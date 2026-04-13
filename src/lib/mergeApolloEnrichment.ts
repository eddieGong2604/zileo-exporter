import type { ApolloPerson, ApolloPersonEnriched } from "../types/apollo";

type MatchRow = {
  id?: string;
  email?: string | null;
  linkedin_url?: string | null;
};

function rowFromMatch(m: unknown): MatchRow | null {
  if (!m || typeof m !== "object") return null;
  const o = m as Record<string, unknown>;
  const id = o.id;
  if (typeof id !== "string") return null;
  return {
    id,
    email: typeof o.email === "string" ? o.email : (o.email as null | undefined),
    linkedin_url:
      typeof o.linkedin_url === "string"
        ? o.linkedin_url
        : (o.linkedin_url as null | undefined),
  };
}

export function enrichmentMapFromMatches(matches: unknown[]): Map<
  string,
  { email?: string | null; linkedin_url?: string | null }
> {
  const map = new Map<
    string,
    { email?: string | null; linkedin_url?: string | null }
  >();
  for (const m of matches) {
    const row = rowFromMatch(m);
    if (!row?.id) continue;
    map.set(row.id, { email: row.email, linkedin_url: row.linkedin_url });
  }
  return map;
}

export function mergePeopleWithEnrichment(
  people: ApolloPerson[],
  enrich: Map<string, { email?: string | null; linkedin_url?: string | null }>,
): ApolloPersonEnriched[] {
  return people.map((p) => {
    const e = enrich.get(p.id);
    return {
      ...p,
      email: e?.email ?? undefined,
      linkedin_url: e?.linkedin_url ?? undefined,
    };
  });
}
