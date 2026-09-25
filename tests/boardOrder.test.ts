import { describe, expect, test } from "bun:test";
import { byPosition, MIN_GAP, planInsert, POSITION_STEP } from "../server/tasks/boardOrder";

const items = (...positions: number[]) => positions.map((position, index) => ({ id: `i${index}`, position }));

describe("boardOrder.planInsert", () => {
  test("an empty list starts at the step", () => {
    expect(planInsert([], undefined)).toEqual({ position: POSITION_STEP, renumbered: null });
    expect(planInsert([], null)).toEqual({ position: POSITION_STEP, renumbered: null });
  });

  test("bottom is last + 1024, top is half the first, after an anchor is the midpoint", () => {
    const list = items(1024, 2048, 3072);
    expect(planInsert(list, undefined)).toEqual({ position: 4096, renumbered: null });
    expect(planInsert(list, null)).toEqual({ position: 512, renumbered: null });
    expect(planInsert(list, "i0")).toEqual({ position: 1536, renumbered: null });
    expect(planInsert(list, "i1")).toEqual({ position: 2560, renumbered: null });
    // After the last item is the bottom.
    expect(planInsert(list, "i2")).toEqual({ position: 4096, renumbered: null });
  });

  test("the input order does not matter; positions decide", () => {
    const list = [{ id: "b", position: 2048 }, { id: "a", position: 1024 }];
    expect(planInsert(list, "a")).toEqual({ position: 1536, renumbered: null });
    expect([...list].sort(byPosition).map((item) => item.id)).toEqual(["a", "b"]);
    // Equal positions tie-break on id.
    expect([{ id: "z", position: 1 }, { id: "y", position: 1 }].sort(byPosition).map((item) => item.id)).toEqual(["y", "z"]);
  });

  test("a stale anchor returns null", () => {
    expect(planInsert(items(1024), "missing")).toBeNull();
  });

  test("renumbers the list when the new gap would drop below 1e-6", () => {
    const list = items(1, 1 + 1.5e-6, 5);
    const plan = planInsert(list, "i0")!;
    expect(plan.renumbered).toEqual([{ id: "i0", position: 1024 }, { id: "i1", position: 3072 }, { id: "i2", position: 4096 }]);
    expect(plan.position).toBe(2048);
    // A gap that stays at or above MIN_GAP is kept.
    const roomy = planInsert(items(1, 1 + 4 * MIN_GAP), "i0")!;
    expect(roomy.renumbered).toBeNull();
    expect(roomy.position).toBeCloseTo(1 + 2 * MIN_GAP, 12);
  });

  test("renumbers at the top when the first position is too small", () => {
    const plan = planInsert(items(1e-6, 2), null)!;
    expect(plan).toEqual({ position: 1024, renumbered: [{ id: "i0", position: 2048 }, { id: "i1", position: 3072 }] });
    const bottom = planInsert(items(1, 2 - 1e-7, 2), "i1")!;
    expect(bottom.renumbered?.map((item) => item.position)).toEqual([1024, 2048, 4096]);
    expect(bottom.position).toBe(3072);
  });

  test("repeated inserts at one spot eventually renumber and stay strictly ordered", () => {
    let list = items(1024, 2048);
    let renumbers = 0;
    for (let round = 0; round < 80; round += 1) {
      const plan = planInsert(list, "i0")!;
      if (plan.renumbered) {
        renumbers += 1;
        list = plan.renumbered;
      }
      list = [...list, { id: `n${round}`, position: plan.position }].sort(byPosition);
      const positions = list.map((item) => item.position);
      for (let index = 1; index < positions.length; index += 1) expect(positions[index]! - positions[index - 1]!).toBeGreaterThanOrEqual(MIN_GAP);
      // The new item sits directly after the anchor.
      expect(list[list.findIndex((item) => item.id === "i0") + 1]!.id).toBe(`n${round}`);
    }
    expect(renumbers).toBeGreaterThan(0);
  });
});
