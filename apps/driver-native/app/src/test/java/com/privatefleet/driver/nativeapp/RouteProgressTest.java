package com.privatefleet.driver.nativeapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.json.JSONObject;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

public class RouteProgressTest {
    private RouteGeometry geometryWith(String firstStatus, String secondStatus) {
        List<double[]> points = new ArrayList<>();
        points.add(new double[]{51.5, -0.10});
        points.add(new double[]{51.5, -0.11});
        points.add(new double[]{51.51, -0.11});
        List<RouteGeometry.Stop> stops = new ArrayList<>();
        stops.add(new RouteGeometry.Stop(1, "s1", "j1", "J-1", "pickup", firstStatus,
                "A", "", "", 200, 51.5, -0.10));
        stops.add(new RouteGeometry.Stop(2, "s2", "j2", "J-2", "dropoff", secondStatus,
                "B", "", "", 300, 51.51, -0.11));
        return new RouteGeometry(points, stops);
    }

    @Test
    public void projectsOntoTheLineAndMeasuresRemainingDistance() {
        RouteGeometry geometry = geometryWith("pending", "pending");
        List<double[]> points = geometry.points;
        double[] cumulative = RouteProgress.cumulative(points);
        // Halfway along the first segment.
        double along = RouteProgress.project(51.5, -0.105, points, cumulative);
        double segmentMetres = 111_320 * Math.cos(Math.toRadians(51.5)) * 0.01;
        assertEquals(segmentMetres / 2, along, 5.0);
    }

    @Test
    public void picksTheFirstIncompleteStopAndCountsRemaining() {
        RouteGeometry geometry = geometryWith("completed", "pending");
        RouteProgress.Result result = RouteProgress.compute(geometry, 51.5, -0.10, 0);
        assertNotNull(result);
        assertEquals("J-2", result.nextStop.reference);
        assertEquals(1, result.remainingStops);
        assertEquals(1, result.firstIncompleteIndex);
        assertEquals(300.0, result.nextStop.legDistanceM.intValue(), 0.01);
    }

    @Test
    public void allDoneStillYieldsTheLastStop() {
        RouteGeometry geometry = geometryWith("completed", "completed");
        RouteProgress.Result result = RouteProgress.compute(geometry, 51.5, -0.10, 0);
        assertNotNull(result);
        assertEquals(0, result.remainingStops);
        assertEquals("J-2", result.nextStop.reference);
    }

    @Test
    public void missingGeometryYieldsNull() {
        RouteGeometry geometry = new RouteGeometry(new ArrayList<>(), new ArrayList<>());
        assertNull(RouteProgress.compute(geometry, 51.5, -0.1, 0));
    }
}
