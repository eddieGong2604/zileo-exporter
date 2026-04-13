import { linkedinCompanySearchUrl } from "../lib/linkedinCompanySearch";
import type {
  CompaniesMeta,
  CompaniesResponse,
  CompaniesSearchBody,
  CompanyFromApi,
} from "../types/zileo";

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
  const raw = (await res.json()) as {
    data: CompanyFromApi[];
    meta: CompaniesMeta;
  };
  const data = raw.data
    .filter((c) => {
      return c.id.trim().length > 0 && c.name.trim().length > 0;
    })
    .map((c) => ({
      ...c,
      linkedinSearchUrl: linkedinCompanySearchUrl(c.name),
    }));
  return { ...raw, data };
}
