import { revealCompanyWithOpenAI } from "./revealCompanyOpenAI";
import type { IncomingMessage, ServerResponse } from "node:http";

export const config = { runtime: "nodejs" };

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

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    sendJson(res, 500, { error: "Missing OPENAI_API_KEY on server" });
    return;
  }

  let body: { companyName?: string; countryHint?: string };
  try {
    body = await readJsonBody<{
      companyName?: string;
      countryHint?: string;
    }>(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const companyName = (body.companyName ?? "").trim();
  if (!companyName) {
    sendJson(res, 400, { error: "companyName is required" });
    return;
  }

  const countryHint = (body.countryHint ?? "").trim();

  try {
    const result = await revealCompanyWithOpenAI({
      companyName,
      countryHint: countryHint || undefined,
      apiKey,
    });
    sendJson(res, 200, result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "OpenAI error";
    sendJson(res, 502, { error: msg });
  }
}
