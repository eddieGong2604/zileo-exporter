/**
 * Logger Node (api/*.ts, lib/*.ts, vite dev).
 * Production: `info` → `console.warn` để dễ thấy trên Vercel Logs.
 * `debug` chỉ khi `NODE_ENV !== "production"` hoặc `DEBUG_LOGS=1`.
 */

const PREFIX = "[zileo-exporter]";

function allowDebug(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.DEBUG_LOGS === "1" ||
    process.env.DEBUG_LOGS === "true"
  );
}

function emit(
  level: "debug" | "info" | "warn" | "error",
  scope: string,
  message: string,
  extra?: unknown,
): void {
  const line = `${PREFIX} [${scope}] ${message}`;
  if (level === "debug" && !allowDebug()) return;

  const prodInfoAsWarn =
    level === "info" && process.env.NODE_ENV === "production";

  if (extra === undefined) {
    if (level === "error") console.error(line);
    else if (level === "warn" || prodInfoAsWarn) console.warn(line);
    else if (level === "info") console.info(line);
    else console.log(line);
  } else if (level === "error") {
    console.error(line, extra);
  } else if (level === "warn" || prodInfoAsWarn) {
    console.warn(line, extra);
  } else if (level === "info") {
    console.info(line, extra);
  } else {
    console.log(line, extra);
  }
}

export function createLogger(scope: string) {
  return {
    debug: (msg: string, extra?: unknown) => emit("debug", scope, msg, extra),
    info: (msg: string, extra?: unknown) => emit("info", scope, msg, extra),
    warn: (msg: string, extra?: unknown) => emit("warn", scope, msg, extra),
    error: (msg: string, extra?: unknown) => emit("error", scope, msg, extra),
    fetchMeta: (
      msg: string,
      res: { status: number; ok: boolean },
      bodyByteLength: number,
    ) => {
      emit(
        "info",
        scope,
        `${msg} status=${res.status} ok=${res.ok} bodyBytes=${bodyByteLength}`,
      );
    },
  };
}
