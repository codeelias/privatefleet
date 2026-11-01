package com.privatefleet.driver.nativeapp;

import android.Manifest;
import android.app.Activity;
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
        subtitle.setText("Driver sign in · native Android client");
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
        driver.setText(session.driverName + " · " + session.tenantSlug);
        driver.setTextSize(15);
        driver.setPadding(0, 4, 0, 20);
        root.addView(driver);

        statusView = statusLabel("Status: " + session.driverStatus);
        root.addView(statusView);

        Button start = new Button(this);
        start.setText("on_route".equals(session.driverStatus)
                ? "Shift active — background tracking on"
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
                        toast("Shift started — background tracking on");
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
        refresh.setOnClickListener(v -> executor.execute(() -> {
            try {
                int count = new ApiClient(this).queueCount();
                runOnUiThread(() -> statusView.setText(
                        "Status: " + session.driverStatus + " · " + count + " jobs"));
            } catch (Exception error) {
                runOnUiThread(() -> toast(error.getMessage()));
            }
        }));
        root.addView(refresh);

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
                        + session.driverStatus + " · " + count + " jobs"));
            } catch (Exception ignored) {
                // the status label already shows the session state
            }
        });
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
            toast("Background location denied — tracking works only while the app is visible");
        }
    }

    private void toast(String message) {
        Toast.makeText(this, message == null ? "Request failed" : message,
                Toast.LENGTH_LONG).show();
    }
}
