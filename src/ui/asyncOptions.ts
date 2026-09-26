// Debounced, abortable option loading for Combobox `loadOptions` (D114): 200 ms after the last
// keystroke, and each new request aborts the one before it, so a slow early answer never replaces a
// later one. The scheduler is injectable for tests.

export const LOAD_DEBOUNCE_MS = 200;

type Schedule = (run: () => void, ms: number) => () => void;
const defaultSchedule: Schedule = (run, ms) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

export function createOptionLoader<T>(
  load: (query: string, signal: AbortSignal) => Promise<T>,
  handlers: { onResult: (query: string, result: T) => void; onError: (query: string, error: unknown) => void },
  options: { delay?: number; schedule?: Schedule } = {}
) {
  const schedule = options.schedule ?? defaultSchedule;
  let cancelTimer: (() => void) | null = null;
  let controller: AbortController | null = null;

  function cancel() {
    cancelTimer?.();
    cancelTimer = null;
    controller?.abort();
    controller = null;
  }

  function request(query: string) {
    cancel();
    cancelTimer = schedule(() => {
      cancelTimer = null;
      const current = new AbortController();
      controller = current;
      load(query, current.signal).then(
        (result) => { if (!current.signal.aborted) handlers.onResult(query, result); },
        (error) => { if (!current.signal.aborted) handlers.onError(query, error); }
      );
    }, options.delay ?? LOAD_DEBOUNCE_MS);
  }

  return { request, cancel };
}
