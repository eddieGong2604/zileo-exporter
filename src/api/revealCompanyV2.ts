import type { CompanyRevealV2Result } from "../types/zileo";

export async function fetchCompanyRevealV2(input: {
  companyName: string;
  country?: string;
}): Promise<CompanyRevealV2Result> {
  const res = await fetch("/api/reveal-company-v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      companyName: input.companyName,
      ...(input.country?.trim() ? { country: input.country.trim() } : {}),
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text || `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* keep raw */
    }
    throw new Error(msg);
  }
  return JSON.parse(text) as CompanyRevealV2Result;
}
