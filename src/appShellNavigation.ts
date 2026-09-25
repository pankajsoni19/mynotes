export type AppSection = "home" | "notes" | "files" | "bin";

const historyKey = "mynotes.app-shell";
const historyVersion = 1;

export type MyNotesAppHistoryState = {
  [historyKey]: {
    version: number;
    userId: string;
    section: AppSection;
  };
};

export function createAppHistoryState(userId: string, section: AppSection, currentState: unknown): MyNotesAppHistoryState {
  const base = currentState && typeof currentState === "object" ? currentState as Record<string, unknown> : {};
  return { ...base, [historyKey]: { version: historyVersion, userId, section } };
}

export function readAppHistorySection(state: unknown, userId: string): AppSection | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[historyKey];
  if (!value || typeof value !== "object") return null;
  const entry = value as { version?: unknown; userId?: unknown; section?: unknown };
  if (entry.version !== historyVersion || entry.userId !== userId) return null;
  return entry.section === "home" || entry.section === "notes" || entry.section === "files" || entry.section === "bin" ? entry.section : null;
}
