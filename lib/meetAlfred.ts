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
  /** Profile URL; sent to Meet Alfred JSON as `linkedin_profile_url`. */
  linkedin_profile_url: string;
  csv_firstname: string;
  csv_companyname: string;
  csv_email: string;
  csv_country: string;
  csv_jobtitle: string;
};

/** Meet Alfred often returns HTTP 200 with `{ success: false, message: "Whoops,..." }` — still a failure. */
function meetAlfredAddLeadResponseAccepted(parsed: unknown): { ok: true } | { ok: false; message: string } {
  if (parsed === null || parsed === undefined) return { ok: true };
  if (typeof parsed !== "object") return { ok: true };
  const o = parsed as Record<string, unknown>;
  const message = String(o.message ?? "").trim();
  if (o.success === false) {
    return { ok: false, message: message || "Meet Alfred returned success: false" };
  }
  if (o.success === true) return { ok: true };
  if (Number(o.id) === 0 && message.length > 0) {
    return { ok: false, message };
  }
  if (/^whoops/i.test(message) || /\bnot a valid\b/i.test(message)) {
    return { ok: false, message };
  }
  return { ok: true };
}

/** Prefer https; Meet Alfred sometimes rejects `http://` LinkedIn URLs as invalid. */
function normalizeMeetAlfredLinkedinUrl(url: string): string {
  const u = url.trim();
  if (!u) return u;
  if (/^http:\/\/(([^/]+\.)?)linkedin\.com/i.test(u)) {
    return `https://${u.slice("http://".length)}`;
  }
  return u;
}

/** Meet Alfred webhook has no status filter param; only keep rows whose status is `"active"` (case-insensitive). */
export function meetAlfredCampaignStatusIsActiveRecord(c: Record<string, unknown>): boolean {
  const raw = c.status ?? c.Status ?? c.campaign_status ?? c.state;
  return String(raw ?? "").trim().toLowerCase() === "active";
}

function meetAlfredCampaignRecordsFromWebhookJson(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) {
    return parsed.filter(
      (x): x is Record<string, unknown> => typeof x === "object" && x !== null,
    ) as Record<string, unknown>[];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const o = parsed as Record<string, unknown>;
  for (const key of ["campaigns", "data", "results"] as const) {
    const a = o[key];
    if (Array.isArray(a)) {
      return a.filter(
        (x): x is Record<string, unknown> => typeof x === "object" && x !== null,
      ) as Record<string, unknown>[];
    }
  }
  return [];
}

