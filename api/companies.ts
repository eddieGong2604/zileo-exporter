export const config = { runtime: "nodejs" };

import type { IncomingMessage, ServerResponse } from "node:http";
import { readRawBody, sendJson } from "./_nodeHttp";

const UPSTREAM = "https://api.zileo.io/opensearch/companies";

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const key = process.env.ZILEO_API_KEY;
  if (!key) {
    sendJson(res, 500, { error: "Missing ZILEO_API_KEY on server" });
    return;
  }

  const body = await readRawBody(req);

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
  res.statusCode = upstream.status;
  res.setHeader(
    "Content-Type",
    upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
  );
  res.end(text);
}
