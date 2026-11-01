package com.privatefleet.driver.nativeapp;

import android.content.Context;

/** Last accepted device location for nearest-stop ordering. */
public final class LocationStore {
    private static final String PREFS = "privatefleet_native_location";

    public static void save(Context context, double lat, double lon, long capturedAt) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString("lat", String.valueOf(lat))
                .putString("lon", String.valueOf(lon))
                .putLong("at", capturedAt)
                .apply();
    }

    public static double[] load(Context context) {
        android.content.SharedPreferences p =
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String lat = p.getString("lat", "");
        String lon = p.getString("lon", "");
        if (lat.isEmpty() || lon.isEmpty()) return null;
        try {
            return new double[]{Double.parseDouble(lat), Double.parseDouble(lon),
                    p.getLong("at", 0L)};
        } catch (NumberFormatException error) {
            return null;
        }
    }
}
