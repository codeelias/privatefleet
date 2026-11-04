package com.privatefleet.driver.nativeapp;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.provider.MediaStore;
import android.util.Base64;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Native Android driver client: PIN login, shift control, request-more-jobs
 * and the background telemetry foreground service. No WebView, no Expo, no
 * JavaScript runtime.
 */
public class MainActivity extends Activity {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private Session session;
    private TextView statusView;
    private LinearLayout root;
    private LinearLayout jobsContainer;
    private Uri pendingPhotoUri;
    private String pendingPhotoJobId;
    private String pendingPhotoStopId;
    private final List<StopItem> stopItems = new ArrayList<>();
    private int page = 0;
    private int pageSize = 3;
    private TextView pageLabel;
    private Button prevButton;
    private Button nextButton;
    private TextView locationView;
    private TextView headsUpView;
    private TextView queueStatus;
    private Button refreshButton;
    private volatile boolean queueLoading = false;
    private ConnectivityManager.NetworkCallback networkCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE,
                android.view.WindowManager.LayoutParams.FLAG_SECURE);
        session = Session.load(this);
        if (session.isLoggedIn()) {
            showMain();
            if ("on_route".equals(session.driverStatus)) {
                TelemetryService.start(this);
            }
        } else {
            showLogin();
        }
    }

    @Override
    protected void onDestroy() {
        if (networkCallback != null) {
            ConnectivityManager manager = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            if (manager != null) {
                try {
                    manager.unregisterNetworkCallback(networkCallback);
                } catch (IllegalArgumentException ignored) {
                }
            }
            networkCallback = null;
        }
        super.onDestroy();
    }

    private void showLogin() {
        ScrollView scroll = new ScrollView(this);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(48, 64, 48, 48);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        scroll.addView(root);
        setContentView(scroll);

        TextView brand = new TextView(this);
        brand.setText("PrivateFleet Native");
        brand.setTextSize(26);
        brand.setGravity(Gravity.CENTER);
        root.addView(brand);

        TextView subtitle = new TextView(this);
        subtitle.setText("Driver sign in - native Android client");
        subtitle.setTextSize(14);
        subtitle.setPadding(0, 8, 0, 32);
        subtitle.setGravity(Gravity.CENTER);
        root.addView(subtitle);

        String[] remembered = LoginMemory.load(this);
        EditText tenant = field("Workspace", remembered[0].isEmpty() ? "northstar-couriers-b67e10" : remembered[0]);
        EditText driver = field("Driver ID", remembered[1]);
        EditText pin = field("PIN", "");
        pin.setInputType(android.text.InputType.TYPE_CLASS_NUMBER
                | android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD);

        Button login = new Button(this);
        login.setText("Sign in");
        login.setOnClickListener(v -> {
            login.setEnabled(false);
            String tenantValue = tenant.getText().toString().trim();
            String driverValue = driver.getText().toString().trim();
            String pinValue = pin.getText().toString().trim();
            executor.execute(() -> {
                try {
                    Session next = new ApiClient(this).login(tenantValue, driverValue, pinValue);
                    LoginMemory.save(this, tenantValue, driverValue);
                    runOnUiThread(() -> {
                        session = next;
                        if ("on_route".equals(next.driverStatus)) {
                            TelemetryService.start(this);
                        }
                        requestPermissions();
                        showMain();
                    });
                } catch (Exception error) {
                    android.util.Log.e("pf-native", "login failed", error);
                    runOnUiThread(() -> {
                        login.setEnabled(true);
                        toast(error.getMessage());
                    });
                }
            });
        });
        root.addView(login, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        root.addView(statusLabel(""));
    }

    private EditText field(String hint, String value) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setText(value);
        input.setSingleLine(true);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        params.bottomMargin = 12;
        root.addView(input, params);
        return input;
    }

    private void showMain() {
        ScrollView scroll = new ScrollView(this);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(245, 246, 248));
        root.setPadding(40, 48, 40, 40);
        pageSize = getResources().getConfiguration().smallestScreenWidthDp >= 600 ? 6 : 3;
        scroll.addView(root);
        setContentView(scroll);

        TextView title = new TextView(this);
        title.setText("PrivateFleet");
        title.setTextSize(24);
        root.addView(title);

        TextView driver = new TextView(this);
        driver.setText(session.driverName + " - " + session.tenantSlug);
        driver.setTextSize(15);
        driver.setPadding(0, 4, 0, 20);
        root.addView(driver);

        statusView = statusLabel("Status: " + session.driverStatus);
        root.addView(statusView);

        headsUpView = new TextView(this);
        headsUpView.setTextSize(12);
        headsUpView.setPadding(dp(12), dp(9), dp(12), dp(9));
        headsUpView.setVisibility(View.GONE);
        LinearLayout.LayoutParams headsUpParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        headsUpParams.topMargin = dp(8);
        headsUpParams.bottomMargin = dp(4);
        root.addView(headsUpView, headsUpParams);

        Button start = new Button(this);
        start.setText("on_route".equals(session.driverStatus)
                ? "Shift active - background tracking on"
                : "Start shift");
        start.setEnabled(!"on_route".equals(session.driverStatus));
        start.setOnClickListener(v -> {
            executor.execute(() -> {
                try {
                    Session next = new ApiClient(this).startShift();
                    runOnUiThread(() -> {
                        session = next;
                        TelemetryService.start(this);
                        requestPermissions();
                        showMain();
                        toast("Shift started - background tracking on");
                    });
                } catch (Exception error) {
                    runOnUiThread(() -> toast(error.getMessage()));
                }
            });
        });
        root.addView(start);

        Button request = new Button(this);
        request.setText("Request more jobs");
        request.setOnClickListener(v -> executor.execute(() -> {
            try {
                String message = new ApiClient(this).requestMoreJobs();
                runOnUiThread(() -> {
                    statusView.setText("Status: " + message);
                    toast("Request sent to dispatch");
                });
            } catch (Exception error) {
                runOnUiThread(() -> toast(error.getMessage()));
            }
        }));
        root.addView(request);

        Button refresh = new Button(this);
        refresh.setText("Refresh queue");
        refreshButton = refresh;
        refresh.setOnClickListener(v -> refreshQueue());
        root.addView(refresh);

        Button mapButton = new Button(this);
        mapButton.setText("Map");
        mapButton.setOnClickListener(v ->
                startActivity(new Intent(this, RouteMapActivity.class)));
        root.addView(mapButton);

        queueStatus = new TextView(this);
        queueStatus.setTextSize(11);
        queueStatus.setTextColor(Color.rgb(180, 83, 9));
        queueStatus.setPadding(0, 8, 0, 0);
        root.addView(queueStatus);

        locationView = new TextView(this);
        locationView.setTextSize(11);
        locationView.setTextColor(Color.rgb(102, 112, 133));
        root.addView(locationView);

        jobsContainer = new LinearLayout(this);
        jobsContainer.setOrientation(LinearLayout.VERTICAL);
        root.addView(jobsContainer);

        LinearLayout footer = new LinearLayout(this);
        footer.setOrientation(LinearLayout.HORIZONTAL);
        footer.setGravity(android.view.Gravity.CENTER_VERTICAL);
        prevButton = new Button(this);
        prevButton.setText("Previous");
        prevButton.setOnClickListener(v -> {
            if (page > 0) {
                page--;
                renderPage();
            }
        });
        footer.addView(prevButton);
        pageLabel = new TextView(this);
        pageLabel.setTextSize(12);
        pageLabel.setGravity(android.view.Gravity.CENTER);
        pageLabel.setLayoutParams(new LinearLayout.LayoutParams(0,
                LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        footer.addView(pageLabel);
        nextButton = new Button(this);
        nextButton.setText("Next");
        nextButton.setOnClickListener(v -> {
            if ((page + 1) * pageSize < stopItems.size()) {
                page++;
                renderPage();
            }
        });
        footer.addView(nextButton);
        root.addView(footer);
        registerNetworkCallback();
        refreshQueue();
        flushQueue();
        checkForUpdate();

        Button signOut = new Button(this);
        signOut.setText("Sign out");
        signOut.setOnClickListener(v -> {
            TelemetryService.stop(this);
            Session.clear(this);
            session = new Session();
            showLogin();
        });
        root.addView(signOut);

        TextView note = new TextView(this);
        note.setText("API: " + ApiClient.BASE
                + "\nBackground location runs as a foreground service while the shift is active.");
        note.setTextSize(11);
        note.setPadding(0, 24, 0, 0);
        root.addView(note);

        executor.execute(() -> {
            try {
                int count = new ApiClient(this).queueCount();
                runOnUiThread(() -> statusView.setText("Status: "
                        + session.driverStatus + " - " + count + " jobs"));
            } catch (Exception ignored) {
                // the status label already shows the session state
            }
        });
    }




    private void checkForUpdate() {
        executor.execute(() -> {
            try {
                JSONObject manifest = new ApiClient(this).releaseManifest();
                int available = manifest.optInt("versionCode", 0);
                if (available <= BuildConfig.VERSION_CODE) return;
                int prompted = getSharedPreferences("privatefleet_update", MODE_PRIVATE)
                        .getInt("prompted_version", 0);
                if (prompted >= available) return;
                String versionName = manifest.optString("versionName", "new version");
                String url = manifest.optString("apkUrl", ApiClient.BASE + "/downloads/native/app-release.apk");
                runOnUiThread(() -> new AlertDialog.Builder(this)
                        .setTitle("PrivateFleet update available")
                        .setMessage("Version " + versionName + " is available. Install it when you are parked and safe.")
                        .setPositiveButton("Download", (dialog, which) -> {
                            getSharedPreferences("privatefleet_update", MODE_PRIVATE).edit()
                                    .putInt("prompted_version", available).apply();
                            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                        })
                        .setNegativeButton("Later", null)
                        .show());
            } catch (Exception ignored) {
                // The update channel is advisory; never block the shift on it.
            }
        });
    }
    private void queueEvidence(String kind, String jobId, String stopId,
                               String field, String value) throws Exception {
        JSONObject command = new JSONObject();
        command.put("kind", kind);
        command.put("jobId", jobId);
        command.put("stopId", stopId);
        command.put(field, value);
        command.put("commandId", UUID.randomUUID().toString());
        command.put("createdAt", java.time.Instant.now().toString());
        CommandQueue.enqueue(this, command);
        flushQueue();
    }

    private void queueCommand(String kind, String jobId, String stopId,
                              String recipient, String reasonCode) {
        try {
            JSONObject command = new JSONObject();
            command.put("kind", kind);
            command.put("jobId", jobId);
            command.put("stopId", stopId);
            command.put("driverId", session.driverId);
            command.put("commandId", UUID.randomUUID().toString());
            if (recipient != null) command.put("recipient", recipient);
            if (reasonCode != null) command.put("reasonCode", reasonCode);
            command.put("createdAt", java.time.Instant.now().toString());
            CommandQueue.enqueue(this, command);
            flushQueue();
        } catch (Exception error) {
            toast(error.getMessage());
        }
    }

    private void flushQueue() {
        executor.execute(() -> {
            CommandQueue.Result result = CommandQueue.flush(this);
            runOnUiThread(() -> {
                if (result.conflicts > 0) {
                    toast(result.conflicts + " action(s) need attention");
                } else if (result.remaining > 0) {
                    toast(result.remaining + " action(s) saved offline; will retry");
                } else if (result.sent > 0) {
                    toast("Action synced");
                }
                refreshQueue();
            });
        });
    }

    private void refreshQueue() {
        if (queueLoading) return;
        queueLoading = true;
        runOnUiThread(() -> {
            queueStatus.setText("Loading…");
            queueStatus.setTextColor(Color.rgb(102, 112, 133));
            if (refreshButton != null) refreshButton.setEnabled(false);
        });
        executor.execute(() -> {
            try {
                JSONObject queue = new ApiClient(this).queue();
                runOnUiThread(() -> {
                    queueLoading = false;
                    queueStatus.setText("");
                    if (refreshButton != null) refreshButton.setEnabled(true);
                    renderQueue(queue);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    queueLoading = false;
                    queueStatus.setText("Offline — could not load your jobs. It will retry when the connection returns.");
                    queueStatus.setTextColor(Color.rgb(180, 83, 9));
                    if (refreshButton != null) refreshButton.setEnabled(true);
                });
            }
        });
    }

    private void registerNetworkCallback() {
        ConnectivityManager manager = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (manager == null) return;
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                runOnUiThread(() -> {
                    if (queueStatus != null && queueStatus.getText().toString().startsWith("Offline")) {
                        refreshQueue();
                    }
                });
            }
        };
        manager.registerDefaultNetworkCallback(networkCallback);
    }

    private static final class StopItem {
        String jobId;
        String jobRef;
        String jobStatus;
        String stopId;
        String type;
        String address;
        String status;
        String windowEnd;
        double latitude;
        double longitude;
        double distanceMetres;
    }

    private void renderQueue(JSONObject queue) {
        stopItems.clear();
        page = 0;
        JSONArray jobs = queue.optJSONArray("jobs");
        if (jobs != null) {
            for (int i = 0; i < jobs.length(); i++) {
                JSONObject job = jobs.optJSONObject(i);
                if (job == null) continue;
                String jobStatus = job.optString("status", "");
                if ("completed".equals(jobStatus) || "cancelled".equals(jobStatus)) continue;
                JSONArray stops = job.optJSONArray("stops");
                if (stops == null) continue;
                for (int s = 0; s < stops.length(); s++) {
                    JSONObject stop = stops.optJSONObject(s);
                    if (stop == null) continue;
                    String status = stop.optString("status", "pending");
                    if ("completed".equals(status) || "skipped".equals(status)
                            || "failed".equals(status)) continue;
                    StopItem item = new StopItem();
                    item.jobId = job.optString("id");
                    item.jobRef = job.optString("reference", "Job");
                    item.jobStatus = jobStatus;
                    item.stopId = stop.optString("id");
                    item.type = stop.optString("stopType", "stop");
                    item.address = stop.optString("address", "");
                    item.status = status;
                    item.windowEnd = stop.optString("windowEnd", "");
                    JSONObject location = stop.optJSONObject("location");
                    if (location != null) {
                        item.latitude = location.optDouble("latitude", 0);
                        item.longitude = location.optDouble("longitude", 0);
                    }
                    stopItems.add(item);
                }
            }
        }

        double[] here = LocationStore.load(this);
        locationView.setText(here == null
                ? "Location unavailable - showing route order"
                : "Sorted by distance from last GPS fix");
        for (StopItem item : stopItems) {
            item.distanceMetres = here == null ? Double.MAX_VALUE
                    : distanceMetres(here[0], here[1], item.latitude, item.longitude);
        }
        stopItems.sort(Comparator
                .comparing((StopItem item) -> !"arrived".equals(item.status))
                .thenComparingDouble(item -> item.distanceMetres)
                .thenComparing(item -> item.jobRef));
        updateHeadsUp();
        renderPage();
    }

    private void renderPage() {
        if (jobsContainer == null) return;
        jobsContainer.removeAllViews();
        int total = stopItems.size();
        if (total == 0) {
            TextView empty = new TextView(this);
            empty.setText("No active stops. Pull refresh after dispatch assigns work.");
            empty.setTextSize(14);
            empty.setPadding(0, 24, 0, 24);
            jobsContainer.addView(empty);
            if (pageLabel != null) pageLabel.setText("0 of 0");
            if (prevButton != null) prevButton.setEnabled(false);
            if (nextButton != null) nextButton.setEnabled(false);
            return;
        }
        int from = Math.min(page * pageSize, total);
        int to = Math.min(from + pageSize, total);
        for (int i = from; i < to; i++) {
            jobsContainer.addView(stopCard(stopItems.get(i), i - from + 1));
        }
        if (pageLabel != null) {
            pageLabel.setText("Page " + (page + 1) + " of "
                    + ((total + pageSize - 1) / pageSize) + " - " + total + " stops");
        }
        if (prevButton != null) prevButton.setEnabled(page > 0);
        if (nextButton != null) nextButton.setEnabled(to < total);
    }

    private android.view.View stopCard(StopItem item, int position) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(28, 22, 28, 22);
        card.setBackground(rounded(Color.WHITE, 18f, Color.rgb(228, 231, 236)));
        card.setElevation(dp(2));
        LinearLayout.LayoutParams cardParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        cardParams.bottomMargin = dp(12);
        card.setLayoutParams(cardParams);

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(android.view.Gravity.CENTER_VERTICAL);
        TextView reference = new TextView(this);
        reference.setText(position + ". " + item.jobRef + " - " + item.type.toUpperCase(Locale.UK));
        reference.setTextSize(13);
        reference.setTextColor(Color.rgb(11, 18, 32));
        reference.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        reference.setLayoutParams(new LinearLayout.LayoutParams(0,
                LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        top.addView(reference);
        TextView chip = new TextView(this);
        chip.setText(item.status.toUpperCase(Locale.UK));
        chip.setTextSize(10);
        chip.setTextColor("arrived".equals(item.status)
                ? Color.rgb(180, 83, 9) : Color.rgb(22, 163, 74));
        chip.setPadding(dp(8), dp(3), dp(8), dp(3));
        chip.setBackground(rounded(Color.rgb(245, 246, 248), 20f, Color.rgb(228, 231, 236)));
        top.addView(chip);
        card.addView(top);

        TextView address = new TextView(this);
        address.setText(item.address);
        address.setTextSize(16);
        address.setTextColor(Color.rgb(17, 24, 39));
        address.setPadding(0, dp(8), 0, dp(4));
        card.addView(address);

        TextView meta = new TextView(this);
        String distance = item.distanceMetres == Double.MAX_VALUE ? "distance unknown"
                : String.format(Locale.UK, "%.1f km from you", item.distanceMetres / 1000);
        meta.setText(distance);
        meta.setTextSize(12);
        meta.setTextColor(Color.rgb(102, 112, 133));
        card.addView(meta);

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setPadding(0, dp(10), 0, 0);
        if ("pending".equals(item.status)) {
            actions.addView(actionButton("Arrive", true,
                    () -> queueCommand("arrive", item.jobId, item.stopId, null, null)));
            actions.addView(actionButton("Photo", false,
                    () -> promptPhoto(item.jobId, item.stopId)));
            actions.addView(actionButton("Fail", false,
                    () -> promptSkip(item.jobId, item.stopId)));
        } else if ("arrived".equals(item.status)) {
            actions.addView(actionButton("Sign", false,
                    () -> promptSignature(item.jobId, item.stopId)));
            actions.addView(actionButton("Complete", true,
                    () -> promptRecipient(item.jobId, item.stopId)));
            actions.addView(actionButton("Fail", false,
                    () -> promptSkip(item.jobId, item.stopId)));
        }
        card.addView(actions);
        return card;
    }

    private Button actionButton(String text, boolean primary, Runnable action) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setTextSize(12);
        button.setTextColor(primary ? Color.WHITE : Color.rgb(11, 18, 32));
        button.setBackground(rounded(primary ? Color.rgb(232, 106, 51) : Color.WHITE,
                14f, Color.rgb(212, 216, 224)));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        params.rightMargin = dp(6);
        button.setLayoutParams(params);
        button.setOnClickListener(v -> action.run());
        return button;
    }

    private GradientDrawable rounded(int fill, float radiusDp, int stroke) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(dp(Math.round(radiusDp)));
        drawable.setStroke(dp(1), stroke);
        return drawable;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static double distanceMetres(double lat1, double lon1, double lat2, double lon2) {
        double radius = 6371000;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * radius * Math.asin(Math.sqrt(a));
    }

    private void updateHeadsUp() {
        if (headsUpView == null) return;
        long now = System.currentTimeMillis();
        StopItem next = null;
        long nextEnd = Long.MAX_VALUE;
        for (StopItem item : stopItems) {
            if (!"pending".equals(item.status) && !"arrived".equals(item.status)) continue;
            Long end = parseIsoMillis(item.windowEnd);
            if (end == null) continue;
            if (end < nextEnd) {
                nextEnd = end;
                next = item;
            }
        }
        if (next == null) {
            headsUpView.setVisibility(View.GONE);
            return;
        }
        long minutes = Math.abs(Math.round((nextEnd - now) / 60000.0));
        String text;
        int fill;
        int stroke;
        int color;
        if (nextEnd < now) {
            text = "Heads up: " + next.jobRef + " window closed " + minutes + " min ago. Contact dispatch before leaving.";
            fill = Color.rgb(254, 242, 242);
            stroke = Color.rgb(248, 113, 113);
            color = Color.rgb(185, 28, 28);
        } else if (nextEnd - now <= 45 * 60_000L) {
            text = "Heads up: " + next.jobRef + " window closes in " + minutes + " min.";
            fill = Color.rgb(255, 251, 235);
            stroke = Color.rgb(251, 191, 36);
            color = Color.rgb(146, 64, 14);
        } else {
            headsUpView.setVisibility(View.GONE);
            return;
        }
        headsUpView.setText(text);
        headsUpView.setTextColor(color);
        headsUpView.setBackground(rounded(fill, 12f, stroke));
        headsUpView.setVisibility(View.VISIBLE);
    }

    private static Long parseIsoMillis(String value) {
        if (value == null || value.trim().isEmpty()) return null;
        try {
            return java.time.Instant.parse(value).toEpochMilli();
        } catch (Exception ignored) {
            try {
                return java.time.OffsetDateTime.parse(value.replace(' ', 'T')).toInstant().toEpochMilli();
            } catch (Exception stillInvalid) {
                return null;
            }
        }
    }

    private void promptPhoto(String jobId, String stopId) {
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME,
                "privatefleet-" + System.currentTimeMillis() + ".jpg");
        values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
        pendingPhotoUri = getContentResolver().insert(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        pendingPhotoJobId = jobId;
        pendingPhotoStopId = stopId;
        Intent capture = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        capture.putExtra(MediaStore.EXTRA_OUTPUT, pendingPhotoUri);
        startActivityForResult(capture, 200);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != 200 || resultCode != RESULT_OK || pendingPhotoUri == null) {
            return;
        }
        Uri uri = pendingPhotoUri;
        String jobId = pendingPhotoJobId;
        String stopId = pendingPhotoStopId;
        pendingPhotoUri = null;
        executor.execute(() -> {
            try (InputStream stream = getContentResolver().openInputStream(uri)) {
                Bitmap bitmap = BitmapFactory.decodeStream(stream);
                if (bitmap == null) throw new IllegalStateException("Could not read photo");
                int max = 1280;
                int width = bitmap.getWidth();
                int height = bitmap.getHeight();
                float scale = Math.min(1f, Math.min((float) max / width, (float) max / height));
                Bitmap scaled = scale < 1f
                        ? Bitmap.createScaledBitmap(bitmap,
                            Math.round(width * scale), Math.round(height * scale), true)
                        : bitmap;
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                scaled.compress(Bitmap.CompressFormat.JPEG, 80, output);
                String path = EvidenceStore.savePhoto(this, output.toByteArray());
                queueEvidence("evidence_photo", jobId, stopId, "path", path);
                runOnUiThread(() -> toast("Photo saved - syncing"));
            } catch (Exception error) {
                runOnUiThread(() -> toast("Photo failed: " + error.getMessage()));
            }
        });
    }

    private void promptSignature(String jobId, String stopId) {
        Dialog dialog = new Dialog(this);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(20), dp(20), dp(20), dp(20));

        TextView title = new TextView(this);
        title.setText("Recipient signature");
        title.setTextSize(20);
        layout.addView(title);

        SignatureView pad = new SignatureView(this);
        pad.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(240)));
        layout.addView(pad);

        Button save = new Button(this);
        save.setText("Save signature");
        save.setOnClickListener(v -> {
            String pathData = pad.getPathData();
            if (pathData.isEmpty()) {
                toast("Signature is empty");
                return;
            }
            executor.execute(() -> {
                try {
                    queueEvidence("evidence_signature", jobId, stopId, "pathData", pathData);
                    runOnUiThread(() -> {
                        toast("Signature saved - syncing");
                        dialog.dismiss();
                    });
                } catch (Exception error) {
                    runOnUiThread(() -> toast(error.getMessage()));
                }
            });
        });
        layout.addView(save);

        Button cancel = new Button(this);
        cancel.setText("Cancel");
        cancel.setOnClickListener(v -> dialog.dismiss());
        layout.addView(cancel);
        dialog.setContentView(layout);
        dialog.show();
    }

    private void promptSkip(String jobId, String stopId) {
        String[] labels = {"Recipient unavailable", "Delivery refused",
                "Address or access problem", "Item damaged", "Vehicle problem", "Other"};
        String[] codes = {"RECIPIENT_UNAVAILABLE", "DELIVERY_REFUSED",
                "ADDRESS_ACCESS_PROBLEM", "ITEM_DAMAGED",
                "VEHICLE_OPERATIONAL_PROBLEM", "OTHER"};
        new AlertDialog.Builder(this)
                .setTitle("Report failed delivery")
                .setItems(labels, (dialog, which) ->
                        queueCommand("skip", jobId, stopId, null, codes[which]))
                .show();
    }

    private void promptRecipient(String jobId, String stopId) {
        EditText input = new EditText(this);
        input.setHint("Recipient name");
        new AlertDialog.Builder(this)
                .setTitle("Complete delivery")
                .setMessage("Enter the recipient name (required by proof policy).")
                .setView(input)
                .setPositiveButton("Complete", (dialog, which) -> {
                    String recipient = input.getText().toString().trim();
                    if (recipient.isEmpty()) {
                        toast("Recipient name is required");
                        return;
                    }
                    queueCommand("complete", jobId, stopId, recipient, null);
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private TextView statusLabel(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(14);
        view.setPadding(0, 12, 0, 16);
        return view;
    }

    private void requestPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            requestPermissions(new String[]{
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                    Manifest.permission.POST_NOTIFICATIONS
            }, 10);
        }
    }

    private void requestBackgroundPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            if (checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                    != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{
                        Manifest.permission.ACCESS_BACKGROUND_LOCATION}, 11);
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == 10
                && checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED) {
            requestBackgroundPermission();
            if ("on_route".equals(session.driverStatus)) {
                TelemetryService.start(this);
            }
        }
        if (requestCode == 11 && results.length > 0
                && results[0] != PackageManager.PERMISSION_GRANTED) {
            toast("Background location denied - tracking works only while the app is visible");
        }
    }

    private void toast(String message) {
        Toast.makeText(this, message == null ? "Request failed" : message,
                Toast.LENGTH_LONG).show();
    }
}









