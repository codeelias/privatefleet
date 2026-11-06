package com.privatefleet.driver.nativeapp;

/**
 * Movement-state classifier and stable-position holder.
 *
 * Pure logic, no filtering math: it decides whether the vehicle is
 * STATIONARY, MOVING or UNKNOWN from speed, displacement and accuracy, with
 * hysteresis, and holds the displayed position while stationary so the pin
 * does not dance with GPS scatter. Position honesty is preserved: the held
 * coordinate is a real measurement with its own accuracy, never fabricated.
 */
public final class StationaryGate {
    public enum State {
        UNKNOWN("unknown"),
        STATIONARY("stationary"),
        MOVING("moving");

        private final String contract;

        State(String contract) {
            this.contract = contract;
        }

        public String contract() {
            return contract;
        }
    }

    public static final class Result {
        public final double latitude;
        public final double longitude;
        public final float accuracy;
        public final State state;
        public final boolean held;

        Result(double latitude, double longitude, float accuracy, State state, boolean held) {
            this.latitude = latitude;
            this.longitude = longitude;
            this.accuracy = accuracy;
            this.state = state;
            this.held = held;
        }
    }

    private static final int VOTES_TO_SWITCH = 2;
    private static final double SPEED_MOVING_MPS = 2.5;
    private static final double SPEED_STILL_MPS = 1.0;
    private static final double HOLD_REFINE_M = 15.0;
    /**
     * The hold must smooth scatter, never latch a stale position: if the live
     * fix drifts further than this from the held coordinate (scaled by the
     * hold's own accuracy), the gate releases to MOVING regardless of the
     * per-sample speed - slow moves (walking, stop-and-go) read speed 0 and
     * would otherwise hold the previous location forever.
     */
    private static final double HOLD_RELEASE_MIN_M = 40.0;

    private State state = State.UNKNOWN;
    private int stillVotes = 0;
    private int moveVotes = 0;
    private boolean hasHold = false;
    private double holdLatitude;
    private double holdLongitude;
    private float holdAccuracy;

    public Result apply(boolean hasSpeed, double speedMps, double accuracyMetres,
                        double displacementMetres, double latitude, double longitude) {
        double small = Math.max(accuracyMetres, 10.0);
        double large = Math.max(2 * accuracyMetres, 25.0);
        boolean still = (!hasSpeed || speedMps <= SPEED_STILL_MPS) && displacementMetres <= small;
        boolean moving = (hasSpeed && speedMps >= SPEED_MOVING_MPS) || displacementMetres > large;
        boolean driftFromHold =
                hasHold && displacementMetres(holdLatitude, holdLongitude, latitude, longitude)
                    > Math.max(3 * holdAccuracy, HOLD_RELEASE_MIN_M);
        moving = moving || driftFromHold;
        still = still && !driftFromHold;

        stillVotes = still ? stillVotes + 1 : 0;
        moveVotes = moving ? moveVotes + 1 : 0;

        switch (state) {
            case UNKNOWN:
                if (moveVotes >= VOTES_TO_SWITCH) {
                    state = State.MOVING;
                    hasHold = false;
                } else if (stillVotes >= VOTES_TO_SWITCH) {
                    state = State.STATIONARY;
                    setHold(latitude, longitude, (float) accuracyMetres);
                }
                break;
            case STATIONARY:
                if (moveVotes >= VOTES_TO_SWITCH) {
                    state = State.MOVING;
                    hasHold = false;
                } else {
                    refineHold(latitude, longitude, (float) accuracyMetres);
                }
                break;
            case MOVING:
                if (stillVotes >= VOTES_TO_SWITCH) {
                    state = State.STATIONARY;
                    setHold(latitude, longitude, (float) accuracyMetres);
                }
                break;
            default:
                break;
        }

        if (state == State.STATIONARY && hasHold) {
            return new Result(holdLatitude, holdLongitude, holdAccuracy, state, true);
        }
        return new Result(latitude, longitude, (float) accuracyMetres, state, false);
    }

    private void setHold(double latitude, double longitude, float accuracy) {
        holdLatitude = latitude;
        holdLongitude = longitude;
        holdAccuracy = accuracy;
        hasHold = true;
    }

    private void refineHold(double latitude, double longitude, float accuracy) {
        if (!hasHold) {
            setHold(latitude, longitude, accuracy);
            return;
        }
        double metres = displacementMetres(holdLatitude, holdLongitude, latitude, longitude);
        if (metres <= HOLD_REFINE_M && accuracy < holdAccuracy * 0.8) {
            setHold(latitude, longitude, accuracy);
        }
    }

    static double displacementMetres(double lat1, double lng1, double lat2, double lng2) {
        double lat = Math.toRadians((lat1 + lat2) / 2);
        double dx = (lng2 - lng1) * 111_320.0 * Math.cos(lat);
        double dy = (lat2 - lat1) * 110_540.0;
        return Math.hypot(dx, dy);
    }

    public State state() {
        return state;
    }
}
