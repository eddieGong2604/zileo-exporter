export const config = { runtime: "nodejs" };

import type { IncomingMessage, ServerResponse } from "node:http";
import { bulkRevealEmailsWithApollo } from "../lib/apolloBulkMatch.js";
import { updateContactEmails } from "../lib/enrichedContactsRepo.js";

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

type ReqBody = {
  contacts?: Array<{
    id?: number;
    linkedinUrl?: string;
    firstName?: string;
    contactName?: string;
    companyName?: string;
  }>;
};

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    sendJson(res, 500, { error: "Missing APOLLO_API_KEY on server" });
    return;
  }

  try {
    const raw = await readRawBody(req);
    const body = JSON.parse(raw) as ReqBody;
    const contacts = Array.isArray(body.contacts) ? body.contacts : [];
    const mapped = contacts
      .map((c) => {
        const fullName = (c.contactName ?? "").trim();
        const [firstFromName = "", ...rest] = fullName.split(/\s+/).filter(Boolean);
        return {
          contactId: Number(c.id),
          linkedinUrl: (c.linkedinUrl ?? "").trim(),
          firstName: (c.firstName ?? "").trim() || firstFromName || undefined,
          lastName: rest.length > 0 ? rest.join(" ") : undefined,
          name: fullName || undefined,
          organizationName: (c.companyName ?? "").trim() || undefined,
        };
      })
      .filter((c) => Number.isFinite(c.contactId) && c.contactId > 0 && c.linkedinUrl);

    if (mapped.length === 0) {
      sendJson(res, 200, { requested: 0, matchedWithEmail: 0, updated: 0, updates: [] });
      return;
    }

    const found = await bulkRevealEmailsWithApollo({ apiKey, people: mapped });
    const updates = found.map((f) => ({ id: f.contactId, email: f.email }));
    const updated = await updateContactEmails(updates);
    sendJson(res, 200, {
      requested: mapped.length,
      matchedWithEmail: found.length,
      updated,
      updates,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to reveal emails with Apollo";
    sendJson(res, 500, { error: message });
  }
}
