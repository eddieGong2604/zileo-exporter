import type { EnrichedContact } from "../types/enriched";

type EnrichedContactsResponse = {
  data: EnrichedContact[];
};

export async function fetchEnrichedContacts(): Promise<EnrichedContact[]> {
  const res = await fetch("/api/enriched-contacts", { method: "GET" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  const body = (await res.json()) as EnrichedContactsResponse;
  return body.data;
}
