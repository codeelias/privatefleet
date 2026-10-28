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
});
