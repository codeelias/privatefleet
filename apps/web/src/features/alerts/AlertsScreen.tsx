/**
 * Exceptions & Alerts (screen 4, design-extract 3.4): triage list left,
 * detail drawer right - no interruptive modals. Acknowledge / resolve
 * append auditable events through the outbox pipeline; reassign opens
 * the shared assignment flow.
 */
import { useEffect, useState } from "react";
import type { AlertDto, EvidenceList, FleetState } from "@privatefleet/contracts";
import { api } from "../../shared/api/client";
import { Panel } from "../../shared/ui/Panel";
import { StatusChip } from "../../shared/ui/StatusChip";

function toneFor(severity: AlertDto["severity"]) {
  if (severity === "urgent") {
    return "danger" as const;
  }
  if (severity === "at_risk") {
    return "warning" as const;
  }
  return "neutral" as const;
}

export function AlertsScreen({
  state,
  onReassign,
  onRefresh,
}: {
  state: FleetState;
  onReassign: (jobId: string) => void;
  onRefresh: () => void;
}) {
  const open = state.alerts.filter((a) => !a.acknowledged);
  const acknowledgedCount = state.alerts.length - open.length;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<EvidenceList | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const selected =
    state.alerts.find((a) => a.id === selectedId) ?? open[0] ?? null;

  useEffect(() => {
    setEvidence(null);
    setEvidenceError(null);
    if (!selected?.relatedJobId || !selected.relatedStopId) {
      return;
    }
    let cancelled = false;
    void api
      .stopEvidence(selected.relatedJobId, selected.relatedStopId)
      .then((result) => {
        if (!cancelled) setEvidence(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setEvidenceError(err instanceof Error ? err.message : "Evidence unavailable");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.id, selected?.relatedJobId, selected?.relatedStopId]);

  async function act(alertId: string, action: "acknowledge" | "resolve") {
    setBusy(true);
    setError(null);
    try {
      if (action === "acknowledge") {
        await api.acknowledgeAlert(alertId);
      } else {
        await api.resolveAlert(alertId);
      }
      if (selectedId === alertId) {
        setSelectedId(null);
      }
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Resolve the issue before the customer calls.</h1>
          <p className="text-sm text-text-secondary">
            Triage delayed jobs, stale GPS and geofence events from one place.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusChip tone="danger" label={`${open.length} open`} />
          <StatusChip tone="neutral" label={`${acknowledgedCount} acknowledged`} />
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-sm text-status-danger">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* Triage list */}
        <Panel title="Open exceptions">
          {open.length === 0 ? (
            <p className="text-sm text-text-secondary">All clear - nothing open.</p>
          ) : (
            <ul className="space-y-2">
              {open.map((alert) => (
                <li key={alert.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(alert.id)}
                    className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                      selected?.id === alert.id
                        ? "border-brand-primary bg-brand-primary/10"
                        : "border-command-border bg-command-raised hover:border-brand-primary/50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{alert.title}</span>
                      <StatusChip tone={toneFor(alert.severity)} label={alert.severity} />
                    </div>
                    <p className="mt-1 text-xs text-text-secondary">
                      {alert.entity} - {alert.location} - {alert.freshness}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Detail drawer */}
        <Panel title={selected ? "Alert detail" : "No selection"}>
          {selected ? (
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-bold">{selected.title}</span>
                <StatusChip tone={toneFor(selected.severity)} label={selected.severity} />
              </div>
              <p className="text-xs text-text-secondary">
                {selected.entity} - {selected.location}
              </p>
              <p className="text-xs text-text-secondary">{selected.freshness}</p>
              <div className="rounded-lg border border-command-border bg-command-bg p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">
                  Recommended action
                </p>
                <p className="mt-1">{selected.recommendedAction}</p>
              </div>
              {(selected.relatedJobId || selected.relatedStopId) && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">
                    Delivery evidence
                  </p>
                  {evidenceError && (
                    <p className="mt-1 text-xs text-status-danger">{evidenceError}</p>
                  )}
                  {evidence?.evidence.length ? (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {evidence.evidence.map((item) => (
                        <div key={item.id} className="rounded-lg border border-command-border bg-command-bg p-2">
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
                            {item.kind.replace("_", " ")}
                          </p>
                          {item.dataBase64 && (
                            <img
                              src={`data:${item.mimeType};base64,${item.dataBase64}`}
                              alt={`${item.kind} evidence`}
                              className="max-h-32 w-full rounded object-contain"
                            />
                          )}
                          <p className="mt-1 break-all text-[9px] text-text-secondary">
                            {item.byteSize} bytes · {item.contentHash.slice(0, 12)}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    !evidenceError && (
                      <p className="mt-1 text-xs text-text-secondary">
                        No evidence attached to this exception.
                      </p>
                    )
                  )}
                </div>
              )}              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">
                  Audit history
                </p>
                <ul className="mt-1 space-y-1 text-xs text-text-secondary">
                  {selected.audit.map((entry, index) => (
                    <li key={index}>
                      {new Date(entry.at).toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      - {entry.message}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(selected.id, "acknowledge")}
                  className="rounded-lg bg-brand-primary px-3 py-1.5 text-xs font-bold text-on-brand hover:brightness-110 disabled:opacity-50"
                >
                  Acknowledge
                </button>
                {selected.relatedJobId && (
                  <button
                    type="button"
                    onClick={() => onReassign(selected.relatedJobId as string)}
                    className="rounded-lg border border-command-border px-3 py-1.5 text-xs font-semibold text-text-primary hover:border-brand-primary/60"
                  >
                    Reassign
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(selected.id, "resolve")}
                  className="rounded-lg bg-status-success px-3 py-1.5 text-xs font-bold text-on-brand hover:brightness-110 disabled:opacity-50"
                >
                  Resolve
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-text-secondary">Pick an alert to inspect.</p>
          )}
        </Panel>
      </div>

      {/* Active service zones */}
      <Panel title="Active service zones">
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          {state.serviceZones.map((zone) => (
            <div
              key={zone.id}
              className="rounded-lg border border-command-border bg-command-raised px-3 py-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{zone.name}</span>
                <StatusChip
                  tone={
                    zone.status === "ok"
                      ? "success"
                      : zone.status === "unexpected_exit"
                        ? "danger"
                        : "stale"
                  }
                  label={
                    zone.status === "ok"
                      ? `${zone.vehiclesInside} inside`
                      : zone.status === "unexpected_exit"
                        ? "exit"
                        : "no arrivals"
                  }
                />
              </div>
              <p className="mt-1 text-xs text-text-secondary">{zone.note}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}


