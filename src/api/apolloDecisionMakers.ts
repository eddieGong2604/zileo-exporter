import { buildApolloPeopleSearchQuery } from "../lib/apolloQuery";
import type { ApolloPeopleSearchInput } from "../lib/apolloQuery";
import { firstOrganizationId } from "../lib/apolloOrgSearch";
import {
  enrichmentMapFromMatches,
  mergePeopleWithEnrichment,
} from "../lib/mergeApolloEnrichment";
import type {
  ApolloDecisionMakersResult,
  ApolloPerson,
  ApolloPersonEnriched,
  ApolloPeopleSearchResponse,
} from "../types/apollo";

async function resolveOrgIdsDev(names: string[]): Promise<{
  organization_ids: string[];
  unresolved_names: string[];
}> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const organization_ids: string[] = [];
  const unresolved_names: string[] = [];
  const seen = new Set<string>();

  for (const name of unique) {
    const params = new URLSearchParams();
    params.set("q_organization_name", name);
    params.set("page", "1");
    params.set("per_page", "10");

    const res = await fetch(
      `/apollo-api/mixed_companies/search?${params.toString()}`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "Content-Type": "application/json",
        },
        body: "{}",
      },
    );

    console.log("TO DEBUG: ", res);

    if (!res.ok) {
      unresolved_names.push(name);
      continue;
    }

    const json: unknown = await res.json();
    const id = firstOrganizationId(json);
    if (id && !seen.has(id)) {
      seen.add(id);
      organization_ids.push(id);
    } else if (!id) {
      unresolved_names.push(name);
    }
  }

  return { organization_ids, unresolved_names };
}

async function resolveOrgIdsProd(names: string[]): Promise<{
  organization_ids: string[];
  unresolved_names: string[];
}> {
  const res = await fetch("/api/apollo-resolve-organizations", {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ names }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `Resolve orgs HTTP ${res.status}`);
  }
  return JSON.parse(text) as {
    organization_ids: string[];
    unresolved_names: string[];
  };
}

async function fetchPeople(
  input: ApolloPeopleSearchInput,
): Promise<ApolloPeopleSearchResponse> {
  const qs = buildApolloPeopleSearchQuery(input);
  const url = import.meta.env.DEV
    ? `/apollo-api/mixed_people/api_search?${qs}`
    : `/api/apollo-people-search`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "Content-Type": "application/json",
    },
    body: import.meta.env.DEV ? "{}" : JSON.stringify(input),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `People search HTTP ${res.status}`);
  }
  return res.json() as Promise<ApolloPeopleSearchResponse>;
}

async function fetchAllPeoplePages(
  input: ApolloPeopleSearchInput,
): Promise<ApolloPeopleSearchResponse> {
  const perPage = input.per_page ?? 100;
  const first = await fetchPeople({
    ...input,
    page: input.page ?? 1,
    per_page: perPage,
  });
  const totalEntries = first.total_entries ?? first.people?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalEntries / perPage));

  const allPeople: ApolloPerson[] = [...(first.people ?? [])];
  for (let page = 2; page <= totalPages; page += 1) {
    const next = await fetchPeople({ ...input, page, per_page: perPage });
    const chunk = next.people ?? [];
    if (!chunk.length) break;
    allPeople.push(...chunk);
  }

  return {
    total_entries: first.total_entries,
    people: allPeople,
  };
}

const ENRICH_CHUNK = 10;

async function bulkEnrichMatchesDev(ids: string[]): Promise<unknown[]> {
  const all: unknown[] = [];
  for (let i = 0; i < ids.length; i += ENRICH_CHUNK) {
    const chunk = ids.slice(i, i + ENRICH_CHUNK);
    const params = new URLSearchParams();
    params.set("reveal_personal_emails", "true");
    const res = await fetch(
      `/apollo-api/people/bulk_match?${params.toString()}`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          details: chunk.map((id) => ({ id })),
        }),
      },
    );
    if (!res.ok) continue;
    try {
      const json = (await res.json()) as { matches?: unknown[] };
      if (Array.isArray(json.matches)) all.push(...json.matches);
    } catch {
      continue;
    }
  }
  return all;
}

async function bulkEnrichMatchesProd(ids: string[]): Promise<unknown[]> {
  const res = await fetch("/api/apollo-people-enrich", {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) return [];
  try {
    const json = (await res.json()) as { matches?: unknown[] };
    return Array.isArray(json.matches) ? json.matches : [];
  } catch {
    return [];
  }
}

export type FetchDecisionMakersInput = {
  organizationNames: string[];
  person_titles: string[];
  page?: number;
  per_page?: number;
  includeSimilarTitles?: boolean;
};

/** People search + resolve orgs — không gọi bulk_match (tiết kiệm credits). */
export async function fetchApolloDecisionMakers(
  input: FetchDecisionMakersInput,
): Promise<{
  result: ApolloDecisionMakersResult;
  unresolved_names: string[];
}> {
  const { organization_ids, unresolved_names } = import.meta.env.DEV
    ? await resolveOrgIdsDev(input.organizationNames)
    : await resolveOrgIdsProd(input.organizationNames);

  if (!organization_ids.length) {
    throw new Error(
      unresolved_names.length
        ? `Không tìm thấy organization_id trên Apollo cho: ${unresolved_names.join(", ")}`
        : "Không có organization_id nào để tìm people.",
    );
  }

  const peopleResponse = await fetchAllPeoplePages({
    organization_ids,
    person_titles: input.person_titles,
    page: input.page ?? 1,
    per_page: input.per_page ?? 100,
    includeSimilarTitles: input.includeSimilarTitles,
  });

  const rawPeople = peopleResponse.people ?? [];
  const uniquePeople = rawPeople.filter(
    (p, idx, arr) => arr.findIndex((x) => x.id === p.id) === idx,
  );
  const people = mergePeopleWithEnrichment(uniquePeople, new Map());

  return {
    result: {
      total_entries: peopleResponse.total_entries,
      people,
    },
    unresolved_names,
  };
}

/**
 * Gọi sau khi user xem list search OK — bulk_match tốn credits Apollo (email / LinkedIn).
 * Dev: `/apollo-api/people/bulk_match` · Prod: `/api/apollo-people-enrich`
 */
export async function enrichApolloDecisionMakersPeople(
  people: ApolloPerson[],
): Promise<ApolloPersonEnriched[]> {
  const ids = people.map((p) => p.id).filter(Boolean);
  if (!ids.length) return [];

  const matches = import.meta.env.DEV
    ? await bulkEnrichMatchesDev(ids)
    : await bulkEnrichMatchesProd(ids);

  const enrichMap = enrichmentMapFromMatches(matches);
  return mergePeopleWithEnrichment(people, enrichMap);
}
