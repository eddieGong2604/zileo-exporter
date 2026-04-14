import { revealCompanyWithOpenAI } from "../lib/revealCompanyOpenAI";

export const config = { runtime: "edge" };

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Missing OPENAI_API_KEY on server" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  let body: { companyName?: string; countryHint?: string };
  try {
    body = (await request.json()) as { companyName?: string; countryHint?: string };
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const companyName = (body.companyName ?? "").trim();
  if (!companyName) {
    return new Response(JSON.stringify({ error: "companyName is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const countryHint = (body.countryHint ?? "").trim();

  try {
    const result = await revealCompanyWithOpenAI({
      companyName,
      countryHint: countryHint || undefined,
      apiKey,
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "OpenAI error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
