/**
 * Customer Tracking & Proof Hub (screen 5, design-extract 3.5): admin
 * configuration left, phone-framed live preview right, with the
 * "Preview as Customer" button opening the standalone portal in a new
 * tab (simulated tracking-token URL - the public endpoint is Phase 6).
 */
import { useState } from "react";
import type { FleetState } from "@privatefleet/contracts";
import { CustomerPortal } from "./CustomerPortal";
import { Panel } from "../../shared/ui/Panel";
import { StatusChip } from "../../shared/ui/StatusChip";

const TENANT = {
  displayName: "NORTHSTAR TRANSPORT",
  primary: "#EF842F",
  primaryContrast: "#171816",
};

export function TrackingHub({ state }: { state: FleetState }) {
  const [notifications, setNotifications] = useState(true);
  const [photoRequired, setPhotoRequired] = useState(false);
  const [signatureRequired, setSignatureRequired] = useState(false);
  const targetJob = state.jobs.find((j) => j.reference === "J-198") ?? state.jobs[0];

  function openPreview() {
    window.open(`/preview?token=demo-j198&job=${targetJob?.reference ?? "J-198"}`, "_blank", "noopener");
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">A customer experience under your brand.</h1>
          <p className="text-sm text-text-secondary">
            Configure public tracking, notifications and completion evidence.
          </p>
        </div>
        <button
          type="button"
          onClick={openPreview}
          className="rounded-xl bg-brand-primary px-4 py-2 text-sm font-bold text-command-bg hover:brightness-110"
        >
          Preview as Customer
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* Admin configuration */}
        <div className="flex flex-col gap-3">
          <Panel title="Brand identity">
            <div className="flex items-center gap-3 text-sm">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg text-sm font-black text-white" style={{ backgroundColor: TENANT.primary }}>
                N
              </span>
              <div className="flex-1">
                <p className="font-bold">{TENANT.displayName}</p>
                <p className="text-xs text-text-secondary">
                  Verified domain: northstar.example / tracking
                </p>
              </div>
              <StatusChip tone="success" label="verified" />
            </div>
            <p className="mt-3 text-xs text-text-secondary">
              Changes apply to future customer links after saving. Theme tokens are
              constrained - no arbitrary CSS is accepted from tenant config.
            </p>
          </Panel>

          <Panel title="Customer notifications">
            <div className="space-y-3 text-sm">
              <label className="flex items-center justify-between">
                <span>Send ETA updates automatically</span>
                <input
                  type="checkbox"
                  checked={notifications}
                  onChange={(event) => setNotifications(event.target.checked)}
                  className="h-4 w-4 accent-[#EF842F]"
                />
              </label>
              <div className="flex items-center gap-3">
                <span className="text-xs text-text-secondary">Update cadence</span>
                <select
                  className="rounded-lg border border-command-border bg-command-bg px-2 py-1 text-xs"
                  defaultValue="on_change"
                >
                  <option value="on_change">On status change</option>
                  <option value="every_15">Every 15 min</option>
                  <option value="manual">Manual only</option>
                </select>
                <StatusChip tone="neutral" label="ETA DELTA > 5 MIN" />
              </div>
              <p className="text-xs text-text-secondary">
                Notify on en route, delay and near-arrival transitions.
              </p>
            </div>
          </Panel>

          <Panel title="Tracking link access">
            <ul className="space-y-1 text-sm text-text-secondary">
              <li>Links expire after 72h; revoke anytime. One link = one job.</li>
              <li>Access scope: single job only - never fleet-wide data.</li>
              <li>Tokens are stored as digests; the raw token is never shown again.</li>
            </ul>
          </Panel>

          <Panel title="Proof of service requirements">
            <div className="space-y-2 text-sm">
              <p className="text-xs text-text-secondary">Recipient name: required</p>
              <label className="flex items-center justify-between">
                <span>Photo evidence</span>
                <input
                  type="checkbox"
                  checked={photoRequired}
                  onChange={(event) => setPhotoRequired(event.target.checked)}
                  className="h-4 w-4 accent-[#EF842F]"
                />
              </label>
              <label className="flex items-center justify-between">
                <span>Recipient signature</span>
                <input
                  type="checkbox"
                  checked={signatureRequired}
                  onChange={(event) => setSignatureRequired(event.target.checked)}
                  className="h-4 w-4 accent-[#EF842F]"
                />
              </label>
            </div>
          </Panel>
        </div>

        {/* Live preview - customer view */}
        <div className="flex flex-col items-center gap-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">
            Live preview - customer view
          </p>
          <div className="w-[320px] overflow-hidden rounded-3xl border-8 border-command-raised shadow-2xl">
            <div className="h-[560px] overflow-y-auto">
              <CustomerPortal
                brand={TENANT}
                jobRef={targetJob?.reference ?? "J-198"}
                eta="14:42"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

