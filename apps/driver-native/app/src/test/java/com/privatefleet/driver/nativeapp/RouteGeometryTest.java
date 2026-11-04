package com.privatefleet.driver.nativeapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

public class RouteGeometryTest {
    @Test
    public void parsesPointsAndStopsFromTheDriverFeed() throws Exception {
        JSONObject json = new JSONObject()
                .put("points", new org.json.JSONArray()
                        .put(new JSONObject().put("latitude", 51.5).put("longitude", -0.1))
                        .put(new JSONObject().put("latitude", 51.51).put("longitude", -0.11)))
                .put("stops", new org.json.JSONArray()
                        .put(new JSONObject()
                                .put("sequence", 1)
                                .put("stopId", "stop-1")
                                .put("jobId", "job-1")
                                .put("reference", "J-100")
                                .put("type", "pickup")
                                .put("status", "pending")
                                .put("address", "Camden")
                                .put("windowEnd", "2026-11-04T12:00:00Z")
                                .put("latitude", 51.5)
                                .put("longitude", -0.1)));
        RouteGeometry geometry = RouteGeometry.fromJson(json);
        assertEquals(2, geometry.points.size());
        assertEquals(51.51, geometry.points.get(1)[0], 1e-9);
        assertEquals(1, geometry.stops.size());
        assertEquals("J-100", geometry.stops.get(0).reference);
        assertEquals("pickup", geometry.stops.get(0).type);
        assertEquals("pending", geometry.stops.get(0).status);
    }

    @Test
    public void emptyFeedProducesEmptyGeometry() {
        RouteGeometry geometry = RouteGeometry.fromJson(new JSONObject());
        assertTrue(geometry.points.isEmpty());
        assertTrue(geometry.stops.isEmpty());
    }
}
