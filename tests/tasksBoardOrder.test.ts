import { expect, test } from "bun:test";
import {
  afterCardIdAt,
  applyLocalMove,
  applyPositions,
  CARD_DRAG_TYPE,
  cardPlace,
  columnCards,
  columnMoveAnchor,
  isCardDrag,
  isNoopMove,
  keyboardMoveTarget,
  readCardDragPayload
} from "../src/tasks/boardOrder";

const columns = [{ id: "todo", name: "To do", position: 1024 }, { id: "doing", name: "Doing", position: 2048 }, { id: "done", name: "Done", position: 3072 }];
const cards = [
  { id: "a", column_id: "todo", position: 1024 },
  { id: "b", column_id: "todo", position: 2048 },
  { id: "c", column_id: "todo", position: 3072 },
  { id: "x", column_id: "doing", position: 1024 }
];
const ids = (list: Array<{ id: string }>) => list.map((item) => item.id);

test("the drag payload is a validated UUID only", () => {
  const id = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
  expect(CARD_DRAG_TYPE).toBe("application/x-mynotes-card");
  expect(readCardDragPayload(` ${id.toUpperCase()} `)).toBe(id);
  for (const value of ["", null, undefined, "javascript:alert(1)", `${id}x`, "<img src=x onerror=alert(1)>", `{"id":"${id}"}`]) expect(readCardDragPayload(value)).toBeNull();
  expect(isCardDrag(["text/plain", CARD_DRAG_TYPE])).toBe(true);
  expect(isCardDrag(["Files"])).toBe(false);
  expect(isCardDrag(null)).toBe(false);
});

test("drop slots map to afterCardId anchors, ignoring the dragged card", () => {
  const todo = columnCards(cards, "todo");
  expect(ids(todo)).toEqual(["a", "b", "c"]);
  expect(afterCardIdAt(todo, 0, "c")).toBeNull();
  expect(afterCardIdAt(todo, 1, "c")).toBe("a");
  expect(afterCardIdAt(todo, 2, "a")).toBe("c");
  expect(afterCardIdAt(todo, 99, "x")).toBe("c");
  expect(afterCardIdAt(todo, -3, "x")).toBeNull();
  expect(isNoopMove(cards, "b", "todo", "a")).toBe(true);
  expect(isNoopMove(cards, "a", "todo", null)).toBe(true);
  expect(isNoopMove(cards, "a", "todo", "b")).toBe(false);
  expect(isNoopMove(cards, "a", "doing", null)).toBe(false);
});

test("local moves mirror the server's midpoint and bottom rules", () => {
  expect(ids(columnCards(applyLocalMove(cards, "c", "todo", null), "todo"))).toEqual(["c", "a", "b"]);
  expect(applyLocalMove(cards, "c", "todo", null).find((card) => card.id === "c")!.position).toBe(512);
  expect(applyLocalMove(cards, "c", "todo", "a").find((card) => card.id === "c")!.position).toBe(1536);
  const across = applyLocalMove(cards, "a", "doing", "x");
  expect(across.find((card) => card.id === "a")).toEqual({ id: "a", column_id: "doing", position: 2048 });
  expect(ids(columnCards(across, "doing"))).toEqual(["x", "a"]);
  expect(applyLocalMove(cards, "missing", "doing", null)).toEqual(cards);
  const renumbered = applyPositions(cards, [{ id: "a", position: 5 }, { id: "zzz", position: 1 }]);
  expect(renumbered.find((card) => card.id === "a")!.position).toBe(5);
  expect(renumbered).toHaveLength(4);
});

test("Alt+Arrow targets move within and across columns and stop at edges", () => {
  expect(keyboardMoveTarget(cards, columns, "a", "ArrowUp")).toBeNull();
  expect(keyboardMoveTarget(cards, columns, "b", "ArrowUp")).toEqual({ columnId: "todo", afterCardId: null });
  expect(keyboardMoveTarget(cards, columns, "c", "ArrowUp")).toEqual({ columnId: "todo", afterCardId: "a" });
  expect(keyboardMoveTarget(cards, columns, "a", "ArrowDown")).toEqual({ columnId: "todo", afterCardId: "b" });
  expect(keyboardMoveTarget(cards, columns, "c", "ArrowDown")).toBeNull();
  expect(keyboardMoveTarget(cards, columns, "a", "ArrowLeft")).toBeNull();
  // Same index in the next column, clamped to its end.
  expect(keyboardMoveTarget(cards, columns, "a", "ArrowRight")).toEqual({ columnId: "doing", afterCardId: null });
  expect(keyboardMoveTarget(cards, columns, "c", "ArrowRight")).toEqual({ columnId: "doing", afterCardId: "x" });
  expect(keyboardMoveTarget(cards, columns, "x", "ArrowRight")).toEqual({ columnId: "done", afterCardId: null });
  expect(keyboardMoveTarget(cards, columns, "x", "ArrowLeft")).toEqual({ columnId: "todo", afterCardId: null });
  expect(cardPlace(cards, columns, "b")).toBe("To do, 2 of 3");
});

test("column ←/→ anchors", () => {
  expect(columnMoveAnchor(columns, "todo", -1)).toBeUndefined();
  expect(columnMoveAnchor(columns, "todo", 1)).toBe("doing");
  expect(columnMoveAnchor(columns, "doing", -1)).toBeNull();
  expect(columnMoveAnchor(columns, "doing", 1)).toBe("done");
  expect(columnMoveAnchor(columns, "done", 1)).toBeUndefined();
  expect(columnMoveAnchor(columns, "done", -1)).toBe("todo");
});
