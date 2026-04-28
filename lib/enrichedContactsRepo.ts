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
  createdAt: string;
  updatedAt: string;
  company: Record<string, unknown> | null;
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
  connectionStringOverride?: string,
): Promise<EnrichedContact[]> {
  const client = await getPool(connectionStringOverride).connect();
  try {
    const result = await client.query<EnrichedContact>(
      `
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
          ct.created_at AS "createdAt",
          ct.updated_at AS "updatedAt",
          row_to_json(cp) AS company
        FROM contacts ct
        RIGHT JOIN companies cp ON cp.id = ct.company_id
        ORDER BY cp.source_company_name NULLS LAST, ct.contact_name NULLS LAST, ct.id ASC
      `,
    );
    return result.rows;
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
       SET added_to_meetalfred_campaign = TRUE, updated_at = NOW()
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
