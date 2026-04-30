import { createLogger } from "./logger.js";

const log = createLogger("lib/apolloBulkMatch");

export type ApolloBulkMatchInput = {
  contactId: number;
  linkedinUrl: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  domain?: string;
  externalId?: string;
  organizationName?: string;
};

type ApolloBulkMatchResponse = {
  matches?: Array<
    | {
        linkedin_url?: string | null;
        email?: string | null;
      }
    | null
  >;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function normalizedLinkedinUrl(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    url.search = "";
    const cleanPath = url.pathname.replace(/\/+$/, "");
    return `${url.origin.toLowerCase()}${cleanPath.toLowerCase()}`;
  } catch {
    return raw.toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

function linkedinProfileId(value: string): string {
  const normalized = normalizedLinkedinUrl(value);
  if (!normalized) return "";
  const match = normalized.match(/\/in\/([^/?#]+)/i);
  return (match?.[1] ?? "").trim().toLowerCase();
}

export async function bulkRevealEmailsWithApollo(input: {
  apiKey: string;
  people: ApolloBulkMatchInput[];
}): Promise<Array<{ contactId: number; email: string }>> {
  const people = input.people.filter(
    (p) => Number.isFinite(p.contactId) && p.contactId > 0 && p.linkedinUrl.trim().length > 0,
  );
  if (people.length === 0) return [];

  const byLinkedinId = new Map<string, number>();
  const byLinkedinUrl = new Map<string, number>();
  for (const p of people) {
    const id = linkedinProfileId(p.linkedinUrl);
    if (id) byLinkedinId.set(id, p.contactId);
    const normalizedUrl = normalizedLinkedinUrl(p.linkedinUrl);
    if (normalizedUrl) byLinkedinUrl.set(normalizedUrl, p.contactId);
  }

  const batches = chunk(people, 10);
  log.info("bulkRevealEmailsWithApollo start", {
    requested: people.length,
    batches: batches.length,
  });
  const settled = await Promise.all(
    batches.map(async (batch, batchIndex) => {
      const payload = {
        details: batch.map((p) => ({
          linkedin_url: p.linkedinUrl.trim(),
          ...(p.firstName?.trim() ? { first_name: p.firstName.trim() } : {}),
          ...(p.lastName?.trim() ? { last_name: p.lastName.trim() } : {}),
          ...(p.name?.trim() ? { name: p.name.trim() } : {}),
          ...(p.email?.trim() ? { email: p.email.trim() } : {}),
          ...(p.domain?.trim() ? { domain: p.domain.trim() } : {}),
          ...(p.externalId?.trim() ? { id: p.externalId.trim() } : {}),
          ...(p.organizationName?.trim()
            ? { organization_name: p.organizationName.trim() }
            : {}),
        })),
      };
      log.info("apollo batch request", {
        batchIndex,
        batchSize: batch.length,
        endpoint:
          "https://api.apollo.io/api/v1/people/bulk_match?reveal_personal_emails=false&reveal_phone_number=false",
        payload,
      });
      const res = await fetch(
        "https://api.apollo.io/api/v1/people/bulk_match?reveal_personal_emails=false&reveal_phone_number=false",
        {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
          "Cache-Control": "no-cache",
          "x-api-key": input.apiKey,
        },
        body: JSON.stringify(payload),
        },
      );
      const text = await res.text();
      log.info("apollo batch response", {
        batchIndex,
        batchSize: batch.length,
        status: res.status,
        ok: res.ok,
        responseBody: text,
      });
      if (!res.ok) {
        log.warn("apollo batch failed", {
          batchIndex,
          batchSize: batch.length,
          status: res.status,
          responseSnippet: text.slice(0, 300),
        });
        throw new Error(`Apollo bulk_match HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      log.info("apollo batch success", {
        batchIndex,
        batchSize: batch.length,
      });
      return JSON.parse(text) as ApolloBulkMatchResponse;
    }),
  );

  const updates: Array<{ contactId: number; email: string }> = [];
  for (const response of settled) {
    const matches = Array.isArray(response.matches) ? response.matches : [];
    for (const m of matches) {
      if (!m || typeof m !== "object") continue;
      const linkedin = (m.linkedin_url ?? "").trim();
      const email = (m.email ?? "").trim();
      if (!linkedin || !email) continue;
      const linkedinId = linkedinProfileId(linkedin);
      const contactId =
        (linkedinId ? byLinkedinId.get(linkedinId) : undefined) ??
        byLinkedinUrl.get(normalizedLinkedinUrl(linkedin));
      if (!contactId) continue;
      updates.push({ contactId, email });
    }
  }

  const dedup = new Map<number, string>();
  for (const u of updates) dedup.set(u.contactId, u.email);
  const result = Array.from(dedup.entries()).map(([contactId, email]) => ({
    contactId,
    email,
  }));
  log.info("bulkRevealEmailsWithApollo done", {
    requested: people.length,
    updated: result.length,
  });
  return result;
}
