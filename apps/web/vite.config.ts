import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/healthz": "http://127.0.0.1:4000",
      "/readyz": "http://127.0.0.1:4000",
      "/v1": "http://127.0.0.1:4000",
      "/socket.io": {
        target: "http://127.0.0.1:4000",
        ws: true,
      },
    },
  },
});
