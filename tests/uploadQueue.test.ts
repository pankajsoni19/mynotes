import { expect, test } from "bun:test";
import { canRetryUpload, emptyUploadQueue, uploadQueueReducer, uploadQueueSummary, uploadsToStart, type UploadAction, type UploadQueueState } from "../src/files/uploadQueue";

const uploads = ["a", "b", "c", "d"].map((id) => ({ id, key: `key-${id}`, name: `${id}.txt`, size: 10, folderId: null }));

function run(...actions: UploadAction[]): UploadQueueState {
  return actions.reduce(uploadQueueReducer, emptyUploadQueue);
}

const status = (state: UploadQueueState) => state.items.map((item) => item.status);

test("enqueued files wait as queued and duplicates are ignored", () => {
  const state = run({ type: "enqueue", uploads }, { type: "enqueue", uploads: uploads.slice(0, 1) });
  expect(status(state)).toEqual(["queued", "queued", "queued", "queued"]);
  expect(uploadsToStart(state).map((item) => item.id)).toEqual(["a", "b"]);
});

test("no more than two uploads run at once", () => {
  const state = run({ type: "enqueue", uploads }, { type: "start", id: "a" }, { type: "start", id: "b" }, { type: "start", id: "c" });
  expect(status(state)).toEqual(["uploading", "uploading", "queued", "queued"]);
  expect(uploadsToStart(state)).toEqual([]);
  const next = uploadQueueReducer(state, { type: "succeed", id: "a", documentId: "doc-a" });
  expect(uploadsToStart(next).map((item) => item.id)).toEqual(["c"]);
});

test("progress only moves forward while uploading", () => {
  let state = run({ type: "enqueue", uploads }, { type: "progress", id: "a", loaded: 5, total: 10 });
  expect(state.items[0].progress).toBe(0);
  state = run({ type: "enqueue", uploads }, { type: "start", id: "a" }, { type: "progress", id: "a", loaded: 5, total: 10 }, { type: "progress", id: "a", loaded: 2, total: 10 });
  expect(state.items[0].progress).toBe(0.5);
  expect(uploadQueueReducer(state, { type: "progress", id: "a", loaded: 30, total: 10 }).items[0].progress).toBe(1);
});

test("cancel stops queued and running uploads and frees a slot", () => {
  const state = run({ type: "enqueue", uploads }, { type: "start", id: "a" }, { type: "start", id: "b" }, { type: "cancel", id: "a" }, { type: "cancel", id: "d" });
  expect(status(state)).toEqual(["canceled", "uploading", "queued", "canceled"]);
  expect(uploadsToStart(state).map((item) => item.id)).toEqual(["c"]);
  // A late failure from the aborted request does not overwrite the cancel.
  expect(uploadQueueReducer(state, { type: "fail", id: "a", error: "late" }).items[0].status).toBe("canceled");
});

test("a failure keeps the error and code", () => {
  const state = run({ type: "enqueue", uploads }, { type: "start", id: "a" }, { type: "fail", id: "a", error: "Storage is full", code: "DISK_FULL" });
  expect(state.items[0]).toMatchObject({ status: "failed", error: "Storage is full", code: "DISK_FULL" });
  expect(uploadQueueSummary(state)).toBe("3 uploading, 1 failed");
});

test("retry requeues with the same idempotency key and a new attempt", () => {
  const failed = run({ type: "enqueue", uploads }, { type: "start", id: "a" }, { type: "progress", id: "a", loaded: 4, total: 10 }, { type: "fail", id: "a", error: "Network error" });
  const retried = uploadQueueReducer(failed, { type: "retry", id: "a" });
  expect(retried.items[0]).toMatchObject({ status: "queued", key: "key-a", progress: 0, error: null });
  const restarted = uploadQueueReducer(retried, { type: "start", id: "a" });
  expect(restarted.items[0]).toMatchObject({ status: "uploading", key: "key-a", attempt: 2 });
  const canceled = run({ type: "enqueue", uploads }, { type: "cancel", id: "b" }, { type: "retry", id: "b" });
  expect(canceled.items[1]).toMatchObject({ status: "queued", key: "key-b" });
});

test("completed uploads never run again", () => {
  const done = run({ type: "enqueue", uploads }, { type: "start", id: "a" }, { type: "succeed", id: "a", documentId: "doc-a" });
  for (const action of [{ type: "retry", id: "a" }, { type: "start", id: "a" }, { type: "cancel", id: "a" }, { type: "fail", id: "a", error: "x" }] as UploadAction[]) {
    expect(uploadQueueReducer(done, action)).toBe(done);
  }
  expect(done.items[0]).toMatchObject({ status: "done", progress: 1, documentId: "doc-a" });
  expect(uploadsToStart(done).map((item) => item.id)).toEqual(["b", "c"]);
  const cleared = uploadQueueReducer(done, { type: "clearFinished" });
  expect(cleared.items.map((item) => item.id)).toEqual(["b", "c", "d"]);
});

test("final failures cannot be retried", () => {
  const cases: [string | null, number][] = [["IDEMPOTENCY_KEY_USED", 409], ["FILE_TOO_LARGE", 413], [null, 413], [null, 415]];
  for (const [code, httpStatus] of cases) {
    const failed = run({ type: "enqueue", uploads }, { type: "start", id: "a" }, { type: "fail", id: "a", error: "No", code, status: httpStatus });
    expect(failed.items[0]).toMatchObject({ status: "failed", final: true });
    expect(canRetryUpload(failed.items[0])).toBe(false);
    expect(uploadQueueReducer(failed, { type: "retry", id: "a" })).toBe(failed);
  }
  const transient = run({ type: "enqueue", uploads }, { type: "start", id: "a" }, { type: "fail", id: "a", error: "Busy", status: 429 });
  expect(canRetryUpload(transient.items[0])).toBe(true);
  expect(uploadQueueReducer(transient, { type: "retry", id: "a" }).items[0]).toMatchObject({ status: "queued", final: false });
});
