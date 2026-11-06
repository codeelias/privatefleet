package com.privatefleet.driver.nativeapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class StationaryGateTest {
    @Test
    public void parkedPhoneHoldsPositionAfterTwoStillFixes() {
        StationaryGate gate = new StationaryGate();
        gate.apply(true, 0.4, 8, 0, 51.5001, -0.1201);
        StationaryGate.Result second = gate.apply(true, 0.3, 8, 2.1, 51.5003, -0.1202);
        assertEquals(StationaryGate.State.STATIONARY, second.state);
        assertTrue(second.held);
        // Hold is the fix that triggered the stationary state.
        assertEquals(51.5003, second.latitude, 1e-9);
        assertEquals(-0.1202, second.longitude, 1e-9);
        // A third small jitter must not move the held position.
        StationaryGate.Result third = gate.apply(true, 0.2, 8, 3.0, 51.5006, -0.1204);
        assertTrue(third.held);
        assertEquals(51.5003, third.latitude, 1e-9);
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

    @Test
    public void slowDriftAwayFromTheHoldReleasesItEvenAtZeroSpeed() {
        // Walking/stop-and-go moves read speed 0 and per-sample displacement
        // below the movement threshold - the hold must still release once the
        // live fix drifts far from the held coordinate.
        StationaryGate gate = new StationaryGate();
        gate.apply(true, 0.3, 8, 1, 51.5000, -0.1200);
        StationaryGate.Result still = gate.apply(true, 0.2, 8, 2, 51.5001, -0.1201);
        assertTrue(still.held);
        // Drift ~60 m from the hold, zero speed, tiny per-sample displacement.
        StationaryGate.Result drift = gate.apply(false, 0.0, 8, 3.0, 51.50065, -0.1202);
        assertEquals(StationaryGate.State.STATIONARY, drift.state); // first vote only
        StationaryGate.Result released = gate.apply(false, 0.0, 8, 2.0, 51.50066, -0.12025);
        assertEquals(StationaryGate.State.MOVING, released.state);
        assertFalse(released.held);
        assertEquals(51.50066, released.latitude, 1e-9);
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
    public void displacementMetresIsReasonableForLondon() {
        double metres = StationaryGate.displacementMetres(51.5, -0.12, 51.5, -0.121);
        assertTrue(metres > 55 && metres < 75);
    }
}
