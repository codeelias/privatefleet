/**
 * Customer-facing tracking portal (design-extract section 5): light
 * theme, pizza-tracker timeline, single-job privacy copy. Rendered both
 * embedded (Tracking Hub preview) and standalone (/preview - the
 * simulated tracking-token URL). Theming comes from the tenant object -
 * tokens only, never arbitrary CSS (handoff section 6).
 */
import type { CSSProperties } from "react";

export interface PortalBrand {
  displayName: string;
  primary: string;
  primaryContrast: string;
}

export interface PortalProps {
  brand: PortalBrand;
  jobRef: string;
  eta: string;
  standalone?: boolean;
  driverName?: string;
  vehicleRegistration?: string;
  delayStatus?: "on_time" | "late" | "unknown";
  etaMethod?: "live" | "planned";
  remainingStops?: number;
  lastUpdateAt?: string;
  inCustomerZone?: boolean;
  customerZoneName?: string;
  proof?: {
    photos: number;
    signatures: number;
    photoIds?: Array<{ id: string; capturedAt: string }>;
    lastRecordedAt?: string;
  };
}

const STEPS = [
  { label: "Booking confirmed", time: "10:03", state: "done" },
  { label: "Collected by driver", time: "10:19", state: "done" },
  { label: "On the way", time: "", state: "current" },
  { label: "Delivered", time: "", state: "pending" },
] as const;

export function CustomerPortal({
  brand,
  jobRef,
  eta,
  standalone = false,
  driverName,
  vehicleRegistration,
  delayStatus,
  etaMethod = "planned",
  remainingStops,
  lastUpdateAt,
  inCustomerZone,
  customerZoneName,
  proof,
}: PortalProps) {
  const theme = {
    "--portal-primary": brand.primary,
    "--portal-primary-contrast": brand.primaryContrast,
  } as CSSProperties;

  return (
    <div
      style={theme}
      className={`bg-[#F2EEE4] text-[#171816] ${
        standalone ? "min-h-screen" : "h-full"
      } flex flex-col`}
    >
      <header className="flex items-center justify-between border-b border-[#D8CFBD] bg-[#FBF8F1] px-5 py-3">
        <div className="flex items-center gap-2">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-black"
            style={{ backgroundColor: "var(--portal-primary)", color: "var(--portal-primary-contrast)" }}
          >
            {brand.displayName.charAt(0)}
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#756E61]">
              {brand.displayName}
            </p>
            <p className="text-sm font-bold">Customer tracking page</p>
          </div>
        </div>
        <span className="text-xs text-[#756E61]">Tracking / Job {jobRef}</span>
      </header>

      <main className={`mx-auto w-full max-w-md flex-1 px-5 py-6 ${standalone ? "" : "pb-2"}`}>
        <h1 className="text-xl font-bold">Your delivery is on the way</h1>
        <div className="mt-3 flex items-center gap-3 rounded-xl bg-[#FBF8F1] p-4 shadow-sm">
          <span
            className="flex h-3 w-3 items-center justify-center rounded-full p-2.5 text-[10px] font-black"
            style={{ backgroundColor: "var(--portal-primary)", color: "var(--portal-primary-contrast)" }}
          >
            {jobRef}
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#756E61]">
              Driver en route
            </p>
            <p className="text-2xl font-bold tabular-nums">{eta}</p>
            <p className="text-[10px] text-[#756E61]">{etaMethod === "live" ? "Live estimate" : "Planned arrival"}</p>
            {inCustomerZone && (
              <p className="mt-1 inline-flex rounded-full bg-[#DBEAFE] px-2 py-0.5 text-[10px] font-bold text-[#1D4ED8]">
                {customerZoneName ? `In your area - ${customerZoneName}` : "In your area"}
              </p>
            )}
            {delayStatus && delayStatus !== "unknown" && (
              <p className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${delayStatus === "late" ? "bg-[#FEE2E2] text-[#B91C1C]" : "bg-[#DCFCE7] text-[#15803D]"}`}>
                {delayStatus === "late" ? "Running late" : "On time"}
              </p>
            )}
          </div>
        </div>

        {(driverName || vehicleRegistration) && (
          <div className="mt-4 flex items-center gap-3 rounded-xl bg-[#FBF8F1] p-4 shadow-sm">
            <span className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold" style={{ backgroundColor: "var(--portal-primary)", color: "var(--portal-primary-contrast)" }}>
              {(driverName ?? "PF").split(" ").map((part) => part[0]).join("").slice(0, 2)}
            </span>
            <div>
              <p className="text-sm font-bold">{driverName ?? "Your driver"}</p>
              <p className="text-[10px] text-[#756E61]">{vehicleRegistration ?? "Vehicle assigned"}{typeof remainingStops === "number" ? ` - ${remainingStops} stops to go` : ""}</p>
            </div>
          </div>
        )}

        <div className="mt-4 rounded-xl bg-[#FBF8F1] p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#756E61]">
            Delivery progress
          </p>
          <ol className="mt-3 space-y-3">
            {STEPS.map((step) => (
              <li key={step.label} className="flex items-center gap-3 text-sm">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                    step.state === "pending"
                      ? "border-2 border-[#D8CFBD] text-[#A69C8B]"
                      : step.state === "current"
                        ? "animate-pulse text-white"
                        : "text-white"
                  }`}
                  style={
                    step.state !== "pending"
                      ? { backgroundColor: "var(--portal-primary)" }
                      : undefined
                  }
                >
                  {step.state === "done" ? "OK" : step.state === "current" ? ">" : ""}
                </span>
                <span className={step.state === "current" ? "font-bold" : "text-[#4A4439]"}>
                  {step.label}
                  {step.time ? ` - ${step.time}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-4 rounded-xl bg-[#FBF8F1] p-4 text-xs text-[#756E61] shadow-sm">
          <p className="font-bold text-[#191815]">Your data, your service provider</p>
          <p className="mt-1">
            This link shows one job only. It does not expose other vehicles, routes
            or customer records.
          </p>
          <p className="mt-1">Link expires automatically - contact the operator if you need a new link.</p>
        </div>

        <div className="mt-4 rounded-xl bg-[#FBF8F1] p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#756E61]">
            Proof of service
          </p>
          {proof ? (
            <p className="mt-1 text-xs text-[#756E61]">
              {proof.photos > 0 ? `${proof.photos} photo${proof.photos === 1 ? "" : "s"} recorded` : "No photo recorded"}
              {" · "}
              {proof.signatures > 0 ? `${proof.signatures} signature${proof.signatures === 1 ? "" : "s"} recorded` : "no signature recorded"}
              {proof.lastRecordedAt
                ? ` · ${new Date(proof.lastRecordedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
                : ""}
            </p>
          ) : (
            <p className="mt-1 text-xs text-[#756E61]">
              Completion evidence will appear here after the driver completes the stop.
            </p>
          )}
        </div>

        <p className="mt-4 text-center text-[10px] text-[#756E61]">
          {lastUpdateAt
            ? `Last updated ${Math.max(1, Math.round((Date.now() - Date.parse(lastUpdateAt)) / 1000))}s ago - `
            : "Last updated recently - "}
          current location is approximate and updates when the driver's device reports.
        </p>
      </main>

      <footer className="border-t border-[#D8CFBD] bg-[#FBF8F1] px-5 py-3 text-center text-xs text-[#756E61]">
        Need help with this job? Contact {brand.displayName}.
      </footer>
    </div>
  );
}

