import { Pool } from "pg";
import { createLogger } from "./logger.js";

const log = createLogger("lib/enrichedContactsRepo");

export type EnrichedContact = {
  id: number | null;
  companyId: number | null;
  firstName: string | null;
  contactName: string | null;
  title: string | null;
  contactLinkedin: string | null;
  apolloProfileHref: string | null;
  contactLocation: string | null;
  source: string | null;
  email: string | null;
  predictedOriginOfName: string | null;
  countryId: string | number | null;
  isPredictedOriginBlacklisted: boolean | null;
  isContactLocationBlacklisted: boolean | null;
  addedToMeetAlfredCampaign: boolean | null;
  addedToMeetAlfredAt: string | null;
  addedToInstantlyAt: string | null;
  notALead: boolean | null;
  createdAt: string;
  updatedAt: string;
  company: Record<string, unknown> | null;
};

export type LatestJobPostedFilter = "24h" | "3d" | "1w" | "all";
export type EnrichedServerFilters = {
  status?: "all" | "approved" | "queued" | "rejected";
  meetAlfredAdded?: "all" | "added" | "not_added";
  instantlyAdded?: "all" | "added" | "not_added";
  excludeOriginBlacklisted?: boolean;
  excludeLocationBlacklisted?: boolean;
  excludeNotALead?: boolean;
  sourceCountries?: string[];
  latestJobPosted?: LatestJobPostedFilter;
  page?: number;
  limit?: number;
};

export type EnrichedListResult = {
  data: EnrichedContact[];
  meta: {
    page: number;
    limit: number;
    totalContacts: number;
    totalCompanies: number;
  };
};

let pool: Pool | null = null;
let poolConnectionString: string | null = null;

function resolveConnectionString(override?: string): string {
  const connectionString =
    override ?? process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing POSTGRES_URL or DATABASE_URL on server");
  }
  return connectionString;
}

function getPool(connectionStringOverride?: string): Pool {
  const connectionString = resolveConnectionString(connectionStringOverride);
  if (pool && poolConnectionString === connectionString) return pool;
  pool = new Pool({ connectionString });
  poolConnectionString = connectionString;
  return pool;
}

