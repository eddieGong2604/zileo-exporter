import { createLogger } from "./logger.js";

const log = createLogger("lib/apolloBulkMatch");

export type ApolloBulkMatchInput = {
  contactId: number;
  linkedinUrl: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  organizationName?: string;
};

type ApolloBulkMatchResponse = {
  matches?: Array<{
    linkedin_url?: string | null;
    email?: string | null;
  }>;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function bulkRevealEmailsWithApollo(input: {
  apiKey: string;
  people: ApolloBulkMatchInput[];
}): Promise<Array<{ contactId: number; email: string }>> {
  const people = input.people.filter(
    (p) => Number.isFinite(p.contactId) && p.contactId > 0 && p.linkedinUrl.trim().length > 0,
  );
  if (people.length === 0) return [];

  const byLinkedin = new Map<string, number>();
  for (const p of people) {
    byLinkedin.set(p.linkedinUrl.trim().toLowerCase(), p.contactId);
  }

  const batches = chunk(people, 10);
  const settled = await Promise.all(
    batches.map(async (batch) => {
      const payload = {
        details: batch.map((p) => ({
          linkedin_url: p.linkedinUrl.trim(),
          ...(p.firstName?.trim() ? { first_name: p.firstName.trim() } : {}),
          ...(p.lastName?.trim() ? { last_name: p.lastName.trim() } : {}),
          ...(p.name?.trim() ? { name: p.name.trim() } : {}),
          ...(p.organizationName?.trim()
            ? { organization_name: p.organizationName.trim() }
            : {}),
        })),
      };
      const res = await fetch("https://api.apollo.io/api/v1/people/bulk_match", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
          "x-api-key": input.apiKey,
        },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`Apollo bulk_match HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      return JSON.parse(text) as ApolloBulkMatchResponse;
    }),
  );

  const updates: Array<{ contactId: number; email: string }> = [];
  for (const response of settled) {
    const matches = Array.isArray(response.matches) ? response.matches : [];
    for (const m of matches) {
      const linkedin = (m.linkedin_url ?? "").trim().toLowerCase();
      const email = (m.email ?? "").trim();
      if (!linkedin || !email) continue;
      const contactId = byLinkedin.get(linkedin);
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
