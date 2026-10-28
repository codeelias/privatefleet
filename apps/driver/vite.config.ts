import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Phase 1 demo transport: React Native components render on the web via
// react-native-web + Vite. Expo CLI / EAS replaces this bundle for the
// native pilot builds in Phase 3 (CHANGELOG v1.9).
// API target is configurable so acceptance stacks can run on isolated ports.
const apiTarget = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:4000";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "react-native": "react-native-web",
    },
  },
  server: {
    port: 5174,
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
