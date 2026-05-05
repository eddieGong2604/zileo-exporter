import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import { marked } from "marked";
import { bulkRevealEmails } from "../api/apolloBulkReveal";
import { rejectCompany as rejectCompanyApi } from "../api/companyReject";
import {
  updateContactField,
  type EditableContactField,
} from "../api/contactUpdateField";
import { fetchEnrichedContacts } from "../api/enrichedContacts";
import {
  bulkSendInstantly,
  fetchInstantlyCampaigns,
  type InstantlyCampaign,
} from "../api/instantly";
import {
  bulkSendMeetAlfred,
  fetchMeetAlfredCampaigns,
  type MeetAlfredCampaign,
} from "../api/meetAlfred";
import type { EnrichedContact } from "../types/enriched";
import { EnrichedContactTitleToolbar } from "./EnrichedContactTitleToolbar";
import { EnrichedJobTitleToolbar } from "./EnrichedJobTitleToolbar";

type ColumnDef = {
  key: string;
  label: string;
  getValue: (row: EnrichedContact) => unknown;
};
type SortDirection = "asc" | "desc";
type SortState = { key: string; direction: SortDirection } | null;
type CompanyStatusFilter = "all" | "approved" | "queued" | "rejected";
type MeetAlfredAddedFilter = "all" | "added" | "not_added";
type InstantlyAddedFilter = "all" | "added" | "not_added";
type LatestJobPostedFilter = "24h" | "3d" | "1w" | "all";
type EditableColumnConfig = {
  field: EditableContactField;
  valueKey: keyof EnrichedContact;
  kind: "text" | "boolean";
};
type CompanyJobItem = {
  id?: string;
  source?: string;
  jobtitle?: string;
  jobTitle?: string;
  description?: string;
};
type JobDetailPayload = {
  title: string;
  source: string;
  description: string;
};

const JOB_DETAIL_EVENT = "enriched:open-job-detail";

const DEFAULT_SORT_STATE: SortState = {
  key: "company.source_latest_job_posted_at",
  direction: "desc",
};

const LS_KEYS = {
  groupByCompany: "enriched.groupByCompany",
  statusFilter: "enriched.statusFilter",
  excludeOriginBlacklist: "enriched.excludeOriginBlacklist",
  excludeLocationBlacklist: "enriched.excludeLocationBlacklist",
  excludeNotALead: "enriched.excludeNotALead",
  contactNameContainsSpace: "enriched.contactNameContainsSpace",
  meetAlfredAddedFilter: "enriched.meetAlfredAddedFilter",
  instantlyAddedFilter: "enriched.instantlyAddedFilter",
  sourceCountries: "enriched.sourceCountries",
  latestJobPosted: "enriched.latestJobPosted",
  jobTitleFilter: "enriched.jobTitleFilter",
  contactTitleFilter: "enriched.contactTitleFilter",
  visibleColumns: "enriched.visibleColumns",
  columnOrder: "enriched.columnOrder",
} as const;

const SOURCE_COUNTRY_OPTIONS = [
  "Australia",
  "United States",
  "United Kingdom",
] as const;

const DEFAULT_SOURCE_COUNTRY_SELECTION = new Set<string>(["Australia"]);

const DEFAULT_VISIBLE_COLUMN_KEYS = new Set<string>([
  "company.source_company_name",
  "company.company_description",
  "company.source_latest_job_posted_at",
  "company.all_jobs",
  "company.status",
  "company.rejection_reason",
  "contact.first_name",
  "contact.contact_name",
  "contact.title",
  "contact.contact_linkedin",
  "contact.contact_location",
  "contact.predicted_origin_of_name",
  "contact.is_predicted_origin_blacklisted",
  "contact.is_contact_location_blacklisted",
  "contact.added_to_meet_alfred_at",
  "contact.added_to_instantly_at",
  "contact.not_a_lead",
]);

const CONTACT_COLUMN_DEFS: ColumnDef[] = [
  { key: "contact.id", label: "ID", getValue: (row) => row.id },
  { key: "contact.company_id", label: "Company ID", getValue: (row) => row.companyId },
  { key: "contact.first_name", label: "First", getValue: (row) => row.firstName },
  { key: "contact.contact_name", label: "Name", getValue: (row) => row.contactName },
  { key: "contact.title", label: "Title", getValue: (row) => row.title },
  {
    key: "contact.contact_linkedin",
    label: "LinkedIn",
    getValue: (row) => row.contactLinkedin,
  },
  {
    key: "contact.apollo_profile_href",
    label: "Apollo URL",
    getValue: (row) => row.apolloProfileHref,
  },
  {
    key: "contact.contact_location",
    label: "Location",
    getValue: (row) => row.contactLocation,
  },
  {
    key: "contact.predicted_origin_of_name",
    label: "Origin",
    getValue: (row) => row.predictedOriginOfName,
  },
  {
    key: "contact.country_id",
    label: "Country",
    getValue: (row) => row.countryId,
  },
  {
    key: "contact.is_predicted_origin_blacklisted",
    label: "Origin BL",
    getValue: (row) => row.isPredictedOriginBlacklisted,
  },
  {
    key: "contact.is_contact_location_blacklisted",
    label: "Location BL",
    getValue: (row) => row.isContactLocationBlacklisted,
  },
  {
    key: "contact.added_to_meet_alfred_at",
    label: "Added To MA At",
    getValue: (row) => row.addedToMeetAlfredAt,
  },
  {
    key: "contact.added_to_instantly_at",
    label: "Added To Instantly At",
    getValue: (row) => row.addedToInstantlyAt,
  },
  {
    key: "contact.not_a_lead",
    label: "Not Lead",
    getValue: (row) => row.notALead,
  },
  { key: "contact.source", label: "Source", getValue: (row) => row.source },
  { key: "contact.email", label: "Email", getValue: (row) => row.email },
  { key: "contact.created_at", label: "Created", getValue: (row) => row.createdAt },
  { key: "contact.updated_at", label: "Updated", getValue: (row) => row.updatedAt },
];

const EDITABLE_COLUMN_CONFIG: Partial<Record<string, EditableColumnConfig>> = {
  "contact.first_name": { field: "first_name", valueKey: "firstName", kind: "text" },
  "contact.contact_name": { field: "contact_name", valueKey: "contactName", kind: "text" },
  "contact.title": { field: "title", valueKey: "title", kind: "text" },
  "contact.contact_linkedin": {
    field: "contact_linkedin",
    valueKey: "contactLinkedin",
    kind: "text",
  },
  "contact.contact_location": {
    field: "contact_location",
    valueKey: "contactLocation",
    kind: "text",
  },
  "contact.predicted_origin_of_name": {
    field: "predicted_origin_of_name",
    valueKey: "predictedOriginOfName",
    kind: "text",
  },
  "contact.is_predicted_origin_blacklisted": {
    field: "is_predicted_origin_blacklisted",
    valueKey: "isPredictedOriginBlacklisted",
    kind: "boolean",
  },
  "contact.is_contact_location_blacklisted": {
    field: "is_contact_location_blacklisted",
    valueKey: "isContactLocationBlacklisted",
    kind: "boolean",
  },
  "contact.not_a_lead": {
    field: "not_a_lead",
    valueKey: "notALead",
    kind: "boolean",
  },
};

function isDateLikeColumnKey(columnKey: string): boolean {
  return (
    columnKey.endsWith("_at") ||
    columnKey.endsWith(".createdAt") ||
    columnKey.endsWith(".updatedAt")
  );
}

function displayValue(value: unknown, columnKey?: string): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) return "—";
    if (columnKey && isDateLikeColumnKey(columnKey)) {
      const parsed = dayjs(normalized);
      if (parsed.isValid()) {
        return parsed.format("DD MMM YYYY, HH:mm:ss");
      }
    }
    return normalized;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function jobSourceLinks(value: unknown): Array<{ href: string; label: string }> {
  const toCompact = (raw: string): string => {
    const text = raw.trim();
    if (!text) return "";
    try {
      const u = new URL(text);
      return u.pathname || "/";
    } catch {
      return (text.split("?")[0] ?? text).trim();
    }
  };
  const toList = (input: unknown): string[] => {
    if (Array.isArray(input)) {
      return input
        .map((v) => (typeof v === "string" ? v.trim() : ""))
        .filter(Boolean);
    }
    if (typeof input === "string") {
      const trimmed = input.trim();
      if (!trimmed) return [];
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
          return parsed
            .map((v) => (typeof v === "string" ? v.trim() : ""))
            .filter(Boolean);
        }
      } catch {
        // Keep as single string.
      }
      return [trimmed];
    }
    return [];
  };
  return toList(value).map((href) => ({ href, label: toCompact(href) || href }));
}

