import type { IncomingMessage, ServerResponse } from "node:http";
import { createLogger } from "../lib/logger.js";
import { revealCompanyWithTavily } from "../lib/revealCompanyTavily.js";

export const config = { runtime: "nodejs" };

const log = createLogger("api/reveal-company-v2");

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
    log.warn("reject", { reason: "method_not_allowed" });
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    log.error("missing TAVILY_API_KEY");
    sendJson(res, 500, { error: "Missing TAVILY_API_KEY on server" });
    return;
  }

  let body: { companyName?: string; country?: string };
  try {
    body = await readJsonBody<{ companyName?: string; country?: string }>(req);
  } catch {
    log.warn("invalid JSON body");
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const companyName = (body.companyName ?? "").trim();
  if (!companyName) {
    log.warn("missing companyName");
    sendJson(res, 400, { error: "companyName is required" });
    return;
  }

  const country = (body.country ?? "").trim();

  try {
    log.info("reveal start", { companyName, hasCountry: Boolean(country) });
    const result = await revealCompanyWithTavily({
      companyName,
      country: country || undefined,
      apiKey,
    });
    log.info("reveal ok", { companyName, confidence: result.confidence });
    sendJson(res, 200, result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Tavily error";
    log.error("reveal failed", { companyName, msg });
    sendJson(res, 502, { error: msg });
  }
}
