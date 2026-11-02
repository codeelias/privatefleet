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
        return Math.sqrt(Math.max(0, Math.max(covariance[0][0], covariance[1][1])));
    }

    /**
     * Constant-velocity prediction. IMU acceleration is deliberately NOT
     * integrated into position: consumer-grade accelerometer noise was the
     * source of the rumble. The velocity is damped so the state decays toward
     * the next GNSS fix instead of extrapolating drift.
     */
    void predict(double dtSeconds, double accelerationEast, double accelerationNorth) {
        if (!initialized) return;
        double dt = Math.max(0, Math.min(0.5, dtSeconds));
        if (dt == 0) return;
        double speed = Math.hypot(state[2], state[3]);
        double damping = speed < 0.5 ? 0.5 : (speed < 1.0 ? 0.85 : 1.0);
        state[2] *= damping;
        state[3] *= damping;
        state[0] += state[2] * dt;
        state[1] += state[3] * dt;

        // P = F P F^T with F = [I dtI; 0 I], computed as a general matrix
        // product so the cross-terms stay correct.
        double[][] f = {
                {1, 0, dt, 0},
                {0, 1, 0, dt},
                {0, 0, 1, 0},
                {0, 0, 0, 1},
        };
        double[][] fp = multiply(f, covariance);
        double[][] next = multiplyTransposed(fp, f);
        double qPosition = 0.4 * dt * dt;
        double qVelocity = 0.8 * dt;
        next[0][0] += qPosition;
        next[1][1] += qPosition;
        next[2][2] += qVelocity;
        next[3][3] += qVelocity;
        symmetrize(next);
        for (int row = 0; row < 4; row += 1) {
            System.arraycopy(next[row], 0, covariance[row], 0, 4);
        }
    }

    /**
     * Hard-correct to the GNSS position and zero velocity. Used when the
     * vehicle is stationary or a fix is outside the innovation gate, so the
     * filtered output can never be worse than the raw GNSS fix itself.
     */
    void snapPosition(double east, double north, double accuracyMetres) {
        if (!initialized) {
            initialize(east, north, 0, 0, accuracyMetres);
            return;
        }
        state[0] = east;
        state[1] = north;
        state[2] = 0;
        state[3] = 0;
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
    }

    private static double[][] multiply(double[][] left, double[][] right) {
        double[][] result = new double[4][4];
        for (int row = 0; row < 4; row += 1) {
            for (int column = 0; column < 4; column += 1) {
                double value = 0;
                for (int k = 0; k < 4; k += 1) {
                    value += left[row][k] * right[k][column];
                }
                result[row][column] = value;
            }
        }
        return result;
    }

    private static double[][] multiplyTransposed(double[][] left, double[][] right) {
        double[][] result = new double[4][4];
        for (int row = 0; row < 4; row += 1) {
            for (int column = 0; column < 4; column += 1) {
                double value = 0;
                for (int k = 0; k < 4; k += 1) {
                    value += left[row][k] * right[column][k];
                }
                result[row][column] = value;
            }
        }
        return result;
    }

    private static void symmetrize(double[][] matrix) {
        for (int row = 0; row < 4; row += 1) {
            for (int column = row + 1; column < 4; column += 1) {
                double average = (matrix[row][column] + matrix[column][row]) / 2;
                matrix[row][column] = average;
                matrix[column][row] = average;
            }
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
        symmetrize(next);
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

    double covariance(int row, int column) {
        return covariance[row][column];
    }

    double state(int index) {
        return state[index];
    }
}
