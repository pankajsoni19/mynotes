import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MODULE_IDS as SERVER_MODULE_IDS } from "../server/moduleIds";
import { AccountActions } from "../src/AppShell";
import { ModulesSettings } from "../src/ModulesSettings";
import {
  DEFAULT_PREFERENCES,
  hiddenModuleForApp,
  hiddenTodaySections,
  isAppEnabled,
  isModuleEnabled,
  MODULE_IDS,
  MODULES,
  ModulesContext,
  moduleOffHint,
  normalizeDisabledModules,
  parsePreferences,
  SETTINGS_MODULES,
  withModuleEnabled,
  type ModuleId
} from "../src/modules";
import { parseRoute } from "../src/router";
import { TodayHome } from "../src/today/TodayHome";
import { enabledTodayApps, TODAY_APPS } from "../src/today/todayApps";
import { TODAY_SECTIONS } from "../src/today/todaySections";

describe("module registry (D92)", () => {
  test("client and server know the same module ids, in the same order, including the reserved team id", () => {
    expect([...MODULE_IDS]).toEqual([...SERVER_MODULE_IDS]);
    expect(MODULES.map((module) => module.id)).toEqual([...MODULE_IDS]);
    expect(MODULE_IDS).toContain("team");
  });

  test("Settings lists every shipped module and leaves the planned Team module out", () => {
    expect(SETTINGS_MODULES.map((module) => module.id)).toEqual(["notes", "files", "tasks", "collections", "calendar", "search", "bin", "notifications"]);
  });

  test("every Today section belongs to exactly one module", () => {
    const owned = MODULES.flatMap((module) => module.todaySections);
    expect(new Set(owned).size).toBe(owned.length);
    expect([...owned].sort()).toEqual(Object.keys(TODAY_SECTIONS).sort());
  });

  test("unknown ids, duplicates, and non-arrays are ignored, and order follows the registry", () => {
    expect(normalizeDisabledModules(["bin", "home", "calendar", "bin", 7, null, "Calendar"])).toEqual(["calendar", "bin"]);
    expect(normalizeDisabledModules("calendar")).toEqual([]);
    expect(normalizeDisabledModules(undefined)).toEqual([]);
  });

  test("toggling keeps registry order and never duplicates", () => {
    expect(withModuleEnabled([], "bin", false)).toEqual(["bin"]);
    expect(withModuleEnabled(["bin"], "notes", false)).toEqual(["notes", "bin"]);
    expect(withModuleEnabled(["notes", "bin"], "notes", false)).toEqual(["notes", "bin"]);
    expect(withModuleEnabled(["notes", "bin"], "notes", true)).toEqual(["bin"]);
    expect(isModuleEnabled(["bin"], "bin")).toBe(false);
    expect(isModuleEnabled(["bin"], "calendar")).toBe(true);
  });

  test("malformed preferences from the server mean every module is on", () => {
    expect(parsePreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences({ disabledModules: "calendar", revision: -2 })).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences({ disabledModules: ["calendar", "retired"], revision: 3, updatedAt: "2026-09-26T00:00:00.000Z" })).toEqual({ disabledModules: ["calendar"], revision: 3, updatedAt: "2026-09-26T00:00:00.000Z" });
  });

  test("the hint names the module and where to turn it on", () => {
    expect(moduleOffHint("tasks")).toBe("Tasks is turned off. Turn it on in Settings → Modules.");
  });
});

describe("Settings → Modules", () => {
  const render = (disabled: Parameters<typeof ModulesSettings>[0]["disabledModules"], status: Parameters<typeof ModulesSettings>[0]["status"] = null) =>
    renderToStaticMarkup(<ModulesSettings disabledModules={disabled} status={status} onToggle={() => undefined} />);

  test("every module is a labelled switch that is on by default", () => {
    const markup = render([]);
    const switches = [...markup.matchAll(/<button[^>]*role="switch"[^>]*>/g)].map(([tag]) => tag);
    expect(switches).toHaveLength(SETTINGS_MODULES.length);
    for (const tag of switches) expect(tag).toContain('aria-checked="true"');
    expect(markup).toContain('aria-labelledby="module-label-calendar"');
    expect(markup).toContain('id="module-label-calendar">Calendar</strong>');
    expect(markup).not.toContain("module-label-team");
  });

  test("a disabled module shows as off, and the Bin and Notifications help says what keeps working", () => {
    const markup = render(["calendar"]);
    expect(markup).toMatch(/<li class="modules-row off">.*?module-label-calendar/);
    expect(markup).toMatch(/aria-checked="false" aria-labelledby="module-label-calendar"/);
    expect(markup).toContain("Deleting still moves items to the Bin");
    expect(markup).toContain("Reminders and push notifications still arrive");
    expect(markup).toContain("MCP keys and links from other people keep working");
  });

  test("a conflict is a status message and a failure is an alert", () => {
    expect(render([], { kind: "conflict", message: "Changed elsewhere" })).toContain('<p class="modules-notice" role="status">Changed elsewhere</p>');
    expect(render([], { kind: "error", message: "Offline" })).toContain('<p class="form-error" role="alert">Offline</p>');
  });
});

