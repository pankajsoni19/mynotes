/**
 * Every module id a client may turn off in Settings → Modules (D92). `team` is reserved for Wave 14
 * so its UI can plug in without a server change. Keep in step with `MODULE_IDS` in src/modules.ts
 * (tests/modules.test.tsx). A pure module with no imports, so client-side tests can load it.
 */
export const MODULE_IDS = ["notes", "files", "tasks", "collections", "calendar", "search", "bin", "notifications", "team"] as const;
export type ModuleId = (typeof MODULE_IDS)[number];
