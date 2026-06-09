import type { EnrichedContact } from "./enrichedContactsRepo.js";
import type { MeetAlfredBulkLeadRow, MeetAlfredCampaign } from "./meetAlfred.js";

export type CompanyJobItem = {
  id?: string;
  source?: string;
  jobtitle?: string;
  jobTitle?: string;
  description?: string;
};

export const MEET_ALFRED_US_CAMPAIGN_PREFIX = "UnitedStates";
export const MEET_ALFRED_UK_CAMPAIGN_PREFIX = "UnitedKingdom";
export const MEET_ALFRED_AU_CAMPAIGN_PREFIX = "Australia";

/** One term per line and/or comma-separated; deduped case-insensitively */
export function parseMultiTitleFilterInput(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\n,]+/)) {
    const t = part.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/**
 * Meet Alfred `csv_jobtitle`: strip emoji code points, remove every ASCII `(...)` segment
 * (innermost pairs first for nesting), remove any remaining `(` or `)`, then normalize spaces and trim.
 */
export function sanitizeMeetAlfredJobTitleString(s: string): string {
  let out = s;
  let prev = "";
  while (out !== prev) {
    prev = out;
    out = out.replace(/\([^()]*\)/g, "");
  }
  out = out
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\uFE0F\u200D]+/g, "")
    .replace(/\p{Emoji_Modifier}/gu, "")
    .replace(/[()]/g, "");
  return out.replace(/\s+/g, " ").trim();
}

export function companyAllJobs(value: unknown): CompanyJobItem[] {
  if (Array.isArray(value)) return value.filter((v) => typeof v === "object") as CompanyJobItem[];
  if (typeof value !== "string") return [];
  const text = value.trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v) => typeof v === "object") as CompanyJobItem[];
  } catch {
    return [];
  }
}

export function companyJobDisplayTitle(job: CompanyJobItem): string {
  return ((job.jobtitle ?? job.jobTitle ?? "") as string).trim();
}

/** First occurrence wins; titles compared case-insensitively after trim */
export function dedupeCompanyJobsByTitle(jobs: CompanyJobItem[]): CompanyJobItem[] {
  const seen = new Set<string>();
  const out: CompanyJobItem[] = [];
  for (const job of jobs) {
    const raw = companyJobDisplayTitle(job);
    const key = raw.length > 0 ? raw.toLowerCase() : "\0__empty_title__";
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(job);
  }
  return out;
}

/** First distinct job title from `all_jobs` after dedupe; optional job-title filter (OR across terms). */
export function csvJobtitleForMeetAlfredRow(
  row: EnrichedContact,
  jobTitleFilterRaw: string,
): string {
  const company = row.company;
  const raw =
    company && typeof company === "object"
      ? (company as Record<string, unknown>).all_jobs
      : undefined;
  const deduped = dedupeCompanyJobsByTitle(companyAllJobs(raw));
  const needles = parseMultiTitleFilterInput(jobTitleFilterRaw)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const filtered =
    needles.length > 0
      ? deduped.filter((job) => {
          const hay = companyJobDisplayTitle(job).toLowerCase();
          return needles.some((n) => hay.includes(n));
        })
      : deduped;
  const first = filtered[0];
  const rawTitle = first ? companyJobDisplayTitle(first) : "";
  return sanitizeMeetAlfredJobTitleString(rawTitle);
}

function firstNameFromContactName(name: string | null): string {
  const normalized = (name ?? "").trim();
  if (!normalized) return "";
  return normalized.split(/\s+/)[0] ?? "";
}

export function firstNameFromRow(row: EnrichedContact): string {
  const fromField = (row.firstName ?? "").trim();
  if (fromField) return fromField;
  return firstNameFromContactName(row.contactName);
}

export function companyNameFromRow(row: EnrichedContact): string {
  const raw = row.company?.source_company_name;
  return typeof raw === "string" ? raw.trim() : "";
}

export function companyCountryFromRow(row: EnrichedContact): string {
  const raw = row.company?.source_country;
  return typeof raw === "string" ? raw.trim() : "";
}