function truncateWords(input: string, maxWords: number): string {
  const words = input.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function companyAllJobs(value: unknown): CompanyJobItem[] {
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

function companyJobDisplayTitle(job: CompanyJobItem): string {
  return ((job.jobtitle ?? job.jobTitle ?? "") as string).trim();
}

/** First occurrence wins; titles compared case-insensitively after trim */
function dedupeCompanyJobsByTitle(jobs: CompanyJobItem[]): CompanyJobItem[] {
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

const MAX_ALL_JOBS_MATCHES_SHOWN = 3;

/** Same substring + case rules as server `all_jobs` filter; returns up to `maxShown` matches in array order */
function companyJobsMatchingTitleFilter(
  jobs: CompanyJobItem[],
  filterNeedles: string[],
  maxShown: number,
): { shown: CompanyJobItem[]; hiddenMatchCount: number } {
  const needles = filterNeedles.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (needles.length === 0) {
    return { shown: jobs, hiddenMatchCount: 0 };
  }
  const matched = jobs.filter((job) => {
    const hay = companyJobDisplayTitle(job).toLowerCase();
    return needles.some((n) => hay.includes(n));
  });
  return {
    shown: matched.slice(0, maxShown),
    hiddenMatchCount: Math.max(0, matched.length - maxShown),
  };
}

function JobDetailModalHost() {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<JobDetailPayload | null>(null);
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handler = (event: Event) => {
      const payload = (event as CustomEvent<JobDetailPayload>).detail;
      if (!payload) return;
      setDetail(payload);
      setHtml("");
      setOpen(true);
    };
    window.addEventListener(JOB_DETAIL_EVENT, handler as EventListener);
    return () => window.removeEventListener(JOB_DETAIL_EVENT, handler as EventListener);
  }, []);

  useEffect(() => {
    if (!open || !detail) {
      setHtml("");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        const parsed = await Promise.resolve(marked.parse(detail.description || "_No description_"));
        if (cancelled) return;
        setHtml(String(parsed));
        setLoading(false);
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, detail]);

  if (!open || !detail) return null;

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal filter-modal job-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{detail.title}</h2>
          <button type="button" className="modal-close" onClick={() => setOpen(false)}>
            ×
          </button>
        </div>
        <div className="filter-modal-body">
          {detail.source && (
            <p className="job-detail-source">
              Source: <strong>{detail.source}</strong>
            </p>
          )}
          <div className="job-detail-markdown">
            {loading ? (
              <p>Rendering description...</p>
            ) : (
              <div dangerouslySetInnerHTML={{ __html: html || "<p><em>No description</em></p>" }} />
            )}
          </div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function companyNameFromRecord(company: Record<string, unknown> | null): string {
  if (!company) return "Unknown company";
  const raw = company.source_company_name;
  if (typeof raw !== "string") return "Unknown company";
  const name = raw.trim();
  return name || "Unknown company";
}

function companyLabel(item: EnrichedContact): string {
  return companyNameFromRecord(item.company);
}

function formatFieldName(input: string): string {
  return input
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function companyColumns(rows: EnrichedContact[]): ColumnDef[] {
  const keySet = new Set<string>();
  for (const row of rows) {
    if (!row.company) continue;
    for (const key of Object.keys(row.company)) keySet.add(key);
  }
  return Array.from(keySet)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => ({
      key: `company.${key}`,
      label: `Company ${formatFieldName(key)}`,
      getValue: (row) => row.company?.[key],
    }));
}

function allColumns(rows: EnrichedContact[]): ColumnDef[] {
  return [...companyColumns(rows), ...CONTACT_COLUMN_DEFS];
}

function sortColumnsByVisibility(
  columns: ColumnDef[],
  visibleColumnKeys: Set<string>,
): ColumnDef[] {
  return columns.filter((column) => visibleColumnKeys.has(column.key));
}

function sortColumnsByOrder(columns: ColumnDef[], order: string[]): ColumnDef[] {
  if (order.length === 0) return columns;
  const rank = new Map(order.map((key, idx) => [key, idx]));
  return [...columns].sort((a, b) => {
    const ai = rank.get(a.key);
    const bi = rank.get(b.key);
    if (ai === undefined && bi === undefined) return 0;
    if (ai === undefined) return 1;
    if (bi === undefined) return -1;
    return ai - bi;
  });
}

function compareValues(a: unknown, b: unknown, columnKey: string): number {
  const normalize = (value: unknown): string | number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return value;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) return null;
      if (isDateLikeColumnKey(columnKey)) {
        const parsed = dayjs(text);
        if (parsed.isValid()) return parsed.valueOf();
      }
      return text.toLowerCase();
    }
    return JSON.stringify(value).toLowerCase();
  };

  const left = normalize(a);
  const right = normalize(b);
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;

  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right));
}

function buildRowKey(row: EnrichedContact, index: number): string {
  const companyId = row.company?.id ?? row.companyId ?? "no-company";
  const contactId = row.id ?? "no-contact";
  return `${companyId}-${contactId}-${index}`;
}

function selectionKeyForRow(row: EnrichedContact): string {
  const companyId = String(row.company?.id ?? row.companyId ?? "");
  const contactId = String(row.id ?? "");
  const linkedin = (row.contactLinkedin ?? "").trim().toLowerCase();
  const name = (row.contactName ?? "").trim().toLowerCase();
  return `${companyId}::${contactId}::${linkedin}::${name}`;
}

