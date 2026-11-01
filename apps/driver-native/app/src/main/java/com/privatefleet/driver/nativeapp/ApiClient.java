package com.privatefleet.driver.nativeapp;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Small synchronous API client used from background executors and the GPS service. */
public final class ApiClient {
    public static final String BASE = BuildConfig.API_BASE;

    public static final class ApiException extends Exception {
        public final int status;

        ApiException(int status, String message) {
            super(message);
            this.status = status;
        }
    }

    private final Context context;

    public ApiClient(Context context) {
        this.context = context.getApplicationContext();
    }

    public Session login(String tenant, String driverId, String pin) throws Exception {
        JSONObject body = new JSONObject();
        body.put("tenantSlug", tenant);
        body.put("driverId", driverId);
        body.put("pin", pin);
        Response response = raw("POST", "/v1/auth/driver-login", body.toString(), null, null);
        if (response.status != 200) {
            throw new ApiException(response.status, message(response.body));
        }
        JSONObject json = new JSONObject(response.body);
        JSONObject tokens = json.getJSONObject("tokens");
        JSONObject driver = json.getJSONObject("driver");
        Session session = new Session();
        session.accessToken = tokens.getString("accessToken");
        session.refreshToken = tokens.getString("refreshToken");
        session.expiresAt = System.currentTimeMillis()
                + tokens.getLong("expiresIn") * 1000L;
        session.driverId = driver.getString("id");
        session.driverName = driver.optString("fullName", "Driver");
        session.driverStatus = driver.optString("status", "available");
        session.tenantSlug = tenant;
        session.save(context);
        return session;
    }

    public Session startShift() throws Exception {
        Session session = Session.load(context);
        Response response = auth("POST", "/v1/driver/shift/start", "{}", session);
        if (response.status != 200) {
            throw new ApiException(response.status, message(response.body));
        }
        JSONObject driver = new JSONObject(response.body);
        session.driverStatus = driver.optString("status", "on_route");
        session.save(context);
        return session;
    }

    public String requestMoreJobs() throws Exception {
        Session session = Session.load(context);
        Response response = auth("POST", "/v1/driver/work-requests", "{}", session);
        if (response.status != 200 && response.status != 409) {
            throw new ApiException(response.status, message(response.body));
        }
        return message(response.body);
    }

    public int queueCount() throws Exception {
        Session session = Session.load(context);
        Response response = auth("GET", "/v1/driver/queue", null, session);
        if (response.status != 200) return -1;
        JSONObject json = new JSONObject(response.body);
        JSONArray jobs = json.optJSONArray("jobs");
        return jobs == null ? 0 : jobs.length();
    }

    public JSONObject queue() throws Exception {
        Session session = Session.load(context);
        Response response = auth("GET", "/v1/driver/queue", null, session);
        if (response.status != 200) throw new ApiException(response.status, message(response.body));
        return new JSONObject(response.body);
    }

    public void arrive(String jobId, String stopId, String driverId, String commandId)
            throws Exception {
        JSONObject body = new JSONObject();
        body.put("driverId", driverId);
        Session session = Session.load(context);
        Response response = command("POST",
                "/v1/jobs/" + jobId + "/stops/" + stopId + "/arrive",
                body.toString(), commandId, session);
        if (response.status != 200) throw new ApiException(response.status, message(response.body));
    }

    public void complete(String jobId, String stopId, String driverId,
                         String recipientName, String commandId) throws Exception {
        JSONObject body = new JSONObject();
        body.put("driverId", driverId);
        body.put("recipientName", recipientName);
        Session session = Session.load(context);
        Response response = command("POST",
                "/v1/jobs/" + jobId + "/stops/" + stopId + "/complete",
                body.toString(), commandId, session);
        if (response.status != 200) throw new ApiException(response.status, message(response.body));
    }

    private Response command(String method, String path, String body, String commandId,
                             Session session) throws Exception {
        Response response = raw(method, path, body, session.accessToken, commandId);
        if (response.status == 401) {
            String refreshed = refresh(session);
            if (refreshed != null) {
                response = raw(method, path, body, refreshed, commandId);
            }
        }
        return response;
    }
    public void telemetry(JSONArray samples) throws Exception {
        Session session = Session.load(context);
        JSONObject body = new JSONObject();
        body.put("samples", samples);
        Response response = auth("POST", "/v1/telemetry", body.toString(), session);
        if (response.status != 200) {
            throw new ApiException(response.status, message(response.body));
        }
    }

    private Response auth(String method, String path, String body, Session session)
            throws Exception {
        Response response = raw(method, path, body, session.accessToken, null);
        if (response.status == 401) {
            String refreshed = refresh(session);
            if (refreshed != null) {
                response = raw(method, path, body, refreshed, null);
            }
        }
        return response;
    }

    private String refresh(Session session) throws Exception {
        JSONObject body = new JSONObject();
        body.put("refreshToken", session.refreshToken);
        Response response = raw("POST", "/v1/auth/refresh", body.toString(), null, null);
        if (response.status != 200) return null;
        JSONObject tokens = new JSONObject(response.body);
        session.accessToken = tokens.getString("accessToken");
        session.refreshToken = tokens.getString("refreshToken");
        session.expiresAt = System.currentTimeMillis()
                + tokens.getLong("expiresIn") * 1000L;
        session.save(context);
        return session.accessToken;
    }

    private static final class Response {
        final int status;
        final String body;

        Response(int status, String body) {
            this.status = status;
            this.body = body;
        }
    }

    private Response raw(String method, String path, String body, String token,
                        String commandId) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(BASE + path).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(20000);
        connection.setRequestProperty("Accept", "application/json");
        if (token != null && !token.isEmpty()) {
            connection.setRequestProperty("Authorization", "Bearer " + token);
        }
        if (commandId != null && !commandId.isEmpty()) {
            connection.setRequestProperty("idempotency-key", commandId);
        }
        if (body != null) {
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            try (OutputStream out = connection.getOutputStream()) {
                out.write(body.getBytes(StandardCharsets.UTF_8));
            }
        }
        int status = connection.getResponseCode();
        InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        StringBuilder text = new StringBuilder();
        if (stream != null) {
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) text.append(line);
            }
        }
        connection.disconnect();
        return new Response(status, text.toString());
    }

    private static String message(String body) {
        try {
            JSONObject json = new JSONObject(body);
            return json.optString("uiMessage", json.optString("detail", body));
        } catch (Exception ignored) {
            return body;
        }
    }
}


