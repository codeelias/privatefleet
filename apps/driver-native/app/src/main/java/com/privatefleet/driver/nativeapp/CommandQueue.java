package com.privatefleet.driver.nativeapp;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Durable offline command queue. Commands are appended with their idempotency
 * key before any network call, so a crash or loss of connectivity cannot lose
 * a driver action. Retries reuse the same key.
 */
public final class CommandQueue {
    private static final String PREFS = "privatefleet_native_commands";
    private static final String KEY = "commands";
    private static final Object LOCK = new Object();

    public static final class Result {
        public final int sent;
        public final int conflicts;
        public final int remaining;

        Result(int sent, int conflicts, int remaining) {
            this.sent = sent;
            this.conflicts = conflicts;
            this.remaining = remaining;
        }
    }

    private CommandQueue() {
    }

    private static JSONArray read(Context context) {
        String stored = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY, "");
        if (stored.isEmpty()) return new JSONArray();
        String raw = SecureStore.decrypt(stored);
        if (raw == null) return new JSONArray();
        try {
            return new JSONArray(raw);
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    private static void write(Context context, JSONArray queue) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(KEY, SecureStore.encrypt(queue.toString())).apply();
    }

    public static void enqueue(Context context, JSONObject command) {
        synchronized (LOCK) {
            JSONArray queue = read(context);
            queue.put(command);
            write(context, queue);
        }
    }

    public static int pending(Context context) {
        synchronized (LOCK) {
            return read(context).length();
        }
    }

    public static Result flush(Context context) {
        synchronized (LOCK) {
            JSONArray queue = read(context);
            JSONArray remaining = new JSONArray();
            int sent = 0;
            int conflicts = 0;
            ApiClient api = new ApiClient(context);
            for (int i = 0; i < queue.length(); i++) {
                JSONObject command = queue.optJSONObject(i);
                if (command == null) continue;
                try {
                    dispatch(api, command);
                    sent++;
                } catch (ApiClient.ApiException error) {
                    if (error.status >= 400 && error.status < 500) {
                        // The server rejected the command (conflict or bad state).
                        // Keep a visible count but do not retry forever.
                        conflicts++;
                    } else {
                        remaining.put(command);
                    }
                } catch (Exception error) {
                    remaining.put(command);
                }
            }
            write(context, remaining);
            return new Result(sent, conflicts, remaining.length());
        }
    }

    private static void dispatch(ApiClient api, JSONObject command) throws Exception {
        String kind = command.getString("kind");
        String jobId = command.getString("jobId");
        String stopId = command.getString("stopId");
        String driverId = command.getString("driverId");
        String commandId = command.getString("commandId");
        if ("arrive".equals(kind)) {
            api.arrive(jobId, stopId, driverId, commandId);
        } else if ("complete".equals(kind)) {
            api.complete(jobId, stopId, driverId, command.optString("recipient", ""), commandId);
        } else if ("skip".equals(kind)) {
            api.skip(jobId, stopId, driverId, command.optString("reasonCode", "OTHER"),
                    command.optString("note", null), commandId);
        }
    }
}

