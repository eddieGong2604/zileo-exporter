export const config = { runtime: "nodejs" };

import type { IncomingMessage, ServerResponse } from "node:http";
import { createLogger } from "../lib/logger.js";
import { listEnrichedContacts } from "../lib/enrichedContactsRepo.js";

const log = createLogger("api/enriched-contacts");

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const url = new URL(req.url ?? "", "http://localhost");
    const sourceCountries = url.searchParams.getAll("sourceCountry");
    const jobTitles = url.searchParams.getAll("jobTitle");
    const contactTitles = url.searchParams.getAll("contactTitle");
    const out = await listEnrichedContacts({
      status: (url.searchParams.get("status") ?? "all") as
        | "all"
        | "approved"
        | "queued"
        | "rejected",
      meetAlfredAdded: (url.searchParams.get("meetAlfredAdded") ?? "all") as
        | "all"
        | "added"
        | "not_added",
      instantlyAdded: (url.searchParams.get("instantlyAdded") ?? "not_added") as
        | "all"
        | "added"
        | "not_added",
      excludeOriginBlacklisted: url.searchParams.get("excludeOriginBlacklisted") !== "false",
      excludeLocationBlacklisted:
        url.searchParams.get("excludeLocationBlacklisted") !== "false",
      excludeNotALead: url.searchParams.get("excludeNotALead") !== "false",
      contactNameContainsSpace: url.searchParams.get("contactNameContainsSpace") === "true",
      sourceCountries,
      latestJobPosted: (url.searchParams.get("latestJobPosted") ?? "all") as
        | "24h"
        | "3d"
        | "1w"
        | "all",
      jobTitles,
      contactTitles,
      page: Number(url.searchParams.get("page") ?? 1),
      limit: Number(url.searchParams.get("limit") ?? 100),
    });
    sendJson(res, 200, out);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load enriched contacts";
    log.error("handler failed", { message });
    sendJson(res, 500, { error: message });
  }
}
