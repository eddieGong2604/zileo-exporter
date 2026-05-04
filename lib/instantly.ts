import { createLogger } from "./logger.js";

const log = createLogger("lib/instantly");

export type InstantlyCampaign = {
  id: string;
  name: string;
  status?: number;
};

type InstantlyCampaignsResponse = {
  items?: Array<{
    id?: string;
    name?: string;
    status?: number;
  }>;
};

export type InstantlyLeadInput = {
  email: string;
  first_name: string;
  company_name: string;
};

type InstantlyAddLeadsResponse = {
  status?: string;
  total_sent?: number;
  leads_uploaded?: number;
  skipped_count?: number;
  invalid_email_count?: number;
  duplicate_email_count?: number;
  incomplete_count?: number;
  created_leads?: Array<{
    id?: string;
    email?: string;
    index?: number;
  }>;
};

export async function listInstantlyCampaigns(input: {
  apiKey: string;
}): Promise<InstantlyCampaign[]> {
  const res = await fetch("https://api.instantly.ai/api/v2/campaigns", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      accept: "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Instantly campaigns failed: HTTP ${res.status} ${text}`);
  const body = JSON.parse(text) as InstantlyCampaignsResponse;
  const items = Array.isArray(body.items) ? body.items : [];
  return items
    .filter((item): item is Required<Pick<InstantlyCampaign, "id" | "name">> & { status?: number } => {
      return typeof item.id === "string" && typeof item.name === "string";
    })
    .map((item) => ({ id: item.id, name: item.name, status: item.status }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function addLeadsToInstantlyCampaign(input: {
  apiKey: string;
  campaignId: string;
  leads: InstantlyLeadInput[];
}): Promise<{
  attempted: number;
  totalSent: number;
  leadsUploaded: number;
  skippedCount: number;
  invalidEmailCount: number;
  duplicateEmailCount: number;
  incompleteCount: number;
  createdLeadEmails: string[];
}> {
  const attempted = input.leads.length;
  if (attempted === 0) {
    return {
      attempted: 0,
      totalSent: 0,
      leadsUploaded: 0,
      skippedCount: 0,
      invalidEmailCount: 0,
      duplicateEmailCount: 0,
      incompleteCount: 0,
      createdLeadEmails: [],
    };
  }
  const res = await fetch("https://api.instantly.ai/api/v2/leads/add", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      leads: input.leads,
      campaign_id: input.campaignId,
      skip_if_in_campaign: true,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Instantly add leads failed: HTTP ${res.status} ${text}`);
  }
  const body = JSON.parse(text) as InstantlyAddLeadsResponse;
  log.info("addLeadsToInstantlyCampaign done", {
    attempted,
    totalSent: Number(body.total_sent ?? 0),
    leadsUploaded: Number(body.leads_uploaded ?? 0),
    status: body.status ?? "",
  });
  return {
    attempted,
    totalSent: Number(body.total_sent ?? 0),
    leadsUploaded: Number(body.leads_uploaded ?? 0),
    skippedCount: Number(body.skipped_count ?? 0),
    invalidEmailCount: Number(body.invalid_email_count ?? 0),
    duplicateEmailCount: Number(body.duplicate_email_count ?? 0),
    incompleteCount: Number(body.incomplete_count ?? 0),
    createdLeadEmails: Array.isArray(body.created_leads)
      ? body.created_leads
          .map((lead) => (lead?.email ?? "").trim().toLowerCase())
          .filter((email) => email.length > 0)
      : [],
  };
}

export type InstantlyBulkLeadRow = InstantlyLeadInput & {
  contactId: number;
  campaignId: string;
};

/** Group rows by Instantly `campaign_id`, call add once per campaign, merge stats and created emails. */
export async function sendInstantlyBulkLeadsByCampaign(input: {
  apiKey: string;
  rows: InstantlyBulkLeadRow[];
}): Promise<{
  attempted: number;
  totalSent: number;
  leadsUploaded: number;
  skippedCount: number;
  invalidEmailCount: number;
  duplicateEmailCount: number;
  incompleteCount: number;
  createdLeadEmails: string[];
}> {
  type Group = {
    campaignId: string;
    leads: InstantlyLeadInput[];
    contactIds: number[];
  };
  const groupMap = new Map<string, Group>();
  for (const row of input.rows) {
    const campaignId = row.campaignId.trim();
    if (!campaignId) continue;
    let g = groupMap.get(campaignId);
    if (!g) {
      g = { campaignId, leads: [], contactIds: [] };
      groupMap.set(campaignId, g);
    }
    g.leads.push({
      email: row.email,
      first_name: row.first_name,
      company_name: row.company_name,
    });
    g.contactIds.push(row.contactId);
  }

  let attempted = 0;
  let totalSent = 0;
  let leadsUploaded = 0;
  let skippedCount = 0;
  let invalidEmailCount = 0;
  let duplicateEmailCount = 0;
  let incompleteCount = 0;
  const createdLeadEmails: string[] = [];

  for (const g of groupMap.values()) {
    const result = await addLeadsToInstantlyCampaign({
      apiKey: input.apiKey,
      campaignId: g.campaignId,
      leads: g.leads,
    });
    attempted += result.attempted;
    totalSent += result.totalSent;
    leadsUploaded += result.leadsUploaded;
    skippedCount += result.skippedCount;
    invalidEmailCount += result.invalidEmailCount;
    duplicateEmailCount += result.duplicateEmailCount;
    incompleteCount += result.incompleteCount;
    createdLeadEmails.push(...result.createdLeadEmails);
  }

  return {
    attempted,
    totalSent,
    leadsUploaded,
    skippedCount,
    invalidEmailCount,
    duplicateEmailCount,
    incompleteCount,
    createdLeadEmails,
  };
}
