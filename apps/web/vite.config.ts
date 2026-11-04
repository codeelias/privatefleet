import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const apiTarget = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:4000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/healthz": apiTarget,
      "/readyz": apiTarget,
      "/v1": apiTarget,
      "/socket.io": {
        target: apiTarget,
        ws: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Do not hoist shared chunks into the entry: map engines must stay
        // lazy so the login/shell bundle stays small.
        hoistTransitiveImports: false,
        manualChunks(id) {
          // Keep the heavy map engines out of the login/shell bundle; they
          // load only when a map screen opens.
          if (id.includes("node_modules/maplibre-gl")) return "maplibre";
          if (id.includes("node_modules/leaflet")) return "leaflet";
          if (id.includes("node_modules/@dnd-kit") || id.includes("node_modules/@tanstack")) return "vendors";
        },
      },
    },
  },
});
