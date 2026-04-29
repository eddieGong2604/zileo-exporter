export const config = { runtime: "nodejs" };

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  updateContactEditableField,
  type ContactEditableField,
} from "../lib/enrichedContactsRepo.js";

const BOOLEAN_FIELDS = new Set<ContactEditableField>([
  "is_predicted_origin_blacklisted",
  "is_contact_location_blacklisted",
  "added_to_meetalfred_campaign",
]);

const ALLOWED_FIELDS = new Set<ContactEditableField>([
  "first_name",
  "contact_name",
  "title",
  "contact_linkedin",
  "contact_location",
  "predicted_origin_of_name",
  "is_predicted_origin_blacklisted",
  "is_contact_location_blacklisted",
  "added_to_meetalfred_campaign",
]);

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
    const body = JSON.parse(raw) as {
      id?: number;
      field?: ContactEditableField;
      value?: unknown;
    };
    const id = Number(body.id);
    const field = body.field;
    if (!Number.isFinite(id) || id <= 0) {
      sendJson(res, 400, { error: "id must be a positive number" });
      return;
    }
    if (!field || !ALLOWED_FIELDS.has(field)) {
      sendJson(res, 400, { error: "field is not editable" });
      return;
    }
    const value =
      BOOLEAN_FIELDS.has(field) ? Boolean(body.value) : String(body.value ?? "").trim();
    const ok = await updateContactEditableField({ id, field, value });
    sendJson(res, 200, { ok });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update contact field";
    sendJson(res, 500, { error: message });
  }
}
