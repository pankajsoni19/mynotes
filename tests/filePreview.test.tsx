import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FilePreview } from "../src/files/FilePreview";
import type { DocumentSummary, PreviewKind } from "../src/types";

const base: DocumentSummary = {
  id: "a1b2c3d4-e5f6-4a7b-9c8d-0e1f2a3b4c5d", owner_id: "u1", owner_name: "Ada", is_owner: 1, folder_id: null,
  name: "report.bin", mime_type: "application/octet-stream", preview_kind: "none", size_bytes: 2048,
  visibility: "private", sharing_override: 0, created_at: "2026-09-01T10:00:00.000Z", updated_at: "2026-09-02T10:00:00.000Z"
};
const inline = `/api/files/${base.id}/content?disposition=inline`;
const render = (kind: PreviewKind, extra: Partial<DocumentSummary> = {}) => renderToStaticMarkup(<FilePreview document={{ ...base, preview_kind: kind, ...extra }} folderName="Default" onBack={() => undefined} />);

test("every preview offers an attachment download link", () => {
  for (const kind of ["image", "pdf", "text", "audio", "video", "none"] as const) {
    expect(render(kind)).toContain(`href="/api/files/${base.id}/content?disposition=attachment" download=""`);
  }
});

test("inline previews follow the rendering rules", () => {
  expect(render("image")).toContain(`<img src="${inline}" alt="report.bin" loading="lazy"`);
  expect(render("pdf")).toContain(`href="${inline}" target="_blank" rel="noopener noreferrer"`);
  expect(render("audio")).toMatch(/<audio controls="" preload="metadata" src="[^"]+disposition=inline"/);
  expect(render("video")).toMatch(/<video controls="" preload="metadata" playsInline="" src="[^"]+disposition=inline"/);
  expect(render("none")).not.toContain("disposition=inline");
  expect(render("none")).toContain("No preview is available");
});

test("details list owner, folder, and effective access", () => {
  const markup = render("none", { is_owner: 0, owner_name: "Grace", visibility: "selected" });
  expect(markup).toContain("Grace");
  expect(markup).toContain("Default");
  expect(markup).toContain("Shared with selected people");
  expect(markup).toContain("2 KB");
});
