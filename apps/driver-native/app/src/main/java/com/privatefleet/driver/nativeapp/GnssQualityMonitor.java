package com.privatefleet.driver.nativeapp;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.GnssMeasurementsEvent;
import android.location.GnssStatus;
import android.location.LocationManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

/**
 * Raw-GNSS quality monitor.
 *
 * It reports what the device can actually prove: satellites used in the fix,
 * whether L1 and L5 are both present, and whether carrier-phase accumulation is
 * valid. It does NOT claim RTK/PPP "fixed" accuracy: that requires correction
 * data which this client does not receive. The caller must therefore never map
 * carrier-phase availability to a sub-metre guarantee.
 */
public final class GnssQualityMonitor {
    public static final class Quality {
        public final int satellitesUsed;
        public final boolean dualFrequency;
        public final boolean carrierPhase;
        public final String label;

        Quality(int satellitesUsed, boolean dualFrequency, boolean carrierPhase, String label) {
            this.satellitesUsed = satellitesUsed;
            this.dualFrequency = dualFrequency;
            this.carrierPhase = carrierPhase;
            this.label = label;
        }
    }

    public interface RawListener {
        void onMeasurements(GnssMeasurementsEvent event);
    }

    private final Context context;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private LocationManager locationManager;
    private GnssStatus.Callback statusCallback;
    private GnssMeasurementsEvent.Callback measurementsCallback;
    private volatile RawListener rawListener;

    public void setRawListener(RawListener listener) {
        rawListener = listener;
    }

    private volatile int satellitesUsed = 0;
    private volatile boolean dualFrequency = false;
    private volatile boolean carrierPhase = false;
    private volatile long lastMeasurementAt = 0L;

    public GnssQualityMonitor(Context context) {
        this.context = context.getApplicationContext();
    }

    public void start() {
        if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        if (locationManager == null) {
            locationManager = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        }
        if (locationManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            statusCallback = new GnssStatus.Callback() {
                @Override
                public void onSatelliteStatusChanged(GnssStatus status) {
                    int used = 0;
                    boolean l1 = false;
                    boolean l5 = false;
                    for (int index = 0; index < status.getSatelliteCount(); index += 1) {
                        if (status.usedInFix(index)) used += 1;
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                                && status.hasCarrierFrequencyHz(index)) {
                            float mhz = status.getCarrierFrequencyHz(index) / 1_000_000f;
                            if (mhz > 1550f && mhz < 1610f) l1 = true;
                            if (mhz > 1150f && mhz < 1210f) l5 = true;
                        }
                    }
                    satellitesUsed = used;
                    dualFrequency = l1 && l5;
                }
            };
            try {
                locationManager.registerGnssStatusCallback(statusCallback, handler);
            } catch (SecurityException | IllegalArgumentException ignored) {
                statusCallback = null;
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            measurementsCallback = new GnssMeasurementsEvent.Callback() {
                @Override
                public void onGnssMeasurementsReceived(GnssMeasurementsEvent event) {
                    lastMeasurementAt = System.currentTimeMillis();
                    boolean phase = false;
                    boolean l1 = false;
                    boolean l5 = false;
                    for (android.location.GnssMeasurement measurement : event.getMeasurements()) {
                        if ((measurement.getAccumulatedDeltaRangeState()
                                & android.location.GnssMeasurement.ADR_STATE_VALID) != 0) {
                            phase = true;
                        }
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                                && measurement.hasCarrierFrequencyHz()) {
                            float mhz = measurement.getCarrierFrequencyHz() / 1_000_000f;
                            if (mhz > 1550f && mhz < 1610f) l1 = true;
                            if (mhz > 1150f && mhz < 1210f) l5 = true;
                        }
                    }
                    if (phase) carrierPhase = true;
                    if (l1 && l5) dualFrequency = true;
                    RawListener listener = rawListener;
                    if (listener != null) listener.onMeasurements(event);
                }
            };
            try {
                locationManager.registerGnssMeasurementsCallback(measurementsCallback, handler);
            } catch (SecurityException | IllegalArgumentException ignored) {
                measurementsCallback = null;
            }
        }
    }

    public Quality snapshot() {
        boolean fresh = lastMeasurementAt > 0
                && System.currentTimeMillis() - lastMeasurementAt < 10_000L;
        boolean carrier = fresh && carrierPhase;
        String label;
        if (dualFrequency && carrier) label = "L1+L5 carrier";
        else if (dualFrequency) label = "L1+L5";
        else if (carrier) label = "carrier phase";
        else if (satellitesUsed > 0) label = "single frequency";
        else label = "no raw GNSS";
        return new Quality(satellitesUsed, dualFrequency && fresh, carrier, label);
    }

    public void stop() {
        if (locationManager != null) {
            if (statusCallback != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                try {
                    locationManager.unregisterGnssStatusCallback(statusCallback);
                } catch (IllegalArgumentException ignored) {
                }
            }
            if (measurementsCallback != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                try {
                    locationManager.unregisterGnssMeasurementsCallback(measurementsCallback);
                } catch (IllegalArgumentException ignored) {
                }
            }
        }
    }
}

