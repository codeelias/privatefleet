package com.privatefleet.driver.nativeapp;

/**
 * Precision state machine. RAW_READY and CORRECTIONS_READY are achievable by
 * the current client; RTK_FLOAT and RTK_FIXED are reserved for the solver and
 * can only be produced by an actual ambiguity resolution, never by this class.
 */
public final class PrecisionState {
    public enum Level {
        UNSUPPORTED,
        RAW_READY,
        CORRECTIONS_READY,
        RTK_FLOAT,
        RTK_FIXED
    }

    private PrecisionState() {
    }

    public static Level evaluate(
            int satellitesUsed,
            boolean dualFrequency,
            boolean carrierPhase,
            boolean correctionsConnected,
            long correctionAgeMs,
            boolean solverFloat,
            boolean solverFixed
    ) {
        if (solverFixed) return Level.RTK_FIXED;
        if (solverFloat) return Level.RTK_FLOAT;
        if (satellitesUsed > 0) {
            if (correctionsConnected && correctionAgeMs < 5_000L) {
                return Level.CORRECTIONS_READY;
            }
            return Level.RAW_READY;
        }
        return Level.UNSUPPORTED;
    }

    public static String contract(Level level) {
        switch (level) {
            case RTK_FIXED:
                return "rtk_fixed";
            case RTK_FLOAT:
                return "rtk_float";
            case CORRECTIONS_READY:
                return "corrections_ready";
            case RAW_READY:
                return "raw_ready";
            default:
                return "unsupported";
        }
    }
}
