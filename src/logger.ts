const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

const configuredLevel: Level =
  (process.env.LOG_LEVEL as Level) in LEVELS
    ? (process.env.LOG_LEVEL as Level)
    : "info";

const runId = new Date()
  .toISOString()
  .replace(/:/g, "-")
  .replace(/\.\d+Z$/, "");

export function getRunId(): string {
  return runId;
}

interface Logger {
  debug: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

export function createLogger(module: string): Logger {
  const write = (level: Level, msg: string) => {
    if (LEVELS[level] < LEVELS[configuredLevel]) {
      return;
    }
    const ts = new Date().toISOString();
    process.stderr.write(
      `[${ts}] [${level.toUpperCase()}] [${module}] ${msg}\n`
    );
  };

  return {
    debug: (msg: string) => write("debug", msg),
    info: (msg: string) => write("info", msg),
    warn: (msg: string) => write("warn", msg),
    error: (msg: string) => write("error", msg),
  };
}
