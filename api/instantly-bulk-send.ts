export const config = { runtime: "nodejs" };

import type { IncomingMessage, ServerResponse } from "node:http";
import { addLeadsToInstantlyCampaign } from "../lib/instantly.js";
import { markContactsAddedToInstantly } from "../lib/enrichedContactsRepo.js";

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
  campaignId?: string;
  leads?: Array<{
    contactId?: number;
    email?: string;
    first_name?: string;
    company_name?: string;
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
  const apiKey = process.env.INSTANTLY_API_KEY;
  if (!apiKey) {
    sendJson(res, 500, { error: "Missing INSTANTLY_API_KEY on server" });
    return;
  }
  try {
    const raw = await readRawBody(req);
    const body = JSON.parse(raw) as ReqBody;
    const campaignId = (body.campaignId ?? "").trim();
    if (!campaignId) {
      sendJson(res, 400, { error: "campaignId is required" });
      return;
    }
    const leads = (Array.isArray(body.leads) ? body.leads : [])
      .map((lead) => ({
        contactId: Number(lead.contactId),
        email: (lead.email ?? "").trim(),
        first_name: (lead.first_name ?? "").trim(),
        company_name: (lead.company_name ?? "").trim(),
      }))
      .filter((lead) => lead.email.length > 0);

    const result = await addLeadsToInstantlyCampaign({
      apiKey,
      campaignId,
      leads: leads.map((lead) => ({
        email: lead.email,
        first_name: lead.first_name,
        company_name: lead.company_name,
      })),
    });
    const byEmail = new Map<string, number>();
    for (const lead of leads) {
      const email = lead.email.trim().toLowerCase();
      if (email && Number.isFinite(lead.contactId) && lead.contactId > 0) {
        byEmail.set(email, lead.contactId);
      }
    }
    const successfulIds = result.createdLeadEmails
      .map((email) => byEmail.get(email))
      .filter((id): id is number => typeof id === "number" && Number.isFinite(id) && id > 0);
    const markedInstantly = await markContactsAddedToInstantly(successfulIds);
    sendJson(res, 200, { ...result, markedInstantly, markedContactIds: successfulIds });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send Instantly leads";
    sendJson(res, 500, { error: message });
  }
}
