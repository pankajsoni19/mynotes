import { expect, test } from "bun:test";
import { contentUrl, formatBytes, uploadErrorMessage } from "../src/files/filesApi";

test("upload errors name the limit, the full store, and the concurrency cap", () => {
  expect(uploadErrorMessage(413, { error: "File is too large", code: "FILE_TOO_LARGE", limitBytes: 100 * 1024 * 1024 })).toBe("File is larger than the 100 MB limit");
  expect(uploadErrorMessage(413, {})).toBe("File is too large");
  expect(uploadErrorMessage(507, { code: "DISK_FULL" })).toBe("Storage is full");
  expect(uploadErrorMessage(507, { code: "QUOTA_EXCEEDED" })).toBe("Your storage quota is full");
  expect(uploadErrorMessage(429, { code: "TOO_MANY_UPLOADS" })).toContain("Too many uploads at once");
  expect(uploadErrorMessage(404, { error: "Folder not found" })).toBe("Folder not found");
  expect(uploadErrorMessage(500, "oops")).toBe("Upload failed (500)");
  expect(uploadErrorMessage(0, null)).toContain("Network error");
});

test("sizes are human readable and content URLs carry the disposition", () => {
  expect(formatBytes(0)).toBe("0 B");
  expect(formatBytes(1536)).toBe("1.5 KB");
  expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB");
  expect(contentUrl("abc", "inline")).toBe("/api/files/abc/content?disposition=inline");
});
