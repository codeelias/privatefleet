package com.privatefleet.driver.nativeapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class Ekf2DTest {
    @Test
    public void repeatedGnssUpdatesConvergeToMeasurement() {
        Ekf2D filter = new Ekf2D();
        filter.initialize(0, 0, 0, 0, 20);
        for (int index = 0; index < 20; index += 1) {
            filter.updatePosition(12.0, -7.0, 4.0);
        }
        assertEquals(12.0, filter.east(), 0.2);
        assertEquals(-7.0, filter.north(), 0.2);
        assertTrue(filter.accuracyMetres() < 4.0);
    }

    @Test
    public void covarianceGrowsWhilePredictingWithoutGnssAndStaysFinite() {
        Ekf2D filter = new Ekf2D();
        filter.initialize(0, 0, 0, 0, 5);
        double before = filter.accuracyMetres();
        for (int index = 0; index < 50; index += 1) {
            filter.predict(0.1, 0.2, 0.1);
        }
        double after = filter.accuracyMetres();
        assertTrue(after > before);
        assertTrue(Double.isFinite(after));
    }

    @Test
    public void velocityPredictionMovesPositionAndKeepsCovarianceSane() {
        Ekf2D filter = new Ekf2D();
        filter.initialize(0, 0, 2, 0, 5);
        for (int index = 0; index < 10; index += 1) {
            filter.predict(0.1, 0, 0);
        }
        assertEquals(2.0, filter.east(), 0.05);
        assertTrue(Double.isFinite(filter.accuracyMetres()));
    }

    @Test
    public void zeroVelocityNoiseDoesNotDriftWhileStationary() {
        Ekf2D filter = new Ekf2D();
        filter.initialize(100, 100, 0, 0, 3);
        for (int index = 0; index < 200; index += 1) {
            filter.predict(0.05, 0.05, -0.05);
        }
        assertEquals(100, filter.east(), 0.4);
        assertEquals(100, filter.north(), 0.4);
    }
}
