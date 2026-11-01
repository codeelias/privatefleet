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
 * Foreground location service. Runs independently of the Activity and keeps
 * posting the same telemetry contract when the screen is off.
 */
public class TelemetryService extends Service implements LocationListener {
    public static final String ACTION_START = "com.privatefleet.driver.START_TRACKING";
    public static final String ACTION_STOP = "com.privatefleet.driver.STOP_TRACKING";
    private static final String CHANNEL = "privatefleet_tracking";
    private static final int NOTIFICATION_ID = 4201;
    private static final String TAG = "pf-native";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private LocationManager locationManager;
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
        Log.i(TAG, "location accuracy=" + location.getAccuracy());
        if (location.getAccuracy() > 150f) return;
        executor.execute(() -> {
            try {
                JSONObject sample = new JSONObject();
                sample.put("latitude", location.getLatitude());
                sample.put("longitude", location.getLongitude());
                sample.put("capturedAt", iso(location.getTime()));
                sample.put("accuracyMetres", location.getAccuracy());
                if (location.hasBearing()) sample.put("headingDeg", location.getBearing());
                if (location.hasSpeed() && location.getSpeed() >= 0) {
                    sample.put("speedMps", location.getSpeed());
                }
                JSONArray samples = new JSONArray();
                samples.put(sample);
                new ApiClient(this).telemetry(samples);
                Log.i(TAG, "telemetry posted");
            } catch (Exception error) {
                Log.w(TAG, "telemetry post failed: " + error.getMessage());
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
        if (locationManager != null) {
            locationManager.removeUpdates(this);
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



