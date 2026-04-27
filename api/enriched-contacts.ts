export const config = { runtime: "nodejs" };

import type { IncomingMessage, ServerResponse } from "node:http";
import { createLogger } from "../lib/logger.js";
import { listEnrichedContacts } from "../lib/enrichedContactsRepo.js";

const log = createLogger("api/enriched-contacts");

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const data = await listEnrichedContacts();
    sendJson(res, 200, { data });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load enriched contacts";
    log.error("handler failed", { message });
    sendJson(res, 500, { error: message });
  }
}
