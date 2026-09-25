import { db } from "./db";
import { objectIsIntact, sweepDocumentFiles, type SweepCounts } from "./documentStorage";

const SWEEP_INTERVAL_MS = 3_600_000;
let running: Promise<SweepCounts | null> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

const hasDocumentRow = (id: string) => Boolean(db.query("SELECT 1 FROM documents WHERE id = ?").get(id));

async function countIntegrityErrors() {
  const rows = db.query("SELECT id, size_bytes FROM documents WHERE purge_started_at IS NULL").all() as Array<{ id: string; size_bytes: number }>;
  let broken = 0;
  for (const row of rows) if (!await objectIsIntact(row.id, row.size_bytes)) broken += 1;
  return broken;
}

/** Runs one sweep. Overlapping calls share the run already in flight. Logs counts only. */
export function runSweep(options: { boot?: boolean; nowMs?: number } = {}) {
  running ??= (async () => {
    try {
      const counts = await sweepDocumentFiles({ boot: options.boot ?? false, nowMs: options.nowMs, hasDocumentRow });
      if (counts.stagingRemoved || counts.orphansRemoved || counts.ignored) {
        console.info(`Document sweep: ${counts.stagingRemoved} staging removed, ${counts.orphansRemoved} orphans removed, ${counts.ignored} unexpected entries ignored`);
      }
      if (options.boot) {
        const broken = await countIntegrityErrors();
        if (broken) console.error(`Document integrity check: ${broken} stored documents are missing or have the wrong size`);
      }
      return counts;
    } catch (error) {
      console.error("Document sweep failed", error instanceof Error ? error.name : "Unknown error");
      return null;
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Starts the boot sweep without awaiting it, then sweeps hourly. */
export function startSweeper() {
  if (timer) return;
  void runSweep({ boot: true });
  timer = setInterval(() => void runSweep(), SWEEP_INTERVAL_MS);
  timer.unref();
}
