package com.privatefleet.driver.nativeapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

import java.util.List;

public class GeofenceInfoTest {
    @Test
    public void parsesNamesStatesAndRings() throws Exception {
        JSONObject json = new JSONObject()
                .put("geofences", new org.json.JSONArray()
                        .put(new JSONObject()
                                .put("name", "Depot zone")
                                .put("inside", true)
                                .put("geojson", new JSONObject()
                                        .put("type", "Polygon")
                                        .put("coordinates", new org.json.JSONArray()
                                                .put(new org.json.JSONArray()
                                                        .put(new org.json.JSONArray().put(-0.1).put(51.5))
                                                        .put(new org.json.JSONArray().put(-0.11).put(51.5))
                                                        .put(new org.json.JSONArray().put(-0.11).put(51.51))
                                                        .put(new org.json.JSONArray().put(-0.1).put(51.5)))))));
        List<GeofenceInfo> fences = GeofenceInfo.fromJson(json);
        assertEquals(1, fences.size());
        assertEquals("Depot zone", fences.get(0).name);
        assertTrue(fences.get(0).inside);
        assertEquals(4, fences.get(0).ring.size());
        assertEquals(51.5, fences.get(0).ring.get(0)[0], 1e-9);
    }
}
