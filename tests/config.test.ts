import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

const configPath = join(import.meta.dir, "..", "server", "config.ts");

/** Imports server/config.ts in a fresh process (outside the repository, so no .env is loaded). */
function loadConfig(env: Record<string, string>) {
  const result = Bun.spawnSync(["bun", "--eval", `const { config } = await import(${JSON.stringify(configPath)}); console.log(JSON.stringify({ maxUploadBytes: config.maxUploadBytes, userStorageQuotaBytes: config.userStorageQuotaBytes, minFreeDiskBytes: config.minFreeDiskBytes }));`], {
    cwd: tmpdir(),
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", DATA_DIR: join(tmpdir(), "mynotes-config-test"), ...env },
    stdout: "pipe",
    stderr: "pipe"
  });
  return { ok: result.exitCode === 0, stdout: result.stdout.toString().trim(), stderr: result.stderr.toString() };
}

describe("upload limit configuration", () => {
  test("uses the documented defaults", () => {
    const result = loadConfig({});
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.stdout)).toEqual({ maxUploadBytes: 104_857_600, userStorageQuotaBytes: 10_737_418_240, minFreeDiskBytes: 1_073_741_824 });
  });

  test("accepts valid values, including an unlimited quota", () => {
    const result = loadConfig({ MAX_UPLOAD_BYTES: "1048576", USER_STORAGE_QUOTA_BYTES: "0", MIN_FREE_DISK_BYTES: "0" });
    expect(JSON.parse(result.stdout)).toEqual({ maxUploadBytes: 1_048_576, userStorageQuotaBytes: 0, minFreeDiskBytes: 0 });
  });

  test("rejects out-of-range and non-integer values", () => {
    for (const env of [
      { MAX_UPLOAD_BYTES: "1048575" },
      { MAX_UPLOAD_BYTES: "2147483649" },
      { MAX_UPLOAD_BYTES: "10MB" },
      { MAX_UPLOAD_BYTES: "1e7" },
      { USER_STORAGE_QUOTA_BYTES: "-1" },
      { MIN_FREE_DISK_BYTES: "1.5" }
    ]) {
      const result = loadConfig(env);
      expect(result.ok).toBe(false);
      expect(result.stderr).toContain(`${Object.keys(env)[0]} must be an integer between`);
    }
  });
});
