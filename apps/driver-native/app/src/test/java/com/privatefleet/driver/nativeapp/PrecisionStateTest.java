package com.privatefleet.driver.nativeapp;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class PrecisionStateTest {
    @Test
    public void noSatellitesIsUnsupported() {
        assertEquals(PrecisionState.Level.UNSUPPORTED,
                PrecisionState.evaluate(0, false, false, false, Long.MAX_VALUE, false, false));
    }

    @Test
    public void satellitesWithoutCorrectionsAreRawReady() {
        assertEquals(PrecisionState.Level.RAW_READY,
                PrecisionState.evaluate(12, true, true, false, Long.MAX_VALUE, false, false));
    }

    @Test
    public void freshCorrectionsPromoteToCorrectionsReady() {
        assertEquals(PrecisionState.Level.CORRECTIONS_READY,
                PrecisionState.evaluate(12, true, true, true, 800L, false, false));
    }

    @Test
    public void solverStatesAreNeverPromotedWithoutASolver() {
        assertEquals(PrecisionState.Level.RTK_FLOAT,
                PrecisionState.evaluate(12, true, true, true, 800L, true, false));
        assertEquals(PrecisionState.Level.RTK_FIXED,
                PrecisionState.evaluate(12, true, true, true, 800L, false, true));
    }
}
