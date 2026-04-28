import { createLogger } from "./logger.js";

const log = createLogger("lib/meetAlfred");

const CAMPAIGN_WEBHOOK_KEYS = [
  "X1hYa5GTrl93zdMMInvok3y7VuMBi0i3",
  "XU93kw7Dc2qD43hbQGql1eDyhpvO7CgL",
  "M4oFNExAkUrAEYPCsp6FSo1PXv90yKeD",
];

export type MeetAlfredCampaign = {
  id: number;
  label: string;
  status?: string;
  required?: boolean;
  dropdown?: boolean;
  webhookKey: string;
};

export type MeetAlfredLeadInput = {
  linkedin_profile_url: string;
  csv_firstname: string;
  csv_companyname: string;
  csv_email: string;
  csv_country: string;
};

type CampaignResponse = {
  campaigns?: Array<{
    id?: number;
    label?: string;
    status?: string;
    required?: boolean;
    dropdown?: boolean;
  }>;
};

export async function listMeetAlfredCampaigns(): Promise<MeetAlfredCampaign[]> {
  const results = await Promise.all(
    CAMPAIGN_WEBHOOK_KEYS.map(async (webhookKey) => {
      const url = `https://meetalfred.com/api/integrations/webhook/campaigns?webhook_key=${encodeURIComponent(webhookKey)}`;
      const res = await fetch(url);
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`Failed campaigns fetch for key ${webhookKey}: HTTP ${res.status}`);
      }
      const parsed = JSON.parse(text) as CampaignResponse;
      const campaigns = Array.isArray(parsed.campaigns) ? parsed.campaigns : [];
      return campaigns
        .filter((c): c is Required<Pick<MeetAlfredCampaign, "id" | "label">> &
          Omit<MeetAlfredCampaign, "webhookKey"> => {
          return typeof c.id === "number" && typeof c.label === "string";
        })
        .map((c) => ({
          id: c.id,
          label: c.label,
          status: c.status,
          required: c.required,
          dropdown: c.dropdown,
          webhookKey,
        }));
    }),
  );

  const merged = results.flat();
  const dedup = new Map<string, MeetAlfredCampaign>();
  for (const item of merged) {
    dedup.set(`${item.webhookKey}:${item.id}`, item);
  }
  return Array.from(dedup.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export async function addLeadsToMeetAlfredCampaign(input: {
  webhookKey: string;
  campaignId: number;
  leads: MeetAlfredLeadInput[];
}): Promise<{
  attempted: number;
  sent: number;
  failed: number;
  successIndices: number[];
}> {
  const endpoint = `https://meetalfred.com/api/integrations/webhook/add_lead_to_campaign?webhook_key=${encodeURIComponent(input.webhookKey)}`;
  const attempted = input.leads.length;
  if (!attempted) return { attempted: 0, sent: 0, failed: 0, successIndices: [] };

  const settled = await Promise.allSettled(
    input.leads.map(async (lead) => {
      const payload = {
        linkedin_profile_url: lead.linkedin_profile_url,
        campaign: input.campaignId,
        csv_firstname: lead.csv_firstname,
        csv_companyname: lead.csv_companyname,
        csv_email: lead.csv_email,
        csv_country: lead.csv_country,
      };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
      }
    }),
  );

  let failed = 0;
  const successIndices: number[] = [];
  for (let i = 0; i < settled.length; i += 1) {
    const r = settled[i];
    if (r.status === "rejected") failed += 1;
    else successIndices.push(i);
  }
  const sent = attempted - failed;
  log.info("addLeadsToMeetAlfredCampaign done", { attempted, sent, failed });
  return { attempted, sent, failed, successIndices };
}
