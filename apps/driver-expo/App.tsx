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
import { AppState, Image, PanResponder } from "react-native";
import Svg, { Path } from "react-native-svg";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import { StatusBar } from "expo-status-bar";
import type { DriverQueue, JobDto, StoredSession } from "./src/api";
import { api, clearSession, driverLogin, loadSession } from "./src/api";
import { enqueue, flush, loadQueue } from "./src/queue";
import { startLocationTracking, stopLocationTracking } from "./src/location";

function newCommandId(): string {
  const cryptoApi = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
const FAILURE_REASONS = [
  { code: "RECIPIENT_UNAVAILABLE", label: "Recipient unavailable" },
  { code: "DELIVERY_REFUSED", label: "Delivery refused" },
  { code: "ADDRESS_ACCESS_PROBLEM", label: "Address / access issue" },
  { code: "ITEM_DAMAGED", label: "Item damaged" },
  { code: "VEHICLE_OPERATIONAL_PROBLEM", label: "Vehicle / operational" },
  { code: "OTHER", label: "Other" },
] as const;

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
  const [notes, setNotes] = useState("");
  const [signaturePath, setSignaturePath] = useState("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [failureCode, setFailureCode] = useState<string>(FAILURE_REASONS[0].code);
  const [failureNote, setFailureNote] = useState("");
  const [failurePhotoUri, setFailurePhotoUri] = useState<string | null>(null);

  const refreshQueue = useCallback(async () => {
    try {
      const stored = await loadQueue();
      setPending(stored.filter((command) => command.status === "pending").length);
      setConflicts(stored.filter((command) => command.status === "conflict").length);
    } catch {
      // Local queue status is still useful when the API is unreachable.
    }
    try {
      const next = await api.driverQueue();
      setQueue(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your queue");
    }
  }, []);

  const syncQueue = useCallback(async () => {
    const result = await flush();
    if (result.ok) {
      setError(null);
    }
    await refreshQueue();
  }, [refreshQueue]);

  useEffect(() => {
    if (pending === 0) {
      return;
    }
    const timer = setInterval(() => {
      void syncQueue();
    }, 15_000);
    return () => clearInterval(timer);
  }, [pending, syncQueue]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void syncQueue();
      }
    });
    const onOnline = (): void => {
      void syncQueue();
    };
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("online", onOnline);
    }
    return () => {
      subscription.remove();
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("online", onOnline);
      }
    };
  }, [syncQueue]);

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

  // A restored session that is already on shift must resume foreground GPS.
  useEffect(() => {
    if (session?.driver.status === "on_route") {
      void startLocationTracking();
    }
  }, [session]);

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
    notes?: string;
    signaturePath?: string;
    photoUri?: string;
    failureCode?: string;
    failureNote?: string;
    failurePhotoUri?: string;
  }): Promise<void> => {
    if (!session) {
      return;
    }
    setError(null);
    try {
      const result = await enqueue({
        commandId: newCommandId(),
        kind: command.kind,
        jobId: command.jobId,
        stopId: command.stopId,
        driverId: session.driver.id,
        recipientName: command.recipientName,
        notes: command.notes,
        signaturePath: command.signaturePath,
        photoUri: command.photoUri,
        failureCode: command.failureCode,
        failureNote: command.failureNote,
        failurePhotoUri: command.failurePhotoUri,
        capturedAt: new Date().toISOString(),
      });
      if (!result.ok) {
        setError(result.message ?? "Action needs attention");
      }
      await refreshQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The action could not be queued.");
    }
  };

  const takePhoto = async (target: "photo" | "failure"): Promise<void> => {
    setError(null);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setError("Camera permission is required to capture proof.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.55,
        base64: true,
      });
      if (result.canceled || !result.assets[0]) {
        return;
      }
      const asset = result.assets[0];
      let uri = asset.uri;
      if (FileSystem.documentDirectory) {
        const destination = `${FileSystem.documentDirectory}evidence-${Date.now()}.jpg`;
        await FileSystem.copyAsync({ from: asset.uri, to: destination });
        uri = destination;
      } else if (asset.base64) {
        uri = `data:image/jpeg;base64,${asset.base64}`;
      }
      if (target === "photo") {
        setPhotoUri(uri);
      } else {
        setFailurePhotoUri(uri);
      }
    } catch {
      setError("The camera could not be opened on this device.");
    }
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
        <Text style={styles.subtitle}>
          Capture what this job requires. Evidence syncs before the stop is completed.
        </Text>

        <Text style={styles.label}>Recipient name</Text>
        <TextInput
          accessibilityLabel="Recipient name"
          value={recipient}
          onChangeText={setRecipient}
          style={styles.input}
          placeholder="Recipient name"
        />
        <Text style={styles.label}>Delivery notes</Text>
        <TextInput
          accessibilityLabel="Delivery notes"
          value={notes}
          onChangeText={setNotes}
          style={styles.input}
          placeholder="Optional notes"
        />

        <Text style={styles.label}>Signature</Text>
        <SignaturePad
          onChange={(path) => {
            setSignaturePath(path);
          }}
        />
        {signaturePath ? (
          <Text style={styles.hint}>Signature captured ({signaturePath.length} path chars).</Text>
        ) : (
          <Text style={styles.hint}>Ask the recipient to sign above.</Text>
        )}

        <Text style={styles.label}>Delivery photo</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void takePhoto("photo")}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>
            {photoUri ? "Replace photo" : "Take photo"}
          </Text>
        </Pressable>
        {photoUri && (
          <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" />
        )}

        {error && <Text style={styles.error}>{error}</Text>}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void runCommand({
              kind: "complete",
              jobId: job.id,
              stopId: stop.id,
              recipientName: recipient,
              notes,
              signaturePath,
              ...(photoUri ? { photoUri } : {}),
            });
            setScreen("shift");
          }}
          style={[styles.primaryButton, { marginTop: 18 }]}
        >
          <Text style={styles.primaryButtonText}>Complete stop</Text>
        </Pressable>

        <Text style={[styles.label, { marginTop: 26 }]}>Report a failed delivery</Text>
        <View style={styles.reasonRow}>
          {FAILURE_REASONS.map((reason) => (
            <Pressable
              key={reason.code}
              accessibilityRole="button"
              onPress={() => setFailureCode(reason.code)}
              style={[
                styles.reasonChip,
                failureCode === reason.code && { backgroundColor: colors.primary },
              ]}
            >
              <Text
                style={[
                  styles.reasonText,
                  failureCode === reason.code && { color: "#FFFFFF" },
                ]}
              >
                {reason.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          accessibilityLabel="Failure note"
          value={failureNote}
          onChangeText={setFailureNote}
          style={styles.input}
          placeholder="What happened? (optional)"
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => void takePhoto("failure")}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>
            {failurePhotoUri ? "Replace exception photo" : "Add exception photo"}
          </Text>
        </Pressable>
        {failurePhotoUri && (
          <Image source={{ uri: failurePhotoUri }} style={styles.photo} resizeMode="cover" />
        )}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void runCommand({
              kind: "skip",
              jobId: job.id,
              stopId: stop.id,
              failureCode,
              failureNote,
              ...(failurePhotoUri ? { failurePhotoUri } : {}),
            });
            setScreen("shift");
          }}
          style={[styles.dangerButton, { marginTop: 12 }]}
        >
          <Text style={styles.primaryButtonText}>Submit failed delivery</Text>
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
        disabled={session?.driver.status === "on_route"}
        onPress={() => {
          void api.startShift().then(async (driver) => {
            await startLocationTracking();
            setSession((previous) =>
              previous ? { ...previous, driver: { ...previous.driver, ...driver } } : previous,
            );
            refreshQueue();
          });
        }}
        style={[
          styles.secondaryButton,
          { marginTop: 18, opacity: session?.driver.status === "on_route" ? 0.55 : 1 },
        ]}
      >
        <Text style={styles.secondaryButtonText}>
          {session?.driver.status === "on_route" ? "Shift active - tracking on" : "Start shift"}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          void clearSession().then(() => {
            stopLocationTracking();
            setSession(null);
          });
        }}
        style={[styles.secondaryButton, { marginTop: 8 }]}
      >
        <Text style={styles.secondaryButtonText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

function SignaturePad({ onChange }: { onChange: (path: string) => void }) {
  const [path, setPath] = useState("");
  const pathRef = useRef("");
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        const { locationX, locationY } = event.nativeEvent;
        pathRef.current = `M${Math.round(locationX)} ${Math.round(locationY)}`;
        setPath(pathRef.current);
      },
      onPanResponderMove: (event) => {
        const { locationX, locationY } = event.nativeEvent;
        pathRef.current += ` L${Math.round(locationX)} ${Math.round(locationY)}`;
        setPath(pathRef.current);
      },
      onPanResponderRelease: () => onChange(pathRef.current),
      onPanResponderTerminate: () => onChange(pathRef.current),
    }),
  ).current;
  return (
    <View style={styles.signature}>
      <View {...responder.panHandlers} style={StyleSheet.absoluteFill}>
        <Svg width="100%" height="100%">
          <Path
            d={path || "M0 0"}
            fill="none"
            stroke="#171816"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          pathRef.current = "";
          setPath("");
          onChange("");
        }}
        style={styles.signatureClear}
      >
        <Text style={styles.signatureClearText}>Clear</Text>
      </Pressable>
    </View>
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
  signature: {
    height: 170,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.card,
    marginTop: 6,
    overflow: "hidden",
  },
  signatureClear: {
    position: "absolute",
    right: 8,
    top: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: colors.bg,
  },
  signatureClearText: { fontSize: 11, color: colors.muted, fontWeight: "600" },
  photo: { width: "100%", height: 180, borderRadius: 12, marginTop: 8 },
  reasonRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  reasonChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.card,
  },
  reasonText: { fontSize: 11, color: colors.text },
  dangerButton: {
    backgroundColor: colors.danger,
    borderRadius: 12,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
});









