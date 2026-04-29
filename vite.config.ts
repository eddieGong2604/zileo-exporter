import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { createLogger } from "./lib/logger.js";
import { revealCompanyWithOpenAI } from "./lib/revealCompanyOpenAI";
import { revealCompanyWithTavily } from "./lib/revealCompanyTavily";
import {
  listEnrichedContacts,
  markContactsAddedToMeetAlfred,
  rejectCompany,
  updateContactEditableField,
  updateContactFirstName,
  updateContactEmails,
} from "./lib/enrichedContactsRepo.js";
import {
  addLeadsToMeetAlfredCampaign,
  listMeetAlfredCampaigns,
} from "./lib/meetAlfred.js";
import { bulkRevealEmailsWithApollo } from "./lib/apolloBulkMatch.js";

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
                  }>;
                };
                const contacts = Array.isArray(body.contacts) ? body.contacts : [];
                const mapped = contacts
                  .map((c) => {
                    const fullName = (c.contactName ?? "").trim();
                    const [firstFromName = "", ...rest] = fullName
                      .split(/\s+/)
                      .filter(Boolean);
                    return {
                      contactId: Number(c.id),
                      linkedinUrl: (c.linkedinUrl ?? "").trim(),
                      firstName: (c.firstName ?? "").trim() || firstFromName || undefined,
                      lastName: rest.length > 0 ? rest.join(" ") : undefined,
                      name: fullName || undefined,
                      organizationName: (c.companyName ?? "").trim() || undefined,
                    };
                  })
                  .filter(
                    (c) =>
                      Number.isFinite(c.contactId) && c.contactId > 0 && c.linkedinUrl.length > 0,
                  );
                const found = await bulkRevealEmailsWithApollo({
                  apiKey,
                  people: mapped,
                });
                const updates = found.map((f) => ({ id: f.contactId, email: f.email }));
                const updated = await updateContactEmails(
                  updates,
                  env.POSTGRES_URL || env.DATABASE_URL,
                );
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
                  excludeOriginBlacklisted:
                    url.searchParams.get("excludeOriginBlacklisted") !== "false",
                  excludeLocationBlacklisted:
                    url.searchParams.get("excludeLocationBlacklisted") !== "false",
                  excludeNotALead: url.searchParams.get("excludeNotALead") !== "false",
                  sourceCountries,
                  latestJobPosted: (url.searchParams.get("latestJobPosted") ?? "all") as
                    | "24h"
                    | "3d"
                    | "1w"
                    | "all",
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
                  webhookKey?: string;
                  campaignId?: number;
                  leads?: Array<{
                    contactId?: number;
                    linkedin_profile_url?: string;
                    csv_firstname?: string;
                    csv_companyname?: string;
                    csv_email?: string;
                    csv_country?: string;
                  }>;
                };
                const webhookKey = (body.webhookKey ?? "").trim();
                const campaignId = Number(body.campaignId);
                const leads = Array.isArray(body.leads) ? body.leads : [];
                if (!webhookKey) {
                  res.statusCode = 400;
                  res.setHeader("Content-Type", "application/json; charset=utf-8");
                  res.end(JSON.stringify({ error: "webhookKey is required" }));
                  return;
                }
                if (!Number.isFinite(campaignId) || campaignId <= 0) {
                  res.statusCode = 400;
                  res.setHeader("Content-Type", "application/json; charset=utf-8");
                  res.end(
                    JSON.stringify({
                      error: "campaignId must be a positive number",
                    }),
                  );
                  return;
                }
                const result = await addLeadsToMeetAlfredCampaign({
                  webhookKey,
                  campaignId,
                  leads: leads.map((lead) => ({
                    linkedin_profile_url: (lead.linkedin_profile_url ?? "").trim(),
                    csv_firstname: (lead.csv_firstname ?? "").trim(),
                    csv_companyname: (lead.csv_companyname ?? "").trim(),
                    csv_email: (lead.csv_email ?? "").trim(),
                    csv_country: (lead.csv_country ?? "").trim(),
                  })),
                });
                const successfulContactIds = result.successIndices
                  .map((index) => Number(leads[index]?.contactId))
                  .filter((id) => Number.isFinite(id) && id > 0) as number[];
                const marked = await markContactsAddedToMeetAlfred(
                  successfulContactIds,
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
