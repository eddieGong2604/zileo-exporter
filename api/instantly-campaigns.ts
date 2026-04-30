export const config = { runtime: "nodejs" };

import type { IncomingMessage, ServerResponse } from "node:http";
import { listInstantlyCampaigns } from "../lib/instantly.js";

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
  const apiKey = process.env.INSTANTLY_API_KEY;
  if (!apiKey) {
    sendJson(res, 500, { error: "Missing INSTANTLY_API_KEY on server" });
    return;
  }
  try {
    const campaigns = await listInstantlyCampaigns({ apiKey });
    sendJson(res, 200, { campaigns });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load Instantly campaigns";
    sendJson(res, 500, { error: message });
  }
}
