export const config = { runtime: "nodejs" };

import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonBody, sendJson } from "./_nodeHttp";

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

  if (!body.organization_ids?.length || !body.person_titles?.length) {
    sendJson(res, 400, {
      error: "organization_ids and person_titles are required",
    });
    return;
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
  res.statusCode = upstream.status;
  res.setHeader(
    "Content-Type",
    upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
  );
  res.end(text);
}
