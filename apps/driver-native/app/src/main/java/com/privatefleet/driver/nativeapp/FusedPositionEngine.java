package com.privatefleet.driver.nativeapp;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Handler;
import android.os.HandlerThread;

/**
 * Fused position engine.
 *
 * GNSS corrections at ~1 Hz and IMU prediction at 50-100 Hz are fused by a
 * 2D constant-velocity EKF. Output is a smooth 10 Hz fix for telemetry and the
 * map. This is dead reckoning between GNSS fixes, not RTK: without correction
 * data the engine never claims sub-metre accuracy. Confidence reflects the EKF
 * covariance and fix age.
 */
public final class FusedPositionEngine implements SensorEventListener, LocationListener {
    public interface Listener {
        void onFix(Fix fix);
    }

    public static final class Fix {
        public final double latitude;
        public final double longitude;
        public final double accuracyMetres;
        public final double headingDeg;
        public final double speedMps;
        public final long capturedAt;
        public final String source;
        public final int satellitesUsed;
        public final boolean dualFrequency;
        public final boolean carrierPhase;
        public final String confidence;

        Fix(double latitude, double longitude, double accuracyMetres, double headingDeg,
            double speedMps, long capturedAt, String source, int satellitesUsed,
            boolean dualFrequency, boolean carrierPhase, String confidence) {
            this.latitude = latitude;
            this.longitude = longitude;
            this.accuracyMetres = accuracyMetres;
            this.headingDeg = headingDeg;
            this.speedMps = speedMps;
            this.capturedAt = capturedAt;
            this.source = source;
            this.satellitesUsed = satellitesUsed;
            this.dualFrequency = dualFrequency;
            this.carrierPhase = carrierPhase;
            this.confidence = confidence;
        }
    }

    private static final long PREDICT_MS = 100L;
    private static final long GNSS_INTERVAL_MS = 1000L;

    private final Context context;
    private final Listener listener;
    private final GnssQualityMonitor qualityMonitor;
    private final HandlerThread worker;
    private final Handler handler;
    private final Ekf2D ekf = new Ekf2D();
    private final float[] rotationMatrix = new float[9];
    private final float[] orientation = new float[3];
    private final float[] gravity = new float[3];

    private SensorManager sensorManager;
    private LocationManager locationManager;
    private boolean initialized = false;
    private double anchorLatitude;
    private double anchorLongitude;
    private double anchorCosLat = 1.0;
    private long lastPredictionNanos = 0L;
    private long lastGnssAt = 0L;
    private double lastGnssAccuracy = 50.0;
    private double accelerationEast = 0.0;
    private double accelerationNorth = 0.0;
    private float azimuthDegrees = 0f;
    private boolean hasRotation = false;
    private boolean hasLinearAcceleration = false;
    private boolean running = false;

    public FusedPositionEngine(Context context, Listener listener) {
        this.context = context.getApplicationContext();
        this.listener = listener;
        this.qualityMonitor = new GnssQualityMonitor(context);
        this.worker = new HandlerThread("pf-fused-position");
        this.worker.start();
        this.handler = new Handler(worker.getLooper());
    }

