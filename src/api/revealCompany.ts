import type { CompanyRevealResult } from "../types/zileo";

export async function fetchCompanyReveal(input: {
  companyName: string;
  countryHint?: string;
}): Promise<CompanyRevealResult> {
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
  return JSON.parse(text) as CompanyRevealResult;
}
