import { api } from "../api";

/** docs/plan/API_CONTRACTS.md § Today. Each section holds at most ten items. */
export type TodaySection<T = Record<string, unknown>> = { items: T[]; more: boolean; href: string; error?: string };
export type TodayResponse = { generatedAt: string; date: string; sections: Record<string, TodaySection> };

/** The viewer's IANA zone; the server refuses anything else, so fall back to UTC. */
export function viewerTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export const getToday = (sections?: readonly string[], tz = viewerTimeZone()) => {
  const query = new URLSearchParams({ tz });
  if (sections?.length) query.set("sections", sections.join(","));
  return api<TodayResponse>(`/today?${query}`);
};
