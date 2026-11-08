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
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Foreground location service.
 *
 * Position source: GPS every 10 s plus network every 15 s (raw fixes).
 * Processing (no Kalman, no RTK):
 *   1. quality gate - accuracy, fix age, out-of-order wall clock
 *   2. source arbitration - a network fix is ignored while a GPS fix is fresh
 *   3. StationaryGate - classifies STATIONARY/MOVING/UNKNOWN and holds the
 *      displayed position while parked so GPS scatter never dances the pin
 * Every decision is logged (pf-diag) for the field-diagnostics phase.
 */
public class TelemetryService extends Service implements LocationListener {
    public static final String ACTION_START = "com.privatefleet.driver.START_TRACKING";
    public static final String ACTION_STOP = "com.privatefleet.driver.STOP_TRACKING";
    private static final String CHANNEL = "privatefleet_tracking";
    private static final int NOTIFICATION_ID = 4201;
    private static final String TAG = "pf-native";
    private static final String DIAG = "pf-diag";
    private static final long MAX_FIX_AGE_MS = 60_000L;
    private static final long GPS_FRESH_MS = 45_000L;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Object gateLock = new Object();
    private final StationaryGate gate = new StationaryGate();
    private LocationManager locationManager;
    private GnssQualityMonitor qualityMonitor;
    private PowerManager.WakeLock wakeLock;

    private long lastAcceptedWallClock = 0L;
    private long lastGpsFixElapsed = 0L;
    private boolean hasAccepted = false;

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
        qualityMonitor = new GnssQualityMonitor(this);
        qualityMonitor.setRawListener(new RawGnssLogger());
        qualityMonitor.start();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        // Architectural fix (docs/58 defect): verify the location permission
        // BEFORE startForeground(FOREGROUND_SERVICE_TYPE_LOCATION). The old
        // order crashed with SecurityException and Android restarted the
        // service in an endless crash loop. A missing permission must stop
        // cleanly, never crash.
        if (checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "fine location not granted; stopping cleanly (no FGS start)");
            stopSelf();
            return START_NOT_STICKY;
        }
        try {
            Notification notification = buildNotification();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (SecurityException error) {
            Log.w(TAG, "startForeground denied; stopping cleanly", error);
            stopSelf();
            return START_NOT_STICKY;
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
        if (locationManager == null) {
            locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);
        }
        try {
            locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER, 10_000L, 0f, this);
            locationManager.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER, 15_000L, 0f, this);
            Log.i(TAG, "native foreground location started");
        } catch (SecurityException | IllegalArgumentException error) {
            Log.e(TAG, "location updates failed", error);
            stopSelf();
        }
    }

    @Override
    public void onLocationChanged(Location location) {
        if (location == null) return;
        long nowElapsed = SystemClock.elapsedRealtime();
        long fixElapsed = location.getElapsedRealtimeNanos() / 1_000_000L;
        long ageMs = fixElapsed > 0 ? nowElapsed - fixElapsed : 0L;
        float accuracy = location.getAccuracy();
        String provider = location.getProvider() == null ? "unknown" : location.getProvider();
        boolean isGps = LocationManager.GPS_PROVIDER.equals(provider);
        boolean hasSpeed = location.hasSpeed();
        double speed = hasSpeed ? location.getSpeed() : -1;

        String decision;
        StationaryGate.Result result;
        double displacementUsed;
        synchronized (gateLock) {
            if (accuracy > 150f) {
                diag(location, ageMs, accuracy, provider, speed, hasSpeed, 0, "rejected accuracy>150", null);
                return;
            }
            if (ageMs > MAX_FIX_AGE_MS) {
                diag(location, ageMs, accuracy, provider, speed, hasSpeed, 0, "rejected fix age", null);
                return;
            }
            if (location.getTime() <= lastAcceptedWallClock) {
                diag(location, ageMs, accuracy, provider, speed, hasSpeed, 0, "rejected out-of-order", null);
                return;
            }
            if (isGps) {
                lastGpsFixElapsed = nowElapsed;
            } else if (hasAccepted && nowElapsed - lastGpsFixElapsed < GPS_FRESH_MS) {
                diag(location, ageMs, accuracy, provider, speed, hasSpeed, 0, "rejected network while gps fresh", null);
                return;
            }
            double displacement = hasAccepted
                    ? StationaryGate.displacementMetres(lastLatitude, lastLongitude,
                    location.getLatitude(), location.getLongitude())
                    : 0;
            displacementUsed = displacement;
            result = gate.apply(hasSpeed, speed, accuracy, displacement,
                    location.getLatitude(), location.getLongitude());
            lastLatitude = location.getLatitude();
            lastLongitude = location.getLongitude();
            lastAcceptedWallClock = location.getTime();
            hasAccepted = true;
            decision = result.held ? "accepted held" : "accepted pass-through";
        }

        diag(location, ageMs, accuracy, provider, speed, hasSpeed,
                displacementUsed, decision, result.state);
        GnssQualityMonitor.Quality quality = qualityMonitor.snapshot();
        LocationStore.save(this, result.latitude, result.longitude, location.getTime());
        executor.execute(() -> {
            try {
                JSONObject sample = new JSONObject();
                sample.put("latitude", result.latitude);
                sample.put("longitude", result.longitude);
                sample.put("capturedAt", iso(location.getTime()));
                sample.put("accuracyMetres", result.accuracy);
                sample.put("source", isGps ? "gnss" : "network");
                sample.put("movementState", result.state.contract());
                if (location.hasBearing()) sample.put("headingDeg", location.getBearing());
                if (hasSpeed && speed >= 0) sample.put("speedMps", speed);
                sample.put("satellitesUsed", quality.satellitesUsed);
                sample.put("dualFrequency", quality.dualFrequency);
                sample.put("carrierPhase", quality.carrierPhase);
                sample.put("rtkState", "unsupported");
                JSONArray samples = new JSONArray();
                samples.put(sample);
                new ApiClient(this).telemetry(samples);
                Log.i(TAG, "telemetry posted state=" + result.state.contract()
                        + (result.held ? " held" : ""));
            } catch (Exception error) {
                Log.w(TAG, "telemetry post failed: " + error.getMessage());
            }
        });
    }

    private double lastLatitude;
    private double lastLongitude;

    private void diag(Location location, long ageMs, float accuracy, String provider,
                      double speed, boolean hasSpeed, double displacement,
                      String decision, StationaryGate.State state) {
        Log.i(DIAG, "provider=" + provider
                + " acc=" + accuracy
                + " ageMs=" + ageMs
                + " lat=" + location.getLatitude()
                + " lng=" + location.getLongitude()
                + " wallClock=" + location.getTime()
                + " elapsed=" + (location.getElapsedRealtimeNanos() / 1_000_000L)
                + " speed=" + (hasSpeed ? speed : "n/a")
                + " speedAcc=" + (location.hasSpeedAccuracy() ? location.getSpeedAccuracyMetersPerSecond() : "n/a")
                + " bearing=" + (location.hasBearing() ? location.getBearing() : "n/a")
                + " bearingAcc=" + (location.hasBearingAccuracy() ? location.getBearingAccuracyDegrees() : "n/a")
                + " dist=" + displacement
                + " decision=" + decision
                + " state=" + (state == null ? "n/a" : state.contract()));
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
        if (locationManager != null) {
            locationManager.removeUpdates(this);
        }
        if (qualityMonitor != null) {
            qualityMonitor.stop();
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
