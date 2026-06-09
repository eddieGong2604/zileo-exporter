export const config = { runtime: "nodejs", maxDuration: 300 };

import type { IncomingMessage, ServerResponse } from "node:http";
import { createLogger } from "../lib/logger.js";
import { runMeetAlfredAutoSend } from "../lib/meetAlfredAutoSend.js";

const log = createLogger("api/cron-meet-alfred-auto-send");

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function isAuthorized(req: IncomingMessage): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.authorization?.trim() ?? "";
  return auth === `Bearer ${secret}`;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "GET" && req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  if (!isAuthorized(req)) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  try {
    const result = await runMeetAlfredAutoSend();
    sendJson(res, 200, result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Meet Alfred auto-send cron failed";
    log.error("handler failed", { message });
    sendJson(res, 500, { error: message });
  }
}
