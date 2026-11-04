package com.privatefleet.driver.nativeapp;

import java.util.List;

/**
 * Pure route-progress mathematics: project a position onto the route line,
 * find the next incomplete stop, and derive remaining distance and ETA.
 * Unit-tested; no Android dependencies.
 */
public final class RouteProgress {

    public static final class Result {
        public final RouteGeometry.Stop nextStop;
        public final double remainingMetres;
        public final long etaMillis;
        public final int remainingStops;
        public final int firstIncompleteIndex;

        Result(RouteGeometry.Stop nextStop, double remainingMetres, long etaMillis,
               int remainingStops, int firstIncompleteIndex) {
            this.nextStop = nextStop;
            this.remainingMetres = remainingMetres;
            this.etaMillis = etaMillis;
            this.remainingStops = remainingStops;
            this.firstIncompleteIndex = firstIncompleteIndex;
        }
    }

    private static final double ASSUMED_SPEED_MPS = 7.0;

    /** Distance (metres) along the polyline from the start. */
    public static double[] cumulative(List<double[]> points) {
        double[] distances = new double[points.size()];
        for (int index = 1; index < points.size(); index++) {
            distances[index] = distances[index - 1]
                    + distance(points.get(index - 1), points.get(index));
        }
        return distances;
    }

    /** Nearest position on the polyline to (lat, lon); returns distance along the line. */
    public static double project(double lat, double lon, List<double[]> points, double[] cumulative) {
        if (points.size() < 2) return 0;
        double best = Double.MAX_VALUE;
        double bestAlong = 0;
        for (int index = 1; index < points.size(); index++) {
            double[] a = points.get(index - 1);
            double[] b = points.get(index);
            double[] projection = projectToSegment(lat, lon, a, b);
            double d = distance(new double[]{lat, lon}, projection);
            if (d < best) {
                best = d;
                double along = cumulative[index - 1] + distance(a, projection);
                bestAlong = along;
            }
        }
        return bestAlong;
    }

    /** Nearest point index on the polyline to the given stop. */
    public static int nearestIndex(double lat, double lon, List<double[]> points) {
        int best = 0;
        double bestDistance = Double.MAX_VALUE;
        for (int index = 0; index < points.size(); index++) {
            double d = distance(points.get(index), new double[]{lat, lon});
            if (d < bestDistance) {
                bestDistance = d;
                best = index;
            }
        }
        return best;
    }

    public static Result compute(RouteGeometry geometry, double driverLat, double driverLon, long nowMs) {
        if (geometry.points.size() < 2 || geometry.stops.isEmpty()) {
            return null;
        }
        int firstIncomplete = -1;
        int remainingStops = 0;
        for (int index = 0; index < geometry.stops.size(); index++) {
            RouteGeometry.Stop stop = geometry.stops.get(index);
            boolean done = "completed".equals(stop.status)
                    || "skipped".equals(stop.status)
                    || "failed".equals(stop.status);
            if (!done) {
                remainingStops += 1;
                if (firstIncomplete == -1) firstIncomplete = index;
            }
        }
        RouteGeometry.Stop nextStop = firstIncomplete >= 0
                ? geometry.stops.get(firstIncomplete)
                : geometry.stops.get(geometry.stops.size() - 1);

        double[] cumulative = cumulative(geometry.points);
        double alongDriver = project(driverLat, driverLon, geometry.points, cumulative);
        int nextIndex = nearestIndex(nextStop.latitude, nextStop.longitude, geometry.points);
        double alongNext = cumulative[nextIndex];
        double remaining = Math.max(0, alongNext - alongDriver);

        long etaMillis;
        if (nextStop.arrivalAt != null && !nextStop.arrivalAt.isEmpty()) {
            try {
                etaMillis = java.time.Instant.parse(nextStop.arrivalAt).toEpochMilli();
            } catch (Exception ignored) {
                etaMillis = nowMs + Math.round(remaining / ASSUMED_SPEED_MPS * 1000);
            }
        } else {
            etaMillis = nowMs + Math.round(remaining / ASSUMED_SPEED_MPS * 1000);
        }

        return new Result(nextStop, remaining, etaMillis, remainingStops, firstIncomplete);
    }

    private static double[] projectToSegment(double lat, double lon, double[] a, double[] b) {
        double ax = a[1];
        double ay = a[0];
        double bx = b[1];
        double by = b[0];
        double px = lon;
        double py = lat;
        double dx = bx - ax;
        double dy = by - ay;
        double lengthSquared = dx * dx + dy * dy;
        if (lengthSquared == 0) return new double[]{a[0], a[1]};
        double t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
        t = Math.max(0, Math.min(1, t));
        return new double[]{ay + t * dy, ax + t * dx};
    }

    private static double distance(double[] a, double[] b) {
        double dLat = (b[0] - a[0]) * 110_540;
        double dLng = (b[1] - a[1]) * 111_320 * Math.cos(Math.toRadians((a[0] + b[0]) / 2));
        return Math.hypot(dLat, dLng);
    }
}
