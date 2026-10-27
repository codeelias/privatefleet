import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Phase 1 demo transport: React Native components render on the web via
// react-native-web + Vite. Expo CLI / EAS replaces this bundle for the
// native pilot builds in Phase 3 (CHANGELOG v1.9).
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
      "/v1": "http://127.0.0.1:4000",
      "/socket.io": {
        target: "http://127.0.0.1:4000",
        ws: true,
      },
    },
  },
});
