import type { EnrichedContact } from "../types/enriched";

type EnrichedContactsResponse = {
  data: EnrichedContact[];
  meta: {
    page: number;
    limit: number;
    totalContacts: number;
    totalCompanies: number;
  };
};

export type FetchEnrichedContactsInput = {
  status: "all" | "approved" | "queued" | "rejected";
  meetAlfredAdded: "all" | "added" | "not_added";
  instantlyAdded: "all" | "added" | "not_added";
  excludeOriginBlacklisted: boolean;
  excludeLocationBlacklisted: boolean;
  excludeNotALead: boolean;
  /** When true, only contacts whose contact_name contains a space (ASCII 0x20) */
  contactNameContainsSpace: boolean;
  sourceCountries: string[];
  latestJobPosted: "24h" | "3d" | "1w" | "all";
  /** Each term: case-insensitive substring on all_jobs job titles; OR across terms */
  jobTitles?: string[];
  /** Each term: case-insensitive substring on contacts.title; OR across terms */
  contactTitles?: string[];
  page: number;
  limit?: number;
};

export async function fetchEnrichedContacts(
  input: FetchEnrichedContactsInput,
): Promise<EnrichedContactsResponse> {
  const params = new URLSearchParams();
  params.set("status", input.status);
  params.set("meetAlfredAdded", input.meetAlfredAdded);
  params.set("instantlyAdded", input.instantlyAdded);
  params.set("excludeOriginBlacklisted", String(input.excludeOriginBlacklisted));
  params.set("excludeLocationBlacklisted", String(input.excludeLocationBlacklisted));
  params.set("excludeNotALead", String(input.excludeNotALead));
  params.set("contactNameContainsSpace", String(input.contactNameContainsSpace));
  params.set("latestJobPosted", input.latestJobPosted);
  for (const t of input.jobTitles ?? []) {
    const s = String(t).trim();
    if (s) params.append("jobTitle", s);
  }
  for (const t of input.contactTitles ?? []) {
    const s = String(t).trim();
    if (s) params.append("contactTitle", s);
  }
  params.set("page", String(input.page));
  params.set("limit", String(input.limit ?? 100));
  for (const country of input.sourceCountries) {
    params.append("sourceCountry", country);
  }

  const res = await fetch(`/api/enriched-contacts?${params.toString()}`, { method: "GET" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return (await res.json()) as EnrichedContactsResponse;
}
