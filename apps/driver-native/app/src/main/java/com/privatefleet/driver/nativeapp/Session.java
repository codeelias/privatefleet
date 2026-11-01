package com.privatefleet.driver.nativeapp;

import android.content.Context;
import android.content.SharedPreferences;

/** Durable device session (access + refresh token + driver identity). */
public final class Session {
    private static final String PREFS = "privatefleet_native_session";

    public String accessToken = "";
    public String refreshToken = "";
    public long expiresAt = 0L;
    public String driverId = "";
    public String driverName = "";
    public String driverStatus = "";
    public String tenantSlug = "";

    public static Session load(Context context) {
        SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        Session s = new Session();
        s.accessToken = p.getString("accessToken", "");
        s.refreshToken = p.getString("refreshToken", "");
        s.expiresAt = p.getLong("expiresAt", 0L);
        s.driverId = p.getString("driverId", "");
        s.driverName = p.getString("driverName", "");
        s.driverStatus = p.getString("driverStatus", "");
        s.tenantSlug = p.getString("tenantSlug", "");
        return s;
    }

    public void save(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString("accessToken", accessToken)
                .putString("refreshToken", refreshToken)
                .putLong("expiresAt", expiresAt)
                .putString("driverId", driverId)
                .putString("driverName", driverName)
                .putString("driverStatus", driverStatus)
                .putString("tenantSlug", tenantSlug)
                .apply();
    }

    public static void clear(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
    }

    public boolean isLoggedIn() {
        return !accessToken.isEmpty() && !refreshToken.isEmpty() && !driverId.isEmpty();
    }
}