    public void start() {
        if (running) return;
        running = true;
        qualityMonitor.start();
        sensorManager = (SensorManager) context.getSystemService(Context.SENSOR_SERVICE);
        if (sensorManager != null) {
            Sensor rotation = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
            Sensor acceleration = sensorManager.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION);
            if (acceleration == null) {
                acceleration = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
            }
            if (rotation != null) {
                sensorManager.registerListener(this, rotation, SensorManager.SENSOR_DELAY_GAME, handler);
                hasRotation = true;
            }
            if (acceleration != null) {
                sensorManager.registerListener(this, acceleration, SensorManager.SENSOR_DELAY_GAME, handler);
                hasLinearAcceleration = acceleration.getType() == Sensor.TYPE_LINEAR_ACCELERATION;
            }
        }
        locationManager = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        if (locationManager != null
                && context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED) {
            try {
                locationManager.requestLocationUpdates(
                        LocationManager.GPS_PROVIDER, GNSS_INTERVAL_MS, 0f, this, handler.getLooper());
                Location last = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
                if (last != null) onLocationChanged(last);
            } catch (SecurityException | IllegalArgumentException ignored) {
            }
        }
        handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (!running) return;
                predictAndEmit();
                handler.postDelayed(this, PREDICT_MS);
            }
        }, PREDICT_MS);
    }

    private void predictAndEmit() {
        if (!initialized) return;
        long nowNanos = System.nanoTime();
        double dt = lastPredictionNanos == 0L ? 0 : (nowNanos - lastPredictionNanos) / 1_000_000_000.0;
        lastPredictionNanos = nowNanos;
        dt = Math.max(0, Math.min(0.5, dt));
        if (dt <= 0) return;
        ekf.predict(dt, accelerationEast, accelerationNorth);
        emit(System.currentTimeMillis());
    }

    @Override
    public void onLocationChanged(Location location) {
        if (location == null || !location.hasAccuracy()) return;
        double accuracy = location.getAccuracy();
        if (accuracy > 150) return;
        double east;
        double north;
        if (!initialized) {
            anchorLatitude = location.getLatitude();
            anchorLongitude = location.getLongitude();
            anchorCosLat = Math.cos(Math.toRadians(anchorLatitude));
            double speed = location.hasSpeed() ? location.getSpeed() : 0;
            double bearing = location.hasBearing() ? location.getBearing() : 0;
            ekf.initialize(
                    0,
                    0,
                    speed * Math.sin(Math.toRadians(bearing)),
                    speed * Math.cos(Math.toRadians(bearing)),
                    accuracy
            );
            initialized = true;
            lastPredictionNanos = System.nanoTime();
        } else {
            east = (location.getLongitude() - anchorLongitude) * 111_320 * anchorCosLat;
            north = (location.getLatitude() - anchorLatitude) * 110_540;
            ekf.updatePosition(east, north, accuracy);
            if (location.hasSpeed() && location.hasBearing() && location.getSpeed() > 1.0) {
                double bearing = Math.toRadians(location.getBearing());
                ekf.updateVelocity(
                        location.getSpeed() * Math.sin(bearing),
                        location.getSpeed() * Math.cos(bearing),
                        Math.max(2.0, accuracy * 0.15)
                );
            }
        }
        lastGnssAt = System.currentTimeMillis();
        lastGnssAccuracy = accuracy;
        emit(lastGnssAt);
    }

    private void emit(long capturedAt) {
        if (!initialized) return;
        GnssQualityMonitor.Quality quality = qualityMonitor.snapshot();
        long age = lastGnssAt == 0 ? 0 : capturedAt - lastGnssAt;
        double accuracy = Math.max(2.0, Math.round(ekf.accuracyMetres() * 10) / 10.0);
        String confidence;
        if (age > 15_000 || accuracy > 50) confidence = "low";
        else if (age > 5_000 || accuracy > 20) confidence = "medium";
        else confidence = "high";
        double speed = Math.hypot(ekf.velocityEast(), ekf.velocityNorth());
        double heading = speed > 2.0
                ? (Math.toDegrees(Math.atan2(ekf.velocityEast(), ekf.velocityNorth())) + 360) % 360
                : azimuthDegrees;
        double latitude = anchorLatitude + ekf.north() / 110_540.0;
        double longitude = anchorLongitude + ekf.east() / (111_320.0 * anchorCosLat);
        listener.onFix(new Fix(latitude, longitude, accuracy, heading, speed, capturedAt,
                "fused", quality.satellitesUsed, quality.dualFrequency, quality.carrierPhase,
                confidence));
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (event.sensor.getType() == Sensor.TYPE_ROTATION_VECTOR) {
            SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values);
            SensorManager.getOrientation(rotationMatrix, orientation);
            azimuthDegrees = (float) ((Math.toDegrees(orientation[0]) + 360) % 360);
            hasRotation = true;
            return;
        }
        if (event.sensor.getType() == Sensor.TYPE_LINEAR_ACCELERATION) {
            accelerationEast = rotationMatrix[0] * event.values[0]
                    + rotationMatrix[1] * event.values[1]
                    + rotationMatrix[2] * event.values[2];
            accelerationNorth = rotationMatrix[3] * event.values[0]
                    + rotationMatrix[4] * event.values[1]
                    + rotationMatrix[5] * event.values[2];
            return;
        }
        if (event.sensor.getType() == Sensor.TYPE_ACCELEROMETER) {
            gravity[0] = 0.8f * gravity[0] + 0.2f * event.values[0];
            gravity[1] = 0.8f * gravity[1] + 0.2f * event.values[1];
            gravity[2] = 0.8f * gravity[2] + 0.2f * event.values[2];
            double ax = event.values[0] - gravity[0];
            double ay = event.values[1] - gravity[1];
            double az = event.values[2] - gravity[2];
            accelerationEast = rotationMatrix[0] * ax + rotationMatrix[1] * ay + rotationMatrix[2] * az;
            accelerationNorth = rotationMatrix[3] * ax + rotationMatrix[4] * ay + rotationMatrix[5] * az;
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
        // Confidence is derived from covariance and GNSS quality.
    }

    public void stop() {
        running = false;
        handler.removeCallbacksAndMessages(null);
        if (sensorManager != null) sensorManager.unregisterListener(this);
        if (locationManager != null) {
            try {
                locationManager.removeUpdates(this);
            } catch (SecurityException ignored) {
            }
        }
        qualityMonitor.stop();
        worker.quitSafely();
    }

    public void setRawGnssListener(GnssQualityMonitor.RawListener listener) {
        qualityMonitor.setRawListener(listener);
    }

    public boolean isRunning() {
        return running;
    }

    public boolean hasRotation() {
        return hasRotation;
    }

    public boolean hasLinearAcceleration() {
        return hasLinearAcceleration;
    }
}
