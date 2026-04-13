export const config = { runtime: "edge" };

const UPSTREAM = "https://api.zileo.io/opensearch/companies";

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const key = process.env.ZILEO_API_KEY;
  if (!key) {
    return new Response(
      JSON.stringify({ error: "Missing ZILEO_API_KEY on server" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const body = await request.text();

  const upstream = await fetch(UPSTREAM, {
    method: "POST",
    headers: {
      accept: "*/*",
      "Content-Type": "application/json",
      x_api_key: key,
    },
    body,
  });

  const text = await upstream.text();
  const ct =
    upstream.headers.get("content-type") ?? "application/json; charset=utf-8";

  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": ct },
  });
}
