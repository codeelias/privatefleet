package com.privatefleet.driver.nativeapp;

import android.content.Context;

import org.json.JSONObject;

import java.util.UUID;

/**
 * Shared, offline-capable submission of driver commands and evidence.
 * Both the list screen and the map screen use this one path so ordering,
 * idempotency and retry behaviour stay identical.
 */
final class CommandSubmitter {
    private CommandSubmitter() {
    }

    static void command(Context context, String kind, String jobId, String stopId,
                        String recipient, String reasonCode) throws Exception {
        JSONObject command = new JSONObject();
        command.put("kind", kind);
        command.put("jobId", jobId);
        command.put("stopId", stopId);
        command.put("driverId", Session.load(context).driverId);
        command.put("commandId", UUID.randomUUID().toString());
        if (recipient != null) command.put("recipient", recipient);
        if (reasonCode != null) command.put("reasonCode", reasonCode);
        command.put("createdAt", java.time.Instant.now().toString());
        CommandQueue.enqueue(context, command);
        CommandQueue.flush(context);
    }

    static void evidence(Context context, String kind, String jobId, String stopId,
                         String field, String value) throws Exception {
        JSONObject command = new JSONObject();
        command.put("kind", kind);
        command.put("jobId", jobId);
        command.put("stopId", stopId);
        command.put(field, value);
        command.put("commandId", UUID.randomUUID().toString());
        command.put("createdAt", java.time.Instant.now().toString());
        CommandQueue.enqueue(context, command);
        CommandQueue.flush(context);
    }
}
