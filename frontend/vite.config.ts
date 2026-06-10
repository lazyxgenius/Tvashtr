import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dev server proxies backend routes to the FastAPI app on :8000 so the
// frontend can call /health (and later /api/*) without CORS config.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/health": "http://localhost:8000",
      "/api": "http://localhost:8000",
    },
  },
});
