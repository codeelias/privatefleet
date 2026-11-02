package com.privatefleet.driver.nativeapp;

/**
 * JNI facade for the RTKLIB-backed solver. The native side feeds Android raw
 * observations and RTCM corrections into rtkpos. Fixed/float states are only
 * reported when the native solver actually produces them.
 */
public final class NativeRtkEngine implements RtkSolver {
    private static final boolean AVAILABLE;

    static {
        boolean loaded = false;
        try {
            System.loadLibrary("pf_rtk");
            loaded = true;
        } catch (Throwable ignored) {
            loaded = false;
        }
        AVAILABLE = loaded;
    }

    public static boolean isAvailable() {
        return AVAILABLE;
    }

    /** [0]=stat [1..3]=rr ECEF [4]=age [5]=ratio */
    private volatile double[] lastSolution;

    public NativeRtkEngine() {
        if (AVAILABLE) nativeInit();
    }

    private native void nativeInit();

    private native void nativeStartEpoch();

    private native void nativeAddMeasurement(
            double gnssTimeSec, int sys, int prn, double freqHz, double cn0,
            double pseudorange, double pseudorangeRate, double adrMeters,
            int adrValid);

    private native void nativeAddCorrections(byte[] chunk);

    private native double[] nativeSolve();

    public void startEpoch() {
        if (AVAILABLE) nativeStartEpoch();
    }

    public void addMeasurement(double gnssTimeSec, int sys, int prn, double freqHz,
                               double cn0, double pseudorange, double pseudorangeRate,
                               double adrMeters, boolean adrValid) {
        if (AVAILABLE) {
            nativeAddMeasurement(gnssTimeSec, sys, prn, freqHz, cn0, pseudorange,
                    pseudorangeRate, adrMeters, adrValid ? 1 : 0);
        }
    }

    public void addCorrections(byte[] chunk) {
        if (AVAILABLE) nativeAddCorrections(chunk);
    }

    public void solve() {
        if (AVAILABLE) {
            double[] result = nativeSolve();
            if (result != null) lastSolution = result;
        }
    }

    public int solutionStat() {
        return lastSolution == null ? 0 : (int) lastSolution[0];
    }

    @Override
    public boolean hasFloatSolution() {
        return solutionStat() == 2;
    }

    @Override
    public boolean hasFixedSolution() {
        return solutionStat() == 1;
    }

    @Override
    public double positionUncertaintyMetres() {
        return hasFixedSolution() ? 0.10 : Double.POSITIVE_INFINITY;
    }

    /** ECEF to WGS84 (simple iterative conversion). */
    private static double[] ecefToLlh(double x, double y, double z) {
        final double a = 6378137.0;
        final double f = 1.0 / 298.257222101;
        final double e2 = f * (2 - f);
        double lon = Math.atan2(y, x);
        double p = Math.hypot(x, y);
        double lat = Math.atan2(z, p * (1 - e2));
        double height = 0;
        for (int index = 0; index < 8; index += 1) {
            double sinLat = Math.sin(lat);
            double n = a / Math.sqrt(1 - e2 * sinLat * sinLat);
            height = p / Math.cos(lat) - n;
            lat = Math.atan2(z, p * (1 - e2 * n / (n + height)));
        }
        return new double[]{Math.toDegrees(lat), Math.toDegrees(lon), height};
    }

    public double getLatitudeDeg() {
        double[] solution = lastSolution;
        return solution == null ? Double.NaN
                : ecefToLlh(solution[1], solution[2], solution[3])[0];
    }

    public double getLongitudeDeg() {
        double[] solution = lastSolution;
        return solution == null ? Double.NaN
                : ecefToLlh(solution[1], solution[2], solution[3])[1];
    }
}
