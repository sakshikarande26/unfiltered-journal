import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The API server (backend/index.ts) listens on 5174. This dev server proxies
// to it so the client can call same-origin /api and /media paths in both dev
// and (a future) production build.
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:5174",
      "/media": "http://127.0.0.1:5174",
    },
  },
});
