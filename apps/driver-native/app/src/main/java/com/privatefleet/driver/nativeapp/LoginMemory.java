package com.privatefleet.driver.nativeapp;

import android.content.Context;

/**
 * Remembers the last workspace and driver identity on this device.
 * The PIN and tokens are never stored here; the session tokens live in
 * Session (Keystore-encrypted) and the PIN is required only when the session
 * is no longer valid.
 */
public final class LoginMemory {
    private static final String PREFS = "privatefleet_native_login_memory";

    private LoginMemory() {
    }

    public static void save(Context context, String tenantSlug, String driverId) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString("tenant", SecureStore.encrypt(tenantSlug))
                .putString("driver", SecureStore.encrypt(driverId))
                .apply();
    }

    public static String[] load(Context context) {
        android.content.SharedPreferences prefs =
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String tenant = prefs.getString("tenant", "");
        String driver = prefs.getString("driver", "");
        return new String[]{
                tenant.isEmpty() ? "" : (SecureStore.decrypt(tenant) == null ? "" : SecureStore.decrypt(tenant)),
                driver.isEmpty() ? "" : (SecureStore.decrypt(driver) == null ? "" : SecureStore.decrypt(driver)),
        };
    }
}
