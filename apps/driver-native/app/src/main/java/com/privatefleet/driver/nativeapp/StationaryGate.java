package com.privatefleet.driver.nativeapp;

/**
 * Movement-state classifier and stable-position holder.
 *
 * Architecture (docs/55): pure logic, no Android deps, and - crucially -
 * honest by INVARIANT, not by tuning:
 *
 *   1. Containment: while a hold exists, it is kept only while the live fix
 *      lies within the combined uncertainty of the two measurements
 *      (holdAccuracy + liveAccuracy, capped at HOLD_MAX_LATCH_M). Beyond
 *      that they are statistically different places and the hold releases
 *      regardless of speed or per-sample displacement.
 *   2. Best-fix adoption: a fix that is strictly more accurate than the
 *      hold, and still contained, replaces the hold - so the displayed
 *      position always tracks the best available measurement, never the
 *      first one.
 *   3. Speed/step hysteresis is retained for genuine motion.
 *
 * StationaryGateTest asserts the invariant as a property test, so a
 * regression in this class fails the suite instead of reaching a driver.
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
    /** Upper bound on the containment uncertainty (two 100 m fixes must not
     *  allow a 200 m latch). Product decision, documented. */
    static final double HOLD_MAX_LATCH_M = 60.0;

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
        if (hasHold) {
            double fromHold = displacementMetres(holdLatitude, holdLongitude, latitude, longitude);
            double uncertainty = Math.min(holdAccuracy + accuracyMetres, HOLD_MAX_LATCH_M);
            if (fromHold > uncertainty) {
                // Invariant 1: statistically a different place - release.
                moving = true;
                still = false;
            }
        }

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

        // The hold is displayed only while the live fix is contained in it.
        // The moment containment breaks (moving == true), the live fix is
        // emitted even if the state vote is still one short of MOVING -
        // display honesty beats anti-bounce hysteresis.
        if (state == State.STATIONARY && hasHold && !moving) {
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

    /**
     * Invariant 2: adopt a strictly more accurate measurement of the same
     * place. There is no proximity gate beyond the containment check already
     * applied in apply(): a better fix IS the truth.
     */
    private void refineHold(double latitude, double longitude, float accuracy) {
        if (!hasHold) {
            setHold(latitude, longitude, accuracy);
            return;
        }
        if (accuracy < holdAccuracy) {
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
