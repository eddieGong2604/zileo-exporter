import type { CompaniesResponse, CompaniesSearchBody } from "../types/zileo";

function companiesEndpoint(): string {
  if (import.meta.env.DEV) {
    return "/zileo-api/opensearch/companies";
  }
  return "/api/companies";
}

function headers(): HeadersInit {
  return {
    accept: "*/*",
    "Content-Type": "application/json",
  };
}

export async function fetchCompanies(
  body: CompaniesSearchBody,
): Promise<CompaniesResponse> {
  const res = await fetch(companiesEndpoint(), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  const raw = (await res.json()) as CompaniesResponse;
  const data = raw.data.filter((c) => {
    return c.id.trim().length > 0 && c.name.trim().length > 0;
  });
  return { ...raw, data };
}
