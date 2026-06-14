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

/** `all_jobs` must contain at least one of these titles (OR match, case-insensitive substring). */
export const MEET_ALFRED_CRON_JOB_TITLES = [
  "Senior Software Engineer",
  "Cloud Engineer",
  "Front End Software Engineer",
  "Infrastructure Engineer",
  "Backend Engineer",
  "Software Developer",
  "Software Engineer",
  "Azure Developer",
  ".NET Developer",
  "Forward Deployed Engineer",
  "Platform Engineer",
  "Data Engineer",
  "QA Engineer",
  "Web Developer",
  "AI/ML Engineer",
  "Frontend Engineer",
  "Full-stack Software Engineer",
  "Full-stack Developer",
  "Fullstack Software Engineer",
  "Fullstack Developer",
  "Integration Engineer",
  "Automation Tester",
  "Systems Administrator",
  "Artificial Intelligence Engineer",
  "LLM Engineer",
  "Full Stack Developer",
  "QA Automation",
  "Founding Engineer",
  "Solutions Architect",
  "Cloud Platform Engineer",
  "Product Engineer",
  "iOS Developer",
  "Android Developer",
  "Full Stack Engineer",
  "Programmer",
  "ML Engineer",
  "Software Architect",
  "Site Reliability Engineer",
  "Data Analyst",
  "Solutions Engineer",
  "Software Test Engineer",
  "Software Engineering",
  "Cloud Architect",
  "Systems Engineer",
  "DevSecOps Engineer",
  "Python Developer",
  "Tech Lead",
  "Quality Assurance Engineer",
  "Database Architect",
  "DBA",
  "Database Developer",
  "Full-stack Web Developer",
  "AI Developer",
  "Machine Learning Engineer",
] as const;

/** `contacts.title` must contain at least one of these (OR match, case-insensitive substring). */
export const MEET_ALFRED_CRON_CONTACT_TITLES = [
  "Chief Operating Officer",
  "Managing Director",
  "Founder",
  "Cofounder",
  "CEO",
  "Chief Executive Officer",
  "Chief Technology Officer",
  "CTO",
] as const;

/** Matches the manual UI filter preset for Meet Alfred auto-send. */
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
  jobTitles: [...MEET_ALFRED_CRON_JOB_TITLES],
  contactTitles: [...MEET_ALFRED_CRON_CONTACT_TITLES],
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
  /** Same terms as list filter — used to pick matching job for Meet Alfred `csv_jobtitle`. */
  const jobTitleFilterRaw =
    input?.jobTitleFilterRaw ?? (filters.jobTitles ?? []).join("\n");
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
