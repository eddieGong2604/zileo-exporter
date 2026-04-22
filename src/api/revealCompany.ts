import { createLogger } from "../lib/logger";
import type { CompanyRevealResult } from "../types/zileo";

const log = createLogger("src/api/revealCompany");

export async function fetchCompanyReveal(input: {
  companyName: string;
  countryHint?: string;
}): Promise<CompanyRevealResult> {
  log.info("fetchCompanyReveal", { companyName: input.companyName });
  const res = await fetch("/api/reveal-company", {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      companyName: input.companyName,
      ...(input.countryHint?.trim()
        ? { countryHint: input.countryHint.trim() }
        : {}),
    }),
  });
  const text = await res.text();
  log.fetchMeta("reveal-company", res, text.length);
  if (!res.ok) {
    let msg = text || `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* keep raw */
    }
    log.error("fetchCompanyReveal failed", { msg });
    throw new Error(msg);
  }
  return JSON.parse(text) as CompanyRevealResult;
}
