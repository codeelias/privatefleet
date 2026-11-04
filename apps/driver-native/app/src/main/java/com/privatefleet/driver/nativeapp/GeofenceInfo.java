package com.privatefleet.driver.nativeapp;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Pure model for the driver geofence feed. Ring coordinates are stored as
 * [latitude, longitude] pairs for direct use on the map.
 */
public final class GeofenceInfo {
    public final String name;
    public final boolean inside;
    public final List<double[]> ring;

    private GeofenceInfo(String name, boolean inside, List<double[]> ring) {
        this.name = name;
        this.inside = inside;
        this.ring = ring;
    }

    public static List<GeofenceInfo> fromJson(JSONObject json) {
        List<GeofenceInfo> fences = new ArrayList<>();
        JSONArray array = json.optJSONArray("geofences");
        if (array == null) return fences;
        for (int index = 0; index < array.length(); index++) {
            JSONObject fence = array.optJSONObject(index);
            if (fence == null) continue;
            List<double[]> ring = new ArrayList<>();
            try {
                JSONObject geometry = new JSONObject(fence.optString("geojson", "{}"));
                JSONArray coordinates = geometry.optJSONArray("coordinates");
                if (coordinates != null && coordinates.length() > 0) {
                    JSONArray outer = coordinates.optJSONArray(0);
                    if (outer != null) {
                        for (int pointIndex = 0; pointIndex < outer.length(); pointIndex++) {
                            JSONArray point = outer.optJSONArray(pointIndex);
                            if (point != null && point.length() >= 2) {
                                ring.add(new double[]{point.optDouble(1), point.optDouble(0)});
                            }
                        }
                    }
                }
            } catch (Exception ignored) {
            }
            fences.add(new GeofenceInfo(
                    fence.optString("name"),
                    fence.optBoolean("inside", false),
                    ring));
        }
        return fences;
    }
}
