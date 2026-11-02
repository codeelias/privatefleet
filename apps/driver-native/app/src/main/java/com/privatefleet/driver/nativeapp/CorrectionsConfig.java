package com.privatefleet.driver.nativeapp;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Correction-source configuration, stored locally and never sent to the API.
 * Empty means corrections are disabled; the app then stays in raw GNSS mode.
 */
public final class CorrectionsConfig {
    private static final String PREFS = "privatefleet_corrections";
    private final SharedPreferences prefs;

    public CorrectionsConfig(Context context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public boolean isEnabled() {
        return prefs.getBoolean("enabled", false)
                && !prefs.getString("host", "").isEmpty();
    }

    public String host() {
        return prefs.getString("host", "");
    }

    public int port() {
        return prefs.getInt("port", 2101);
    }

    public String mountpoint() {
        return prefs.getString("mountpoint", "");
    }

    public String username() {
        return prefs.getString("username", "");
    }

    public String password() {
        return prefs.getString("password", "");
    }

    public void save(boolean enabled, String host, int port, String mountpoint,
                     String username, String password) {
        prefs.edit()
                .putBoolean("enabled", enabled)
                .putString("host", host)
                .putInt("port", port)
                .putString("mountpoint", mountpoint)
                .putString("username", username)
                .putString("password", password)
                .apply();
    }
}
