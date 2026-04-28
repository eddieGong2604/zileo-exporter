export const config = { runtime: "nodejs" };

import type { IncomingMessage, ServerResponse } from "node:http";
import { updateContactFirstName } from "../lib/enrichedContactsRepo.js";

async function readRawBody(req: IncomingMessage): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  try {
    const raw = await readRawBody(req);
    const body = JSON.parse(raw) as { id?: number; firstName?: string };
    const id = Number(body.id);
    const firstName = (body.firstName ?? "").trim();
    if (!Number.isFinite(id) || id <= 0) {
      sendJson(res, 400, { error: "id must be a positive number" });
      return;
    }
    const ok = await updateContactFirstName({ id, firstName });
    sendJson(res, 200, { ok });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update contact first name";
    sendJson(res, 500, { error: message });
  }
}
