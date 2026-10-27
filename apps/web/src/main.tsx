import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app/App";
import { CustomerPortal } from "./features/customer-tracking/CustomerPortal";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5_000,
    },
  },
});

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element #root not found");
}

// /preview simulates the public tracking-token URL (Phase 6 endpoint).
// It renders only the branded portal - no dispatcher chrome, no fleet data.
if (window.location.pathname === "/preview") {
  const jobRef = new URLSearchParams(window.location.search).get("job") ?? "J-198";
  createRoot(rootEl).render(
    <CustomerPortal
      brand={{
        displayName: "NORTHSTAR TRANSPORT",
        primary: "#2563EB",
        primaryContrast: "#FFFFFF",
      }}
      jobRef={jobRef}
      eta="14:42"
      standalone
    />,
  );
} else {
  createRoot(rootEl).render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}
