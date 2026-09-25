import { expect, test } from "bun:test";
import { fileViewStorageKey, gridColumnCount, moveFileSelection, readFileView, writeFileView } from "../src/files/fileView";

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, values };
}

test("the Files view is remembered per user and defaults to the list", () => {
  const storage = memoryStorage();
  expect(fileViewStorageKey("u1")).toBe("mynotes:files-view:u1");
  expect(readFileView(storage, "u1")).toBe("list");
  writeFileView(storage, "u1", "grid");
  expect(storage.values.get("mynotes:files-view:u1")).toBe("grid");
  expect(readFileView(storage, "u1")).toBe("grid");
  expect(readFileView(storage, "u2")).toBe("list");
  storage.values.set("mynotes:files-view:u2", "tiles");
  expect(readFileView(storage, "u2")).toBe("list");
});

test("blocked or missing storage falls back to the list without throwing", () => {
  const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  expect(readFileView(throwing, "u1")).toBe("list");
  expect(() => writeFileView(throwing, "u1", "grid")).not.toThrow();
  expect(readFileView(null, "u1")).toBe("list");
});

test("list keyboard movement is one column and ignores left and right", () => {
  expect(moveFileSelection(-1, "ArrowDown", 5, 1, "list")).toBe(0);
  expect(moveFileSelection(2, "ArrowDown", 5, 4, "list")).toBe(3);
  expect(moveFileSelection(2, "ArrowUp", 5, 4, "list")).toBe(1);
  expect(moveFileSelection(4, "ArrowDown", 5, 1, "list")).toBe(4);
  expect(moveFileSelection(0, "ArrowUp", 5, 1, "list")).toBe(0);
  expect(moveFileSelection(2, "ArrowLeft", 5, 1, "list")).toBeNull();
  expect(moveFileSelection(2, "ArrowRight", 5, 1, "list")).toBeNull();
  expect(moveFileSelection(2, "Enter", 5, 1, "list")).toBeNull();
  expect(moveFileSelection(-1, "ArrowDown", 0, 1, "list")).toBeNull();
});

test("grid keyboard movement follows rows and columns", () => {
  // 10 tiles in 4 columns: rows [0..3], [4..7], [8, 9].
  expect(moveFileSelection(-1, "ArrowRight", 10, 4, "grid")).toBe(0);
  expect(moveFileSelection(-1, "End", 10, 4, "grid")).toBe(9);
  expect(moveFileSelection(1, "ArrowRight", 10, 4, "grid")).toBe(2);
  expect(moveFileSelection(3, "ArrowRight", 10, 4, "grid")).toBe(4);
  expect(moveFileSelection(9, "ArrowRight", 10, 4, "grid")).toBe(9);
  expect(moveFileSelection(4, "ArrowLeft", 10, 4, "grid")).toBe(3);
  expect(moveFileSelection(0, "ArrowLeft", 10, 4, "grid")).toBe(0);
  expect(moveFileSelection(1, "ArrowDown", 10, 4, "grid")).toBe(5);
  expect(moveFileSelection(5, "ArrowDown", 10, 4, "grid")).toBe(9);
  // Nothing directly below 6 and 7: land on the last tile of the shorter row.
  expect(moveFileSelection(7, "ArrowDown", 10, 4, "grid")).toBe(9);
  expect(moveFileSelection(8, "ArrowDown", 10, 4, "grid")).toBe(8);
  expect(moveFileSelection(9, "ArrowUp", 10, 4, "grid")).toBe(5);
  expect(moveFileSelection(2, "ArrowUp", 10, 4, "grid")).toBe(2);
  expect(moveFileSelection(6, "Home", 10, 4, "grid")).toBe(0);
  expect(moveFileSelection(6, "End", 10, 4, "grid")).toBe(9);
});

test("the grid column count comes from the computed track list", () => {
  expect(gridColumnCount("172px 172px 172px")).toBe(3);
  expect(gridColumnCount("200px")).toBe(1);
  expect(gridColumnCount("none")).toBe(1);
  expect(gridColumnCount("")).toBe(1);
  expect(gridColumnCount(undefined)).toBe(1);
});
