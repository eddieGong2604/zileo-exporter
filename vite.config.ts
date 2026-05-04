import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { createLogger } from "./lib/logger.js";
import { revealCompanyWithOpenAI } from "./lib/revealCompanyOpenAI";
import { revealCompanyWithTavily } from "./lib/revealCompanyTavily";
import {
  listEnrichedContacts,
  markContactsAddedToInstantly,
  markContactsAddedToMeetAlfred,
  rejectCompany,
  updateContactEditableField,
  updateContactFirstName,
  updateContactEmails,
} from "./lib/enrichedContactsRepo.js";
import { listMeetAlfredCampaigns, sendMeetAlfredBulkLeadsByCampaign } from "./lib/meetAlfred.js";
import { bulkRevealEmailsWithApollo } from "./lib/apolloBulkMatch.js";
import { listInstantlyCampaigns, sendInstantlyBulkLeadsByCampaign } from "./lib/instantly.js";

const devRevealLog = createLogger("vite/reveal-dev-api");

function revealDevApiPlugin(env: Record<string, string>): Plugin {
  return {
    name: "reveal-dev-api",
    configureServer(server) {
      server.middlewares.use(
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const pathname = req.url?.split("?")[0] ?? "";
          if (
            req.method !== "POST" ||
            (pathname !== "/api/reveal-company" &&
              pathname !== "/api/reveal-company-v2")
          ) {
            next();
            return;
          }
          const chunks: Buffer[] = [];
          req.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          req.on("end", () => {
            void (async () => {
              try {
                devRevealLog.info("request", { pathname });
                const raw = Buffer.concat(chunks).toString("utf8");
                let body: {
                  companyName?: string;
                  countryHint?: string;
                  country?: string;
                };
                try {
                  body = JSON.parse(raw) as {
                    companyName?: string;
                    countryHint?: string;
                    country?: string;
                  };
                } catch {
                  res.statusCode = 400;
                  res.setHeader("Content-Type", "application/json");
                  res.end(JSON.stringify({ error: "Invalid JSON body" }));
                  return;
                }
                const companyName = (body.companyName ?? "").trim();
                if (!companyName) {
                  res.statusCode = 400;
                  res.setHeader("Content-Type", "application/json");
                  res.end(
                    JSON.stringify({ error: "companyName is required" }),
                  );
                  return;
                }
                let result: unknown;
                if (pathname === "/api/reveal-company-v2") {
                  const apiKey = env.TAVILY_API_KEY;
                  if (!apiKey) {
                    res.statusCode = 500;
                    res.setHeader("Content-Type", "application/json");
                    res.end(
                      JSON.stringify({
                        error: "Missing TAVILY_API_KEY on server",
                      }),
                    );
                    return;
                  }
                  const country = (body.country ?? "").trim();
                  result = await revealCompanyWithTavily({
                    companyName,
                    country: country || undefined,
                    apiKey,
                  });
                } else {
                  const apiKey = env.OPENAI_API_KEY;
                  if (!apiKey) {
                    res.statusCode = 500;
                    res.setHeader("Content-Type", "application/json");
                    res.end(
                      JSON.stringify({
                        error: "Missing OPENAI_API_KEY on server",
                      }),
                    );
                    return;
                  }
                  const countryHint = (body.countryHint ?? "").trim();
                  result = await revealCompanyWithOpenAI({
                    companyName,
                    countryHint: countryHint || undefined,
                    apiKey,
                  });
                }
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(result));
              } catch (e) {
                const msg = e instanceof Error ? e.message : "OpenAI error";
                devRevealLog.error("handler error", { pathname, msg });
                res.statusCode = 502;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ error: msg }));
              }
            })();
          });
        },
      );
      server.middlewares.use(
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const pathname = req.url?.split("?")[0] ?? "";
          if (req.method !== "POST" || pathname !== "/api/contact-update-field") {
            next();
            return;
          }
          const chunks: Buffer[] = [];
          req.on("data", (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          req.on("end", () => {
            void (async () => {
              try {
                const raw = Buffer.concat(chunks).toString("utf8");
                const body = JSON.parse(raw) as {
                  id?: number;
                  field?:
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
                  value?: unknown;
                };
                const id = Number(body.id);
                const field = body.field;
                if (!Number.isFinite(id) || id <= 0) {
                  res.statusCode = 400;
                  res.setHeader("Content-Type", "application/json; charset=utf-8");
                  res.end(JSON.stringify({ error: "id must be a positive number" }));
                  return;
                }
                const booleanFields = new Set([
                  "is_predicted_origin_blacklisted",
                  "is_contact_location_blacklisted",
                  "added_to_meetalfred_campaign",
                  "not_a_lead",
                ]);
                const value = booleanFields.has(field ?? "")
                  ? Boolean(body.value)
                  : String(body.value ?? "").trim();
                if (!field) {
                  res.statusCode = 400;
                  res.setHeader("Content-Type", "application/json; charset=utf-8");
                  res.end(JSON.stringify({ error: "field is required" }));
                  return;
                }
                const ok = await updateContactEditableField(
                  { id, field, value },
                  env.POSTGRES_URL || env.DATABASE_URL,
                );
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ ok }));
              } catch (e) {
                const msg =
                  e instanceof Error ? e.message : "Failed to update contact field";
                res.statusCode = 500;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: msg }));
              }
            })();
          });
        },
      );
      server.middlewares.use(
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const pathname = req.url?.split("?")[0] ?? "";
          if (req.method !== "POST" || pathname !== "/api/company-reject") {
            next();
            return;
          }
          const chunks: Buffer[] = [];
          req.on("data", (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          req.on("end", () => {
            void (async () => {
              try {
                const raw = Buffer.concat(chunks).toString("utf8");
                const body = JSON.parse(raw) as {
                  companyId?: number;
                  rejectionReason?: string;
                };
                const companyId = Number(body.companyId);
                const rejectionReason = (body.rejectionReason ?? "").trim();
                if (!Number.isFinite(companyId) || companyId <= 0) {
                  res.statusCode = 400;
                  res.setHeader("Content-Type", "application/json; charset=utf-8");
                  res.end(
                    JSON.stringify({ error: "companyId must be a positive number" }),
                  );
                  return;
                }
                if (!rejectionReason) {
                  res.statusCode = 400;
                  res.setHeader("Content-Type", "application/json; charset=utf-8");
                  res.end(JSON.stringify({ error: "rejectionReason is required" }));
                  return;
                }
                const ok = await rejectCompany(
                  { companyId, rejectionReason },
                  env.POSTGRES_URL || env.DATABASE_URL,
                );
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ ok }));
              } catch (e) {
                const msg = e instanceof Error ? e.message : "Failed to reject company";
                res.statusCode = 500;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: msg }));
              }
            })();
          });
        },
      );
      server.middlewares.use(
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const pathname = req.url?.split("?")[0] ?? "";
          if (req.method !== "POST" || pathname !== "/api/contact-first-name") {
            next();
            return;
          }
          const chunks: Buffer[] = [];
          req.on("data", (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          req.on("end", () => {
            void (async () => {
              try {
                const raw = Buffer.concat(chunks).toString("utf8");
                const body = JSON.parse(raw) as { id?: number; firstName?: string };
                const id = Number(body.id);
                const firstName = (body.firstName ?? "").trim();
                if (!Number.isFinite(id) || id <= 0) {
                  res.statusCode = 400;
                  res.setHeader("Content-Type", "application/json; charset=utf-8");
                  res.end(JSON.stringify({ error: "id must be a positive number" }));
                  return;
                }
                const ok = await updateContactFirstName(
                  { id, firstName },
                  env.POSTGRES_URL || env.DATABASE_URL,
                );
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ ok }));
              } catch (e) {
                const msg =
                  e instanceof Error ? e.message : "Failed to update contact first name";
                res.statusCode = 500;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: msg }));
              }
            })();
          });
        },
      );
      server.middlewares.use(
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const pathname = req.url?.split("?")[0] ?? "";
          if (req.method !== "POST" || pathname !== "/api/apollo-bulk-reveal-emails") {
            next();
            return;
          }
          const chunks: Buffer[] = [];
          req.on("data", (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          req.on("end", () => {
            void (async () => {
              try {
                const apiKey = env.APOLLO_API_KEY;
                if (!apiKey) {
                  res.statusCode = 500;
                  res.setHeader("Content-Type", "application/json; charset=utf-8");
                  res.end(JSON.stringify({ error: "Missing APOLLO_API_KEY on server" }));
                  return;
                }
                const raw = Buffer.concat(chunks).toString("utf8");
                const body = JSON.parse(raw) as {
                  contacts?: Array<{
                    id?: number;
                    linkedinUrl?: string;
                    firstName?: string;
                    contactName?: string;
                    companyName?: string;
                    email?: string;
                  }>;
                };
                const contacts = Array.isArray(body.contacts) ? body.contacts : [];
                devRevealLog.info("apollo bulk reveal request", {
                  requestedRaw: contacts.length,
                });
                const mapped = contacts
                  .map((c) => {
                    const fullName = (c.contactName ?? "").trim();
                    const [firstFromName = "", ...rest] = fullName
                      .split(/\s+/)
                      .filter(Boolean);
                    return {
                      contactId: Number(c.id),
                      linkedinUrl: (c.linkedinUrl ?? "").trim(),
                      email: (c.email ?? "").trim(),
                      firstName: (c.firstName ?? "").trim() || firstFromName || undefined,
                      lastName: rest.length > 0 ? rest.join(" ") : undefined,
                      name: fullName || undefined,
                      organizationName: (c.companyName ?? "").trim() || undefined,
                    };
                  })
                  .filter(
                    (c) =>
                      Number.isFinite(c.contactId) &&
                      c.contactId > 0 &&
                      c.linkedinUrl.length > 0 &&
                      c.email.length === 0,
                  );
                devRevealLog.info("apollo bulk reveal prefilter", {
                  requestedRaw: contacts.length,
                  eligibleForApollo: mapped.length,
                  skipped: contacts.length - mapped.length,
                });
                const found = await bulkRevealEmailsWithApollo({
                  apiKey,
                  people: mapped,
                });
                const updates = found.map((f) => ({ id: f.contactId, email: f.email }));
                const updated = await updateContactEmails(
                  updates,
                  env.POSTGRES_URL || env.DATABASE_URL,
                );
                devRevealLog.info("apollo bulk reveal completed", {
                  requested: mapped.length,
                  matchedWithEmail: found.length,
                  updated,
                });
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(
                  JSON.stringify({
                    requested: mapped.length,
                    matchedWithEmail: found.length,
                    updated,
                    updates,
                  }),
                );
              } catch (e) {
                const msg =
                  e instanceof Error ? e.message : "Failed to reveal emails with Apollo";
                res.statusCode = 500;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: msg }));
              }
            })();
          });
        },
      );
      server.middlewares.use(
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const pathname = req.url?.split("?")[0] ?? "";
          if (req.method !== "GET" || pathname !== "/api/enriched-contacts") {
            next();
            return;
          }

          void (async () => {
            try {
              const url = new URL(req.url ?? "", "http://localhost");
              const sourceCountries = url.searchParams.getAll("sourceCountry");
              const jobTitles = url.searchParams.getAll("jobTitle");
              const contactTitles = url.searchParams.getAll("contactTitle");
              const out = await listEnrichedContacts(
                {
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
                  excludeOriginBlacklisted:
                    url.searchParams.get("excludeOriginBlacklisted") !== "false",
                  excludeLocationBlacklisted:
                    url.searchParams.get("excludeLocationBlacklisted") !== "false",
                  excludeNotALead: url.searchParams.get("excludeNotALead") !== "false",
                  contactNameContainsSpace:
                    url.searchParams.get("contactNameContainsSpace") === "true",
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
                },
                env.POSTGRES_URL || env.DATABASE_URL,
              );
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify(out));
            } catch (e) {
              const msg =
                e instanceof Error ? e.message : "Failed to load enriched contacts";
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ error: msg }));
            }
          })();
        },
      );
      server.middlewares.use(
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const pathname = req.url?.split("?")[0] ?? "";
          if (req.method !== "GET" || pathname !== "/api/meet-alfred-campaigns") {
            next();
            return;
          }
          void (async () => {
            try {
              const campaigns = await listMeetAlfredCampaigns();
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ campaigns }));
            } catch (e) {
              const msg =
                e instanceof Error
                  ? e.message
                  : "Failed to load Meet Alfred campaigns";
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ error: msg }));
            }
          })();
        },
      );
      server.middlewares.use(
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const pathname = req.url?.split("?")[0] ?? "";
          if (req.method !== "POST" || pathname !== "/api/meet-alfred-bulk-send") {
            next();
            return;
          }
          const chunks: Buffer[] = [];
          req.on("data", (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          req.on("end", () => {
            void (async () => {
              try {
                const raw = Buffer.concat(chunks).toString("utf8");
                const body = JSON.parse(raw) as {
                  leads?: Array<{
                    contactId?: number;
                    webhookKey?: string;
                    campaignId?: number;
                    linkedin_profile_url?: string;
                    csv_firstname?: string;
                    csv_companyname?: string;
                    csv_email?: string;
                    csv_country?: string;
                    csv_jobtitle?: string;
                  }>;
                };
                const leads = Array.isArray(body.leads) ? body.leads : [];
                const prepared = leads.map((lead) => ({
                  contactId: Number(lead.contactId),
                  webhookKey: (lead.webhookKey ?? "").trim(),
                  campaignId: Number(lead.campaignId),
                  linkedin_profile_url: (lead.linkedin_profile_url ?? "").trim(),
                  csv_firstname: (lead.csv_firstname ?? "").trim(),
                  csv_companyname: (lead.csv_companyname ?? "").trim(),
                  csv_email: (lead.csv_email ?? "").trim(),
                  csv_country: (lead.csv_country ?? "").trim(),
                  csv_jobtitle: (lead.csv_jobtitle ?? "").trim(),
                }));
                for (const row of prepared) {
                  if (!row.webhookKey) {
                    res.statusCode = 400;
                    res.setHeader("Content-Type", "application/json; charset=utf-8");
                    res.end(JSON.stringify({ error: "Each lead must include webhookKey" }));
                    return;
                  }
                  if (!Number.isFinite(row.campaignId) || row.campaignId <= 0) {
                    res.statusCode = 400;
                    res.setHeader("Content-Type", "application/json; charset=utf-8");
                    res.end(
                      JSON.stringify({
                        error: "Each lead must include a positive campaignId",
                      }),
                    );
                    return;
                  }
                }
                const result = await sendMeetAlfredBulkLeadsByCampaign(prepared);
                const marked = await markContactsAddedToMeetAlfred(
                  result.successContactIds,
                  env.POSTGRES_URL || env.DATABASE_URL,
                );
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(
                  JSON.stringify({
                    attempted: result.attempted,
                    sent: result.sent,
                    failed: result.failed,
                    marked,
                    markedContactIds: result.successContactIds,
                  }),
                );
              } catch (e) {
                const msg =
                  e instanceof Error ? e.message : "Failed to send Meet Alfred leads";
                res.statusCode = 500;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: msg }));
              }
            })();
          });
        },
      );
      server.middlewares.use(
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const pathname = req.url?.split("?")[0] ?? "";
          if (req.method !== "GET" || pathname !== "/api/instantly-campaigns") {
            next();
            return;
          }
          void (async () => {
            try {
              const apiKey = env.INSTANTLY_API_KEY;
              if (!apiKey) {
                res.statusCode = 500;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: "Missing INSTANTLY_API_KEY on server" }));
                return;
              }
              const campaigns = await listInstantlyCampaigns({ apiKey });
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ campaigns }));
            } catch (e) {
              const msg = e instanceof Error ? e.message : "Failed to load Instantly campaigns";
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ error: msg }));
            }
          })();
        },
      );
      server.middlewares.use(
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const pathname = req.url?.split("?")[0] ?? "";
          if (req.method !== "POST" || pathname !== "/api/instantly-bulk-send") {
            next();
            return;
          }
          const chunks: Buffer[] = [];
          req.on("data", (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          req.on("end", () => {
            void (async () => {
              try {
                const apiKey = env.INSTANTLY_API_KEY;
                if (!apiKey) {
                  res.statusCode = 500;
                  res.setHeader("Content-Type", "application/json; charset=utf-8");
                  res.end(JSON.stringify({ error: "Missing INSTANTLY_API_KEY on server" }));
                  return;
                }
                const raw = Buffer.concat(chunks).toString("utf8");
                const body = JSON.parse(raw) as {
                  leads?: Array<{
                    contactId?: number;
                    campaignId?: string;
                    email?: string;
                    first_name?: string;
                    company_name?: string;
                  }>;
                };
                const leads = (Array.isArray(body.leads) ? body.leads : [])
                  .map((lead) => ({
                    contactId: Number(lead.contactId),
                    campaignId: (lead.campaignId ?? "").trim(),
                    email: (lead.email ?? "").trim(),
                    first_name: (lead.first_name ?? "").trim(),
                    company_name: (lead.company_name ?? "").trim(),
                  }))
                  .filter((lead) => lead.email.length > 0);
                for (const row of leads) {
                  if (!row.campaignId) {
                    res.statusCode = 400;
                    res.setHeader("Content-Type", "application/json; charset=utf-8");
                    res.end(JSON.stringify({ error: "Each lead must include campaignId" }));
                    return;
                  }
                }
                const result = await sendInstantlyBulkLeadsByCampaign({
                  apiKey,
                  rows: leads.map((lead) => ({
                    contactId: lead.contactId,
                    campaignId: lead.campaignId,
                    email: lead.email,
                    first_name: lead.first_name,
                    company_name: lead.company_name,
                  })),
                });
                const byEmail = new Map<string, number>();
                for (const lead of leads) {
                  const email = lead.email.trim().toLowerCase();
                  if (email && Number.isFinite(lead.contactId) && lead.contactId > 0) {
                    byEmail.set(email, lead.contactId);
                  }
                }
                const successfulIds = result.createdLeadEmails
                  .map((email) => byEmail.get(email))
                  .filter(
                    (id): id is number =>
                      typeof id === "number" && Number.isFinite(id) && id > 0,
                  );
                const markedInstantly = await markContactsAddedToInstantly(
                  successfulIds,
                  env.POSTGRES_URL || env.DATABASE_URL,
                );
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(
                  JSON.stringify({ ...result, markedInstantly, markedContactIds: successfulIds }),
                );
              } catch (e) {
                const msg = e instanceof Error ? e.message : "Failed to send Instantly leads";
                res.statusCode = 500;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: msg }));
              }
            })();
          });
        },
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [revealDevApiPlugin(env), react()],
    server: {
      proxy: {
        "/zileo-api": {
          target: "https://api.zileo.io",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/zileo-api/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              const key = env.ZILEO_API_KEY;
              if (key) proxyReq.setHeader("x_api_key", key);
            });
          },
        },
        "/apollo-api": {
          target: "https://api.apollo.io",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/apollo-api/, "/api/v1"),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              const key = env.APOLLO_API_KEY;
              if (key) {
                proxyReq.setHeader("x-api-key", key);
                proxyReq.setHeader("Cache-Control", "no-cache");
              }
            });
          },
        },
      },
    },
  };
});
