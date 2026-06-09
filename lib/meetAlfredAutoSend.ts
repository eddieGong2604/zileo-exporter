import { createLogger } from "./logger.js";
import {
  listEnrichedContacts,
  markContactsAddedToMeetAlfred,
  type EnrichedContact,
  type EnrichedServerFilters,
} from "./enrichedContactsRepo.js";
import {
  listMeetAlfredCampaigns,
  sendMeetAlfredBulkLeadsByCampaign,
} from "./meetAlfred.js";
import { prepareMeetAlfredBulkLeads } from "./meetAlfredLeadPrep.js";

const log = createLogger("lib/meetAlfredAutoSend");

const PAGE_SIZE = 100;

/** Matches the manual UI filter preset shown in the enriched contacts page. */
export const MEET_ALFRED_CRON_FILTERS: EnrichedServerFilters = {
  status: "approved",
  meetAlfredAdded: "not_added",
  instantlyAdded: "all",
  includeIgnoreForNow: false,
  excludeOriginBlacklisted: true,
  excludeLocationBlacklisted: true,
  excludeNotALead: true,
  contactNameContainsSpace: false,
  sourceCountries: ["Australia", "United States", "United Kingdom"],
  latestJobPosted: "1w",
  jobTitles: [],
  contactTitles: [],
};

export async function listAllEnrichedContactsMatching(
  filters: EnrichedServerFilters,
  connectionStringOverride?: string,
): Promise<EnrichedContact[]> {
  const first = await listEnrichedContacts(
    { ...filters, page: 1, limit: PAGE_SIZE },
    connectionStringOverride,
  );
  const allRows = [...first.data];
  const totalPages = Math.max(1, Math.ceil(first.meta.totalContacts / PAGE_SIZE));
  for (let page = 2; page <= totalPages; page += 1) {
    const next = await listEnrichedContacts(
      { ...filters, page, limit: PAGE_SIZE },
      connectionStringOverride,
    );
    allRows.push(...next.data);
  }
  return allRows;
}

export type MeetAlfredAutoSendResult = {
  matchedContacts: number;
  prepared: number;
  skipped: number;
  attempted: number;
  sent: number;
  failed: number;
  marked: number;
  markedContactIds: number[];
  skippedDetails: Array<{ contactId: number; reason: string }>;
};

export async function runMeetAlfredAutoSend(input?: {
  filters?: EnrichedServerFilters;
  jobTitleFilterRaw?: string;
  connectionStringOverride?: string;
}): Promise<MeetAlfredAutoSendResult> {
  const filters = input?.filters ?? MEET_ALFRED_CRON_FILTERS;
  const jobTitleFilterRaw = input?.jobTitleFilterRaw ?? "";
  const connectionStringOverride = input?.connectionStringOverride;

  log.info("runMeetAlfredAutoSend start", { filters });

  const [campaigns, rows] = await Promise.all([
    listMeetAlfredCampaigns(),
    listAllEnrichedContactsMatching(filters, connectionStringOverride),
  ]);

  log.info("runMeetAlfredAutoSend fetched", {
    campaigns: campaigns.length,
    matchedContacts: rows.length,
  });

  if (rows.length === 0) {
    return {
      matchedContacts: 0,
      prepared: 0,
      skipped: 0,
      attempted: 0,
      sent: 0,
      failed: 0,
      marked: 0,
      markedContactIds: [],
      skippedDetails: [],
    };
  }

  const { leads, skipped } = prepareMeetAlfredBulkLeads({
    rows,
    campaigns,
    jobTitleFilterRaw,
  });

  if (leads.length === 0) {
    log.info("runMeetAlfredAutoSend no sendable leads", { skipped: skipped.length });
    return {
      matchedContacts: rows.length,
      prepared: 0,
      skipped: skipped.length,
      attempted: 0,
      sent: 0,
      failed: 0,
      marked: 0,
      markedContactIds: [],
      skippedDetails: skipped,
    };
  }

  const result = await sendMeetAlfredBulkLeadsByCampaign(leads);
  const marked = await markContactsAddedToMeetAlfred(
    result.successContactIds,
    connectionStringOverride,
  );

  log.info("runMeetAlfredAutoSend done", {
    matchedContacts: rows.length,
    prepared: leads.length,
    skipped: skipped.length,
    attempted: result.attempted,
    sent: result.sent,
    failed: result.failed,
    marked,
  });

  return {
    matchedContacts: rows.length,
    prepared: leads.length,
    skipped: skipped.length,
    attempted: result.attempted,
    sent: result.sent,
    failed: result.failed,
    marked,
    markedContactIds: result.successContactIds,
    skippedDetails: skipped,
  };
}
