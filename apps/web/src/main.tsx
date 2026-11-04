import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app/App";
import "./index.css";

// Customer-facing map screens stay out of the dispatcher bundle and load
// only when a /track/:token or /preview URL is opened.
const PublicTracking = lazy(() =>
  import("./features/customer-tracking/PublicTracking").then((module) => ({
    default: module.PublicTracking,
  })),
);
const CustomerPortal = lazy(() =>
  import("./features/customer-tracking/CustomerPortal").then((module) => ({
    default: module.CustomerPortal,
  })),
);

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

function Fallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-command-bg text-sm text-text-secondary">
      Loading…
    </div>
  );
}

// /track/:token is the real public tracking URL (Stage 4): polled, scoped,
// no dispatcher chrome and no tenant sockets.
const trackMatch = window.location.pathname.match(/^\/track\/([A-Za-z0-9_-]{20,64})$/);
if (trackMatch) {
  createRoot(rootEl).render(
    <Suspense fallback={<Fallback />}>
      <PublicTracking token={trackMatch[1]!} />
    </Suspense>,
  );
} else if (window.location.pathname === "/preview") {
  const jobRef = new URLSearchParams(window.location.search).get("job") ?? "J-198";
  createRoot(rootEl).render(
    <Suspense fallback={<Fallback />}>
      <CustomerPortal
        brand={{
          displayName: "NORTHSTAR TRANSPORT",
          primary: "#2563EB",
          primaryContrast: "#FFFFFF",
        }}
        jobRef={jobRef}
        eta="14:42"
        standalone
      />
    </Suspense>,
  );
} else {
  createRoot(rootEl).render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}
