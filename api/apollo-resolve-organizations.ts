export const config = { runtime: "nodejs" };

import type { IncomingMessage, ServerResponse } from "node:http";
import { createLogger } from "../lib/logger.js";

const log = createLogger("api/apollo-resolve-organizations");

function firstOrganizationId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const list = d.organizations as unknown[];
  const listAccounts = d.accounts as unknown[];
  if (
    !Array.isArray(list) ||
    list.length === 0 ||
    !Array.isArray(listAccounts) ||
    listAccounts.length === 0
  )
    return null;
  const first = list[0] as Record<string, unknown>;
  const firstAccount = listAccounts[0] as Record<string, unknown>;

  const oid = first.id ?? firstAccount.organization_id;

  return typeof oid === "string" ? oid : null;
}

const UPSTREAM = "https://api.apollo.io/api/v1/mixed_companies/search";

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

type Body = { names: string[] };

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

  const names = [
    ...new Set((body.names ?? []).map((n) => n.trim()).filter(Boolean)),
  ];
  if (!names.length) {
    log.warn("empty names");
    sendJson(res, 400, { error: "names is required" });
    return;
  }

  log.info("resolve org names", { count: names.length });
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
    log.fetchMeta(
      `mixed_companies/search name="${name}"`,
      upstream,
      text.length,
    );
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

  log.info("done", {
    resolved: organization_ids.length,
    unresolved: unresolved_names.length,
  });
  sendJson(res, 200, { organization_ids, unresolved_names });
}
