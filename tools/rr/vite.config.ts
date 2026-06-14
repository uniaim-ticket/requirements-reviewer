import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The client is served from /app by the Fastify server in production.
// In dev, the Vite dev server proxies API calls to the Fastify server.
export default defineConfig({
  root: "src/client",
  // Relative base so assets load correctly behind a path-prefixing proxy.
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
  server: {
    port: 5178,
    proxy: {
      "/api": "http://127.0.0.1:5177",
    },
  },
});
