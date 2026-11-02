package com.privatefleet.driver.nativeapp;

/**
 * Pure 2D constant-velocity EKF: ENU position/velocity with scalar GNSS
 * position corrections and velocity updates. Extracted from the Android
 * engine so the filter math can be unit-tested on the JVM.
 */
final class Ekf2D {
    private final double[] state = new double[4]; // east, north, vEast, vNorth
    private final double[][] covariance = new double[4][4];
    private boolean initialized = false;

    void initialize(double east, double north, double vEast, double vNorth, double accuracyMetres) {
        state[0] = east;
        state[1] = north;
        state[2] = vEast;
        state[3] = vNorth;
        for (int row = 0; row < 4; row += 1) {
            for (int column = 0; column < 4; column += 1) {
                covariance[row][column] = 0;
            }
        }
        double variance = Math.max(1, accuracyMetres * accuracyMetres);
        covariance[0][0] = variance;
        covariance[1][1] = variance;
        covariance[2][2] = 4;
        covariance[3][3] = 4;
        initialized = true;
    }

    boolean isInitialized() {
        return initialized;
    }

    double east() {
        return state[0];
    }

    double north() {
        return state[1];
    }

    double velocityEast() {
        return state[2];
    }

    double velocityNorth() {
        return state[3];
    }

    double accuracyMetres() {
        return Math.sqrt(Math.max(0, covariance[0][0] + covariance[1][1]));
    }

    void predict(double dtSeconds, double accelerationEast, double accelerationNorth) {
        if (!initialized) return;
        double dt = Math.max(0, Math.min(0.5, dtSeconds));
        if (dt == 0) return;
        double ax = Math.max(-8, Math.min(8, accelerationEast));
        double ay = Math.max(-8, Math.min(8, accelerationNorth));
        double speed = Math.hypot(state[2], state[3]);
        if (speed < 0.6 && Math.hypot(ax, ay) < 0.35) {
            state[2] *= 0.96;
            state[3] *= 0.96;
            ax = 0;
            ay = 0;
        } else {
            state[2] += ax * dt;
            state[3] += ay * dt;
        }
        state[0] += state[2] * dt + 0.5 * ax * dt * dt;
        state[1] += state[3] * dt + 0.5 * ay * dt * dt;

        double[][] next = new double[4][4];
        for (int row = 0; row < 4; row += 1) {
            for (int column = 0; column < 4; column += 1) {
                // F P F^T with F = [I dtI; 0 I], computed directly.
                double value = covariance[row][column];
                if (row < 2 && column >= 2) value += dt * covariance[row][column];
                if (row >= 2 && column < 2) value += dt * covariance[row][column];
                if (row >= 2 && column >= 2) value += dt * dt * covariance[row - 2][column - 2]
                        + dt * covariance[row][column - 2]
                        + dt * covariance[row - 2][column];
                next[row][column] = value;
            }
        }
        double qPosition = 0.8 * dt * dt;
        double qVelocity = 1.2 * dt;
        next[0][0] += qPosition;
        next[1][1] += qPosition;
        next[2][2] += qVelocity;
        next[3][3] += qVelocity;
        for (int row = 0; row < 4; row += 1) {
            System.arraycopy(next[row], 0, covariance[row], 0, 4);
        }
    }

    void updatePosition(double measuredEast, double measuredNorth, double accuracyMetres) {
        if (!initialized) return;
        double variance = Math.max(1, accuracyMetres * accuracyMetres);
        double[][] h = {{1, 0, 0, 0}, {0, 1, 0, 0}};
        double[][] phT = new double[4][2];
        for (int row = 0; row < 4; row += 1) {
            for (int column = 0; column < 2; column += 1) {
                double value = 0;
                for (int k = 0; k < 4; k += 1) value += covariance[row][k] * h[column][k];
                phT[row][column] = value;
            }
        }
        double[][] s = new double[2][2];
        for (int row = 0; row < 2; row += 1) {
            for (int column = 0; column < 2; column += 1) {
                double value = 0;
                for (int k = 0; k < 4; k += 1) value += h[row][k] * phT[k][column];
                s[row][column] = value;
            }
        }
        s[0][0] += variance;
        s[1][1] += variance;
        double det = s[0][0] * s[1][1] - s[0][1] * s[1][0];
        if (Math.abs(det) < 1e-9) return;
        double[][] sInv = {
                {s[1][1] / det, -s[0][1] / det},
                {-s[1][0] / det, s[0][0] / det},
        };
        double[][] k = new double[4][2];
        for (int row = 0; row < 4; row += 1) {
            for (int column = 0; column < 2; column += 1) {
                double value = 0;
                for (int j = 0; j < 2; j += 1) value += phT[row][j] * sInv[j][column];
                k[row][column] = value;
            }
        }
        double innovationEast = measuredEast - state[0];
        double innovationNorth = measuredNorth - state[1];
        for (int row = 0; row < 4; row += 1) {
            state[row] += k[row][0] * innovationEast + k[row][1] * innovationNorth;
        }
        double[][] iMinusKh = new double[4][4];
        for (int row = 0; row < 4; row += 1) {
            for (int column = 0; column < 4; column += 1) {
                double hk = 0;
                for (int j = 0; j < 2; j += 1) hk += k[row][j] * h[j][column];
                iMinusKh[row][column] = (row == column ? 1 : 0) - hk;
            }
        }
        double[][] next = new double[4][4];
        for (int row = 0; row < 4; row += 1) {
            for (int column = 0; column < 4; column += 1) {
                double value = 0;
                for (int a = 0; a < 4; a += 1) {
                    for (int b = 0; b < 4; b += 1) {
                        value += iMinusKh[row][a] * covariance[a][b] * iMinusKh[column][b];
                    }
                }
                value += k[row][0] * variance * k[column][0]
                        + k[row][1] * variance * k[column][1];
                next[row][column] = value;
            }
        }
        for (int row = 0; row < 4; row += 1) {
            System.arraycopy(next[row], 0, covariance[row], 0, 4);
        }
    }

    void updateVelocity(double measuredEast, double measuredNorth, double accuracyMetres) {
        if (!initialized) return;
        double variance = Math.max(1, accuracyMetres * accuracyMetres);
        double kEast = covariance[2][2] / (covariance[2][2] + variance);
        double kNorth = covariance[3][3] / (covariance[3][3] + variance);
        state[2] += kEast * (measuredEast - state[2]);
        state[3] += kNorth * (measuredNorth - state[3]);
        covariance[2][2] *= (1 - kEast);
        covariance[3][3] *= (1 - kNorth);
    }
}
