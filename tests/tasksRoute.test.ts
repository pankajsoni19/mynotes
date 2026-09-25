import { expect, test } from "bun:test";
import { formatRoute, parseRoute } from "../src/router";
import { parentTasksRoute, tasksBackAction, tasksRoute } from "../src/tasksRoute";
import { carriedTasksState, columnIndexFor, createTasksHistoryState, readTasksHistoryHint } from "../src/tasksNavigation";

const boardId = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
const otherBoard = "4f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
const cardId = "a1b2c3d4-e5f6-4a7b-9c8d-0e1f2a3b4c5d";

test("Tasks URLs parse strictly and normalise", () => {
  expect(parseRoute("/tasks/")).toEqual(tasksRoute());
  expect(parseRoute(`/tasks/${boardId.toUpperCase()}`)).toEqual(tasksRoute(boardId));
  expect(parseRoute(`/tasks/${boardId}/card/${cardId.toUpperCase()}/`)).toEqual(tasksRoute(boardId, cardId));
  // A malformed board id opens the list; anything malformed after a valid board opens the board.
  expect(parseRoute("/tasks/not-a-board")).toEqual(tasksRoute());
  expect(parseRoute(`/tasks/${boardId}/card/nope`)).toEqual(tasksRoute(boardId));
  expect(parseRoute(`/tasks/${boardId}/cards/${cardId}`)).toEqual(tasksRoute(boardId));
  expect(parseRoute(`/tasks/${boardId}/card/${cardId}/extra`)).toEqual(tasksRoute(boardId));
  expect(parseRoute("/tasksx")).toEqual({ app: "home" });
  // A card never formats without its board.
  expect(tasksRoute(null, cardId)).toEqual(tasksRoute());
  expect(formatRoute({ app: "tasks", boardId: null, cardId })).toBe("/tasks");
  expect(formatRoute({ app: "tasks", boardId: "../x", cardId })).toBe("/tasks");
  expect(formatRoute({ app: "tasks", boardId, cardId: "javascript:x" })).toBe(`/tasks/${boardId}`);
});

test("Back steps card → board → list → Home", () => {
  expect(parentTasksRoute(tasksRoute(boardId, cardId))).toEqual(tasksRoute(boardId));
  expect(parentTasksRoute(tasksRoute(boardId))).toEqual(tasksRoute());
  expect(parentTasksRoute(tasksRoute())).toBeNull();
  // Entries this visit pushed are stepped back through, like the browser's Back.
  expect(tasksBackAction(tasksRoute(boardId, cardId), 3)).toEqual({ kind: "history" });
  // A deep link (depth 0) replaces its entry with the parent view and never leaves Nook.
  expect(tasksBackAction(tasksRoute(boardId, cardId), 0)).toEqual({ kind: "replace", route: tasksRoute(boardId) });
  expect(tasksBackAction(tasksRoute(boardId), 0)).toEqual({ kind: "replace", route: tasksRoute() });
  expect(tasksBackAction(tasksRoute(), 0)).toEqual({ kind: "home" });
});

test("the phone column hint round-trips, is bound to its user and board, and is clamped", () => {
  const state = createTasksHistoryState("user-1", { boardId, column: 2 }, { "mynotes.depth": 4, other: true });
  expect(readTasksHistoryHint(state, "user-1")).toEqual({ boardId, column: 2 });
  expect(readTasksHistoryHint(state, "user-2")).toBeNull();
  expect((state as unknown as Record<string, unknown>)["mynotes.depth"]).toBe(4);
  expect((state as unknown as Record<string, unknown>).other).toBe(true);
  expect(columnIndexFor(state, "user-1", boardId, 5)).toBe(2);
  // Fewer columns now (one was deleted): the last one is shown.
  expect(columnIndexFor(state, "user-1", boardId, 2)).toBe(1);
  expect(columnIndexFor(state, "user-1", otherBoard, 5)).toBe(0);
  expect(columnIndexFor(null, "user-1", boardId, 5)).toBe(0);
  expect(readTasksHistoryHint(createTasksHistoryState("user-1", { boardId, column: 99 }, null), "user-1")?.column).toBe(19);
  expect(readTasksHistoryHint(createTasksHistoryState("user-1", { boardId, column: -3 }, null), "user-1")?.column).toBe(0);
  for (const hint of [{ boardId, column: 1.5 }, { boardId, column: 20 }, { boardId, column: "1" }, { column: 1 }, null]) {
    expect(readTasksHistoryHint({ "mynotes.tasks-navigation": { version: 1, userId: "user-1", hint } }, "user-1")).toBeNull();
  }
  expect(readTasksHistoryHint({ "mynotes.tasks-navigation": { version: 2, userId: "user-1", hint: { boardId, column: 1 } } }, "user-1")).toBeNull();
});

test("a history write on the same board keeps the column hint, another board drops it", () => {
  const state = createTasksHistoryState("user-1", { boardId, column: 3 }, null);
  expect(readTasksHistoryHint(carriedTasksState("user-1", boardId, state), "user-1")).toEqual({ boardId, column: 3 });
  expect(carriedTasksState("user-1", otherBoard, state)).toBeNull();
  expect(carriedTasksState("user-1", null, state)).toBeNull();
  expect(carriedTasksState("user-2", boardId, state)).toBeNull();
});
