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
  excludeOriginBlacklisted: boolean;
  excludeLocationBlacklisted: boolean;
  excludeNotALead: boolean;
  sourceCountries: string[];
  latestJobPosted: "24h" | "3d" | "1w" | "all";
  page: number;
  limit?: number;
};

export async function fetchEnrichedContacts(
  input: FetchEnrichedContactsInput,
): Promise<EnrichedContactsResponse> {
  const params = new URLSearchParams();
  params.set("status", input.status);
  params.set("meetAlfredAdded", input.meetAlfredAdded);
  params.set("excludeOriginBlacklisted", String(input.excludeOriginBlacklisted));
  params.set("excludeLocationBlacklisted", String(input.excludeLocationBlacklisted));
  params.set("excludeNotALead", String(input.excludeNotALead));
  params.set("latestJobPosted", input.latestJobPosted);
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
