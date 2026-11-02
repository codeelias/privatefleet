package com.privatefleet.driver.nativeapp;

/**
 * RTK solver boundary. The current client ships {@link NoRtkSolver} because no
 * ambiguity-fixed engine is integrated yet. A future RTKLIB/PPP native bridge
 * must implement this interface and only then may telemetry reach RTK_FLOAT or
 * RTK_FIXED.
 */
public interface RtkSolver {
    boolean hasFloatSolution();

    boolean hasFixedSolution();

    double positionUncertaintyMetres();
}
