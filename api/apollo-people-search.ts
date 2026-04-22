export const config = { runtime: "nodejs" };

import type { IncomingMessage, ServerResponse } from "node:http";
import { createLogger } from "../lib/logger.js";

const log = createLogger("api/apollo-people-search");

const UPSTREAM = "https://api.apollo.io/api/v1/mixed_people/api_search";

async function readRawBody(req: IncomingMessage): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const raw = await readRawBody(req);
  return JSON.parse(raw) as T;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

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
    log.warn("reject", { reason: "method_not_allowed" });
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const key = process.env.APOLLO_API_KEY;
  if (!key) {
    log.error("missing APOLLO_API_KEY");
    sendJson(res, 500, { error: "Missing APOLLO_API_KEY on server" });
    return;
  }

  let body: Body;
  try {
    body = await readJsonBody<Body>(req);
  } catch {
    log.warn("invalid JSON body");
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  if (!body.organization_ids?.length || !body.person_titles?.length) {
    log.warn("validation", {
      orgCount: body.organization_ids?.length ?? 0,
      titleCount: body.person_titles?.length ?? 0,
    });
    sendJson(res, 400, {
      error: "organization_ids and person_titles are required",
    });
    return;
  }

  const qs = buildQuery(body);
  const url = `${UPSTREAM}?${qs}`;
  log.info("Apollo people search", {
    page: body.page ?? 1,
    per_page: body.per_page ?? 100,
    orgIds: body.organization_ids.length,
    titles: body.person_titles.length,
  });

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
  log.fetchMeta("Apollo upstream", upstream, text.length);
  res.statusCode = upstream.status;
  res.setHeader(
    "Content-Type",
    upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
  );
  res.end(text);
}
