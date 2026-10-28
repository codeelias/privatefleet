/**
 * PrivateFleet Driver - Expo application (Phase 3, docs/06).
 *
 * Same server contract as the RN-web app: PIN device session, tenant
 * scoped queue, arrive/complete/skip commands with idempotency keys and
 * a durable offline queue. Native builds run through EAS; this app also
 * exports for web so the workflow can be verified in CI-like conditions.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import type { DriverQueue, JobDto, StoredSession } from "./src/api";
import { api, clearSession, driverLogin, loadSession } from "./src/api";
import { enqueue, flush, loadQueue, pendingCount } from "./src/queue";

const colors = {
  bg: "#F8FAFC",
  card: "#FFFFFF",
  text: "#0F172A",
  muted: "#64748B",
  border: "#E2E8F0",
  primary: "#2563EB",
  danger: "#DC2626",
  success: "#16A34A",
};

function HoldButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const firedRef = useRef(false);

  const start = (): void => {
    setProgress(0);
    firedRef.current = false;
    const started = Date.now();
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    timerRef.current = setInterval(() => {
      const ratio = Math.min(1, (Date.now() - started) / 900);
      setProgress(ratio);
      if (ratio >= 1) {
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
  };

  const cancel = (): void => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setProgress(0);
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} - hold to confirm`}
      onPressIn={start}
      onPressOut={cancel}
      style={[styles.primaryButton, { overflow: "hidden" }]}
    >
      <View style={[styles.holdFill, { width: `${progress * 100}%` }]} />
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

export default function App() {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [booting, setBooting] = useState(true);
  const [queue, setQueue] = useState<DriverQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [conflicts, setConflicts] = useState(0);
  const [screen, setScreen] = useState<"login" | "shift" | "active" | "pod">("login");
  const [stopId, setStopId] = useState<string | null>(null);
  const [tenantSlug, setTenantSlug] = useState("");
  const [driverId, setDriverId] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [recipient, setRecipient] = useState("");

  const refreshQueue = useCallback(async () => {
    try {
      const next = await api.driverQueue();
      setQueue(next);
      setPending(await pendingCount());
      const stored = await loadQueue();
      setConflicts(stored.filter((command) => command.status === "conflict").length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your queue");
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const existing = await loadSession();
      await loadQueue();
      if (existing) {
        setSession(existing);
        setScreen("shift");
        await flush();
        await refreshQueue();
      }
      setBooting(false);
    })();
  }, [refreshQueue]);

  const submitLogin = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const next = await driverLogin({
        tenantSlug: tenantSlug.trim(),
        driverId: driverId.trim(),
        pin,
      });
      setSession(next);
      setScreen("shift");
      await refreshQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  };

  const activeStop = queue?.jobs
    .flatMap((job) => job.stops.map((stop) => ({ job, stop })))
    .find((entry) => entry.stop.id === stopId);

  const runCommand = async (command: {
    kind: "arrive" | "complete" | "skip";
    jobId: string;
    stopId: string;
    recipientName?: string;
  }): Promise<void> => {
    if (!session) {
      return;
    }
    setError(null);
    const result = await enqueue({
      commandId: crypto.randomUUID(),
      kind: command.kind,
      jobId: command.jobId,
      stopId: command.stopId,
      driverId: session.driver.id,
      recipientName: command.recipientName,
      capturedAt: new Date().toISOString(),
    });
    if (!result.ok) {
      setError(result.message ?? "Action needs attention");
    }
    await refreshQueue();
  };

  if (booting) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!session) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.padded}>
        <StatusBar style="dark" />
        <Text style={styles.brand}>NORTHSTAR TRANSPORT</Text>
        <Text style={styles.title}>Driver sign in</Text>
        <Text style={styles.subtitle}>Workspace, driver ID and PIN are issued by dispatch.</Text>
        <Text style={styles.label}>Workspace</Text>
        <TextInput
          accessibilityLabel="Workspace"
          autoCapitalize="none"
          value={tenantSlug}
          onChangeText={setTenantSlug}
          style={styles.input}
        />
        <Text style={styles.label}>Driver ID</Text>
        <TextInput
          accessibilityLabel="Driver ID"
          autoCapitalize="none"
          value={driverId}
          onChangeText={setDriverId}
          style={styles.input}
        />
        <Text style={styles.label}>PIN</Text>
        <TextInput
          accessibilityLabel="PIN"
          secureTextEntry
          keyboardType="number-pad"
          value={pin}
          onChangeText={setPin}
          style={styles.input}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => {
            void submitLogin();
          }}
          style={[styles.primaryButton, { marginTop: 18, opacity: busy ? 0.6 : 1 }]}
        >
          <Text style={styles.primaryButtonText}>{busy ? "Signing in..." : "Sign in"}</Text>
        </Pressable>
      </ScrollView>
    );
  }

  if (screen === "active" && activeStop) {
    const { job, stop } = activeStop;
    const arrived = stop.status === "arrived";
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.padded}>
        <StatusBar style="dark" />
        <Text style={styles.brand}>ACTIVE JOB / {job.reference}</Text>
        <Text style={styles.title}>{stop.address}</Text>
        <Text style={styles.subtitle}>{stop.stopType.toUpperCase()} - sequence {stop.sequenceNo}</Text>
        {error && <Text style={styles.error}>{error}</Text>}
        {arrived ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setRecipient("");
              setScreen("pod");
            }}
            style={[styles.primaryButton, { marginTop: 24 }]}
          >
            <Text style={styles.primaryButtonText}>Go to completion</Text>
          </Pressable>
        ) : (
          <View style={{ marginTop: 24 }}>
            <HoldButton
              label="SLIDE TO CONFIRM ARRIVAL"
              onConfirm={() => {
                void runCommand({ kind: "arrive", jobId: job.id, stopId: stop.id });
              }}
            />
            <Text style={styles.hint}>Hold for one second - prevents pocket dials.</Text>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          onPress={() => setScreen("shift")}
          style={[styles.secondaryButton, { marginTop: 12 }]}
        >
          <Text style={styles.secondaryButtonText}>Back to queue</Text>
        </Pressable>
      </ScrollView>
    );
  }

  if (screen === "pod" && activeStop) {
    const { job, stop } = activeStop;
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.padded}>
        <StatusBar style="dark" />
        <Text style={styles.brand}>PROOF OF DELIVERY</Text>
        <Text style={styles.title}>{stop.address}</Text>
        <Text style={styles.label}>Recipient name</Text>
        <TextInput
          accessibilityLabel="Recipient name"
          value={recipient}
          onChangeText={setRecipient}
          style={styles.input}
          placeholder="Recipient name"
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setScreen("shift");
            void runCommand({
              kind: "complete",
              jobId: job.id,
              stopId: stop.id,
              recipientName: recipient,
            });
          }}
          style={[styles.primaryButton, { marginTop: 18 }]}
        >
          <Text style={styles.primaryButtonText}>Complete stop</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setScreen("active")}
          style={[styles.secondaryButton, { marginTop: 10 }]}
        >
          <Text style={styles.secondaryButtonText}>Back</Text>
        </Pressable>
      </ScrollView>
    );
  }

  const jobs: JobDto[] = queue?.jobs ?? [];
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.padded}>
      <StatusBar style="dark" />
      <Text style={styles.brand}>NORTHSTAR TRANSPORT</Text>
      <Text style={styles.title}>Good morning, {session.driver.fullName.split(" ")[0]}</Text>
      <Text style={styles.subtitle}>
        {conflicts > 0
          ? `${conflicts} action(s) need attention - refresh your queue.`
          : pending > 0
            ? `${pending} action(s) waiting to sync`
            : "Connected - actions sync immediately"}
      </Text>
      {error && <Text style={styles.error}>{error}</Text>}
      {jobs.length === 0 && <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />}
      {jobs.map((job) => (
        <View key={job.id} style={styles.card}>
          <Text style={styles.cardTitle}>{job.reference}</Text>
          <Text style={styles.muted}>
            {job.serviceType} - {job.status}
          </Text>
          {job.stops
            .filter((stop) => stop.status === "pending" || stop.status === "arrived")
            .map((stop) => (
              <Pressable
                key={stop.id}
                accessibilityRole="button"
                onPress={() => {
                  setStopId(stop.id);
                  setScreen("active");
                }}
                style={styles.stopRow}
              >
                <Text style={styles.stopText}>
                  {stop.address} - {stop.stopType}
                  {stop.status === "arrived" ? " (arrived)" : ""}
                </Text>
              </Pressable>
            ))}
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          void api.startShift().then(() => refreshQueue());
        }}
        style={[styles.secondaryButton, { marginTop: 18 }]}
      >
        <Text style={styles.secondaryButtonText}>Start shift</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          void clearSession().then(() => setSession(null));
        }}
        style={[styles.secondaryButton, { marginTop: 8 }]}
      >
        <Text style={styles.secondaryButtonText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { justifyContent: "center", alignItems: "center" },
  padded: { padding: 20, paddingBottom: 48 },
  brand: { fontSize: 11, fontWeight: "700", letterSpacing: 2, color: colors.muted },
  title: { fontSize: 22, fontWeight: "700", color: colors.text, marginTop: 6 },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 4 },
  label: { fontSize: 12, color: colors.muted, marginTop: 16 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 6,
    backgroundColor: colors.card,
    color: colors.text,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  primaryButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
  },
  secondaryButtonText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  holdFill: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: "#1D4ED8" },
  hint: { fontSize: 11, color: colors.muted, marginTop: 8, textAlign: "center" },
  error: { color: colors.danger, fontSize: 13, marginTop: 12 },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
  },
  cardTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  muted: { fontSize: 12, color: colors.muted, marginTop: 2 },
  stopRow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 8 },
  stopText: { fontSize: 14, color: colors.text },
});