/** One term per line and/or comma-separated; deduped case-insensitively */
function parseMultiTitleFilterInput(raw: string): string[] {
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
function sanitizeMeetAlfredJobTitleString(s: string): string {
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

/** First distinct job title from `all_jobs` after dedupe; if job-title filter is applied, only jobs matching those terms (same rules as list API / UI). Result is passed through {@link sanitizeMeetAlfredJobTitleString} for Meet Alfred `csv_jobtitle`. */
function csvJobtitleForMeetAlfredRow(row: EnrichedContact, jobTitleFilterRaw: string): string {
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

function filterSummary(
  status: CompanyStatusFilter,
  meetAlfredAddedFilter: MeetAlfredAddedFilter,
  instantlyAddedFilter: InstantlyAddedFilter,
  excludeOriginBlacklist: boolean,
  excludeLocationBlacklist: boolean,
  excludeNotALead: boolean,
  contactNameContainsSpace: boolean,
  sourceCountries: ReadonlySet<string>,
  latestJobPosted: LatestJobPostedFilter,
  /** Applied job title filter (not draft while typing) */
  jobTitleApplied: string,
  contactTitleApplied: string,
): string {
  const statusPart =
    status === "all" ? "All statuses" : `${status[0]!.toUpperCase()}${status.slice(1)}`;
  const parts = [statusPart];
  parts.push(
    meetAlfredAddedFilter === "all"
      ? "Meet Alfred: all"
      : meetAlfredAddedFilter === "added"
        ? "Meet Alfred: added only"
        : "Meet Alfred: not added only",
  );
  parts.push(
    instantlyAddedFilter === "all"
      ? "Instantly: all"
      : instantlyAddedFilter === "added"
        ? "Instantly: added only"
        : "Instantly: not added only",
  );
  parts.push(
    excludeOriginBlacklist ? "Origin not blacklisted" : "Any origin blacklist",
  );
  parts.push(
    excludeLocationBlacklist ? "Location not blacklisted" : "Any location blacklist",
  );
  parts.push(excludeNotALead ? "Exclude not-a-lead" : "Include not-a-lead");
  parts.push(
    contactNameContainsSpace
      ? "contact_name contains a space"
      : "contact_name: any (no space-only filter)",
  );
  if (sourceCountries.size === 0) {
    parts.push("All source countries");
  } else {
    parts.push(
      `Source country: ${[...sourceCountries].sort((a, b) => a.localeCompare(b)).join(", ")}`,
    );
  }
  parts.push(
    latestJobPosted === "all"
      ? "Latest job: all time"
      : latestJobPosted === "24h"
        ? "Latest job: 24h"
        : latestJobPosted === "3d"
          ? "Latest job: 3d"
          : "Latest job: 1w",
  );
  const jtTerms = parseMultiTitleFilterInput(jobTitleApplied);
  if (jtTerms.length === 0) {
    parts.push("All job titles (all_jobs)");
  } else if (jtTerms.length === 1) {
    const t = jtTerms[0]!;
    parts.push(
      `Job title (all_jobs): contains "${t.length > 48 ? `${t.slice(0, 48)}...` : t}"`,
    );
  } else {
    const preview = jtTerms
      .slice(0, 2)
      .map((t) => (t.length > 24 ? `${t.slice(0, 24)}...` : t))
      .join(", ");
    const extra = jtTerms.length > 2 ? ` +${jtTerms.length - 2} more` : "";
    parts.push(`Job titles (all_jobs, OR): ${preview}${extra}`);
  }
  const ctTerms = parseMultiTitleFilterInput(contactTitleApplied);
  if (ctTerms.length === 0) {
    parts.push("All contact titles");
  } else if (ctTerms.length === 1) {
    const t = ctTerms[0]!;
    parts.push(
      `Contact title: contains "${t.length > 48 ? `${t.slice(0, 48)}...` : t}"`,
    );
  } else {
    const preview = ctTerms
      .slice(0, 2)
      .map((t) => (t.length > 24 ? `${t.slice(0, 24)}...` : t))
      .join(", ");
    const extra = ctTerms.length > 2 ? ` +${ctTerms.length - 2} more` : "";
    parts.push(`Contact titles (OR): ${preview}${extra}`);
  }
  return parts.join(" · ");
}

function safeReadLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWriteLocalStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures (private mode/quota/etc).
  }
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function firstNameFromContactName(name: string | null): string {
  const normalized = (name ?? "").trim();
  if (!normalized) return "";
  return normalized.split(/\s+/)[0] ?? "";
}

function firstNameFromRow(row: EnrichedContact): string {
  const fromField = (row.firstName ?? "").trim();
  if (fromField) return fromField;
  return firstNameFromContactName(row.contactName);
}

function syncContactNameWithFirstName(
  contactName: string | null,
  firstName: string,
): string | null {
  const base = (contactName ?? "").trim();
  const nextFirst = firstName.trim();
  if (!base) return nextFirst || contactName;
  const rest = base.replace(/^[^\s]+\s*/, "").trim();
  if (!nextFirst) return rest || null;
  return rest ? `${nextFirst} ${rest}` : nextFirst;
}

function companyNameFromRow(row: EnrichedContact): string {
  const raw = row.company?.source_company_name;
  return typeof raw === "string" ? raw.trim() : "";
}

function companyCountryFromRow(row: EnrichedContact): string {
  const raw = row.company?.source_country;
  return typeof raw === "string" ? raw.trim() : "";
}

const MEET_ALFRED_US_CAMPAIGN_LABEL = "UnitedStates_JobTitle_Personalise";
const MEET_ALFRED_UK_CAMPAIGN_LABEL = "UnitedKingdom_JobTitle_Personalise";
const MEET_ALFRED_AU_CAMPAIGN_LABEL = "Australia_JobTitle_Personalise";

function meetAlfredTargetCampaignLabelForCountry(country: string): string | null {
  const n = country.trim().toLowerCase();
  if (n === "united states") return MEET_ALFRED_US_CAMPAIGN_LABEL;
  if (n === "united kingdom") return MEET_ALFRED_UK_CAMPAIGN_LABEL;
  if (n === "australia") return MEET_ALFRED_AU_CAMPAIGN_LABEL;
  return null;
}

function findMeetAlfredCampaignByLabel(
  list: MeetAlfredCampaign[],
  label: string,
): MeetAlfredCampaign | null {
  const want = label.trim().toLowerCase();
  return list.find((c) => c.label.trim().toLowerCase() === want) ?? null;
}

function meetAlfredCampaignPreviewForRow(
  row: EnrichedContact,
  list: MeetAlfredCampaign[],
): string {
  const country = companyCountryFromRow(row);
  const targetLabel = meetAlfredTargetCampaignLabelForCountry(country);
  if (!targetLabel) return "—";
  const c = findMeetAlfredCampaignByLabel(list, targetLabel);
  return c ? `${c.label} (id ${c.id})` : `Missing: ${targetLabel}`;
}

const INSTANTLY_US_CAMPAIGN_NAME = "US_Campaign";
const INSTANTLY_UK_CAMPAIGN_NAME = "UK_Campaign";
const INSTANTLY_AU_CAMPAIGN_NAME = "AU_Campaign";

function instantlyTargetCampaignNameForCountry(country: string): string | null {
  const n = country.trim().toLowerCase();
  if (n === "united states") return INSTANTLY_US_CAMPAIGN_NAME;
  if (n === "united kingdom") return INSTANTLY_UK_CAMPAIGN_NAME;
  if (n === "australia") return INSTANTLY_AU_CAMPAIGN_NAME;
  return null;
}

function findInstantlyCampaignByName(
  list: InstantlyCampaign[],
  name: string,
): InstantlyCampaign | null {
  const want = name.trim().toLowerCase();
  return list.find((c) => c.name.trim().toLowerCase() === want) ?? null;
}

function instantlyCampaignPreviewForRow(row: EnrichedContact, list: InstantlyCampaign[]): string {
  const country = companyCountryFromRow(row);
  const targetName = instantlyTargetCampaignNameForCountry(country);
  if (!targetName) return "— (not US/UK/AU)";
  const c = findInstantlyCampaignByName(list, targetName);
  return c ? c.name : `Missing: ${targetName}`;
}

function valueForCsv(row: EnrichedContact, column: ColumnDef): string {
  const raw = column.getValue(row);
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  return JSON.stringify(raw);
}

function exportRowsToCsvWithColumns(rows: EnrichedContact[], selectedColumns: ColumnDef[]): void {
  if (rows.length === 0 || selectedColumns.length === 0) return;
  const headers = selectedColumns.map((c) => c.label);
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    const values = selectedColumns.map((column) => csvEscape(valueForCsv(row, column)));
    lines.push(values.join(","));
  }
  const csv = lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `enriched_contacts_selected_fields_${new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/:/g, "-")}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function EnrichedPage() {
  const [rows, setRows] = useState<EnrichedContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupByCompany, setGroupByCompany] = useState<boolean>(() => {
    const raw = safeReadLocalStorage(LS_KEYS.groupByCompany);
    if (raw === "false") return false;
    if (raw === "true") return true;
    return true;
  });
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<Set<string>>(new Set());
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [sortState, setSortState] = useState<SortState>(DEFAULT_SORT_STATE);
  const [columnConfigOpen, setColumnConfigOpen] = useState(false);
  const [columnDraftOrder, setColumnDraftOrder] = useState<string[]>([]);
  const [columnDraftVisibleKeys, setColumnDraftVisibleKeys] = useState<Set<string>>(new Set());
  const [initializedVisibleColumns, setInitializedVisibleColumns] = useState(false);
  const [statusFilter, setStatusFilter] = useState<CompanyStatusFilter>(() => {
    const raw = safeReadLocalStorage(LS_KEYS.statusFilter);
    if (raw === "all" || raw === "approved" || raw === "queued" || raw === "rejected") {
      return raw;
    }
    return "approved";
  });
  const [meetAlfredAddedFilter, setMeetAlfredAddedFilter] = useState<MeetAlfredAddedFilter>(
    () => {
      const raw = safeReadLocalStorage(LS_KEYS.meetAlfredAddedFilter);
      if (raw === "all" || raw === "added" || raw === "not_added") return raw;
      return "all";
    },
  );
  const [instantlyAddedFilter, setInstantlyAddedFilter] = useState<InstantlyAddedFilter>(() => {
    const raw = safeReadLocalStorage(LS_KEYS.instantlyAddedFilter);
    if (raw === "all" || raw === "added" || raw === "not_added") return raw;
    return "not_added";
  });
  const [excludePredictedOriginBlacklist, setExcludePredictedOriginBlacklist] = useState(() => {
    const raw = safeReadLocalStorage(LS_KEYS.excludeOriginBlacklist);
    if (raw === "false") return false;
    if (raw === "true") return true;
    return true;
  });
  const [excludeContactLocationBlacklist, setExcludeContactLocationBlacklist] = useState(() => {
    const raw = safeReadLocalStorage(LS_KEYS.excludeLocationBlacklist);
    if (raw === "false") return false;
    if (raw === "true") return true;
    return true;
  });
  const [excludeNotALead, setExcludeNotALead] = useState(() => {
    const raw = safeReadLocalStorage(LS_KEYS.excludeNotALead);
    if (raw === "false") return false;
    if (raw === "true") return true;
    return true;
  });
  const [contactNameContainsSpace, setContactNameContainsSpace] = useState(() => {
    const raw = safeReadLocalStorage(LS_KEYS.contactNameContainsSpace);
    if (raw === "true") return true;
    return false;
  });
  const [sourceCountrySelection, setSourceCountrySelection] = useState<Set<string>>(
    () => {
      const raw = safeReadLocalStorage(LS_KEYS.sourceCountries);
      if (!raw) return new Set(DEFAULT_SOURCE_COUNTRY_SELECTION);
      try {
        const arr = JSON.parse(raw) as string[];
        if (!Array.isArray(arr)) return new Set(DEFAULT_SOURCE_COUNTRY_SELECTION);
        const normalized = arr.filter((v) =>
          SOURCE_COUNTRY_OPTIONS.includes(v as (typeof SOURCE_COUNTRY_OPTIONS)[number]),
        );
        return new Set(normalized);
      } catch {
        return new Set(DEFAULT_SOURCE_COUNTRY_SELECTION);
      }
    },
  );
  const [latestJobPostedFilter, setLatestJobPostedFilter] = useState<LatestJobPostedFilter>(() => {
    const raw = safeReadLocalStorage(LS_KEYS.latestJobPosted);
    if (raw === "24h" || raw === "3d" || raw === "1w" || raw === "all") return raw;
    return "all";
  });
  const [jobTitleApplied, setJobTitleApplied] = useState<string>(() => {
    const raw = safeReadLocalStorage(LS_KEYS.jobTitleFilter);
    return typeof raw === "string" ? raw : "";
  });
  const [contactTitleApplied, setContactTitleApplied] = useState<string>(() => {
    const raw = safeReadLocalStorage(LS_KEYS.contactTitleFilter);
    return typeof raw === "string" ? raw : "";
  });
  const [page, setPage] = useState(1);
  const [totalContacts, setTotalContacts] = useState(0);
  const [totalCompanies, setTotalCompanies] = useState(0);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set());
  const [csvExportModalOpen, setCsvExportModalOpen] = useState(false);
  const [csvExportSelectedColumnKeys, setCsvExportSelectedColumnKeys] = useState<Set<string>>(
    new Set(),
  );
  const [meetAlfredModalOpen, setMeetAlfredModalOpen] = useState(false);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<MeetAlfredCampaign[]>([]);
  const [sendingToMeetAlfred, setSendingToMeetAlfred] = useState(false);
  const [sendResultMessage, setSendResultMessage] = useState<string | null>(null);
  const [instantlyModalOpen, setInstantlyModalOpen] = useState(false);
  const [instantlyCampaignsLoading, setInstantlyCampaignsLoading] = useState(false);
  const [instantlyCampaignsError, setInstantlyCampaignsError] = useState<string | null>(null);
  const [instantlyCampaigns, setInstantlyCampaigns] = useState<InstantlyCampaign[]>([]);
  const [sendingToInstantly, setSendingToInstantly] = useState(false);
  const [instantlySendResultMessage, setInstantlySendResultMessage] = useState<string | null>(null);
  const [revealingEmails, setRevealingEmails] = useState(false);
  const [revealResultMessage, setRevealResultMessage] = useState<string | null>(null);
  const [revealingEmailRowKeys, setRevealingEmailRowKeys] = useState<Set<string>>(new Set());
  const [savingCellKeys, setSavingCellKeys] = useState<Set<string>>(new Set());
  const [rejectOpenCompanyId, setRejectOpenCompanyId] = useState<number | null>(null);
  const [rejectingCompanyId, setRejectingCompanyId] = useState<number | null>(null);
  const [draggingColumnKey, setDraggingColumnKey] = useState<string | null>(null);
  const rejectReasonInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const editTextInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const editBooleanInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const handleJobTitleApply = useCallback((draft: string) => {
    setJobTitleApplied(draft);
    safeWriteLocalStorage(LS_KEYS.jobTitleFilter, draft);
  }, []);

  const handleJobTitleClear = useCallback(() => {
    setJobTitleApplied("");
    safeWriteLocalStorage(LS_KEYS.jobTitleFilter, "");
  }, []);

  const handleContactTitleApply = useCallback((draft: string) => {
    setContactTitleApplied(draft);
    safeWriteLocalStorage(LS_KEYS.contactTitleFilter, draft);
  }, []);

  const handleContactTitleClear = useCallback(() => {
    setContactTitleApplied("");
    safeWriteLocalStorage(LS_KEYS.contactTitleFilter, "");
  }, []);

  const loadRows = async () => {
    setLoading(true);
    setError(null);
    try {
      const body = await fetchEnrichedContacts({
        status: statusFilter,
        meetAlfredAdded: meetAlfredAddedFilter,
        instantlyAdded: instantlyAddedFilter,
        excludeOriginBlacklisted: excludePredictedOriginBlacklist,
        excludeLocationBlacklisted: excludeContactLocationBlacklist,
        excludeNotALead,
        contactNameContainsSpace,
        sourceCountries: Array.from(sourceCountrySelection),
        latestJobPosted: latestJobPostedFilter,
        jobTitles: parseMultiTitleFilterInput(jobTitleApplied),
        contactTitles: parseMultiTitleFilterInput(contactTitleApplied),
        page,
        limit: 100,
      });
      setRows(body.data);
      setTotalContacts(body.meta.totalContacts);
      setTotalCompanies(body.meta.totalCompanies);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRows();
  }, [
    statusFilter,
    meetAlfredAddedFilter,
    instantlyAddedFilter,
    excludePredictedOriginBlacklist,
    excludeContactLocationBlacklist,
    excludeNotALead,
    contactNameContainsSpace,
    sourceCountrySelection,
    latestJobPostedFilter,
    jobTitleApplied,
    contactTitleApplied,
    page,
  ]);

  const columns = useMemo(() => allColumns(rows), [rows]);

  useEffect(() => {
    if (!columns.length) return;

    if (!initializedVisibleColumns) {
      const hasCompanyColumns = columns.some((column) => column.key.startsWith("company."));
      if (!hasCompanyColumns && rows.length === 0) return;
      const savedVisibleRaw = safeReadLocalStorage(LS_KEYS.visibleColumns);
      let defaults: string[] = [];
      if (savedVisibleRaw) {
        try {
          const saved = JSON.parse(savedVisibleRaw) as string[];
          if (Array.isArray(saved)) {
            const allowed = new Set(columns.map((c) => c.key));
            defaults = saved.filter((k) => allowed.has(k));
          }
        } catch {
          defaults = [];
        }
      }
      if (defaults.length === 0) {
        defaults = columns
          .map((column) => column.key)
          .filter((key) => DEFAULT_VISIBLE_COLUMN_KEYS.has(key));
      }
      setVisibleColumnKeys(
        new Set(defaults.length > 0 ? defaults : columns.map((column) => column.key)),
      );
      const savedOrderRaw = safeReadLocalStorage(LS_KEYS.columnOrder);
      const fallbackOrder = columns.map((column) => column.key);
      let nextOrder = fallbackOrder;
      if (savedOrderRaw) {
        try {
          const savedOrder = JSON.parse(savedOrderRaw) as string[];
          if (Array.isArray(savedOrder)) {
            const allowed = new Set(fallbackOrder);
            const filtered = savedOrder.filter((k) => allowed.has(k));
            const missing = fallbackOrder.filter((k) => !filtered.includes(k));
            nextOrder = [...filtered, ...missing];
          }
        } catch {
          nextOrder = fallbackOrder;
        }
      }
      setColumnOrder(nextOrder);
      setInitializedVisibleColumns(true);
      return;
    }

    setVisibleColumnKeys((prev) => {
      const columnKeys = new Set(columns.map((column) => column.key));
      return new Set(Array.from(prev).filter((key) => columnKeys.has(key)));
    });
    setColumnOrder((prev) => {
      const current = columns.map((column) => column.key);
      const allowed = new Set(current);
      const filtered = prev.filter((key) => allowed.has(key));
      const missing = current.filter((key) => !filtered.includes(key));
      return [...filtered, ...missing];
    });
  }, [columns, initializedVisibleColumns, rows.length]);

  useEffect(() => {
    safeWriteLocalStorage(LS_KEYS.groupByCompany, String(groupByCompany));
  }, [groupByCompany]);

  useEffect(() => {
    safeWriteLocalStorage(LS_KEYS.statusFilter, statusFilter);
  }, [statusFilter]);

  useEffect(() => {
    safeWriteLocalStorage(LS_KEYS.meetAlfredAddedFilter, meetAlfredAddedFilter);
  }, [meetAlfredAddedFilter]);

  useEffect(() => {
    safeWriteLocalStorage(LS_KEYS.instantlyAddedFilter, instantlyAddedFilter);
  }, [instantlyAddedFilter]);

  useEffect(() => {
    safeWriteLocalStorage(
      LS_KEYS.excludeOriginBlacklist,
      String(excludePredictedOriginBlacklist),
    );
  }, [excludePredictedOriginBlacklist]);

  useEffect(() => {
    safeWriteLocalStorage(
      LS_KEYS.excludeLocationBlacklist,
      String(excludeContactLocationBlacklist),
    );
  }, [excludeContactLocationBlacklist]);

  useEffect(() => {
    safeWriteLocalStorage(LS_KEYS.excludeNotALead, String(excludeNotALead));
  }, [excludeNotALead]);

  useEffect(() => {
    safeWriteLocalStorage(
      LS_KEYS.contactNameContainsSpace,
      String(contactNameContainsSpace),
    );
  }, [contactNameContainsSpace]);

  useEffect(() => {
    safeWriteLocalStorage(
      LS_KEYS.sourceCountries,
      JSON.stringify(Array.from(sourceCountrySelection)),
    );
  }, [sourceCountrySelection]);

  useEffect(() => {
    safeWriteLocalStorage(LS_KEYS.latestJobPosted, latestJobPostedFilter);
  }, [latestJobPostedFilter]);

  useEffect(() => {
    setPage(1);
  }, [
    statusFilter,
    meetAlfredAddedFilter,
    instantlyAddedFilter,
    excludePredictedOriginBlacklist,
    excludeContactLocationBlacklist,
    excludeNotALead,
    contactNameContainsSpace,
    sourceCountrySelection,
    latestJobPostedFilter,
    jobTitleApplied,
    contactTitleApplied,
  ]);

  useEffect(() => {
    if (!initializedVisibleColumns) return;
    safeWriteLocalStorage(
      LS_KEYS.visibleColumns,
      JSON.stringify(Array.from(visibleColumnKeys)),
    );
  }, [visibleColumnKeys, initializedVisibleColumns]);

  useEffect(() => {
    if (!initializedVisibleColumns) return;
    safeWriteLocalStorage(LS_KEYS.columnOrder, JSON.stringify(columnOrder));
  }, [columnOrder, initializedVisibleColumns]);

  const orderedColumns = useMemo(
    () => sortColumnsByOrder(columns, columnOrder),
    [columns, columnOrder],
  );
  const visibleColumns = useMemo(
    () => sortColumnsByVisibility(orderedColumns, visibleColumnKeys),
    [orderedColumns, visibleColumnKeys],
  );

  const filteredRows = rows;

  const sortedRows = useMemo(() => {
    if (!sortState) return filteredRows;
    const active = orderedColumns.find((column) => column.key === sortState.key);
    if (!active) return filteredRows;
    const sorted = [...filteredRows].sort((leftRow, rightRow) => {
      const compared = compareValues(
        active.getValue(leftRow),
        active.getValue(rightRow),
        active.key,
      );
      return sortState.direction === "asc" ? compared : -compared;
    });
    return sorted;
  }, [orderedColumns, filteredRows, sortState]);

  const openColumnConfigModal = () => {
    setColumnDraftOrder([...columnOrder]);
    setColumnDraftVisibleKeys(new Set(visibleColumnKeys));
    setColumnConfigOpen(true);
  };

  const applyColumnConfig = () => {
    setColumnOrder([...columnDraftOrder]);
    setVisibleColumnKeys(new Set(columnDraftVisibleKeys));
    setColumnConfigOpen(false);
  };

  const moveDraftColumnBefore = (dragKey: string, targetKey: string) => {
    if (!dragKey || dragKey === targetKey) return;
    setColumnDraftOrder((prev) => {
      const base = prev.length > 0 ? prev : orderedColumns.map((c) => c.key);
      const withoutDrag = base.filter((k) => k !== dragKey);
      const targetIdx = withoutDrag.indexOf(targetKey);
      if (targetIdx < 0) return prev;
      const next = [...withoutDrag];
      next.splice(targetIdx, 0, dragKey);
      return next;
    });
  };

  useEffect(() => {
    const validKeys = new Set(sortedRows.map(selectionKeyForRow));
    setSelectedRowKeys((prev) => {
      const next = new Set<string>();
      for (const key of prev) {
        if (validKeys.has(key)) next.add(key);
      }
      return next;
    });
  }, [sortedRows]);

  const allFilteredSelected =
    sortedRows.length > 0 && sortedRows.every((row) => selectedRowKeys.has(selectionKeyForRow(row)));

  const selectedCount = selectedRowKeys.size;

  const grouped = useMemo(() => {
    if (!groupByCompany) return [];
    const map = new Map<string, EnrichedContact[]>();
    for (const row of sortedRows) {
      const key = companyLabel(row);
      const bucket = map.get(key);
      if (bucket) {
        bucket.push(row);
      } else {
        map.set(key, [row]);
      }
    }
    return Array.from(map.entries()).map(([company, contacts]) => ({
      company,
      contacts,
    }));
  }, [groupByCompany, sortedRows]);

  const selectedRowsForActions = useMemo(
    () => sortedRows.filter((row) => selectedRowKeys.has(selectionKeyForRow(row))),
    [sortedRows, selectedRowKeys],
  );
  const totalPages = Math.max(1, Math.ceil(totalContacts / 100));

  const toggleSort = (columnKey: string) => {
    setSortState((prev) => {
      if (!prev || prev.key !== columnKey) return { key: columnKey, direction: "asc" };
      if (prev.direction === "asc") return { key: columnKey, direction: "desc" };
      return null;
    });
  };

  const toggleRowSelection = (row: EnrichedContact) => {
    const key = selectionKeyForRow(row);
    setSelectedRowKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    setSelectedRowKeys((prev) => {
      const next = new Set(prev);
      const keys = sortedRows.map(selectionKeyForRow);
      const currentlyAllSelected =
        keys.length > 0 && keys.every((key) => next.has(key));
      if (currentlyAllSelected) {
        for (const key of keys) next.delete(key);
      } else {
        for (const key of keys) next.add(key);
      }
      return next;
    });
  };

  const openCsvExportModal = () => {
    setCsvExportSelectedColumnKeys(new Set(visibleColumns.map((column) => column.key)));
    setCsvExportModalOpen(true);
  };

  const exportSelectedRowsWithChosenColumns = () => {
    const selectedRows = sortedRows.filter((row) =>
      selectedRowKeys.has(selectionKeyForRow(row)),
    );
    if (!selectedRows.length) return;
    const selectedColumns = columns.filter((column) =>
      csvExportSelectedColumnKeys.has(column.key),
    );
    if (selectedColumns.length === 0) return;
    exportRowsToCsvWithColumns(selectedRows, selectedColumns);
    setCsvExportModalOpen(false);
  };

  const openMeetAlfredModal = async () => {
    setMeetAlfredModalOpen(true);
    setSendResultMessage(null);
    setCampaignsLoading(true);
    setCampaignsError(null);
    try {
      const list = await fetchMeetAlfredCampaigns();
      setCampaigns(list);
    } catch (e) {
      setCampaignsError(e instanceof Error ? e.message : "Failed to load campaigns");
    } finally {
      setCampaignsLoading(false);
    }
  };

  const sendSelectedToMeetAlfred = async () => {
    const selectedRows = selectedRowsForActions;
    if (selectedRows.length === 0) return;
    if (campaigns.length === 0) {
      setSendResultMessage("Campaign list not loaded yet; wait a moment and try again.");
      return;
    }
    setSendingToMeetAlfred(true);
    setCampaignsError(null);
    setSendResultMessage(null);
    try {
      const skipped: string[] = [];
      const leads: Array<{
        contactId: number;
        webhookKey: string;
        campaignId: number;
        linkedin_profile_url: string;
        csv_firstname: string;
        csv_companyname: string;
        csv_email: string;
        csv_country: string;
        csv_jobtitle: string;
      }> = [];
      for (const row of selectedRows) {
        const country = companyCountryFromRow(row);
        const targetLabel = meetAlfredTargetCampaignLabelForCountry(country);
        if (!targetLabel) {
          skipped.push(`#${row.id ?? "?"} (${country || "no country"})`);
          continue;
        }
        const campaign = findMeetAlfredCampaignByLabel(campaigns, targetLabel);
        if (!campaign) {
          skipped.push(`#${row.id ?? "?"} (campaign "${targetLabel}" not found)`);
          continue;
        }
        leads.push({
          contactId: Number(row.id ?? 0),
          webhookKey: campaign.webhookKey,
          campaignId: campaign.id,
          linkedin_profile_url: (row.contactLinkedin ?? "").trim(),
          csv_firstname: firstNameFromRow(row),
          csv_companyname: companyNameFromRow(row),
          csv_email: (row.email ?? "").trim(),
          csv_country: country,
          csv_jobtitle: csvJobtitleForMeetAlfredRow(row, jobTitleApplied),
        });
      }
      if (leads.length === 0) {
        setSendResultMessage(
          skipped.length
            ? `No leads sent. Skipped: ${skipped.slice(0, 12).join("; ")}${skipped.length > 12 ? "…" : ""}`
            : "No leads to send.",
        );
        return;
      }
      const result = await bulkSendMeetAlfred({ leads });
      const skipNote =
        skipped.length > 0 ? ` Skipped ${skipped.length} (not US/UK/AU or missing campaign).` : "";
      setSendResultMessage(
        `Sent ${result.sent}/${result.attempted} leads (failed: ${result.failed}, marked: ${result.marked}).${skipNote}`,
      );
      if (result.markedContactIds.length > 0) {
        const markedIds = new Set(result.markedContactIds);
        const nowIso = new Date().toISOString();
        setRows((prev) =>
          prev
            .map((row) => {
              const id = Number(row.id ?? 0);
              if (!markedIds.has(id)) return row;
              return {
                ...row,
                addedToMeetAlfredCampaign: true,
                addedToMeetAlfredAt: nowIso,
              };
            })
            .filter((row) =>
              meetAlfredAddedFilter === "not_added"
                ? !markedIds.has(Number(row.id ?? 0))
                : true,
            ),
        );
      }
    } catch (e) {
      setCampaignsError(e instanceof Error ? e.message : "Failed to send leads");
    } finally {
      setSendingToMeetAlfred(false);
    }
  };

  const openInstantlyModal = async () => {
    setInstantlyModalOpen(true);
    setInstantlyCampaignsError(null);
    setInstantlySendResultMessage(null);
    if (instantlyCampaigns.length > 0) return;
    setInstantlyCampaignsLoading(true);
    try {
      const list = await fetchInstantlyCampaigns();
      setInstantlyCampaigns(list);
    } catch (e) {
      setInstantlyCampaignsError(
        e instanceof Error ? e.message : "Failed to load Instantly campaigns",
      );
    } finally {
      setInstantlyCampaignsLoading(false);
    }
  };

  const sendSelectedToInstantly = async () => {
    const selectedRows = selectedRowsForActions;
    if (selectedRows.length === 0) return;
    const eligibleRows = selectedRows.filter((row) => (row.email ?? "").trim().length > 0);
    const skippedWithoutEmail = selectedRows.length - eligibleRows.length;
    if (eligibleRows.length === 0) {
      setInstantlyCampaignsError("No selected leads have email.");
      setInstantlySendResultMessage(`Skipped ${skippedWithoutEmail} leads without email.`);
      return;
    }
    if (instantlyCampaigns.length === 0) {
      setInstantlyCampaignsError("Campaign list not loaded yet; wait a moment and try again.");
      return;
    }
    setSendingToInstantly(true);
    setInstantlyCampaignsError(null);
    setInstantlySendResultMessage(null);
    try {
      const skipped: string[] = [];
      const leads: Array<{
        contactId: number;
        campaignId: string;
        email: string;
        first_name: string;
        company_name: string;
      }> = [];
      for (const row of eligibleRows) {
        const country = companyCountryFromRow(row);
        const targetName = instantlyTargetCampaignNameForCountry(country);
        if (!targetName) {
          skipped.push(`#${row.id ?? "?"} (${country || "no country"})`);
          continue;
        }
        const campaign = findInstantlyCampaignByName(instantlyCampaigns, targetName);
        if (!campaign) {
          skipped.push(`#${row.id ?? "?"} (campaign "${targetName}" not found)`);
          continue;
        }
        leads.push({
          contactId: Number(row.id ?? 0),
          campaignId: campaign.id,
          email: (row.email ?? "").trim(),
          first_name: firstNameFromRow(row),
          company_name: companyNameFromRow(row),
        });
      }
      if (leads.length === 0) {
        setInstantlySendResultMessage(
          skipped.length
            ? `No leads sent. Skipped: ${skipped.slice(0, 12).join("; ")}${skipped.length > 12 ? "…" : ""}${skippedWithoutEmail ? `; ${skippedWithoutEmail} without email` : ""}`
            : skippedWithoutEmail
              ? `No leads to send (${skippedWithoutEmail} without email).`
              : "No leads to send.",
        );
        return;
      }
      const result = await bulkSendInstantly({ leads });
      if (result.markedContactIds.length > 0) {
        const markedIds = new Set(result.markedContactIds);
        const nowIso = new Date().toISOString();
        setRows((prev) =>
          prev
            .map((row) => {
              const id = Number(row.id ?? 0);
              return markedIds.has(id) ? { ...row, addedToInstantlyAt: nowIso } : row;
            })
            .filter((row) =>
              instantlyAddedFilter === "not_added"
                ? !markedIds.has(Number(row.id ?? 0))
                : true,
            ),
        );
      }
      const skipNote =
        skipped.length > 0 ? ` Skipped ${skipped.length} (not US/UK/AU or missing campaign).` : "";
      setInstantlySendResultMessage(
        `Uploaded ${result.leadsUploaded}/${result.attempted}. Sent: ${result.totalSent}, skipped by Instantly: ${result.skippedCount}, skipped missing email: ${skippedWithoutEmail}, invalid: ${result.invalidEmailCount}, marked: ${result.markedInstantly}.${skipNote}`,
      );
    } catch (e) {
      setInstantlyCampaignsError(e instanceof Error ? e.message : "Failed to send Instantly leads");
    } finally {
      setSendingToInstantly(false);
    }
  };

  const revealEmailsForSelectedRows = async () => {
    const selectedRows = selectedRowsForActions;
    if (!selectedRows.length) return;
    const revealable = selectedRows.filter((row) => {
      const id = Number(row.id ?? 0);
      const linkedinUrl = (row.contactLinkedin ?? "").trim();
      const email = (row.email ?? "").trim();
      return id > 0 && linkedinUrl.length > 0 && email.length === 0;
    });
    if (revealable.length === 0) {
      setRevealResultMessage("All selected rows already have email or missing LinkedIn.");
      return;
    }
    setRevealingEmails(true);
    setRevealResultMessage(null);
    setError(null);
    try {
      const result = await bulkRevealEmails({
        contacts: revealable
          .map((row) => ({
            id: Number(row.id ?? 0),
            linkedinUrl: (row.contactLinkedin ?? "").trim(),
            firstName: (row.firstName ?? "").trim(),
            contactName: (row.contactName ?? "").trim(),
            companyName: companyNameFromRow(row),
            email: (row.email ?? "").trim(),
          }))
          .filter((c) => c.id > 0 && c.linkedinUrl.length > 0),
      });
      setRevealResultMessage(
        `Apollo matched ${result.matchedWithEmail}/${result.requested}. Updated ${result.updated} contacts.`,
      );
      if (result.updates.length > 0) {
        const byId = new Map(result.updates.map((u) => [u.id, u.email]));
        setRows((prev) =>
          prev.map((row) => {
            const id = Number(row.id ?? 0);
            const email = byId.get(id);
            return email ? { ...row, email } : row;
          }),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reveal emails");
    } finally {
      setRevealingEmails(false);
    }
  };

  const revealEmailForRow = async (row: EnrichedContact) => {
    const rowKey = selectionKeyForRow(row);
    const id = Number(row.id ?? 0);
    const linkedinUrl = (row.contactLinkedin ?? "").trim();
    const email = (row.email ?? "").trim();
    if (id <= 0 || !linkedinUrl || email.length > 0) return;
    setRevealingEmailRowKeys((prev) => {
      const next = new Set(prev);
      next.add(rowKey);
      return next;
    });
    setError(null);
    try {
      const result = await bulkRevealEmails({
        contacts: [
          {
            id,
            linkedinUrl,
            firstName: (row.firstName ?? "").trim(),
            contactName: (row.contactName ?? "").trim(),
            companyName: companyNameFromRow(row),
            email: (row.email ?? "").trim(),
          },
        ],
      });
      const nextEmail = result.updates.find((u) => u.id === id)?.email;
      if (nextEmail) {
        setRows((prev) =>
          prev.map((item) => (Number(item.id ?? 0) === id ? { ...item, email: nextEmail } : item)),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reveal email");
    } finally {
      setRevealingEmailRowKeys((prev) => {
        const next = new Set(prev);
        next.delete(rowKey);
        return next;
      });
    }
  };

  const submitRejectCompany = async (companyId: number, reasonInput?: string) => {
    const reason =
      typeof reasonInput === "string"
        ? reasonInput.trim()
        : (rejectReasonInputRefs.current[companyId]?.value ?? "").trim();
    if (!reason) {
      setError("Please enter a rejection reason");
      return;
    }
    setRejectingCompanyId(companyId);
    setError(null);
    try {
      await rejectCompanyApi({ companyId, rejectionReason: reason });
      setRejectOpenCompanyId(null);
      setRows((prev) => {
        const next = prev.filter((row) => {
          const rowCompanyId = row.company?.id ?? row.companyId;
          return rowCompanyId !== companyId;
        });
        const removedCount = prev.length - next.length;
        if (removedCount > 0) {
          setTotalContacts((current) => Math.max(0, current - removedCount));
          setTotalCompanies((current) => Math.max(0, current - 1));
        }
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reject company");
    } finally {
      setRejectingCompanyId(null);
    }
  };

  const saveEditableCell = async (row: EnrichedContact, columnKey: string) => {
    const config = EDITABLE_COLUMN_CONFIG[columnKey];
    if (!config) return;
    const id = Number(row.id);
    if (!Number.isFinite(id) || id <= 0) return;
    const rowKey = selectionKeyForRow(row);
    const cellKey = `${rowKey}::${columnKey}`;
    const sourceRaw = row[config.valueKey];
    const sourceText = typeof sourceRaw === "string" ? sourceRaw.trim() : "";
    const sourceBool = sourceRaw === true;
    const textInput = editTextInputRefs.current[cellKey];
    const boolInput = editBooleanInputRefs.current[cellKey];
    const draftText = (textInput?.value ?? sourceText).trim();
    const draftBool = boolInput?.checked ?? sourceBool;
    const draftValue = config.kind === "boolean" ? draftBool : draftText;
    const sourceValue = config.kind === "boolean" ? sourceBool : sourceText;
    if (draftValue === sourceValue) return;
    setSavingCellKeys((prev) => {
      const next = new Set(prev);
      next.add(cellKey);
      return next;
    });
    setError(null);
    try {
      await updateContactField({
        id,
        field: config.field,
        value: draftValue as string | boolean,
      });
      setRows((prev) => {
        if (config.field === "not_a_lead" && draftValue === true && excludeNotALead) {
          return prev.filter((item) => item.id !== row.id);
        }
        return prev.map((item) =>
          item.id === row.id
            ? ({
                ...item,
                [config.valueKey]: draftValue,
                ...(config.field === "first_name"
                  ? {
                      contactName: syncContactNameWithFirstName(
                        item.contactName,
                        String(draftValue ?? ""),
                      ),
                    }
                  : {}),
              } as EnrichedContact)
            : item,
        );
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update contact field");
    } finally {
      setSavingCellKeys((prev) => {
        const next = new Set(prev);
        next.delete(cellKey);
        return next;
      });
    }
  };

  const renderCell = (row: EnrichedContact, column: ColumnDef) => {
    if (column.key === "company.all_jobs") {
      const allJobs = dedupeCompanyJobsByTitle(companyAllJobs(column.getValue(row)));
      const jobTitleNeedles = parseMultiTitleFilterInput(jobTitleApplied);
      const { shown: jobs, hiddenMatchCount } = companyJobsMatchingTitleFilter(
        allJobs,
        jobTitleNeedles,
        MAX_ALL_JOBS_MATCHES_SHOWN,
      );
      if (jobs.length === 0) return "—";
      return (
        <div className="all-jobs-list">
          {jobs.map((job, idx) => {
            const title = companyJobDisplayTitle(job) || `Job ${idx + 1}`;
            const source = (job.source ?? "").trim();
            const description = (job.description ?? "").trim();
            return (
              <button
                key={`${job.id ?? "job"}-${idx}`}
                type="button"
                className="all-jobs-label"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent<JobDetailPayload>(JOB_DETAIL_EVENT, {
                      detail: { title, source, description },
                    }),
                  );
                }}
              >
                {title}
              </button>
            );
          })}
          {hiddenMatchCount > 0 ? (
            <span className="all-jobs-more-matches" title="More roles match the job title filter">
              +{hiddenMatchCount} more
            </span>
          ) : null}
        </div>
      );
    }

    if (column.key === "company.company_description") {
      const raw = column.getValue(row);
      const full = typeof raw === "string" ? raw.trim() : "";
      if (!full) return "—";
      return (
        <span title={full} className="company-description-preview">
          {truncateWords(full, 8)}
        </span>
      );
    }

    if (column.key === "company.source_jobs") {
      const links = jobSourceLinks(column.getValue(row));
      if (links.length === 0) return "—";
      return (
        <div className="job-source-inline-list">
          {links.map((item, idx) => (
            <a
              key={`${item.href}-${idx}`}
              className="job-source-link"
              href={item.href}
              target="_blank"
              rel="noreferrer noopener"
              title={item.href}
            >
              {item.label}
            </a>
          ))}
        </div>
      );
    }

    if (column.key === "contact.email") {
      const rowKey = selectionKeyForRow(row);
      const revealing = revealingEmailRowKeys.has(rowKey);
      const id = Number(row.id ?? 0);
      const hasLinkedin = (row.contactLinkedin ?? "").trim().length > 0;
      const emailText = (row.email ?? "").trim();
      const hasEmail = emailText.length > 0;
      const canReveal = id > 0 && hasLinkedin && !revealing && !hasEmail;
      return (
        <div className="inline-edit-cell">
          <span>{emailText || "—"}</span>
          {!hasEmail && (
            <button
              type="button"
              className="inline-edit-save-btn"
              disabled={!canReveal}
              onClick={() => void revealEmailForRow(row)}
            >
              {revealing ? "..." : "Reveal"}
            </button>
          )}
        </div>
      );
    }

    const config = EDITABLE_COLUMN_CONFIG[column.key];
    if (!config) {
      return displayValue(column.getValue(row), column.key);
    }
    const rowKey = selectionKeyForRow(row);
    const cellKey = `${rowKey}::${column.key}`;
    const isSaving = savingCellKeys.has(cellKey);
    const sourceRaw = row[config.valueKey];
    const sourceText = typeof sourceRaw === "string" ? sourceRaw.trim() : "";
    const sourceBool = sourceRaw === true;
    const canSave = Number.isFinite(Number(row.id)) && Number(row.id) > 0 && !isSaving;
    return (
      <div className="inline-edit-cell">
        {config.kind === "boolean" ? (
          <input
            type="checkbox"
            defaultChecked={sourceBool}
            ref={(el) => {
              editBooleanInputRefs.current[cellKey] = el;
            }}
          />
        ) : (
          <input
            className={`inline-edit-input ${
              column.key === "contact.contact_linkedin" ? "inline-edit-input-linkedin" : ""
            }`}
            type="text"
            defaultValue={sourceText}
            ref={(el) => {
              editTextInputRefs.current[cellKey] = el;
            }}
            placeholder={column.label}
          />
        )}
        <button
          type="button"
          className="inline-edit-save-btn"
          disabled={!canSave}
          onClick={() => void saveEditableCell(row, column.key)}
        >
          {isSaving ? "..." : "Save"}
        </button>
      </div>
    );
  };

  return (
    <div className="app app--wide app--dense">
      <header className="header">
        <h1>Enriched Contacts</h1>
        <p className="subtitle">All contacts with their linked company record</p>
      </header>

      <section className="panel">
        <div className="route-links">
          <a href="/">Search</a>
          <a href="/enriched" aria-current="page">
            Enriched
          </a>
        </div>
        <div className="actions">
          <label className="toggle-line">
            <input
              type="checkbox"
              checked={groupByCompany}
              onChange={(e) => setGroupByCompany(e.target.checked)}
            />
            <span>Group by company</span>
          </label>
          <button
            type="button"
            className="column-btn filter-trigger-btn"
            onClick={() => setFilterModalOpen(true)}
          >
            Filters
            <span className="filter-trigger-summary">
              {filterSummary(
                statusFilter,
                meetAlfredAddedFilter,
                instantlyAddedFilter,
                excludePredictedOriginBlacklist,
                excludeContactLocationBlacklist,
                excludeNotALead,
                contactNameContainsSpace,
                sourceCountrySelection,
                latestJobPostedFilter,
                jobTitleApplied,
                contactTitleApplied,
              )}
            </span>
          </button>
          <button
            type="button"
            className="column-btn"
            onClick={openColumnConfigModal}
          >
            Configure columns
          </button>
        </div>
      </section>

      <EnrichedJobTitleToolbar
        applied={jobTitleApplied}
        onApply={handleJobTitleApply}
        onClear={handleJobTitleClear}
      />
      <EnrichedContactTitleToolbar
        applied={contactTitleApplied}
        onApply={handleContactTitleApply}
        onClear={handleContactTitleClear}
      />

      {loading && <div className="meta-bar">Loading enriched contacts...</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && !groupByCompany && (
        <section className="results">
          <div className="meta-bar meta-bar-row">
            <span>
              {totalCompanies} companies · {totalContacts} contacts
              <span className="meta-filter-hint">
                {" "}
                ·{" "}
                {filterSummary(
                  statusFilter,
                  meetAlfredAddedFilter,
                  instantlyAddedFilter,
                  excludePredictedOriginBlacklist,
                  excludeContactLocationBlacklist,
                  excludeNotALead,
                  contactNameContainsSpace,
                  sourceCountrySelection,
                  latestJobPostedFilter,
                  jobTitleApplied,
                  contactTitleApplied,
                )}
              </span>
            </span>
            <div className="meta-actions">
              <span className="selection-cart">
                Selected: <strong>{selectedCount}</strong>
              </span>
              <button type="button" className="column-btn" onClick={toggleSelectAllFiltered}>
                {allFilteredSelected ? "Unselect all" : "Select all"}
              </button>
              <span className="selection-cart">
                Page <strong>{page}</strong> / {totalPages}
              </span>
              <button
                type="button"
                className="column-btn"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Prev
              </button>
              <button
                type="button"
                className="column-btn"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
              <button
                type="button"
                className="column-btn"
                disabled={selectedCount === 0}
                onClick={openCsvExportModal}
              >
                Export CSV
              </button>
              <button
                type="button"
                className="column-btn"
                disabled={selectedCount === 0 || revealingEmails}
                onClick={() => void revealEmailsForSelectedRows()}
              >
                {revealingEmails ? "Revealing..." : "Bulk Reveal Email"}
              </button>
              <button
                type="button"
                className="column-btn"
                disabled={selectedCount === 0}
                onClick={() => void openMeetAlfredModal()}
              >
                Bulk Send To Meet Alfred
              </button>
              <button
                type="button"
                className="column-btn"
                disabled={selectedCount === 0}
                onClick={() => void openInstantlyModal()}
              >
                Bulk Send To Instantly
              </button>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="th-check">
                    <span className="check-cell">
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={toggleSelectAllFiltered}
                        aria-label="Select all filtered rows"
                      />
                    </span>
                  </th>
                  {visibleColumns.map((column) => (
                    <th key={column.key}>
                      <button
                        type="button"
                        className="th-sort-btn"
                        onClick={() => toggleSort(column.key)}
                      >
                        {column.label}
                        {sortState?.key === column.key ? (
                          <span>{sortState.direction === "asc" ? " ↑" : " ↓"}</span>
                        ) : (
                          <span className="sort-hint"> ↕</span>
                        )}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, idx) => (
                  <tr key={buildRowKey(row, idx)}>
                    <td className="td-check">
                      <span className="check-cell">
                        <input
                          type="checkbox"
                          checked={selectedRowKeys.has(selectionKeyForRow(row))}
                          onChange={() => toggleRowSelection(row)}
                          aria-label="Select row"
                        />
                      </span>
                    </td>
                    {visibleColumns.map((column) => (
                      <td key={`${buildRowKey(row, idx)}-${column.key}`}>
                        {renderCell(row, column)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {filterModalOpen && (
        <div className="modal-backdrop" onClick={() => setFilterModalOpen(false)}>
          <div className="modal filter-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Filters</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setFilterModalOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="filter-modal-body">
              <fieldset className="filter-fieldset">
                <legend>Company status</legend>
                <div className="filter-radio-list">
                  {(
                    [
                      ["all", "All"],
                      ["approved", "Approved"],
                      ["queued", "Queued"],
                      ["rejected", "Rejected"],
                    ] as const
                  ).map(([value, label]) => (
                    <label key={value} className="filter-radio-row">
                      <input
                        type="radio"
                        name="company-status-filter"
                        value={value}
                        checked={statusFilter === value}
                        onChange={() => setStatusFilter(value)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="filter-fieldset">
                <legend>Added to Meet Alfred campaign</legend>
                <div className="filter-radio-list">
                  {(
                    [
                      ["all", "All"],
                      ["added", "Added only"],
                      ["not_added", "Not added only"],
                    ] as const
                  ).map(([value, label]) => (
                    <label key={value} className="filter-radio-row">
                      <input
                        type="radio"
                        name="meetalfred-added-filter"
                        value={value}
                        checked={meetAlfredAddedFilter === value}
                        onChange={() => setMeetAlfredAddedFilter(value)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="filter-fieldset">
                <legend>Added to Instantly</legend>
                <div className="filter-radio-list">
                  {(
                    [
                      ["all", "All"],
                      ["added", "Added only"],
                      ["not_added", "Not added only"],
                    ] as const
                  ).map(([value, label]) => (
                    <label key={value} className="filter-radio-row">
                      <input
                        type="radio"
                        name="instantly-added-filter"
                        value={value}
                        checked={instantlyAddedFilter === value}
                        onChange={() => setInstantlyAddedFilter(value)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="filter-fieldset">
                <legend>Company source country</legend>
                <p className="filter-fieldset-hint">
                  Choose one or more. Leave all unchecked to include every country.
                </p>
                <div className="filter-checkbox-stack">
                  {SOURCE_COUNTRY_OPTIONS.map((country) => (
                    <label key={country} className="filter-checkbox-row">
                      <input
                        type="checkbox"
                        checked={sourceCountrySelection.has(country)}
                        onChange={() => {
                          setSourceCountrySelection((prev) => {
                            const next = new Set(prev);
                            if (next.has(country)) next.delete(country);
                            else next.add(country);
                            return next;
                          });
                        }}
                      />
                      <span>{country}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="filter-fieldset">
                <legend>Latest job posted</legend>
                <div className="filter-radio-list">
                  {(
                    [
                      ["24h", "Last 24 hours"],
                      ["3d", "Last 3 days"],
                      ["1w", "Last 1 week"],
                      ["all", "All time"],
                    ] as const
                  ).map(([value, label]) => (
                    <label key={value} className="filter-radio-row">
                      <input
                        type="radio"
                        name="latest-job-posted-filter"
                        value={value}
                        checked={latestJobPostedFilter === value}
                        onChange={() => setLatestJobPostedFilter(value)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="filter-checkbox-row">
                <input
                  type="checkbox"
                  checked={excludePredictedOriginBlacklist}
                  onChange={(e) => setExcludePredictedOriginBlacklist(e.target.checked)}
                />
                <span>
                  Hide origin-blacklisted leads{" "}
                  <span className="filter-checkbox-hint">
                    (predicted origin blacklist is null or false)
                  </span>
                </span>
              </label>
              <label className="filter-checkbox-row">
                <input
                  type="checkbox"
                  checked={excludeContactLocationBlacklist}
                  onChange={(e) => setExcludeContactLocationBlacklist(e.target.checked)}
                />
                <span>
                  Hide location-blacklisted leads{" "}
                  <span className="filter-checkbox-hint">
                    (contact in blacklisted country for location — null or false passes)
                  </span>
                </span>
              </label>
              <label className="filter-checkbox-row">
                <input
                  type="checkbox"
                  checked={excludeNotALead}
                  onChange={(e) => setExcludeNotALead(e.target.checked)}
                />
                <span>
                  Hide not-a-lead contacts{" "}
                  <span className="filter-checkbox-hint">(not_a_lead is null or false passes)</span>
                </span>
              </label>
              <label className="filter-checkbox-row">
                <input
                  type="checkbox"
                  checked={contactNameContainsSpace}
                  onChange={(e) => setContactNameContainsSpace(e.target.checked)}
                />
                <span>
                  Only contacts whose <code className="job-title-code">contact_name</code> contains
                  a space{" "}
                  <span className="filter-checkbox-hint">
                    (normal ASCII space; unchecked = no filter)
                  </span>
                </span>
              </label>
            </div>
            <div className="modal-foot filter-modal-foot">
              <button
                type="button"
                className="column-btn"
                onClick={() => {
                  setStatusFilter("approved");
                  setMeetAlfredAddedFilter("all");
                  setInstantlyAddedFilter("not_added");
                  setExcludePredictedOriginBlacklist(true);
                  setExcludeContactLocationBlacklist(true);
                  setExcludeNotALead(true);
                  setSourceCountrySelection(new Set(DEFAULT_SOURCE_COUNTRY_SELECTION));
                  setLatestJobPostedFilter("all");
                  setJobTitleApplied("");
                  safeWriteLocalStorage(LS_KEYS.jobTitleFilter, "");
                  setContactTitleApplied("");
                  safeWriteLocalStorage(LS_KEYS.contactTitleFilter, "");
                  setContactNameContainsSpace(false);
                  safeWriteLocalStorage(LS_KEYS.contactNameContainsSpace, "false");
                }}
              >
                Reset to defaults
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setFilterModalOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {csvExportModalOpen && (
        <div className="modal-backdrop" onClick={() => setCsvExportModalOpen(false)}>
          <div className="modal column-config-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Export CSV Fields</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setCsvExportModalOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="dm-results">
              <div className="column-picker-top">
                <button
                  type="button"
                  className="column-btn"
                  onClick={() =>
                    setCsvExportSelectedColumnKeys(new Set(columns.map((column) => column.key)))
                  }
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="column-btn"
                  onClick={() =>
                    setCsvExportSelectedColumnKeys(
                      new Set(visibleColumns.map((column) => column.key)),
                    )
                  }
                >
                  Reset to visible columns
                </button>
              </div>
              <div className="column-picker-list">
                {columns.map((column) => (
                  <label key={column.key} className="column-toggle-item">
                    <input
                      type="checkbox"
                      checked={csvExportSelectedColumnKeys.has(column.key)}
                      onChange={(e) => {
                        setCsvExportSelectedColumnKeys((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(column.key);
                          else next.delete(column.key);
                          return next;
                        });
                      }}
                    />
                    <span>{column.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="modal-foot">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setCsvExportModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={selectedCount === 0 || csvExportSelectedColumnKeys.size === 0}
                onClick={exportSelectedRowsWithChosenColumns}
              >
                Export
              </button>
            </div>
          </div>
        </div>
      )}

      {meetAlfredModalOpen && (
        <div className="modal-backdrop" onClick={() => setMeetAlfredModalOpen(false)}>
          <div className="modal filter-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Send To Meet Alfred</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setMeetAlfredModalOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="filter-modal-body">
              <p className="filter-fieldset-hint">
                Selected leads: <strong>{selectedCount}</strong>. Campaign is chosen from{" "}
                <code className="job-title-code">company.source_country</code>: United States →{" "}
                <strong>{MEET_ALFRED_US_CAMPAIGN_LABEL}</strong>, United Kingdom →{" "}
                <strong>{MEET_ALFRED_UK_CAMPAIGN_LABEL}</strong>, Australia →{" "}
                <strong>{MEET_ALFRED_AU_CAMPAIGN_LABEL}</strong>. Other countries are skipped. The{" "}
                <strong>Job title</strong> column is the exact{" "}
                <code className="job-title-code">csv_jobtitle</code> payload (from{" "}
                <code className="job-title-code">all_jobs</code>, using your applied job-title filter
                on this page). Emojis are removed; balanced ASCII <code className="job-title-code">()</code>{" "}
                segments (with contents) are stripped, then any remaining <code className="job-title-code">(</code>{" "}
                or <code className="job-title-code">)</code> characters are removed before send.
              </p>
              {selectedRowsForActions.length > 0 && (
                <div className="meet-alfred-preview-wrap">
                  <table className="meet-alfred-preview-table">
                    <thead>
                      <tr>
                        <th>LinkedIn URL</th>
                        <th>First Name</th>
                        <th>Company Name</th>
                        <th>Email</th>
                        <th>Country</th>
                        <th>Job title</th>
                        <th>Meet Alfred campaign</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedRowsForActions.map((row) => {
                        const csvJobtitle = csvJobtitleForMeetAlfredRow(
                          row,
                          jobTitleApplied,
                        ).trim();
                        return (
                          <tr key={`preview-${selectionKeyForRow(row)}`}>
                            <td>{(row.contactLinkedin ?? "").trim() || "—"}</td>
                            <td>{firstNameFromRow(row) || "—"}</td>
                            <td>{companyNameFromRow(row) || "—"}</td>
                            <td>{(row.email ?? "").trim() || "—"}</td>
                            <td>{companyCountryFromRow(row) || "—"}</td>
                            <td>{csvJobtitle || "—"}</td>
                            <td>
                              {campaignsLoading
                                ? "…"
                                : meetAlfredCampaignPreviewForRow(row, campaigns)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {campaignsLoading && <div className="meta-filter-hint">Loading campaigns...</div>}
              {campaignsError && <div className="error">{campaignsError}</div>}
              {sendResultMessage && <div className="meta-bar">{sendResultMessage}</div>}
            </div>
            <div className="modal-foot filter-modal-foot">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setMeetAlfredModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={
                  sendingToMeetAlfred || campaignsLoading || selectedRowsForActions.length === 0
                }
                onClick={() => void sendSelectedToMeetAlfred()}
              >
                {sendingToMeetAlfred ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}

      {instantlyModalOpen && (
        <div className="modal-backdrop" onClick={() => setInstantlyModalOpen(false)}>
          <div className="modal filter-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Send To Instantly</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setInstantlyModalOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="filter-modal-body">
              <p className="filter-fieldset-hint">
                Selected leads: <strong>{selectedCount}</strong>. Campaign is chosen from{" "}
                <code className="job-title-code">company.source_country</code>: United States →{" "}
                <strong>{INSTANTLY_US_CAMPAIGN_NAME}</strong>, United Kingdom →{" "}
                <strong>{INSTANTLY_UK_CAMPAIGN_NAME}</strong>, Australia →{" "}
                <strong>{INSTANTLY_AU_CAMPAIGN_NAME}</strong> (matched to Instantly campaign{" "}
                <strong>name</strong>). Other countries are skipped. Only rows with an email are sent.
              </p>
              {selectedRowsForActions.length > 0 && (
                <div className="meet-alfred-preview-wrap">
                  <table className="meet-alfred-preview-table">
                    <thead>
                      <tr>
                        <th>Email</th>
                        <th>First name</th>
                        <th>Company</th>
                        <th>Country</th>
                        <th>Instantly campaign</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedRowsForActions.map((row) => (
                        <tr key={`instantly-preview-${selectionKeyForRow(row)}`}>
                          <td>{(row.email ?? "").trim() || "—"}</td>
                          <td>{firstNameFromRow(row) || "—"}</td>
                          <td>{companyNameFromRow(row) || "—"}</td>
                          <td>{companyCountryFromRow(row) || "—"}</td>
                          <td>
                            {instantlyCampaignsLoading
                              ? "…"
                              : instantlyCampaignPreviewForRow(row, instantlyCampaigns)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {instantlyCampaignsLoading && (
                <div className="meta-filter-hint">Loading Instantly campaigns...</div>
              )}
              {instantlyCampaignsError && <div className="error">{instantlyCampaignsError}</div>}
              {instantlySendResultMessage && (
                <div className="meta-bar">{instantlySendResultMessage}</div>
              )}
            </div>
            <div className="modal-foot filter-modal-foot">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setInstantlyModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={
                  sendingToInstantly ||
                  instantlyCampaignsLoading ||
                  selectedRowsForActions.length === 0
                }
                onClick={() => void sendSelectedToInstantly()}
              >
                {sendingToInstantly ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}

      <JobDetailModalHost />

      {columnConfigOpen && (
        <div className="modal-backdrop" onClick={() => setColumnConfigOpen(false)}>
          <div className="modal column-config-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Configure columns</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setColumnConfigOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="dm-results">
              {(() => {
                const modalOrderedColumns = sortColumnsByOrder(columns, columnDraftOrder);
                return (
                  <>
              <div className="column-picker-top">
                <button
                  type="button"
                  className="column-btn"
                  onClick={() =>
                    setColumnDraftVisibleKeys(new Set(modalOrderedColumns.map((col) => col.key)))
                  }
                >
                  Show all
                </button>
                <button
                  type="button"
                  className="column-btn"
                  onClick={() => {
                    const defaults = modalOrderedColumns
                      .map((column) => column.key)
                      .filter((key) => DEFAULT_VISIBLE_COLUMN_KEYS.has(key));
                    setColumnDraftVisibleKeys(
                      new Set(
                        defaults.length > 0
                          ? defaults
                          : modalOrderedColumns.map((column) => column.key),
                      ),
                    );
                  }}
                >
                  Reset default
                </button>
              </div>
              <div className="column-picker-list">
                {modalOrderedColumns.map((column) => (
                  <label
                    key={column.key}
                    className={`column-toggle-item ${
                      draggingColumnKey === column.key ? "column-toggle-item--dragging" : ""
                    }`}
                    draggable
                    onDragStart={() => setDraggingColumnKey(column.key)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (draggingColumnKey && draggingColumnKey !== column.key) {
                        moveDraftColumnBefore(draggingColumnKey, column.key);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (draggingColumnKey && draggingColumnKey !== column.key) {
                        moveDraftColumnBefore(draggingColumnKey, column.key);
                      }
                      setDraggingColumnKey(null);
                    }}
                    onDragEnd={() => setDraggingColumnKey(null)}
                  >
                    <input
                      type="checkbox"
                      checked={columnDraftVisibleKeys.has(column.key)}
                      onChange={(e) => {
                        setColumnDraftVisibleKeys((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(column.key);
                          else next.delete(column.key);
                          return next;
                        });
                      }}
                    />
                    <span>{column.label}</span>
                  </label>
                ))}
              </div>
                  </>
                );
              })()}
            </div>
            <div className="modal-foot">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setColumnConfigOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={applyColumnConfig}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {!loading && !error && groupByCompany && (
        <div className="grouped-wrap">
          <div className="meta-bar meta-bar-row grouped-toolbar">
            <span>
                {totalCompanies} companies · {totalContacts} contacts
              <span className="meta-filter-hint">
                {" "}
                ·{" "}
                {filterSummary(
                  statusFilter,
                  meetAlfredAddedFilter,
                  instantlyAddedFilter,
                  excludePredictedOriginBlacklist,
                  excludeContactLocationBlacklist,
                  excludeNotALead,
                  contactNameContainsSpace,
                  sourceCountrySelection,
                  latestJobPostedFilter,
                  jobTitleApplied,
                  contactTitleApplied,
                )}
              </span>
            </span>
            <div className="meta-actions">
              <span className="selection-cart">
                Selected: <strong>{selectedCount}</strong>
              </span>
              <button type="button" className="column-btn" onClick={toggleSelectAllFiltered}>
                {allFilteredSelected ? "Unselect all" : "Select all"}
              </button>
              <span className="selection-cart">
                Page <strong>{page}</strong> / {totalPages}
              </span>
              <button
                type="button"
                className="column-btn"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Prev
              </button>
              <button
                type="button"
                className="column-btn"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
              <button
                type="button"
                className="column-btn"
                disabled={selectedCount === 0}
                onClick={openCsvExportModal}
              >
                Export CSV
              </button>
              <button
                type="button"
                className="column-btn"
                disabled={selectedCount === 0 || revealingEmails}
                onClick={() => void revealEmailsForSelectedRows()}
              >
                {revealingEmails ? "Revealing..." : "Bulk Reveal Email"}
              </button>
              <button
                type="button"
                className="column-btn"
                disabled={selectedCount === 0}
                onClick={() => void openMeetAlfredModal()}
              >
                Bulk Send To Meet Alfred
              </button>
              <button
                type="button"
                className="column-btn"
                disabled={selectedCount === 0}
                onClick={() => void openInstantlyModal()}
              >
                Bulk Send To Instantly
              </button>
            </div>
          </div>
          {revealResultMessage && <div className="meta-bar">{revealResultMessage}</div>}
          {grouped.map((item) => (
            <section className="results group-card" key={item.company}>
              <div className="meta-bar group-company-head">
                <span>
                  {item.company} ({item.contacts.length})
                </span>
                {(() => {
                  const companyIdValue = item.contacts[0]?.company?.id;
                  const companyId =
                    typeof companyIdValue === "number" && companyIdValue > 0
                      ? companyIdValue
                      : null;
                  if (!companyId) return null;
                  const isOpen = rejectOpenCompanyId === companyId;
                  const isSaving = rejectingCompanyId === companyId;
                  return (
                    <div className="group-company-actions">
                      {!isOpen ? (
                        <button
                          type="button"
                          className="column-btn btn-reject-company"
                          onClick={() => setRejectOpenCompanyId(companyId)}
                        >
                          Reject
                        </button>
                      ) : (
                        <div className="reject-inline-form">
                          <input
                            type="text"
                            className="inline-edit-input"
                            placeholder="Rejection reason"
                            ref={(el) => {
                              rejectReasonInputRefs.current[companyId] = el;
                            }}
                          />
                          <button
                            type="button"
                            className="inline-edit-save-btn"
                            disabled={isSaving}
                            onClick={() => void submitRejectCompany(companyId)}
                          >
                            {isSaving ? "Saving..." : "Submit"}
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => setRejectOpenCompanyId(null)}
                            disabled={isSaving}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="th-check">
                        <span className="check-cell">
                          <input
                            type="checkbox"
                            checked={
                              item.contacts.length > 0 &&
                              item.contacts.every((row) =>
                                selectedRowKeys.has(selectionKeyForRow(row)),
                              )
                            }
                            onChange={() => {
                              setSelectedRowKeys((prev) => {
                                const next = new Set(prev);
                                const keys = item.contacts.map(selectionKeyForRow);
                                const allInGroupSelected =
                                  keys.length > 0 && keys.every((key) => next.has(key));
                                if (allInGroupSelected) {
                                  for (const key of keys) next.delete(key);
                                } else {
                                  for (const key of keys) next.add(key);
                                }
                                return next;
                              });
                            }}
                            aria-label={`Select all rows for ${item.company}`}
                          />
                        </span>
                      </th>
                      {visibleColumns.map((column) => (
                        <th key={column.key}>
                          <button
                            type="button"
                            className="th-sort-btn"
                            onClick={() => toggleSort(column.key)}
                          >
                            {column.label}
                            {sortState?.key === column.key ? (
                              <span>{sortState.direction === "asc" ? " ↑" : " ↓"}</span>
                            ) : (
                              <span className="sort-hint"> ↕</span>
                            )}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {item.contacts.map((row, idx) => (
                      <tr key={buildRowKey(row, idx)}>
                        <td className="td-check">
                          <span className="check-cell">
                            <input
                              type="checkbox"
                              checked={selectedRowKeys.has(selectionKeyForRow(row))}
                              onChange={() => toggleRowSelection(row)}
                              aria-label="Select row"
                            />
                          </span>
                        </td>
                        {visibleColumns.map((column) => (
                          <td key={`${buildRowKey(row, idx)}-${column.key}`}>
                            {renderCell(row, column)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
