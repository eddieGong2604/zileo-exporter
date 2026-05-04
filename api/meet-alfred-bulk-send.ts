export const config = { runtime: "nodejs" };

import type { IncomingMessage, ServerResponse } from "node:http";
import { sendMeetAlfredBulkLeadsByCampaign } from "../lib/meetAlfred.js";
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
  leads?: Array<{
    contactId?: number;
    webhookKey?: string;
    campaignId?: number;
    linkedin_profile_url?: string;
    csv_firstname?: string;
    csv_companyname?: string;
    csv_email?: string;
    csv_country?: string;
    csv_jobtitle?: string;
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
    const leads = Array.isArray(body.leads) ? body.leads : [];

    const prepared = leads.map((lead) => ({
      contactId: Number(lead.contactId),
      webhookKey: (lead.webhookKey ?? "").trim(),
      campaignId: Number(lead.campaignId),
      linkedin_profile_url: (lead.linkedin_profile_url ?? "").trim(),
      csv_firstname: (lead.csv_firstname ?? "").trim(),
      csv_companyname: (lead.csv_companyname ?? "").trim(),
      csv_email: (lead.csv_email ?? "").trim(),
      csv_country: (lead.csv_country ?? "").trim(),
      csv_jobtitle: (lead.csv_jobtitle ?? "").trim(),
    }));

    for (const row of prepared) {
      if (!row.webhookKey) {
        sendJson(res, 400, { error: "Each lead must include webhookKey" });
        return;
      }
      if (!Number.isFinite(row.campaignId) || row.campaignId <= 0) {
        sendJson(res, 400, { error: "Each lead must include a positive campaignId" });
        return;
      }
    }

    const result = await sendMeetAlfredBulkLeadsByCampaign(prepared);
    const marked = await markContactsAddedToMeetAlfred(result.successContactIds);
    sendJson(res, 200, {
      attempted: result.attempted,
      sent: result.sent,
      failed: result.failed,
      marked,
      markedContactIds: result.successContactIds,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to send leads to Meet Alfred";
    sendJson(res, 500, { error: message });
  }
}
