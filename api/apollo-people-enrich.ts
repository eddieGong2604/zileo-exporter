export const config = { runtime: "nodejs" };

import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonBody, sendJson } from "./_nodeHttp";

const UPSTREAM = "https://api.apollo.io/api/v1/people/bulk_match";

const CHUNK = 10;

type Body = { ids: string[] };

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const key = process.env.APOLLO_API_KEY;
  if (!key) {
    sendJson(res, 500, { error: "Missing APOLLO_API_KEY on server" });
    return;
  }

  let body: Body;
  try {
    body = await readJsonBody<Body>(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const ids = [
    ...new Set((body.ids ?? []).map((id) => id.trim()).filter(Boolean)),
  ];
  if (!ids.length) {
    sendJson(res, 200, { matches: [] });
    return;
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

  sendJson(res, 200, { matches });
}
