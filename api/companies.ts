export const config = { runtime: "nodejs" };

import type { IncomingMessage, ServerResponse } from "node:http";

const UPSTREAM = "https://api.zileo.io/opensearch/companies";

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

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

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
