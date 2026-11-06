package com.privatefleet.driver.nativeapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Random;

import org.junit.Test;

public class StationaryGateTest {
    @Test
    public void parkedPhoneHoldsPositionAfterTwoStillFixes() {
        StationaryGate gate = new StationaryGate();
        gate.apply(true, 0.4, 8, 0, 51.5001, -0.1201);
        StationaryGate.Result second = gate.apply(true, 0.3, 8, 2.1, 51.5003, -0.1202);
        assertEquals(StationaryGate.State.STATIONARY, second.state);
        assertTrue(second.held);
        assertEquals(51.5003, second.latitude, 1e-9);
        assertEquals(-0.1202, second.longitude, 1e-9);
        // Equal-accuracy contained jitter must not churn the hold.
        StationaryGate.Result third = gate.apply(true, 0.2, 8, 3.0, 51.50033, -0.12022);
        assertTrue(third.held);
        assertEquals(51.5003, third.latitude, 1e-9);
    }

    @Test
    public void aStrictlyBetterFixIsAdoptedEvenBeyondTheOldScatterBound() {
        // Regression for the 2026-11-06 incident: a 34 m hold must yield to an
        // 11 m fix of the same (contained) place, so the map never sticks to
        // the first, coarser measurement.
        StationaryGate gate = new StationaryGate();
        gate.apply(true, 0.3, 34, 1, 51.5000, -0.1200);
        StationaryGate.Result held = gate.apply(true, 0.2, 34, 2, 51.5001, -0.1201);
        assertTrue(held.held);
        assertEquals(34.0, held.accuracy, 1e-9);
        // ~25 m away, strictly better: adopted.
        StationaryGate.Result adopted = gate.apply(true, 0.2, 11, 3, 51.50028, -0.12015);
        assertTrue(adopted.held);
        assertEquals(11.0, adopted.accuracy, 1e-9);
        assertEquals(51.50028, adopted.latitude, 1e-9);
    }

    @Test
    public void sustainedMotionReleasesTheHold() {
        StationaryGate gate = new StationaryGate();
        gate.apply(true, 0.3, 8, 1, 51.5, -0.12);
        StationaryGate.Result still = gate.apply(true, 0.2, 8, 2, 51.5001, -0.1201);
        assertTrue(still.held);
        StationaryGate.Result move1 = gate.apply(true, 4.0, 8, 28, 51.5025, -0.1225);
        assertEquals(StationaryGate.State.STATIONARY, move1.state);
        StationaryGate.Result move2 = gate.apply(true, 4.1, 8, 31, 51.5050, -0.1250);
        assertEquals(StationaryGate.State.MOVING, move2.state);
        assertFalse(move2.held);
        assertEquals(51.5050, move2.latitude, 1e-9);
    }

    @Test
    public void slowDriftBeyondContainmentReleasesTheHoldEvenAtZeroSpeed() {
        StationaryGate gate = new StationaryGate();
        gate.apply(true, 0.3, 8, 1, 51.5000, -0.1200);
        StationaryGate.Result still = gate.apply(true, 0.2, 8, 2, 51.5001, -0.1201);
        assertTrue(still.held);
        // Containment for two 8 m fixes is 16 m: 60 m drift is elsewhere.
        StationaryGate.Result drift = gate.apply(false, 0.0, 8, 3.0, 51.50065, -0.1202);
        assertEquals(StationaryGate.State.STATIONARY, drift.state); // first vote only
        StationaryGate.Result released = gate.apply(false, 0.0, 8, 2.0, 51.50066, -0.12025);
        assertEquals(StationaryGate.State.MOVING, released.state);
        assertFalse(released.held);
        assertEquals(51.50066, released.latitude, 1e-9);
    }

