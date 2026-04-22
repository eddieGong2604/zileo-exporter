/** Logger phía trình duyệt. Chi tiết: `VITE_DEBUG_LOGS=true` hoặc chạy `vite dev`. */

const PREFIX = "[zileo-exporter]";

const verbose =
  import.meta.env.DEV ||
  import.meta.env.VITE_DEBUG_LOGS === "true" ||
  import.meta.env.VITE_DEBUG_LOGS === "1";

function emit(
  level: "debug" | "info" | "warn" | "error",
  scope: string,
  message: string,
  extra?: unknown,
): void {
  const line = `${PREFIX} [${scope}] ${message}`;
  if (level === "debug" && !verbose) return;
  if (level === "info" && !verbose) return;

  if (extra === undefined) {
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else if (level === "info") console.info(line);
    else console.debug(line);
  } else if (level === "error") {
    console.error(line, extra);
  } else if (level === "warn") {
    console.warn(line, extra);
  } else if (level === "info") {
    console.info(line, extra);
  } else {
    console.debug(line, extra);
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
        verbose ? "info" : "warn",
        scope,
        `${msg} status=${res.status} ok=${res.ok} bodyBytes=${bodyByteLength}`,
      );
    },
  };
}
