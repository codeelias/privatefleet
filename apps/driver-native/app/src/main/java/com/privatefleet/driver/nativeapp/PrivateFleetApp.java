package com.privatefleet.driver.nativeapp;

import android.app.Application;

import org.maplibre.android.MapLibre;
import org.maplibre.android.WellKnownTileServer;

/**
 * Application bootstrap: initialise the MapLibre engine once. The map uses
 * the OpenFreeMap public style, so no API key is required (empty string).
 */
public final class PrivateFleetApp extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        MapLibre.getInstance(this, "", WellKnownTileServer.MapLibre);
    }
}
