export const config = { runtime: "nodejs" };

import type { IncomingMessage, ServerResponse } from "node:http";
import { addLeadsToMeetAlfredCampaign } from "../lib/meetAlfred.js";
import { markContactsAddedToMeetAlfred } from "../lib/enrichedContactsRepo.js";

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
  webhookKey?: string;
  campaignId?: number;
  leads?: Array<{
    contactId?: number;
    linkedin_profile_url?: string;
    csv_firstname?: string;
    csv_companyname?: string;
    csv_email?: string;
    csv_country?: string;
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
  try {
    const raw = await readRawBody(req);
    const body = JSON.parse(raw) as ReqBody;
    const webhookKey = (body.webhookKey ?? "").trim();
    const campaignId = Number(body.campaignId);
    const leads = Array.isArray(body.leads) ? body.leads : [];

    if (!webhookKey) {
      sendJson(res, 400, { error: "webhookKey is required" });
      return;
    }
    if (!Number.isFinite(campaignId) || campaignId <= 0) {
      sendJson(res, 400, { error: "campaignId must be a positive number" });
      return;
    }

    const preparedLeads = leads.map((lead) => ({
      contactId: Number(lead.contactId),
      linkedin_profile_url: (lead.linkedin_profile_url ?? "").trim(),
      csv_firstname: (lead.csv_firstname ?? "").trim(),
      csv_companyname: (lead.csv_companyname ?? "").trim(),
      csv_email: (lead.csv_email ?? "").trim(),
      csv_country: (lead.csv_country ?? "").trim(),
    }));

    const result = await addLeadsToMeetAlfredCampaign({
      webhookKey,
      campaignId,
      leads: preparedLeads.map((lead) => ({
        linkedin_profile_url: lead.linkedin_profile_url,
        csv_firstname: lead.csv_firstname,
        csv_companyname: lead.csv_companyname,
        csv_email: lead.csv_email,
        csv_country: lead.csv_country,
      })),
    });
    const successfulContactIds = result.successIndices
      .map((index) => preparedLeads[index]?.contactId)
      .filter((id): id is number => Number.isFinite(id) && id > 0);
    const marked = await markContactsAddedToMeetAlfred(successfulContactIds);
    sendJson(res, 200, {
      attempted: result.attempted,
      sent: result.sent,
      failed: result.failed,
      marked,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to send leads to Meet Alfred";
    sendJson(res, 500, { error: message });
  }
}
