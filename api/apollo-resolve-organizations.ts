export const config = { runtime: "nodejs" };

import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonBody, sendJson } from "./_nodeHttp";

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

  const names = [
    ...new Set((body.names ?? []).map((n) => n.trim()).filter(Boolean)),
  ];
  if (!names.length) {
    sendJson(res, 400, { error: "names is required" });
    return;
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

  sendJson(res, 200, { organization_ids, unresolved_names });
}
