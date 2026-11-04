package com.privatefleet.driver.nativeapp;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Pure model for the driver route map feed. No Android dependencies, so the
 * parsing is unit-testable.
 */
public final class RouteGeometry {

    public static final class Stop {
        public final int sequence;
        public final String stopId;
        public final String jobId;
        public final String reference;
        public final String type;
        public final String status;
        public final String address;
        public final String windowEnd;
        public final String arrivalAt;
        public final Integer legDistanceM;
        public final double latitude;
        public final double longitude;

        Stop(int sequence, String stopId, String jobId, String reference, String type,
             String status, String address, String windowEnd, String arrivalAt,
             Integer legDistanceM, double latitude, double longitude) {
            this.sequence = sequence;
            this.stopId = stopId;
            this.jobId = jobId;
            this.reference = reference;
            this.type = type;
            this.status = status;
            this.address = address;
            this.windowEnd = windowEnd;
            this.arrivalAt = arrivalAt;
            this.legDistanceM = legDistanceM;
            this.latitude = latitude;
            this.longitude = longitude;
        }
    }

    public final List<double[]> points; // [latitude, longitude]
    public final List<Stop> stops;

    RouteGeometry(List<double[]> points, List<Stop> stops) {
        this.points = points;
        this.stops = stops;
    }

    /** Parse the /v1/driver/route-geometry response. */
    public static RouteGeometry fromJson(JSONObject json) {
        List<double[]> points = new ArrayList<>();
        JSONArray pointArray = json.optJSONArray("points");
        if (pointArray != null) {
            for (int index = 0; index < pointArray.length(); index++) {
                JSONObject point = pointArray.optJSONObject(index);
                if (point != null) {
                    points.add(new double[]{point.optDouble("latitude"), point.optDouble("longitude")});
                }
            }
        }
        List<Stop> stops = new ArrayList<>();
        JSONArray stopArray = json.optJSONArray("stops");
        if (stopArray != null) {
            for (int index = 0; index < stopArray.length(); index++) {
                JSONObject stop = stopArray.optJSONObject(index);
                if (stop == null) continue;
                stops.add(new Stop(
                        stop.optInt("sequence", index + 1),
                        stop.optString("stopId"),
                        stop.optString("jobId"),
                        stop.optString("reference"),
                        stop.optString("type"),
                        stop.optString("status"),
                        stop.optString("address"),
                        stop.optString("windowEnd", ""),
                        stop.optString("arrivalAt", ""),
                        stop.has("legDistanceM") ? (Integer) stop.optInt("legDistanceM") : null,
                        stop.optDouble("latitude"),
                        stop.optDouble("longitude")));
            }
        }
        return new RouteGeometry(points, stops);
    }

    /** Empty result for drivers without a published route. */
    public static RouteGeometry empty() {
        return new RouteGeometry(new ArrayList<>(), new ArrayList<>());
    }
}
