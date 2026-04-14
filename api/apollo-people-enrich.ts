export const config = { runtime: "edge" };

const UPSTREAM = "https://api.apollo.io/api/v1/people/bulk_match";

const CHUNK = 10;

type Body = { ids: string[] };

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

  const ids = [
    ...new Set((body.ids ?? []).map((id) => id.trim()).filter(Boolean)),
  ];
  if (!ids.length) {
    return new Response(JSON.stringify({ matches: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const matches: unknown[] = [];

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const params = new URLSearchParams();
    params.set("reveal_personal_emails", "true");

    const url = `${UPSTREAM}?${params.toString()}`;
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "x-api-key": key,
      },
      body: JSON.stringify({
        details: chunk.map((id) => ({ id })),
      }),
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      continue;
    }

    try {
      const json = JSON.parse(text) as { matches?: unknown[] };
      if (Array.isArray(json.matches)) matches.push(...json.matches);
    } catch {
      continue;
    }
  }

  return new Response(JSON.stringify({ matches }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