export async function listMeetAlfredCampaigns(): Promise<MeetAlfredCampaign[]> {
  const results = await Promise.all(
    CAMPAIGN_WEBHOOK_KEYS.map(async (webhookKey) => {
      const url = `https://meetalfred.com/api/integrations/webhook/campaigns?webhook_key=${encodeURIComponent(webhookKey)}`;
      const res = await fetch(url);
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`Failed campaigns fetch for key ${webhookKey}: HTTP ${res.status}`);
      }
      const parsed: unknown = JSON.parse(text);
      const campaigns = meetAlfredCampaignRecordsFromWebhookJson(parsed);
      return campaigns
        .filter((c) => meetAlfredCampaignStatusIsActiveRecord(c))
        .filter((c): c is Record<string, unknown> & { id: number; label: string } => {
          const id = c.id;
          const label = c.label ?? c.name;
          return typeof id === "number" && typeof label === "string";
        })
        .map((c) => ({
          id: c.id as number,
          label: (c.label ?? c.name) as string,
          status: String(c.status ?? c.Status ?? c.campaign_status ?? c.state ?? "").trim() || "active",
          required: typeof c.required === "boolean" ? c.required : undefined,
          dropdown: typeof c.dropdown === "boolean" ? c.dropdown : undefined,
          webhookKey,
        }));
    }),
  );

  const merged = results.flat();
  const dedup = new Map<string, MeetAlfredCampaign>();
  for (const item of merged) {
    dedup.set(`${item.webhookKey}:${item.id}`, item);
  }
  const sorted = Array.from(dedup.values()).sort((a, b) => a.label.localeCompare(b.label));
  log.info("Meet Alfred campaigns list (active only, after dedupe)", {
    count: sorted.length,
    campaigns: sorted.map((c) => ({
      id: c.id,
      label: c.label,
      status: c.status,
      required: c.required,
      dropdown: c.dropdown,
      webhookKey: c.webhookKey,
    })),
  });
  return sorted;
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
  const webhookKeyTail = input.webhookKey.slice(-6);
  const attempted = input.leads.length;
  if (!attempted) return { attempted: 0, sent: 0, failed: 0, successIndices: [] };

  log.info("addLeadsToMeetAlfredCampaign start", {
    attempted,
    campaignId: input.campaignId,
    webhookKeyTail,
  });

  const settled = await Promise.allSettled(
    input.leads.map(async (lead, index) => {
      const linkedinProfileUrl = normalizeMeetAlfredLinkedinUrl(lead.linkedin_profile_url ?? "");
      /** Meet Alfred: only `campaign`, `linkedin_profile_url`, and these five csv_* keys (no `csv_company` or other extras). */
      const payload = {
        campaign: input.campaignId,
        linkedin_profile_url: linkedinProfileUrl,
        csv_firstname: lead.csv_firstname,
        csv_companyname: lead.csv_companyname,
        csv_email: lead.csv_email,
        csv_country: lead.csv_country,
        csv_jobtitle: lead.csv_jobtitle,
      };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const responseText = await res.text();
      let parsedBody: unknown;
      try {
        const t = responseText.trim();
        parsedBody = t.length > 0 ? (JSON.parse(t) as unknown) : undefined;
      } catch {
        parsedBody = undefined;
      }
      const responseForLog =
        parsedBody !== undefined
          ? parsedBody
          : responseText.trim().length > 8000
            ? `${responseText.slice(0, 8000)}…`
            : responseText;
      if (!res.ok) {
        log.warn("meetAlfred lead send failed", {
          index,
          campaignId: input.campaignId,
          webhookKeyTail,
          linkedin_profile_url: linkedinProfileUrl,
          company: lead.csv_companyname,
          status: res.status,
          response: responseForLog,
        });
        throw new Error(`HTTP ${res.status}: ${responseText.slice(0, 300)}`);
      }
      const accepted = meetAlfredAddLeadResponseAccepted(parsedBody);
      if (!accepted.ok) {
        log.warn("meetAlfred lead send rejected (HTTP 200, application-level error)", {
          index,
          campaignId: input.campaignId,
          webhookKeyTail,
          linkedin_profile_url: linkedinProfileUrl,
          company: lead.csv_companyname,
          status: res.status,
          response: responseForLog,
          message: accepted.message,
        });
        throw new Error(accepted.message);
      }
      log.info("meetAlfred lead send ok", {
        index,
        campaignId: input.campaignId,
        webhookKeyTail,
        linkedin_profile_url: linkedinProfileUrl,
        company: lead.csv_companyname,
        status: res.status,
        response: responseForLog,
      });
    }),
  );

  let failed = 0;
  const successIndices: number[] = [];
  for (let i = 0; i < settled.length; i += 1) {
    const r = settled[i];
    if (r.status === "rejected") {
      failed += 1;
      log.warn("meetAlfred lead audit", {
        index: i,
        campaignId: input.campaignId,
        webhookKeyTail,
        outcome: "failed",
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    } else {
      successIndices.push(i);
      log.info("meetAlfred lead audit", {
        index: i,
        campaignId: input.campaignId,
        webhookKeyTail,
        outcome: "sent",
      });
    }
  }
  const sent = attempted - failed;
  log.info("addLeadsToMeetAlfredCampaign done", {
    attempted,
    sent,
    failed,
    campaignId: input.campaignId,
    webhookKeyTail,
  });
  return { attempted, sent, failed, successIndices };
}

/** One row per lead; may use different webhook/campaign per row — grouped for Meet Alfred API. */
export type MeetAlfredBulkLeadRow = MeetAlfredLeadInput & {
  contactId: number;
  webhookKey: string;
  campaignId: number;
};

export async function sendMeetAlfredBulkLeadsByCampaign(
  rows: MeetAlfredBulkLeadRow[],
): Promise<{
  attempted: number;
  sent: number;
  failed: number;
  successContactIds: number[];
}> {
  type Group = {
    webhookKey: string;
    campaignId: number;
    leads: MeetAlfredLeadInput[];
    contactIds: number[];
  };
  const groupMap = new Map<string, Group>();
  for (const row of rows) {
    const key = `${row.webhookKey}::${row.campaignId}`;
    let g = groupMap.get(key);
    if (!g) {
      g = {
        webhookKey: row.webhookKey,
        campaignId: row.campaignId,
        leads: [],
        contactIds: [],
      };
      groupMap.set(key, g);
    }
    g.leads.push({
      linkedin_profile_url: row.linkedin_profile_url,
      csv_firstname: row.csv_firstname,
      csv_companyname: row.csv_companyname,
      csv_email: row.csv_email,
      csv_country: row.csv_country,
      csv_jobtitle: row.csv_jobtitle,
    });
    g.contactIds.push(row.contactId);
  }

  let attempted = 0;
  let sent = 0;
  let failed = 0;
  const successContactIds: number[] = [];

  for (const g of groupMap.values()) {
    const result = await addLeadsToMeetAlfredCampaign({
      webhookKey: g.webhookKey,
      campaignId: g.campaignId,
      leads: g.leads,
    });
    attempted += result.attempted;
    sent += result.sent;
    failed += result.failed;
    for (const idx of result.successIndices) {
      const cid = g.contactIds[idx];
      if (Number.isFinite(cid) && cid > 0) successContactIds.push(cid);
    }
  }

  return { attempted, sent, failed, successContactIds };
}
