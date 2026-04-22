/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `true` / `1` — bật `debug` / `info` trong `src/lib/logger.ts` (browser). */
  readonly VITE_DEBUG_LOGS?: string;
}