export function meetAlfredTargetCampaignPrefixForCountry(country: string): string | null {
  const n = country.trim().toLowerCase();
  if (n === "united states") return MEET_ALFRED_US_CAMPAIGN_PREFIX;
  if (n === "united kingdom") return MEET_ALFRED_UK_CAMPAIGN_PREFIX;
  if (n === "australia") return MEET_ALFRED_AU_CAMPAIGN_PREFIX;
  return null;
}

/** Sort by label then id so round-robin order is stable across renders/sends. */
export function findMeetAlfredCampaignsByLabelPrefix(
  list: MeetAlfredCampaign[],
  prefix: string,
): MeetAlfredCampaign[] {
  const p = prefix.trim().toLowerCase();
  return [...list]
    .filter((c) => c.label.trim().toLowerCase().startsWith(p))
    .sort((a, b) => a.label.localeCompare(b.label) || a.id - b.id);
}

export type MeetAlfredRowAssignment =
  | { kind: "campaign"; campaign: MeetAlfredCampaign }
  | { kind: "skipped"; reason: string };

/** Round-robin distribute rows of each target country across all campaigns starting with that country prefix. */
export function buildMeetAlfredAssignments(
  rows: EnrichedContact[],
  campaigns: MeetAlfredCampaign[],
): Map<EnrichedContact, MeetAlfredRowAssignment> {
  const assignments = new Map<EnrichedContact, MeetAlfredRowAssignment>();
  const matchedByPrefix = new Map<string, MeetAlfredCampaign[]>();
  const countersByPrefix = new Map<string, number>();
  for (const row of rows) {
    const country = companyCountryFromRow(row);
    const prefix = meetAlfredTargetCampaignPrefixForCountry(country);
    if (!prefix) {
      assignments.set(row, {
        kind: "skipped",
        reason: country ? `not US/UK/AU (${country})` : "no country",
      });
      continue;
    }
    let list = matchedByPrefix.get(prefix);
    if (!list) {
      list = findMeetAlfredCampaignsByLabelPrefix(campaigns, prefix);
      matchedByPrefix.set(prefix, list);
    }
    if (list.length === 0) {
      assignments.set(row, {
        kind: "skipped",
        reason: `no campaign starting with "${prefix}"`,
      });
      continue;
    }
    const i = countersByPrefix.get(prefix) ?? 0;
    countersByPrefix.set(prefix, i + 1);
    const campaign = list[i % list.length]!;
    assignments.set(row, { kind: "campaign", campaign });
  }
  return assignments;
}

export function prepareMeetAlfredBulkLeads(input: {
  rows: EnrichedContact[];
  campaigns: MeetAlfredCampaign[];
  jobTitleFilterRaw?: string;
}): {
  leads: MeetAlfredBulkLeadRow[];
  skipped: Array<{ contactId: number; reason: string }>;
} {
  const jobTitleFilterRaw = input.jobTitleFilterRaw ?? "";
  const assignments = buildMeetAlfredAssignments(input.rows, input.campaigns);
  const leads: MeetAlfredBulkLeadRow[] = [];
  const skipped: Array<{ contactId: number; reason: string }> = [];

  for (const row of input.rows) {
    const contactId = Number(row.id ?? 0);
    const country = companyCountryFromRow(row);
    const assignment = assignments.get(row);
    if (!assignment || assignment.kind === "skipped") {
      skipped.push({
        contactId,
        reason: assignment?.kind === "skipped" ? assignment.reason : "no assignment",
      });
      continue;
    }
    leads.push({
      contactId,
      webhookKey: assignment.campaign.webhookKey,
      campaignId: assignment.campaign.id,
      linkedin_profile_url: (row.contactLinkedin ?? "").trim(),
      csv_firstname: firstNameFromRow(row),
      csv_companyname: companyNameFromRow(row),
      csv_email: (row.email ?? "").trim(),
      csv_country: country,
      csv_jobtitle: csvJobtitleForMeetAlfredRow(row, jobTitleFilterRaw),
    });
  }

  return { leads, skipped };
}