    @Test
    public void containmentIsCappedAtTheDocumentedMaximumLatch() {
        // Two 100 m fixes 80 m apart: uncapped uncertainty would allow a 200 m
        // latch. The cap forces the release.
        StationaryGate gate = new StationaryGate();
        gate.apply(false, 0.0, 100, 1, 51.5000, -0.1200);
        StationaryGate.Result held = gate.apply(false, 0.0, 100, 2, 51.5001, -0.1201);
        assertTrue(held.held);
        StationaryGate.Result far1 = gate.apply(false, 0.0, 100, 2, 51.5008, -0.1202);
        assertEquals(StationaryGate.State.STATIONARY, far1.state); // first vote
        StationaryGate.Result far2 = gate.apply(false, 0.0, 100, 2, 51.5009, -0.1203);
        assertEquals(StationaryGate.State.MOVING, far2.state);
        assertFalse(far2.held);
    }

    @Test
    public void smallScatterWithinTheHoldNeverReleases() {
        StationaryGate gate = new StationaryGate();
        gate.apply(true, 0.3, 8, 1, 51.5000, -0.1200);
        StationaryGate.Result still = gate.apply(true, 0.2, 8, 2, 51.5001, -0.1201);
        assertTrue(still.held);
        for (int i = 0; i < 5; i++) {
            StationaryGate.Result sample = gate.apply(true, 0.2, 8, 4.0, 51.50012, -0.12014);
            assertEquals(StationaryGate.State.STATIONARY, sample.state);
            assertTrue(sample.held);
        }
    }

    @Test
    public void largeJumpIsTreatedAsMovementEvenWithoutSpeed() {
        StationaryGate gate = new StationaryGate();
        gate.apply(false, 0, 8, 1, 51.5, -0.12);
        gate.apply(false, 0, 8, 2, 51.5001, -0.1201);
        StationaryGate.Result jump1 = gate.apply(false, 0, 8, 60, 51.5060, -0.1260);
        assertEquals(StationaryGate.State.STATIONARY, jump1.state); // hysteresis: one vote
        StationaryGate.Result jump2 = gate.apply(false, 0, 8, 55, 51.5110, -0.1310);
        assertEquals(StationaryGate.State.MOVING, jump2.state);
        assertFalse(jump2.held);
    }

    /**
     * ARCHITECTURAL INVARIANT (property test): whenever the gate emits a held
     * position, that position is never farther from the live fix than the
     * combined uncertainty of the two measurements (capped). This pins the
     * honesty contract so a regression fails the suite instead of a driver.
     */
    @Test
    public void emittedHeldPositionAlwaysContainsTheLiveFix() {
        Random random = new Random(20261106L);
        for (int trial = 0; trial < 50; trial++) {
            StationaryGate gate = new StationaryGate();
            double lat = 51.5;
            double lng = -0.12;
            for (int step = 0; step < 60; step++) {
                float accuracy = 5 + random.nextFloat() * 95; // 5..100 m
                double dLat = (random.nextDouble() - 0.5) * 0.004; // <= ~220 m
                double dLng = (random.nextDouble() - 0.5) * 0.004;
                double speed = random.nextDouble() < 0.15 ? 0.0 : random.nextDouble() * 6;
                lat = 51.5 + dLat;
                lng = -0.12 + dLng;
                double stepDist = random.nextDouble() * 30;
                StationaryGate.Result result = gate.apply(true, speed, accuracy, stepDist, lat, lng);
                if (result.held) {
                    double emittedDistance =
                        StationaryGate.displacementMetres(result.latitude, result.longitude, lat, lng);
                    double allowed = Math.min(result.accuracy + accuracy, StationaryGate.HOLD_MAX_LATCH_M);
                    assertTrue(
                        "trial " + trial + " step " + step + ": emitted " + emittedDistance
                            + " m from live fix, allowed " + allowed + " m",
                        emittedDistance <= allowed + 0.5);
                }
            }
        }
    }

    @Test
    public void displacementMetresIsReasonableForLondon() {
        double metres = StationaryGate.displacementMetres(51.5, -0.12, 51.5, -0.121);
        assertTrue(metres > 55 && metres < 75);
    }
}
