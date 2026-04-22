import { createLogger } from "../lib/logger";
import type { CompanyRevealV2Result } from "../types/zileo";

const log = createLogger("src/api/revealCompanyV2");

export async function fetchCompanyRevealV2(input: {
  companyName: string;
  country?: string;
}): Promise<CompanyRevealV2Result> {
  log.info("fetchCompanyRevealV2", { companyName: input.companyName });
  const res = await fetch("/api/reveal-company-v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      companyName: input.companyName,
      ...(input.country?.trim() ? { country: input.country.trim() } : {}),
    }),
  });
  const text = await res.text();
  log.fetchMeta("reveal-company-v2", res, text.length);
  if (!res.ok) {
    let msg = text || `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* keep raw */
    }
    log.error("fetchCompanyRevealV2 failed", { msg });
    throw new Error(msg);
  }
  return JSON.parse(text) as CompanyRevealV2Result;
}
