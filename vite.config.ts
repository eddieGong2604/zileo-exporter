import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { revealCompanyWithOpenAI } from "./lib/revealCompanyOpenAI";

function revealDevApiPlugin(env: Record<string, string>): Plugin {
  return {
    name: "reveal-dev-api",
    configureServer(server) {
      server.middlewares.use(
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const pathname = req.url?.split("?")[0] ?? "";
          if (req.method !== "POST" || pathname !== "/api/reveal-company") {
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
                const raw = Buffer.concat(chunks).toString("utf8");
                let body: { companyName?: string; countryHint?: string };
                try {
                  body = JSON.parse(raw) as {
                    companyName?: string;
                    countryHint?: string;
                  };
                } catch {
                  res.statusCode = 400;
                  res.setHeader("Content-Type", "application/json");
                  res.end(JSON.stringify({ error: "Invalid JSON body" }));
                  return;
                }
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
                const companyName = (body.companyName ?? "").trim();
                if (!companyName) {
                  res.statusCode = 400;
                  res.setHeader("Content-Type", "application/json");
                  res.end(
                    JSON.stringify({ error: "companyName is required" }),
                  );
                  return;
                }
                const countryHint = (body.countryHint ?? "").trim();
                const result = await revealCompanyWithOpenAI({
                  companyName,
                  countryHint: countryHint || undefined,
                  apiKey,
                });
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(result));
              } catch (e) {
                const msg = e instanceof Error ? e.message : "OpenAI error";
                res.statusCode = 502;
                res.setHeader("Content-Type", "application/json");
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
