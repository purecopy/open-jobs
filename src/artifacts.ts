import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getRunId } from "./logger.js";

const RUNS_DIR = "runs";

export function isArtifactStorageEnabled(): boolean {
  return (
    process.env.STORE_ARTIFACTS === "true" || process.env.LOG_LEVEL === "debug"
  );
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

export function storeArtifact(
  category: string,
  name: string,
  content: string
): void {
  if (!isArtifactStorageEnabled()) {
    return;
  }

  const dir = join(RUNS_DIR, getRunId(), category);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, sanitize(name)), content, "utf-8");
}
