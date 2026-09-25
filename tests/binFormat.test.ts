import { describe, expect, test } from "bun:test";
import { binFolderLabel, binItemLabel, daysUntilPurge, deleteForeverConfirm, emptiedMessage, emptyBinConfirm, filterBinItems, purgeCountdownLabel, restoredMessage } from "../src/bin/binFormat";
import type { BinItem } from "../src/types";

const DAY = 86_400_000;
const now = Date.parse("2026-09-25T12:00:00.000Z");
const at = (offsetMs: number) => new Date(now + offsetMs).toISOString();

describe("Bin countdown", () => {
  test("a fresh deletion reads 30 days and partial days round up", () => {
    expect(daysUntilPurge(at(30 * DAY), now)).toBe(30);
    expect(daysUntilPurge(at(30 * DAY - 1000), now)).toBe(30);
    expect(daysUntilPurge(at(29 * DAY + 1), now)).toBe(30);
    expect(daysUntilPurge(at(29 * DAY), now)).toBe(29);
    expect(daysUntilPurge(at(1), now)).toBe(1);
  });

  test("due, overdue, and malformed dates never go negative", () => {
    expect(daysUntilPurge(at(0), now)).toBe(0);
    expect(daysUntilPurge(at(-5 * DAY), now)).toBe(0);
    expect(daysUntilPurge("not a date", now)).toBe(0);
  });

  test("labels use singular and plural forms and say soon when due", () => {
    expect(purgeCountdownLabel(at(30 * DAY), now)).toBe("Deletes in 30 days");
    expect(purgeCountdownLabel(at(DAY / 2), now)).toBe("Deletes in 1 day");
    expect(purgeCountdownLabel(at(-1), now)).toBe("Deletes soon");
  });
});

describe("Bin labels and copy", () => {
  const item = (type: BinItem["type"], extra: Partial<BinItem> = {}): BinItem => ({
    type, id: crypto.randomUUID(), title: "Plan", folder_id: null, folder_name: null, size_bytes: type === "document" ? 10 : null,
    deleted_at: at(0), purge_after: at(30 * DAY), purging: false, ...extra
  });

  test("the folder falls back to Default when the original is gone", () => {
    expect(binFolderLabel({ folder_name: "Projects" })).toBe("Projects");
    expect(binFolderLabel({ folder_name: null })).toBe("Default");
  });

  test("filters by type and keeps order", () => {
    const items = [item("document"), item("note"), item("document")];
    expect(filterBinItems(items, "all")).toEqual(items);
    expect(filterBinItems(items, "note")).toEqual([items[1]!]);
    expect(filterBinItems(items, "document")).toEqual([items[0]!, items[2]!]);
  });

  test("blank titles get a readable fallback", () => {
    expect(binItemLabel({ title: "  ", type: "note" })).toBe("Untitled note");
    expect(binItemLabel({ title: "", type: "document" })).toBe("Untitled file");
    expect(binItemLabel({ title: "Report.pdf", type: "document" })).toBe("Report.pdf");
  });

  test("confirmation and toast copy", () => {
    expect(deleteForeverConfirm("Plan")).toBe("Permanently delete “Plan”? This can't be undone.");
    expect(emptyBinConfirm(1)).toBe("Permanently delete 1 item in the Bin? This can't be undone.");
    expect(emptyBinConfirm(4)).toBe("Permanently delete 4 items in the Bin? This can't be undone.");
    expect(emptyBinConfirm(499)).toBe("Permanently delete 499 items in the Bin? This can't be undone.");
    expect(emptyBinConfirm(500)).toBe("Permanently delete all 500+ items in the Bin? This can't be undone.");
    expect(restoredMessage("Projects", "private")).toBe("Restored to Projects");
    expect(restoredMessage("Default", "all_users")).toBe("Restored to Default · shared with everyone");
    expect(restoredMessage("Team", "selected")).toBe("Restored to Team · shared with selected people");
    expect(emptiedMessage(3, 0)).toBe("3 items deleted forever");
    expect(emptiedMessage(1, 2)).toBe("1 item deleted forever. 2 still finishing.");
  });
});
