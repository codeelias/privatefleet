import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app/App";
import { CustomerPortal } from "./features/customer-tracking/CustomerPortal";
import { PublicTracking } from "./features/customer-tracking/PublicTracking";
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

// /track/:token is the real public tracking URL (Stage 4): polled, scoped,
// no dispatcher chrome and no tenant sockets.
const trackMatch = window.location.pathname.match(/^\/track\/([A-Za-z0-9_-]{20,64})$/);
if (trackMatch) {
  createRoot(rootEl).render(<PublicTracking token={trackMatch[1]!} />);
} else if (window.location.pathname === "/preview") {
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
