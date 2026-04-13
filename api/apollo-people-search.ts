export const config = { runtime: "edge" as const };

const UPSTREAM = "https://api.apollo.io/api/v1/mixed_people/api_search";

type Body = {
  organization_ids: string[];
  person_titles: string[];
  page?: number;
  per_page?: number;
  includeSimilarTitles?: boolean;
};

function buildQuery(body: Body): string {
  const params = new URLSearchParams();
  for (const id of body.organization_ids) {
    const t = id.trim();
    if (t) params.append("organization_ids[]", t);
  }
  for (const title of body.person_titles) {
    const t = title.trim();
    if (t) params.append("person_titles[]", t);
  }
  params.set("page", String(body.page ?? 1));
  params.set(
    "per_page",
    String(Math.min(100, Math.max(1, body.per_page ?? 100))),
  );
  if (body.includeSimilarTitles === false) {
    params.set("include_similar_titles", "false");
  }
  return params.toString();
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const key = process.env.APOLLO_API_KEY;
  if (!key) {
    return new Response(
      JSON.stringify({ error: "Missing APOLLO_API_KEY on server" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.organization_ids?.length || !body.person_titles?.length) {
    return new Response(
      JSON.stringify({
        error: "organization_ids and person_titles are required",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const qs = buildQuery(body);
  const url = `${UPSTREAM}?${qs}`;

  const upstream = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "x-api-key": key,
    },
    body: "{}",
  });

  const text = await upstream.text();
  const ct =
    upstream.headers.get("content-type") ?? "application/json; charset=utf-8";

  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": ct },
  });
}
