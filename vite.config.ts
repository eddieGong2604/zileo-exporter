import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
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