export async function listEnrichedContacts(
  filters?: EnrichedServerFilters,
  connectionStringOverride?: string,
): Promise<EnrichedListResult> {
  const client = await getPool(connectionStringOverride).connect();
  try {
    const page = Math.max(1, Number(filters?.page ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters?.limit ?? 100) || 100));
    const offset = (page - 1) * limit;

    const where: string[] = [];
    const values: unknown[] = [];
    const push = (v: unknown) => {
      values.push(v);
      return `$${values.length}`;
    };

    const status = (filters?.status ?? "all").toLowerCase();
    if (status !== "all") where.push(`LOWER(COALESCE(cp.status, '')) = ${push(status)}`);

    const ma = (filters?.meetAlfredAdded ?? "all").toLowerCase();
    if (ma === "added") where.push(`ct.added_to_meetalfred_campaign IS TRUE`);
    if (ma === "not_added")
      where.push(`COALESCE(ct.added_to_meetalfred_campaign, FALSE) IS FALSE`);

    const instantlyAdded = (filters?.instantlyAdded ?? "not_added").toLowerCase();
    if (instantlyAdded === "added") where.push(`ct.added_to_instantly_at IS NOT NULL`);
    if (instantlyAdded === "not_added") where.push(`ct.added_to_instantly_at IS NULL`);

    const excludeOrigin = filters?.excludeOriginBlacklisted ?? true;
    if (excludeOrigin)
      where.push(`COALESCE(ct.is_predicted_origin_blacklisted, FALSE) IS FALSE`);

    const excludeLocation = filters?.excludeLocationBlacklisted ?? true;
    if (excludeLocation)
      where.push(`COALESCE(ct.is_contact_location_blacklisted, FALSE) IS FALSE`);

    const excludeNotALead = filters?.excludeNotALead ?? true;
    if (excludeNotALead) where.push(`COALESCE(ct.not_a_lead, FALSE) IS FALSE`);

    const sourceCountries = Array.isArray(filters?.sourceCountries)
      ? filters?.sourceCountries.filter(Boolean)
      : [];
    if (sourceCountries.length > 0) {
      const normalized = sourceCountries.map((s) => s.trim().toLowerCase());
      const expanded = new Set<string>(normalized);
      if (normalized.includes("australia")) {
        expanded.add("au");
        expanded.add("aus");
      }
      if (normalized.includes("united states")) {
        expanded.add("usa");
        expanded.add("us");
        expanded.add("u.s.");
        expanded.add("u.s.a.");
        expanded.add("united states of america");
      }
      if (normalized.includes("united kingdom")) {
        expanded.add("uk");
        expanded.add("gb");
        expanded.add("great britain");
        expanded.add("united kingdon");
        expanded.add("united kinadom");
        expanded.add("united kindgom");
      }
      where.push(
        `LOWER(TRIM(COALESCE(cp.source_country, ''))) = ANY(${push(Array.from(expanded))}::text[])`,
      );
    }

    const latest = (filters?.latestJobPosted ?? "all").toLowerCase();
    if (latest === "24h")
      where.push(
        `cp.source_latest_job_posted_at IS NOT NULL AND cp.source_latest_job_posted_at >= NOW() - INTERVAL '24 hours'`,
      );
    if (latest === "3d")
      where.push(
        `cp.source_latest_job_posted_at IS NOT NULL AND cp.source_latest_job_posted_at >= NOW() - INTERVAL '3 days'`,
      );
    if (latest === "1w")
      where.push(
        `cp.source_latest_job_posted_at IS NOT NULL AND cp.source_latest_job_posted_at >= NOW() - INTERVAL '7 days'`,
      );

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const limitSql = push(limit);
    const offsetSql = push(offset);

    const result = await client.query<EnrichedContact>(
      `
        WITH filtered AS (
          SELECT
            ct.id,
            cp.id AS "companyId",
            ct.first_name AS "firstName",
            ct.contact_name AS "contactName",
            ct.title,
            ct.contact_linkedin AS "contactLinkedin",
            ct.apollo_profile_href AS "apolloProfileHref",
            ct.contact_location AS "contactLocation",
            ct.source,
            ct.email,
            ct.predicted_origin_of_name AS "predictedOriginOfName",
            ct.country_id AS "countryId",
            ct.is_predicted_origin_blacklisted AS "isPredictedOriginBlacklisted",
            ct.is_contact_location_blacklisted AS "isContactLocationBlacklisted",
            ct.added_to_meetalfred_campaign AS "addedToMeetAlfredCampaign",
            ct.added_to_meet_alfred_at AS "addedToMeetAlfredAt",
            ct.added_to_instantly_at AS "addedToInstantlyAt",
            ct.not_a_lead AS "notALead",
            ct.created_at AS "createdAt",
            ct.updated_at AS "updatedAt",
            row_to_json(cp) AS company
          FROM contacts ct
          RIGHT JOIN companies cp ON cp.id = ct.company_id
          ${whereClause}
        )
        SELECT *
        FROM filtered
        ORDER BY company->>'source_company_name' NULLS LAST, "contactName" NULLS LAST, id ASC
        LIMIT ${limitSql}
        OFFSET ${offsetSql}
      `,
      values,
    );

    const countResult = await client.query<{ totalContacts: string; totalCompanies: string }>(
      `
        SELECT
          COUNT(*)::text AS "totalContacts",
          COUNT(DISTINCT cp.id)::text AS "totalCompanies"
        FROM contacts ct
        RIGHT JOIN companies cp ON cp.id = ct.company_id
        ${whereClause}
      `,
      values.slice(0, values.length - 2),
    );
    const counts = countResult.rows[0] ?? { totalContacts: "0", totalCompanies: "0" };
    return {
      data: result.rows,
      meta: {
        page,
        limit,
        totalContacts: Number(counts.totalContacts) || 0,
        totalCompanies: Number(counts.totalCompanies) || 0,
      },
    };
  } catch (error) {
    log.error("listEnrichedContacts failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    client.release();
  }
}

