package com.privatefleet.driver.nativeapp;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Bitmap;
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

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
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

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
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
        subtitle.setText("Driver sign in Â· native Android client");
        subtitle.setTextSize(14);
        subtitle.setPadding(0, 8, 0, 32);
        subtitle.setGravity(Gravity.CENTER);
        root.addView(subtitle);

        EditText tenant = field("Workspace", "northstar-couriers-b67e10");
        EditText driver = field("Driver ID", "");
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
                    runOnUiThread(() -> {
                        session = next;
                        requestPermissions();
                        showMain();
                    });
                } catch (Exception error) {
                    login.setEnabled(true);
                    runOnUiThread(() -> toast(error.getMessage()));
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
        root.setPadding(40, 48, 40, 40);
        scroll.addView(root);
        setContentView(scroll);

        TextView title = new TextView(this);
        title.setText("PrivateFleet");
        title.setTextSize(24);
        root.addView(title);

        TextView driver = new TextView(this);
        driver.setText(session.driverName + " Â· " + session.tenantSlug);
        driver.setTextSize(15);
        driver.setPadding(0, 4, 0, 20);
        root.addView(driver);

        statusView = statusLabel("Status: " + session.driverStatus);
        root.addView(statusView);

        Button start = new Button(this);
        start.setText("on_route".equals(session.driverStatus)
                ? "Shift active â€” background tracking on"
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
                        toast("Shift started â€” background tracking on");
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
        refresh.setOnClickListener(v -> refreshQueue());
        root.addView(refresh);

        jobsContainer = new LinearLayout(this);
        jobsContainer.setOrientation(LinearLayout.VERTICAL);
        root.addView(jobsContainer);
        refreshQueue();

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
                        + session.driverStatus + " Â· " + count + " jobs"));
            } catch (Exception ignored) {
                // the status label already shows the session state
            }
        });
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
        executor.execute(() -> {
            try {
                JSONObject queue = new ApiClient(this).queue();
                runOnUiThread(() -> renderQueue(queue));
            } catch (Exception error) {
                runOnUiThread(() -> toast(error.getMessage()));
            }
        });
    }

    private void renderQueue(JSONObject queue) {
        if (jobsContainer == null) return;
        jobsContainer.removeAllViews();
        JSONArray jobs = queue.optJSONArray("jobs");
        if (jobs == null || jobs.length() == 0) {
            TextView empty = new TextView(this);
            empty.setText("No jobs assigned.");
            jobsContainer.addView(empty);
            return;
        }
        for (int i = 0; i < jobs.length(); i++) {
            JSONObject job = jobs.optJSONObject(i);
            if (job == null) continue;
            if ("completed".equals(job.optString("status"))) continue;
            TextView header = new TextView(this);
            header.setText(job.optString("reference", "Job") + " Â· "
                    + job.optString("status", ""));
            header.setTextSize(16);
            header.setPadding(0, 18, 0, 6);
            jobsContainer.addView(header);

            JSONArray stops = job.optJSONArray("stops");
            if (stops == null) continue;
            for (int s = 0; s < stops.length(); s++) {
                JSONObject stop = stops.optJSONObject(s);
                if (stop == null) continue;
                String jobId = job.optString("id");
                String stopId = stop.optString("id");
                String status = stop.optString("status", "pending");
                LinearLayout row = new LinearLayout(this);
                row.setOrientation(LinearLayout.HORIZONTAL);
                row.setPadding(0, 4, 0, 4);

                TextView label = new TextView(this);
                label.setText(stop.optString("stopType", "stop") + ": "
                        + stop.optString("address", "") + "\n" + status);
                label.setTextSize(13);
                label.setLayoutParams(new LinearLayout.LayoutParams(
                        0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
                row.addView(label);

                LinearLayout actions = new LinearLayout(this);
                actions.setOrientation(LinearLayout.VERTICAL);
                if ("pending".equals(status)) {
                    Button arrive = new Button(this);
                    arrive.setText("Arrive");
                    arrive.setOnClickListener(v -> queueCommand("arrive", jobId, stopId,
                            null, null));
                    actions.addView(arrive);
                    Button photo = new Button(this);
                    photo.setText("Photo");
                    photo.setOnClickListener(v -> promptPhoto(jobId, stopId));
                    actions.addView(photo);
                    Button fail = new Button(this);
                    fail.setText("Fail");
                    fail.setOnClickListener(v -> promptSkip(jobId, stopId));
                    actions.addView(fail);
                } else if ("arrived".equals(status)) {
                    Button sign = new Button(this);
                    sign.setText("Sign");
                    sign.setOnClickListener(v -> promptSignature(jobId, stopId));
                    actions.addView(sign);
                    Button complete = new Button(this);
                    complete.setText("Complete");
                    complete.setOnClickListener(v -> promptRecipient(jobId, stopId));
                    actions.addView(complete);
                    Button photo = new Button(this);
                    photo.setText("Photo");
                    photo.setOnClickListener(v -> promptPhoto(jobId, stopId));
                    actions.addView(photo);
                    Button fail = new Button(this);
                    fail.setText("Fail");
                    fail.setOnClickListener(v -> promptSkip(jobId, stopId));
                    actions.addView(fail);
                }
                row.addView(actions);
                jobsContainer.addView(row);
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
                String base64 = Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
                new ApiClient(this).uploadPhoto(jobId, stopId, base64);
                runOnUiThread(() -> toast("Photo evidence saved"));
            } catch (Exception error) {
                runOnUiThread(() -> toast("Photo failed: " + error.getMessage()));
            }
        });
    }

    private void promptSignature(String jobId, String stopId) {
        Dialog dialog = new Dialog(this);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(32, 32, 32, 32);

        TextView title = new TextView(this);
        title.setText("Recipient signature");
        title.setTextSize(20);
        layout.addView(title);

        SignatureView pad = new SignatureView(this);
        pad.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 600));
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
                    new ApiClient(this).uploadSignature(jobId, stopId, pathData);
                    runOnUiThread(() -> {
                        toast("Signature saved");
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
            toast("Background location denied â€” tracking works only while the app is visible");
        }
    }

    private void toast(String message) {
        Toast.makeText(this, message == null ? "Request failed" : message,
                Toast.LENGTH_LONG).show();
    }
}

