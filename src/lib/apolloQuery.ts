/** People API Search — theo https://docs.apollo.io/reference/people-api-search */
export type ApolloPeopleSearchInput = {
  organization_ids: string[];
  person_titles: string[];
  page?: number;
  per_page?: number;
  includeSimilarTitles?: boolean;
};

export function buildApolloPeopleSearchQuery(
  input: ApolloPeopleSearchInput,
): string {
  const params = new URLSearchParams();
  for (const id of input.organization_ids) {
    const t = id.trim();
    if (t) params.append("organization_ids[]", t);
  }
  for (const title of input.person_titles) {
    const t = title.trim();
    if (t) params.append("person_titles[]", t);
  }
  params.set("page", String(input.page ?? 1));
  params.set(
    "per_page",
    String(Math.min(100, Math.max(1, input.per_page ?? 100))),
  );
  if (input.includeSimilarTitles === false) {
    params.set("include_similar_titles", "false");
  }
  return params.toString();
}