export async function updateContactEmails(
  updates: Array<{ id: number; email: string }>,
  connectionStringOverride?: string,
): Promise<number> {
  if (updates.length === 0) return 0;
  const client = await getPool(connectionStringOverride).connect();
  try {
    await client.query("BEGIN");
    let updated = 0;
    for (const item of updates) {
      const res = await client.query(
        `UPDATE contacts
         SET email = $2, updated_at = NOW()
         WHERE id = $1`,
        [item.id, item.email],
      );
      updated += res.rowCount ?? 0;
    }
    await client.query("COMMIT");
    return updated;
  } catch (error) {
    await client.query("ROLLBACK");
    log.error("updateContactEmails failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    client.release();
  }
}

export async function markContactsAddedToMeetAlfred(
  contactIds: number[],
  connectionStringOverride?: string,
): Promise<number> {
  const ids = Array.from(new Set(contactIds.filter((id) => Number.isFinite(id) && id > 0)));
  if (ids.length === 0) return 0;
  const client = await getPool(connectionStringOverride).connect();
  try {
    const res = await client.query(
      `UPDATE contacts
       SET added_to_meetalfred_campaign = TRUE,
           added_to_meet_alfred_at = NOW(),
           updated_at = NOW()
       WHERE id = ANY($1::int[])`,
      [ids],
    );
    return res.rowCount ?? 0;
  } catch (error) {
    log.error("markContactsAddedToMeetAlfred failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    client.release();
  }
}

export async function markContactsAddedToInstantly(
  contactIds: number[],
  connectionStringOverride?: string,
): Promise<number> {
  const ids = Array.from(new Set(contactIds.filter((id) => Number.isFinite(id) && id > 0)));
  if (ids.length === 0) return 0;
  const client = await getPool(connectionStringOverride).connect();
  try {
    const res = await client.query(
      `UPDATE contacts
       SET added_to_instantly_at = NOW(),
           updated_at = NOW()
       WHERE id = ANY($1::int[])`,
      [ids],
    );
    return res.rowCount ?? 0;
  } catch (error) {
    log.error("markContactsAddedToInstantly failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    client.release();
  }
}

export async function updateContactFirstName(
  input: { id: number; firstName: string },
  connectionStringOverride?: string,
): Promise<boolean> {
  if (!Number.isFinite(input.id) || input.id <= 0) return false;
  const client = await getPool(connectionStringOverride).connect();
  try {
    const res = await client.query(
      `UPDATE contacts
       SET first_name = $2, updated_at = NOW()
       WHERE id = $1`,
      [input.id, input.firstName],
    );
    return (res.rowCount ?? 0) > 0;
  } catch (error) {
    log.error("updateContactFirstName failed", {
      id: input.id,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    client.release();
  }
}

export type ContactEditableField =
  | "first_name"
  | "contact_name"
  | "title"
  | "contact_linkedin"
  | "contact_location"
  | "predicted_origin_of_name"
  | "is_predicted_origin_blacklisted"
  | "is_contact_location_blacklisted"
  | "added_to_meetalfred_campaign"
  | "not_a_lead";

const CONTACT_EDITABLE_FIELD_SQL: Record<ContactEditableField, string> = {
  first_name: "first_name",
  contact_name: "contact_name",
  title: "title",
  contact_linkedin: "contact_linkedin",
  contact_location: "contact_location",
  predicted_origin_of_name: "predicted_origin_of_name",
  is_predicted_origin_blacklisted: "is_predicted_origin_blacklisted",
  is_contact_location_blacklisted: "is_contact_location_blacklisted",
  added_to_meetalfred_campaign: "added_to_meetalfred_campaign",
  not_a_lead: "not_a_lead",
};

export async function updateContactEditableField(
  input: { id: number; field: ContactEditableField; value: string | boolean },
  connectionStringOverride?: string,
): Promise<boolean> {
  if (!Number.isFinite(input.id) || input.id <= 0) return false;
  const sqlField = CONTACT_EDITABLE_FIELD_SQL[input.field];
  if (!sqlField) return false;
  const client = await getPool(connectionStringOverride).connect();
  try {
    let res;
    if (input.field === "first_name") {
      const firstName = String(input.value ?? "").trim();
      res = await client.query(
        `UPDATE contacts
         SET first_name = $2,
             contact_name = CASE
               WHEN COALESCE(BTRIM(contact_name), '') = '' THEN
                 CASE
                   WHEN $2 = '' THEN contact_name
                   ELSE $2
                 END
               ELSE
                 CASE
                   WHEN $2 = '' THEN BTRIM(REGEXP_REPLACE(BTRIM(contact_name), '^[^\\s]+\\s*', ''))
                   ELSE $2 || CASE
                     WHEN BTRIM(REGEXP_REPLACE(BTRIM(contact_name), '^[^\\s]+\\s*', '')) = '' THEN ''
                     ELSE ' ' || BTRIM(REGEXP_REPLACE(BTRIM(contact_name), '^[^\\s]+\\s*', ''))
                   END
                 END
             END,
             updated_at = NOW()
         WHERE id = $1`,
        [input.id, firstName],
      );
    } else {
      res = await client.query(
        `UPDATE contacts
         SET ${sqlField} = $2, updated_at = NOW()
         WHERE id = $1`,
        [input.id, input.value],
      );
    }
    return (res.rowCount ?? 0) > 0;
  } catch (error) {
    log.error("updateContactEditableField failed", {
      id: input.id,
      field: input.field,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    client.release();
  }
}

export async function rejectCompany(
  input: { companyId: number; rejectionReason: string },
  connectionStringOverride?: string,
): Promise<boolean> {
  if (!Number.isFinite(input.companyId) || input.companyId <= 0) return false;
  const client = await getPool(connectionStringOverride).connect();
  try {
    const res = await client.query(
      `UPDATE companies
       SET status = 'rejected',
           rejection_reason = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [input.companyId, input.rejectionReason],
    );
    return (res.rowCount ?? 0) > 0;
  } catch (error) {
    log.error("rejectCompany failed", {
      companyId: input.companyId,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    client.release();
  }
}
