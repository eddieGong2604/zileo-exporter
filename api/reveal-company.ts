import { revealCompanyWithOpenAI } from "../lib/revealCompanyOpenAI";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonBody, sendJson } from "./_nodeHttp";

export const config = { runtime: "nodejs" };

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
