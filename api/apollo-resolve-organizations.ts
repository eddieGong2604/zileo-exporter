export const config = { runtime: "nodejs" };

function firstOrganizationId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const list = (d.accounts as unknown[]) ?? (d.organizations as unknown[]);
  if (!Array.isArray(list) || list.length === 0) return null;
  const first = list[0] as Record<string, unknown>;
  const oid = first.organization_id ?? first.id;
  return typeof oid === "string" ? oid : null;
}

const UPSTREAM = "https://api.apollo.io/api/v1/mixed_companies/search";

type Body = { names: string[] };

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

  const names = [
    ...new Set((body.names ?? []).map((n) => n.trim()).filter(Boolean)),
  ];
  if (!names.length) {
    return new Response(JSON.stringify({ error: "names is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const organization_ids: string[] = [];
  const unresolved_names: string[] = [];
  const seenIds = new Set<string>();

  for (const name of names) {
    const params = new URLSearchParams();
    params.set("q_organization_name", name);
    params.set("page", "1");
    params.set("per_page", "10");

    const url = `${UPSTREAM}?${params.toString()}`;
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
    if (!upstream.ok) {
      unresolved_names.push(name);
      continue;
    }

    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      unresolved_names.push(name);
      continue;
    }

    const id = firstOrganizationId(json);
    if (id && !seenIds.has(id)) {
      seenIds.add(id);
      organization_ids.push(id);
    } else if (!id) {
      unresolved_names.push(name);
    }
  }

  return new Response(JSON.stringify({ organization_ids, unresolved_names }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
