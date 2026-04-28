import { Pool } from "pg";
import { createLogger } from "./logger.js";

const log = createLogger("lib/enrichedContactsRepo");

export type EnrichedContact = {
  id: number | null;
  companyId: number | null;
  contactName: string | null;
  contactLinkedin: string | null;
  apolloProfileHref: string | null;
  contactLocation: string | null;
  source: string | null;
  email: string | null;
  predictedOriginOfName: string | null;
  countryId: string | number | null;
  isPredictedOriginBlacklisted: boolean | null;
  isContactLocationBlacklisted: boolean | null;
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
          ct.contact_name AS "contactName",
          ct.contact_linkedin AS "contactLinkedin",
          ct.apollo_profile_href AS "apolloProfileHref",
          ct.contact_location AS "contactLocation",
          ct.source,
          ct.email,
          ct.predicted_origin_of_name AS "predictedOriginOfName",
          ct.country_id AS "countryId",
          ct.is_predicted_origin_blacklisted AS "isPredictedOriginBlacklisted",
          ct.is_contact_location_blacklisted AS "isContactLocationBlacklisted",
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
