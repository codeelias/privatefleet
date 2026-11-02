package com.privatefleet.driver.nativeapp;

/**
 * Default solver: no RTK engine is linked, so neither float nor fixed can be
 * reported. This keeps every precision claim honest until a native solver is
 * integrated and validated.
 */
final class NoRtkSolver implements RtkSolver {
    @Override
    public boolean hasFloatSolution() {
        return false;
    }

    @Override
    public boolean hasFixedSolution() {
        return false;
    }

    @Override
    public double positionUncertaintyMetres() {
        return Double.POSITIVE_INFINITY;
    }
}
