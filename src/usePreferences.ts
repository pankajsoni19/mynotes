import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_PREFERENCES, withModuleEnabled, type ModuleId, type Preferences } from "./modules";
import { getPreferences, savePreferences } from "./preferencesApi";

export type PreferencesStatus = { kind: "conflict" | "error"; message: string } | null;

const sameIds = (left: readonly ModuleId[], right: readonly ModuleId[]) => left.length === right.length && left.every((id, index) => right[index] === id);

/**
 * The signed-in user's preferences (D92). Toggles apply at once (optimistic) and are saved one at a
 * time with the last confirmed revision. A 409 shows the server's value; any other failure goes
 * back to the last saved value. Coming back to the tab re-reads them, so another device's change
 * shows up without a reload.
 *
 * `initial` is the value from /api/auth/me; without it (right after sign-in) the hook fetches it.
 */
export function usePreferences(userId: string | null, initial: Preferences | undefined) {
  const [preferences, setPreferences] = useState<Preferences>(initial ?? DEFAULT_PREFERENCES);
  const [status, setStatus] = useState<PreferencesStatus>(null);
  const confirmedRef = useRef<Preferences>(initial ?? DEFAULT_PREFERENCES);
  const desiredRef = useRef<ModuleId[]>((initial ?? DEFAULT_PREFERENCES).disabledModules);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingRef = useRef(0);
  const userRef = useRef(userId);
  const initialRef = useRef(initial);
  initialRef.current = initial;

  const apply = useCallback((next: Preferences) => {
    confirmedRef.current = next;
    desiredRef.current = next.disabledModules;
    setPreferences(next);
  }, []);

  const refresh = useCallback(async () => {
    const user = userRef.current;
    if (!user) return;
    try {
      const next = await getPreferences();
      // A toggle made meanwhile wins; its own save reports any conflict.
      if (userRef.current === user && pendingRef.current === 0 && sameIds(desiredRef.current, confirmedRef.current.disabledModules)) apply(next);
    } catch {
      // Best effort: keep what is shown (for example behind the TOTP setup gate).
    }
  }, [apply]);

  useEffect(() => {
    userRef.current = userId;
    setStatus(null);
    pendingRef.current = 0;
    chainRef.current = Promise.resolve();
    apply(initialRef.current ?? DEFAULT_PREFERENCES);
    if (userId && !initialRef.current) void refresh();
  }, [userId, apply, refresh]);

  useEffect(() => {
    if (!userId) return;
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [userId, refresh]);

  const setModuleEnabled = useCallback((id: ModuleId, enabled: boolean) => {
    const user = userRef.current;
    if (!user) return;
    const next = withModuleEnabled(desiredRef.current, id, enabled);
    desiredRef.current = next;
    setPreferences((current) => ({ ...current, disabledModules: next }));
    setStatus(null);
    pendingRef.current += 1;
    chainRef.current = chainRef.current.then(async () => {
      try {
        if (userRef.current !== user) return;
        const wanted = desiredRef.current;
        if (sameIds(wanted, confirmedRef.current.disabledModules)) return;
        const result = await savePreferences(wanted, confirmedRef.current.revision);
        if (userRef.current !== user) return;
        if (result.ok) {
          confirmedRef.current = result.preferences;
          setPreferences({ ...result.preferences, disabledModules: desiredRef.current });
        } else {
          apply(result.conflict);
          setStatus({ kind: "conflict", message: "Modules were changed on another device or tab. The latest choice is shown; try again if needed." });
        }
      } catch (reason) {
        if (userRef.current !== user) return;
        apply(confirmedRef.current);
        setStatus({ kind: "error", message: `${reason instanceof Error ? reason.message : "Could not save"}. Your modules were not changed.` });
      } finally {
        pendingRef.current = Math.max(0, pendingRef.current - 1);
      }
    });
  }, [apply]);

  return { preferences, status, setModuleEnabled, refresh };
}
