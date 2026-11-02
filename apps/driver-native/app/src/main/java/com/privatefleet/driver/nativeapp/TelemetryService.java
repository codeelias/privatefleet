package com.privatefleet.driver.nativeapp;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Foreground location service. Runs independently of the Activity and keeps
 * posting the same telemetry contract when the screen is off.
 */
public class TelemetryService extends Service {
    public static final String ACTION_START = "com.privatefleet.driver.START_TRACKING";
    public static final String ACTION_STOP = "com.privatefleet.driver.STOP_TRACKING";
    private static final String CHANNEL = "privatefleet_tracking";
    private static final int NOTIFICATION_ID = 4201;
    private static final String TAG = "pf-native";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean sending = new AtomicBoolean(false);
    private final RtkSolver rtkSolver = new NoRtkSolver();
    private FusedPositionEngine engine;
    private NtripClient ntripClient;
    private volatile boolean correctionsConnected = false;
    private volatile long correctionAgeMs = Long.MAX_VALUE;
    private volatile String rtkState = "unsupported";
    private volatile long lastSentAt = 0L;
    private PowerManager.WakeLock wakeLock;

    public static void start(Context context) {
        Intent intent = new Intent(context, TelemetryService.class).setAction(ACTION_START);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    public static void stop(Context context) {
        context.stopService(new Intent(context, TelemetryService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "privatefleet:gps");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire(60 * 60 * 1000L);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        startUpdates();
        return START_STICKY;
    }

    private void startUpdates() {
        if (checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "fine location not granted; service stopping");
            stopSelf();
            return;
        }
        if (engine == null) {
            engine = new FusedPositionEngine(this, fix -> onFusedFix(fix));
            engine.start();
            Log.i(TAG, "fused GNSS/IMU positioning started");
        }
        startCorrections();
    }

    private void startCorrections() {
        if (ntripClient != null) return;
        CorrectionsConfig config = new CorrectionsConfig(this);
        if (!config.isEnabled()) {
            rtkState = PrecisionState.contract(
                    PrecisionState.evaluate(0, false, false, false, Long.MAX_VALUE,
                            rtkSolver.hasFloatSolution(), rtkSolver.hasFixedSolution()));
            return;
        }
        ntripClient = new NtripClient(
                config.host(), config.port(), config.mountpoint(),
                config.username(), config.password(),
                status -> {
                    correctionsConnected = status.connected;
                    correctionAgeMs = status.ageMs(System.currentTimeMillis());
                    rtkState = PrecisionState.contract(
                            PrecisionState.evaluate(0, false, false, correctionsConnected,
                                    correctionAgeMs, rtkSolver.hasFloatSolution(),
                                    rtkSolver.hasFixedSolution()));
                });
        ntripClient.start();
        Log.i(TAG, "correction stream configured: " + config.host() + "/" + config.mountpoint());
    }

    private void onFusedFix(FusedPositionEngine.Fix fix) {
        if (fix.accuracyMetres > 250) return;
        LocationStore.save(this, fix.latitude, fix.longitude, fix.capturedAt);
        PrecisionState.Level level = PrecisionState.evaluate(
                fix.satellitesUsed, fix.dualFrequency, fix.carrierPhase,
                correctionsConnected, correctionAgeMs,
                rtkSolver.hasFloatSolution(), rtkSolver.hasFixedSolution());
        rtkState = PrecisionState.contract(level);
        long now = System.currentTimeMillis();
        if (now - lastSentAt < 900L) return;
        if (!sending.compareAndSet(false, true)) return;
        lastSentAt = now;
        executor.execute(() -> {
            try {
                JSONObject sample = new JSONObject();
                sample.put("latitude", fix.latitude);
                sample.put("longitude", fix.longitude);
                sample.put("capturedAt", iso(fix.capturedAt));
                sample.put("accuracyMetres", fix.accuracyMetres);
                sample.put("headingDeg", fix.headingDeg);
                sample.put("speedMps", Math.max(0, fix.speedMps));
                sample.put("source", fix.source);
                sample.put("satellitesUsed", fix.satellitesUsed);
                sample.put("dualFrequency", fix.dualFrequency);
                sample.put("carrierPhase", fix.carrierPhase);
                sample.put("ekfConfidence", fix.confidence);
                sample.put("rtkState", rtkState);
                if (correctionsConnected && correctionAgeMs != Long.MAX_VALUE) {
                    sample.put("correctionAgeMs", correctionAgeMs);
                }
                JSONArray samples = new JSONArray();
                samples.put(sample);
                new ApiClient(this).telemetry(samples);
                Log.i(TAG, "fused telemetry posted acc=" + fix.accuracyMetres
                        + " sats=" + fix.satellitesUsed + " confidence=" + fix.confidence
                        + " rtk=" + rtkState);
            } catch (Exception error) {
                Log.w(TAG, "telemetry post failed: " + error.getMessage());
            } finally {
                sending.set(false);
            }
        });
    }

    private static String iso(long millis) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date(millis));
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        NotificationChannel channel = new NotificationChannel(
                CHANNEL, "PrivateFleet tracking", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Location sharing while the shift is active");
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent content = PendingIntent.getActivity(
                this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Intent stop = new Intent(this, TelemetryService.class).setAction(ACTION_STOP);
        PendingIntent stopIntent = PendingIntent.getService(
                this, 1, stop, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL)
                : new Notification.Builder(this);
        return builder
                .setContentTitle("PrivateFleet tracking")
                .setContentText("Sharing location while your shift is active")
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentIntent(content)
                .addAction(new Notification.Action.Builder(
                        null, "Stop tracking", stopIntent).build())
                .setOngoing(true)
                .build();
    }

    @Override
    public void onDestroy() {
        if (engine != null) {
            engine.stop();
            engine = null;
        }
        if (ntripClient != null) {
            ntripClient.stop();
            ntripClient = null;
        }
        executor.shutdownNow();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}




