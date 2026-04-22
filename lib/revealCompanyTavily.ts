import { createLogger } from "./logger.js";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

const log = createLogger("lib/revealCompanyTavily");

type TavilyResult = {
  url?: unknown;
  title?: unknown;
  content?: unknown;
  score?: unknown;
};

type TavilyResponse = {
  results?: unknown;
};

export type RevealCompanyTavilyPayload = {
  companyName: string;
  matchedUrl: string | null;
  industry: string;
  companySize: string;
  source: "tavily";
  confidence: "high" | "medium" | "low";
};

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeLinkedInCompanyUrl(url: string): boolean {
  return /(^https?:\/\/)?([a-z]{2,3}\.)?linkedin\.com\/company\//i.test(url);
}

function extractAfterHeading(content: string, heading: "Industry" | "Company Size"): string | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`###\\s*${escaped}\\s*\\n+([^\\n]+)`, "i");
  const m = content.match(re);
  if (!m?.[1]) return null;
  const value = m[1].trim();
  return value || null;
}

function extractIndustry(content: string): string | null {
  const fromHeading = extractAfterHeading(content, "Industry");
  if (fromHeading) return fromHeading;
  const fallback = content.match(/Industry\s*[:\-]?\s*\n?([^\n]+)/i);
  return fallback?.[1]?.trim() || null;
}

function extractCompanySize(content: string): string | null {
  const fromHeading = extractAfterHeading(content, "Company Size");
  if (fromHeading) {
    const withEmployees = fromHeading.match(/\b[\d,]+(?:\s*-\s*[\d,]+|\+)?\s+employees\b/i);
    return (withEmployees?.[0] ?? fromHeading).trim();
  }
  const fallback = content.match(/\b[\d,]+(?:\s*-\s*[\d,]+|\+)?\s+employees\b/i);
  return fallback?.[0]?.trim() || null;
}

function toCandidates(data: TavilyResponse): Array<{
  url: string;
  title: string;
  content: string;
  score: number;
}> {
  if (!Array.isArray(data.results)) return [];
  return data.results
    .filter((item): item is TavilyResult => typeof item === "object" && item !== null)
    .map((item) => ({
      url: typeof item.url === "string" ? item.url : "",
      title: typeof item.title === "string" ? item.title : "",
      content: typeof item.content === "string" ? item.content : "",
      score: typeof item.score === "number" ? item.score : 0,
    }))
    .filter((item) => item.url && item.content);
}

function pickBestCandidate(
  candidates: Array<{ url: string; title: string; content: string; score: number }>,
  companyName: string,
): { url: string; title: string; content: string; score: number } | null {
  const normalizedName = normalizeText(companyName);
  const linkedInCandidates = candidates.filter((c) => looksLikeLinkedInCompanyUrl(c.url));
  const strictMatched = linkedInCandidates.filter((c) => {
    const haystack = normalizeText(`${c.title} ${c.content}`);
    return haystack.includes(normalizedName);
  });
  const pool = strictMatched.length > 0 ? strictMatched : linkedInCandidates;
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => b.score - a.score)[0] ?? null;
}

export async function revealCompanyWithTavily(opts: {
  companyName: string;
  country?: string;
  apiKey: string;
}): Promise<RevealCompanyTavilyPayload> {
  const companyName = opts.companyName.trim();
  const country = (opts.country ?? "").trim();
  const query = country
    ? `linkedIn of ${companyName} ${country}`
    : `linkedIn of ${companyName}`;

  log.info("Tavily search", { companyName, hasCountry: Boolean(country) });
  const upstream = await fetch(TAVILY_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: opts.apiKey,
      query,
      search_depth: "advanced",
    }),
  });

  const raw = (await upstream.json()) as TavilyResponse | { detail?: unknown };
  log.fetchMeta("Tavily upstream", upstream, JSON.stringify(raw).length);
  if (!upstream.ok) {
    const message =
      typeof raw === "object" &&
      raw !== null &&
      "detail" in raw &&
      typeof raw.detail === "string"
        ? raw.detail
        : `Tavily HTTP ${upstream.status}`;
    throw new Error(message);
  }

  const candidates = toCandidates(raw as TavilyResponse);
  const best = pickBestCandidate(candidates, companyName);

  if (!best) {
    log.info("Tavily no strong candidate", { companyName });
    return {
      companyName,
      matchedUrl: null,
      industry: "Unknown",
      companySize: "Unknown",
      source: "tavily",
      confidence: "low",
    };
  }

  const industry = extractIndustry(best.content) ?? "Unknown";
  const companySize = extractCompanySize(best.content) ?? "Unknown";
  const confidence =
    industry !== "Unknown" && companySize !== "Unknown"
      ? "high"
      : industry !== "Unknown" || companySize !== "Unknown"
        ? "medium"
        : "low";

  log.info("Tavily ok", { companyName, confidence });
  return {
    companyName,
    matchedUrl: best.url,
    industry,
    companySize,
    source: "tavily",
    confidence,
  };
}
