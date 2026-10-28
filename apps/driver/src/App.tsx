/**
 * Driver co-pilot (handoff section 4, design-extract section 4):
 * glanceable, thumb-zone actions, light theme, honest offline state.
 * Views: pick profile -> shift home (queue) -> active stop (hold-to-
 * confirm arrival) -> proof of service / exceptions.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { DriverDto } from "@privatefleet/contracts";
import {
  api,
  createFleetSocket,
  conflictCount,
  enqueue,
  flush,
  nextStops,
  onAuthLost,
  pendingCount,
  storedDriverSession,
  type DriverQueue,
  type DriverStoredSession,
} from "./shared/client";
import { colors, touch } from "./theme";

type Screen =
  | { name: "pick" }
  | { name: "shift" }
  | { name: "active"; jobId: string; stopId: string }
  | { name: "pod"; jobId: string; stopId: string };

const SKIP_REASONS = [
  "Customer unavailable",
  "Address inaccessible",
  "Refused",
  "Other",
] as const;

function initialsOf(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("");
}

function timeOf(iso?: string): string {
  if (!iso) {
    return "--:--";
  }
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Chip({ label, tone }: { label: string; tone: "urgent" | "neutral" | "on" }) {
  const background =
    tone === "urgent" ? colors.danger : tone === "on" ? colors.success : colors.border;
  return (
    <View style={[styles.chip, { backgroundColor: background }]}>
      <Text style={[styles.chipText, { color: tone === "neutral" ? colors.muted : "#FFFFFF" }]}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

function HoldToConfirm({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [progress, setProgress] = useState(0);
  // Refs, not state: the interval callback must see the live handle and
  // confirm exactly once (a stale state closure used to fire onConfirm on
  // every tick after the threshold - duplicate commands, 409 conflicts).
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const firedRef = useRef(false);

  function start() {
    setProgress(0);
    firedRef.current = false;
    const started = Date.now();
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    timerRef.current = setInterval(() => {
      const pct = Math.min(1, (Date.now() - started) / 800);
      setProgress(pct);
      if (pct >= 1) {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        if (!firedRef.current) {
          firedRef.current = true;
          onConfirm();
        }
      }
    }, 40);
  }

  function cancel() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setProgress(0);
  }

  return (
    <View>
      <Pressable
        onPressIn={start}
        onPressOut={cancel}
        accessibilityRole="button"
        accessibilityLabel={`${label} - hold to confirm`}
        style={[styles.primaryButton, { overflow: "hidden" }]}
      >
        <View style={[styles.holdFill, { width: `${progress * 100}%` }]} />
        <Text style={styles.primaryButtonText}>{label}</Text>
      </Pressable>
      <Text style={styles.hint}>Hold for one second - prevents pocket dials.</Text>
    </View>
  );
}

export function DriverApp() {
  const queryClient = useQueryClient();
  const [driverId, setDriverId] = useState<string | null>(null);
  const [view, setView] = useState<Screen>({ name: "pick" });
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [recipientName, setRecipientName] = useState("");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState<string>(SKIP_REASONS[0]);
  const [mode, setMode] = useState<"loading" | "demo" | "production">("loading");
  const [session, setSession] = useState<DriverStoredSession | null>(null);
  const [tenantSlug, setTenantSlug] = useState("");
  const [driverIdText, setDriverIdText] = useState("");
  const [pin, setPin] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    onAuthLost(() => {
      setSession(null);
      setDriverId(null);
      setView({ name: "pick" });
    });
    let cancelled = false;
    void api
      .meta()
      .then((meta) => {
        if (cancelled) {
          return;
        }
        if (meta.demoMode) {
          setMode("demo");
          return;
        }
        setMode("production");
        const existing = storedDriverSession();
        if (existing) {
          setSession(existing);
          setDriverId(existing.driver.id);
          setView({ name: "shift" });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMode("demo");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submitLogin = useCallback(async () => {
    setLoginError(null);
    setLoginBusy(true);
    try {
      const nextSession = await api.driverLogin({
        tenantSlug: tenantSlug.trim(),
        driverId: driverIdText.trim(),
        pin,
      });
      setSession(nextSession);
      setDriverId(nextSession.driver.id);
      setView({ name: "shift" });
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoginBusy(false);
    }
  }, [tenantSlug, driverIdText, pin]);

  const fleetQuery = useQuery({
    queryKey: ["fleet"],
    queryFn: api.fleetState,
    enabled: mode === "demo" && view.name === "pick",
  });

  const queueQuery = useQuery({
    queryKey: ["queue", mode === "production" ? "self" : driverId],
    queryFn: () =>
      mode === "production" ? api.driverQueue() : api.queue(driverId as string),
    enabled: mode === "production" ? session !== null : driverId !== null,
    refetchInterval: 5_000,
  });

  useEffect(() => {
    const socket = createFleetSocket();
    socket.on("event", () => {
      void queryClient.invalidateQueries({ queryKey: ["queue", driverId] });
    });
    const goOnline = () => {
      setOnline(true);
      void flush();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      socket.disconnect();
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [queryClient, driverId]);

  const runCommand = useCallback(
    async (command: {
      kind: "arrive" | "complete" | "skip";
      jobId: string;
      stopId: string;
      payload?: { recipientName?: string; notes?: string; reason?: string };
    }) => {
      if (!driverId) {
        return;
      }
      setError(null);
      try {
        const syncResult = await enqueue({
          commandId: crypto.randomUUID(),
          kind: command.kind,
          jobId: command.jobId,
          stopId: command.stopId,
          driverId,
          payload: command.payload,
          capturedAt: new Date().toISOString(),
        });
        if (!syncResult.ok) {
          setError(syncResult.message ?? "Action needs attention");
        }
        await queryClient.invalidateQueries({ queryKey: ["queue", driverId] });
        await queryClient.invalidateQueries({ queryKey: ["queue", "self"] });
        await queryClient.invalidateQueries({ queryKey: ["fleet"] });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed");
      }
    },
    [driverId, queryClient],
  );

  const queue: DriverQueue | undefined = queueQuery.data;
  const stops = queue ? nextStops(queue) : [];

  if (mode === "loading") {
    return (
      <View style={[styles.screen, { justifyContent: "center" }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (mode === "production" && !session) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.padded}>
        <Text style={styles.brand}>NORTHSTAR TRANSPORT</Text>
        <Text style={styles.title}>Driver sign in</Text>
        <Text style={styles.subtitle}>
          Workspace, driver ID and PIN are issued by your dispatcher.
        </Text>
        <Text style={[styles.muted, { marginTop: 18 }]}>Workspace</Text>
        <TextInput
          accessibilityLabel="Workspace"
          autoCapitalize="none"
          value={tenantSlug}
          onChangeText={setTenantSlug}
          style={styles.input}
        />
        <Text style={[styles.muted, { marginTop: 12 }]}>Driver ID</Text>
        <TextInput
          accessibilityLabel="Driver ID"
          autoCapitalize="none"
          value={driverIdText}
          onChangeText={setDriverIdText}
          style={styles.input}
        />
        <Text style={[styles.muted, { marginTop: 12 }]}>PIN</Text>
        <TextInput
          accessibilityLabel="PIN"
          secureTextEntry
          keyboardType="number-pad"
          value={pin}
          onChangeText={setPin}
          style={styles.input}
        />
        {loginError && (
          <Text style={[styles.muted, { color: colors.danger, marginTop: 12 }]}>
            {loginError}
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          disabled={loginBusy}
          onPress={() => {
            void submitLogin();
          }}
          style={[styles.primaryButton, { marginTop: 18, opacity: loginBusy ? 0.6 : 1 }]}
        >
          <Text style={styles.primaryButtonText}>
            {loginBusy ? "Signing in..." : "Sign in"}
          </Text>
        </Pressable>
      </ScrollView>
    );
  }

  if (view.name === "pick") {
    const drivers: DriverDto[] = fleetQuery.data?.drivers ?? [];
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.padded}>
        <Text style={styles.brand}>NORTHSTAR TRANSPORT</Text>
        <Text style={styles.title}>Choose your profile</Text>
        <Text style={styles.subtitle}>Demo login - production uses device auth.</Text>
        {drivers.map((driver) => (
          <Pressable
            key={driver.id}
            accessibilityRole="button"
            onPress={() => {
              setDriverId(driver.id);
              setView({ name: "shift" });
            }}
            style={styles.card}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initialsOf(driver.fullName)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{driver.fullName}</Text>
              <Text style={styles.muted}>Driver - {driver.status}</Text>
            </View>
            <Text style={styles.muted}>&gt;</Text>
          </Pressable>
        ))}
        {drivers.length === 0 && <ActivityIndicator color={colors.primary} />}
      </ScrollView>
    );
  }

  if (view.name === "shift") {
    const driver = queue?.driver;
    const [next, ...rest] = stops;
    return (
      <View style={styles.screen}>
        <SyncBanner online={online} />
        <ScrollView contentContainerStyle={styles.padded}>
          <View style={styles.rowBetween}>
            <View>
              <Text style={styles.brand}>NORTHSTAR TRANSPORT</Text>
              <Text style={styles.greeting}>
                Good morning, {driver?.fullName.split(" ")[0] ?? "driver"}
              </Text>
            </View>
            <Chip label="On shift" tone="on" />
          </View>

          {next ? (
            <View style={styles.nextCard}>
              <View style={styles.rowBetween}>
                <Text style={styles.nextLabel}>NEXT STOP - PRIORITY</Text>
                <Chip
                  label={next.job.priority === "stat" ? "STAT" : next.job.priority}
                  tone={next.job.priority === "urgent" || next.job.priority === "stat" ? "urgent" : "neutral"}
                />
              </View>
              <Text style={styles.nextAddress}>{next.stop.address}</Text>
              <Text style={styles.muted}>
                Arrive by {timeOf(next.stop.windowStart)} - {next.job.reference}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  const url = `https://www.google.com/maps/dir/?api=1&destination=${next.stop.location.latitude},${next.stop.location.longitude}`;
                  window.open(url, "_blank", "noopener");
                }}
                style={[styles.primaryButton, { marginTop: 12 }]}
              >
                <Text style={styles.primaryButtonText}>Navigate to next stop</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  setView({ name: "active", jobId: next.job.id, stopId: next.stop.id })
                }
                style={[styles.secondaryButton, { marginTop: 8 }]}
              >
                <Text style={styles.secondaryButtonText}>Open active job</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.nextCard}>
              <Text style={styles.cardTitle}>No stops queued</Text>
              <Text style={styles.muted}>
                Ask dispatch to assign jobs, then pull to refresh.
              </Text>
            </View>
          )}

          {rest.length > 0 && (
            <View style={{ marginTop: 16 }}>
              <Text style={styles.sectionLabel}>UP NEXT</Text>
              {rest.map(({ job, stop }) => (
                <Pressable
                  key={stop.id}
                  accessibilityRole="button"
                  onPress={() => setView({ name: "active", jobId: job.id, stopId: stop.id })}
                  style={styles.card}
                >
                  <Text style={styles.time}>{timeOf(stop.windowStart)}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{stop.address}</Text>
                    <Text style={styles.muted}>
                      {stop.stopType} - {job.reference}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>
      </View>
    );
  }

  const active = stops.find((s) => s.stop.id === view.stopId);
  if (!active) {
    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.padded}>
          <Text style={styles.title}>Stop unavailable</Text>
          <Text style={styles.muted}>
            It may have changed state - pull to refresh your queue.
          </Text>
          <Pressable style={styles.primaryButton} onPress={() => setView({ name: "shift" })}>
            <Text style={styles.primaryButtonText}>Back to queue</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  const { job, stop } = active;

  if (view.name === "active") {
    const arrived = stop.status === "arrived";
    return (
      <View style={styles.screen}>
        <SyncBanner online={online} />
        <ScrollView contentContainerStyle={styles.padded}>
          <Text style={styles.brand}>ACTIVE JOB / {job.reference}</Text>
          <Text style={styles.title}>{stop.stopType === "pickup" ? "Arrive at pickup" : "Deliver to"}</Text>
          <Text style={styles.nextAddress}>{stop.address}</Text>
          <Text style={styles.muted}>
            Scheduled {timeOf(stop.windowStart)} - follow site instructions before
            confirming.
          </Text>
          <View style={[styles.card, { marginTop: 16 }]}>
            <Text style={styles.sectionLabel}>JOB ACTIONS</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                const url = `https://www.google.com/maps/dir/?api=1&destination=${stop.location.latitude},${stop.location.longitude}`;
                window.open(url, "_blank", "noopener");
              }}
              style={[styles.secondaryButton, { marginTop: 8 }]}
            >
              <Text style={styles.secondaryButtonText}>Open navigation</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => window.alert("Call dispatch: +44 20 0000 0000 (demo)")}
              style={[styles.secondaryButton, { marginTop: 8 }]}
            >
              <Text style={styles.secondaryButtonText}>Call dispatch</Text>
            </Pressable>
          </View>
          <View style={{ marginTop: 24 }}>
            {arrived ? (
              <>
                <Chip label="Arrived" tone="on" />
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setView({ name: "pod", jobId: job.id, stopId: stop.id })}
                  style={[styles.primaryButton, { marginTop: 12 }]}
                >
                  <Text style={styles.primaryButtonText}>Go to completion</Text>
                </Pressable>
              </>
            ) : (
              <HoldToConfirm
                label="SLIDE TO CONFIRM ARRIVAL"
                onConfirm={() => {
                  void runCommand({ kind: "arrive", jobId: job.id, stopId: stop.id });
                }}
              />
            )}
          </View>
          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>
      </View>
    );
  }

  // POD / exceptions
  return (
    <View style={styles.screen}>
      <SyncBanner online={online} />
      <ScrollView contentContainerStyle={styles.padded}>
        <Text style={styles.brand}>{job.reference} / COMPLETION</Text>
        <Text style={styles.title}>Confirm service</Text>
        <Text style={styles.subtitle}>
          Capture only what this job requires. The record syncs when you are back
          online.
        </Text>

        <Text style={styles.sectionLabel}>RECIPIENT DETAILS</Text>
        <TextInput
          value={recipientName}
          onChangeText={setRecipientName}
          placeholder="Recipient name (required for this job)"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Notes (optional)"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />

        <Text style={styles.sectionLabel}>PROOF OF SERVICE</Text>
        <View style={styles.signatureBox}>
          <Text style={styles.muted}>
            Sign above - clear and retry available. Native capture ships in Phase 3;
            the typed recipient name stands in for the demo.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void runCommand({
              kind: "complete",
              jobId: job.id,
              stopId: stop.id,
              payload: { recipientName, notes },
            }).then(() => setView({ name: "shift" }));
          }}
          style={[styles.primaryButton, { marginTop: 12 }]}
        >
          <Text style={styles.primaryButtonText}>Complete stop</Text>
        </Pressable>

        <Text style={[styles.sectionLabel, { marginTop: 20 }]}>SKIP / REPORT AN EXCEPTION</Text>
        <View style={styles.reasonRow}>
          {SKIP_REASONS.map((r) => (
            <Pressable
              key={r}
              accessibilityRole="button"
              onPress={() => setReason(r)}
              style={[styles.reasonChip, reason === r && { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.reasonText, reason === r && { color: "#FFFFFF" }]}>{r}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void runCommand({
              kind: "skip",
              jobId: job.id,
              stopId: stop.id,
              payload: { reason },
            }).then(() => setView({ name: "shift" }));
          }}
          style={[styles.dangerButton, { marginTop: 12 }]}
        >
          <Text style={styles.primaryButtonText}>Skip stop - report exception</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => setView({ name: "shift" })}
          style={[styles.secondaryButton, { marginTop: 16 }]}
        >
          <Text style={styles.secondaryButtonText}>Back to queue</Text>
        </Pressable>
        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
    </View>
  );
}

function SyncBanner({ online }: { online: boolean }) {
  const pending = pendingCount();
  const conflicts = conflictCount();
  const tone =
    conflicts > 0 ? colors.danger : online && pending === 0 ? colors.success : colors.warning;
  return (
    <View style={[styles.syncBanner, { backgroundColor: tone }]}>
      <Text style={styles.syncText}>
        {conflicts > 0
          ? `${conflicts} action(s) need attention - refresh your queue.`
          : online
            ? pending === 0
              ? "Synced"
              : `Queued locally - will sync (${pending})`
            : "No signal. Your progress is saved locally and will sync automatically."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  padded: { padding: 20, paddingBottom: 48 },
  brand: { fontSize: 11, fontWeight: "800", letterSpacing: 1.5, color: colors.muted },
  title: { fontSize: 22, fontWeight: "700", color: colors.text, marginTop: 6 },
  greeting: { fontSize: 20, fontWeight: "700", color: colors.text, marginTop: 6 },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 4 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    color: colors.muted,
    marginTop: 16,
    marginBottom: 6,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginTop: 8,
  },
  cardTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  muted: { fontSize: 12, color: colors.muted },
  time: { fontSize: 13, fontWeight: "700", color: colors.text, width: 44 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#FFFFFF", fontWeight: "800", fontSize: 13 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  chipText: { fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  nextCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginTop: 16,
  },
  nextLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 1.2, color: colors.muted },
  nextAddress: { fontSize: 18, fontWeight: "700", color: colors.text, marginTop: 6 },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  primaryButton: {
    minHeight: touch.primaryHeight,
    backgroundColor: colors.primary,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "800", fontSize: 15, textAlign: "center" },
  secondaryButton: {
    minHeight: touch.target,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  secondaryButtonText: { color: colors.text, fontWeight: "700", fontSize: 14, textAlign: "center" },
  dangerButton: {
    minHeight: touch.primaryHeight,
    backgroundColor: colors.danger,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  holdFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(255,255,255,0.35)",
  },
  hint: { fontSize: 11, color: colors.muted, marginTop: 6, textAlign: "center" },
  input: {
    minHeight: 48,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 15,
    color: colors.text,
    marginTop: 8,
  },
  signatureBox: {
    height: 96,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    marginTop: 8,
  },
  reasonRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  reasonChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  reasonText: { fontSize: 12, color: colors.text, fontWeight: "600" },
  syncBanner: { paddingVertical: 8, paddingHorizontal: 16 },
  syncText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700", textAlign: "center" },
  error: {
    color: colors.danger,
    fontSize: 13,
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 10,
    padding: 10,
  },
});