describe("gating (client only)", () => {
  const account = { displayName: "Ada Lovelace", onSettings: () => undefined, onSignOut: () => undefined };
  const home = (disabled: ModuleId[]) => renderToStaticMarkup(<ModulesContext.Provider value={disabled}>
    <TodayHome {...account} userId="u1" onOpen={() => undefined} onOpenRoute={() => undefined} />
  </ModulesContext.Provider>);
  const launcher = (markup: string) => [...markup.matchAll(/class="today-app today-app-([a-z]+)"/g)].map(([, section]) => section);

  test("the launcher is derived from the registry and drops modules that are off", () => {
    expect(TODAY_APPS.map((app) => app.section)).toEqual(["notes", "files", "tasks", "collections", "calendar"]);
    expect(enabledTodayApps(["calendar", "search"]).map((app) => app.section)).toEqual(["notes", "files", "tasks", "collections"]);
    expect(launcher(home([]))).toEqual(["notes", "files", "tasks", "collections", "calendar"]);
    expect(launcher(home(["calendar", "tasks"]))).toEqual(["notes", "files", "collections"]);
  });

  test("Bin off removes the Bin button from Home and from any header, even when the app passes onBin", () => {
    expect(home([])).toContain('title="Bin"');
    expect(home(["bin"])).not.toContain('title="Bin"');
    const header = renderToStaticMarkup(<ModulesContext.Provider value={["bin"]}><AccountActions {...account} onBin={() => undefined} binCount={2} /></ModulesContext.Provider>);
    expect(header).not.toContain('title="Bin"');
    expect(header).toContain('title="Settings"');
  });

  test("the Today sections of modules that are off are hidden", () => {
    expect(hiddenTodaySections([])).toEqual([]);
    expect(hiddenTodaySections(["calendar", "tasks", "bin"])).toEqual(["tasksDue", "tasksMine", "upcoming", "binSoon"]);
    const markup = home(["tasks", "calendar"]);
    expect(markup).not.toContain("today-section-tasksDue");
    expect(markup).not.toContain("today-section-upcoming");
    expect(markup).toContain("today-section-notesRecent");
  });

  test("a hidden module's routes redirect, and Home, Search, and unknown ids never do", () => {
    const eventId = "0f8fad5b-d9cb-469f-a165-70867728950e";
    expect(hiddenModuleForApp(["calendar"], parseRoute(`/calendar/event/${eventId}`).app)).toBe("calendar");
    expect(hiddenModuleForApp(["calendar"], parseRoute("/calendar/month/2026-09").app)).toBe("calendar");
    expect(hiddenModuleForApp(["tasks"], parseRoute("/tasks").app)).toBe("tasks");
    expect(hiddenModuleForApp(["bin"], parseRoute("/bin").app)).toBe("bin");
    expect(hiddenModuleForApp(["notifications"], parseRoute("/notifications").app)).toBe("notifications");
    expect(hiddenModuleForApp(["notes"], parseRoute("/notes").app)).toBe("notes");
    expect(hiddenModuleForApp(["calendar"], parseRoute("/tasks").app)).toBeNull();
    expect(hiddenModuleForApp([...MODULE_IDS], parseRoute("/").app)).toBeNull();
    expect(hiddenModuleForApp(normalizeDisabledModules(["home", "settings"]), parseRoute("/").app)).toBeNull();
    expect(isAppEnabled(["search"], "notes")).toBe(true);
  });
});
