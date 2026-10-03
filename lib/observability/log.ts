/**
 * Structured JSON logging and log-based metrics.
 *
 * No paid monitoring service is part of the free core (spec §63), so metrics are emitted as
 * structured log lines (`kind: "metric"`) that Vercel's runtime logs retain and that can be
 * grepped or exported. Never pass learner source code, tokens or PII in fields.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Readonly<Record<string, string | number | boolean | undefined>>;

export interface Logger {
  log(level: LogLevel, event: string, fields?: LogFields): void;
  metric(name: string, value: number, dimensions?: LogFields): void;
  child(bound: LogFields): Logger;
}

type Sink = (line: string) => void;

const defaultSink: Sink = (line) => {
  process.stdout.write(`${line}\n`);
};

export function createLogger(bound: LogFields = {}, sink: Sink = defaultSink): Logger {
  return {
    log(level, event, fields = {}) {
      sink(JSON.stringify({ ts: new Date().toISOString(), level, event, ...bound, ...fields }));
    },
    metric(name, value, dimensions = {}) {
      sink(JSON.stringify({ ts: new Date().toISOString(), kind: "metric", name, value, ...bound, ...dimensions }));
    },
    child(extra) {
      return createLogger({ ...bound, ...extra }, sink);
    },
  };
}

/** Logger that drops everything; for tests that don't assert on logging. */
export const silentLogger: Logger = {
  log() {},
  metric() {},
  child() {
    return silentLogger;
  },
};
