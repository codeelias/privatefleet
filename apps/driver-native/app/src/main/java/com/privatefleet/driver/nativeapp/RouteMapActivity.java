package com.privatefleet.driver.nativeapp;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.content.Intent;
import android.content.res.Resources;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Log;
import android.view.Gravity;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.maplibre.android.camera.CameraUpdateFactory;
import org.maplibre.android.geometry.LatLng;
import org.maplibre.android.maps.MapLibreMap;
import org.maplibre.android.maps.MapView;
import org.maplibre.android.annotations.IconFactory;
import org.maplibre.android.annotations.Marker;
import org.maplibre.android.annotations.MarkerOptions;
import org.maplibre.android.annotations.Polygon;
import org.maplibre.android.annotations.PolygonOptions;
import org.maplibre.android.annotations.Polyline;
import org.maplibre.android.annotations.PolylineOptions;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Driver route map screen. Thin UI wiring only:
 *  - basemap + offline cache handled by MapCacheManager
 *  - route data and parsing live in RouteGeometry
 *  - actions reuse the offline command and evidence queues
 * The list UI remains the primary workflow; this screen is opt-in.
 */
public class RouteMapActivity extends Activity {
    private static final String TAG = "pf-map";
    private static final String STYLE_URI = "https://tiles.openfreemap.org/styles/liberty";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private MapView mapView;
    private MapLibreMap map;
    private TextView statusView;
    private TextView hudView;
    private Button followButton;
    private MapCacheManager cacheManager;
    private final Map<Long, RouteGeometry.Stop> markerStops = new HashMap<>();
    private final Set<String> syncingStopIds = new HashSet<>();
    private final List<Marker> stopMarkers = new ArrayList<>();
    private final List<Polyline> routePolylines = new ArrayList<>();
    private final List<Polygon> fencePolygons = new ArrayList<>();
    private RouteGeometry geometry = RouteGeometry.empty();
    private List<GeofenceInfo> fences = new ArrayList<>();
    private Marker positionMarker;
    private boolean follow = true;
    private boolean programmaticMove = false;

    private Uri pendingPhotoUri;
    private String pendingPhotoJobId;
    private String pendingPhotoStopId;
    private boolean busy = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE,
                android.view.WindowManager.LayoutParams.FLAG_SECURE);

        FrameLayout frame = new FrameLayout(this);
        mapView = new MapView(this);
        frame.addView(mapView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        statusView = new TextView(this);
        statusView.setTextSize(13);
        statusView.setTextColor(Color.WHITE);
        statusView.setBackgroundColor(Color.argb(200, 24, 24, 27));
        statusView.setPadding(dp(12), dp(8), dp(12), dp(8));
        FrameLayout.LayoutParams statusLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        statusLp.topMargin = dp(8);
        frame.addView(statusView, statusLp);

        Button back = new Button(this);
        back.setText("\u2190 List");
        back.setOnClickListener(v -> finish());
        FrameLayout.LayoutParams backLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP | Gravity.START);
        backLp.topMargin = dp(8);
        backLp.leftMargin = dp(8);
        frame.addView(back, backLp);

        followButton = new Button(this);
        followButton.setText("Following");
        followButton.setOnClickListener(v -> {
            follow = !follow;
            followButton.setText(follow ? "Following" : "Follow");
            if (follow) refreshPosition();
        });
        FrameLayout.LayoutParams followLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP | Gravity.END);
        followLp.topMargin = dp(8);
        followLp.rightMargin = dp(8);
        frame.addView(followButton, followLp);

        hudView = new TextView(this);
        hudView.setTextSize(13);
        hudView.setTextColor(Color.WHITE);
        hudView.setBackgroundColor(Color.argb(210, 24, 24, 27));
        hudView.setPadding(dp(12), dp(8), dp(12), dp(8));
        FrameLayout.LayoutParams hudLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        hudLp.bottomMargin = dp(10);
        hudLp.leftMargin = dp(10);
        hudLp.rightMargin = dp(10);
        frame.addView(hudView, hudLp);

        setContentView(frame);

        cacheManager = new MapCacheManager(this, (message, hasOfflineData) -> runOnUiThread(() -> {
            statusView.setText(message);
            // Only force cached tiles when the network is down; otherwise the
            // live style renders and the cache is the automatic offline
            // fallback the SDK applies itself.
            if (hasOfflineData && map != null && !NetworkState.online(this)) {
                map.setOfflineRegionDefinition(cacheManager.definition());
            }
            if (!hasOfflineData && "Map needs a first download on a better connection - staying in list mode.".equals(message)) {
                toast(message);
                finish();
            }
        }));

        mapView.getMapAsync(loaded -> {
            map = loaded;
            map.setStyle(STYLE_URI, style -> {
                Log.i(TAG, "style loaded fully=" + style.isFullyLoaded()
                        + " layers=" + style.getLayers().size()
                        + " sources=" + style.getSources().size());
                map.moveCamera(CameraUpdateFactory.newLatLngZoom(new LatLng(51.5074, -0.1278), 11));
                map.setOnMarkerClickListener(marker -> {
                    RouteGeometry.Stop stop = markerStops.get(marker.getId());
                    if (stop != null) {
                        showStopSheet(stop);
                    }
                    return true;
                });
                map.addOnCameraMoveStartedListener(reason -> {
                    if (!programmaticMove) follow = false;
                    if (!follow) {
                        runOnUiThread(() -> followButton.setText("Follow"));
                    }
                });
                cacheManager.start();
                loadRoute();
                loadFences();
            });
        });
        handler.postDelayed(refreshTick, 10_000);
    }

    private final Runnable refreshTick = new Runnable() {
        @Override
        public void run() {
            refreshPosition();
            // Offline queue: retry while the map is open so completions and
            // evidence don't wait for a return to the list screen.
            if (CommandQueue.pending(RouteMapActivity.this) > 0) {
                executor.execute(() -> {
                    try {
                        CommandQueue.Result result = CommandQueue.flush(RouteMapActivity.this);
                        if (result.remaining == 0) {
                            runOnUiThread(() -> {
                                syncingStopIds.clear();
                                loadRoute();
                            });
                        }
                    } catch (Exception ignored) {
                    }
                });
            }
            handler.postDelayed(this, 10_000);
        }
    };

    private void loadFences() {
        executor.execute(() -> {
            try {
                List<GeofenceInfo> parsed = GeofenceInfo.fromJson(new ApiClient(this).geofences());
                runOnUiThread(() -> {
                    fences = parsed;
                    renderFences();
                    refreshHud();
                });
            } catch (Exception error) {
                Log.w(TAG, "geofences failed", error);
            }
        });
    }

    private void renderFences() {
        if (map == null) return;
        for (GeofenceInfo fence : fences) {
            if (fence.ring.size() < 3) continue;
            List<LatLng> ring = new ArrayList<>();
            for (double[] point : fence.ring) {
                ring.add(new LatLng(point[0], point[1]));
            }
            map.addPolygon(new PolygonOptions()
                    .addAll(ring)
                    .fillColor(fence.inside ? 0x33276EF1 : 0x1A276EF1)
                    .strokeColor(Color.parseColor(fence.inside ? "#276EF1" : "#64748B")));
        }
    }

    private void refreshPosition() {
        if (map == null) return;
        double[] location = LocationStore.load(this);
        if (location == null) return;
        double lat = location[0];
        double lng = location[1];
        IconFactory icons = IconFactory.getInstance(this);
        if (positionMarker == null) {
            positionMarker = map.addMarker(new MarkerOptions()
                    .position(new LatLng(lat, lng))
                    .icon(icons.fromBitmap(positionBitmap())));
        } else {
            positionMarker.setPosition(new LatLng(lat, lng));
        }
        if (follow) {
            programmaticMove = true;
            map.moveCamera(CameraUpdateFactory.newLatLngZoom(new LatLng(lat, lng), map.getCameraPosition().zoom));
            programmaticMove = false;
        }
        refreshHud(lat, lng);
    }

    private void refreshHud() {
        double[] location = LocationStore.load(this);
        if (location == null) return;
        refreshHud(location[0], location[1]);
    }

    private void refreshHud(double lat, double lng) {
        RouteProgress.Result progress = RouteProgress.compute(geometry, lat, lng, System.currentTimeMillis());
        StringBuilder hud = new StringBuilder();
        if (progress != null) {
            double km = progress.remainingMetres / 1000.0;
            hud.append("Next: ").append(progress.nextStop.reference)
                    .append(" \u00b7 ").append(String.format(java.util.Locale.US, "%.1f km", km));
            String eta = progress.nextStop.arrivalAt == null || progress.nextStop.arrivalAt.isEmpty()
                    ? "--:--"
                    : new java.text.SimpleDateFormat("HH:mm", java.util.Locale.US)
                            .format(new java.util.Date(progress.etaMillis));
            hud.append(" \u00b7 ETA ").append(eta)
                    .append(" \u00b7 ").append(progress.remainingStops).append(" stop(s) left");
        }
        boolean insideAny = false;
        for (GeofenceInfo fence : fences) {
            if (fence.inside) insideAny = true;
        }
        if (insideAny) hud.append(" \u00b7 Inside zone");
        if (!syncingStopIds.isEmpty()) hud.append(" \u00b7 ").append(syncingStopIds.size()).append(" action(s) waiting to sync");
        hudView.setText(hud.length() == 0 ? "No route assigned" : hud.toString());
    }

    private Bitmap positionBitmap() {
        int size = dp(22);
        Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(0xFFEF842F);
        canvas.drawCircle(size / 2f, size / 2f, size / 2f - dp(2), paint);
        paint.setColor(Color.WHITE);
        canvas.drawCircle(size / 2f, size / 2f, dp(4), paint);
        return bitmap;
    }

    private void loadRoute() {
        executor.execute(() -> {
            try {
                RouteGeometry loaded = RouteGeometry.fromJson(new ApiClient(this).routeGeometry());
                runOnUiThread(() -> {
                    renderRoute(loaded);
                    refreshPosition();
                });
            } catch (Exception error) {
                Log.w(TAG, "route geometry failed", error);
                runOnUiThread(() -> statusView.setText("Route unavailable - check connection."));
            }
        });
    }

    private void renderRoute(RouteGeometry loadedGeometry) {
        geometry = loadedGeometry;
        // Repaint from server truth: remove all previous overlays first.
        for (Marker marker : stopMarkers) {
            map.removeMarker(marker);
        }
        stopMarkers.clear();
        markerStops.clear();
        for (Polyline line : routePolylines) {
            map.removePolyline(line);
        }
        routePolylines.clear();
        // Confirmed terminal stops leave the syncing set (green now).
        Set<String> confirmed = new HashSet<>();
        for (RouteGeometry.Stop stop : geometry.stops) {
            if ("completed".equals(stop.status) || "skipped".equals(stop.status) || "failed".equals(stop.status)) {
                confirmed.add(stop.stopId);
            }
        }
        syncingStopIds.removeAll(confirmed);

        if (lineManagerGeometryPoints().size() >= 2) {
            int splitIndex = geometry.points.size();
            RouteProgress.Result progress = RouteProgress.compute(
                    geometry, geometry.points.get(0)[0], geometry.points.get(0)[1],
                    System.currentTimeMillis());
            if (progress != null && progress.firstIncompleteIndex >= 0) {
                RouteGeometry.Stop first = geometry.stops.get(progress.firstIncompleteIndex);
                splitIndex = RouteProgress.nearestIndex(
                        first.latitude, first.longitude, geometry.points);
            }
            List<LatLng> done = new ArrayList<>();
            List<LatLng> remaining = new ArrayList<>();
            for (int index = 0; index < geometry.points.size(); index++) {
                double[] point = geometry.points.get(index);
                if (index <= splitIndex) done.add(new LatLng(point[0], point[1]));
                if (index >= splitIndex) remaining.add(new LatLng(point[0], point[1]));
            }
            if (done.size() >= 2) {
                routePolylines.add(map.addPolyline(new PolylineOptions()
                        .addAll(done)
                        .color(Color.parseColor("#94A3B8"))
                        .width(3.5f)));
            }
            if (remaining.size() >= 2) {
                routePolylines.add(map.addPolyline(new PolylineOptions()
                        .addAll(remaining)
                        .color(Color.parseColor("#EF842F"))
                        .width(5.0f)));
            }
        }
        IconFactory icons = IconFactory.getInstance(this);
        for (RouteGeometry.Stop stop : geometry.stops) {
            Marker marker = map.addMarker(new MarkerOptions()
                    .position(new LatLng(stop.latitude, stop.longitude))
                    .icon(icons.fromBitmap(pinBitmap(stop))));
            markerStops.put(marker.getId(), stop);
            stopMarkers.add(marker);
        }
        if (!geometry.stops.isEmpty()) {
            RouteGeometry.Stop first = geometry.stops.get(0);
            programmaticMove = true;
            map.moveCamera(CameraUpdateFactory.newLatLngZoom(
                    new LatLng(first.latitude, first.longitude), 12));
            programmaticMove = false;
        }
        if (!statusView.getText().toString().startsWith("Downloading")) {
            statusView.setText(geometry.stops.isEmpty() ? "No stops on this route." : "Map ready (offline)");
        }
    }

    private List<double[]> lineManagerGeometryPoints() {
        return geometry.points;
    }

    private Bitmap pinBitmap(RouteGeometry.Stop stop) {
        int size = dp(36);
        Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        boolean done = "completed".equals(stop.status) || "skipped".equals(stop.status) || "failed".equals(stop.status);
        boolean syncing = syncingStopIds.contains(stop.stopId);
        paint.setColor(syncing ? 0xFFD97706 : done ? 0xFF16A34A : 0xFF276EF1);
        canvas.drawCircle(size / 2f, size / 2f, size / 2f - dp(3), paint);
        paint.setColor(Color.WHITE);
        paint.setTextSize(dp(13));
        paint.setTypeface(Typeface.DEFAULT_BOLD);
        String label = String.valueOf(stop.sequence);
        float width = paint.measureText(label);
        canvas.drawText(label, (size - width) / 2f, size / 2f + dp(4), paint);
        return bitmap;
    }

    private void showStopSheet(RouteGeometry.Stop stop) {
        Dialog dialog = new Dialog(this);
        ScrollView scroll = new ScrollView(this);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(20), dp(20), dp(20), dp(24));
        scroll.addView(layout);
        dialog.setContentView(scroll);

        TextView title = new TextView(this);
        title.setText(stop.sequence + ". " + stop.reference + " - " + stop.type.toUpperCase());
        title.setTextSize(18);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        layout.addView(title);

        TextView address = new TextView(this);
        address.setText(stop.address);
        address.setTextSize(14);
        address.setPadding(0, dp(6), 0, 0);
        layout.addView(address);

        TextView status = new TextView(this);
        status.setText("Status: " + stop.status
                + (stop.windowEnd.isEmpty() ? "" : "  \u00b7  window ends " + stop.windowEnd));
        status.setTextSize(12);
        status.setTextColor(Color.rgb(102, 112, 133));
        status.setPadding(0, dp(6), 0, dp(8));
        layout.addView(status);

        addAction(layout, dialog, "Arrive", () -> runCommand("arrive", stop, null));
        addAction(layout, dialog, "Upload photo", () -> capturePhoto(stop));
        addAction(layout, dialog, "Recipient signature", () -> promptSignature(stop));
        addAction(layout, dialog, "Add note", () -> promptNote(stop));
        addAction(layout, dialog, "Complete delivery", () -> promptRecipientAndComplete(stop));

        dialog.show();
    }

    private void addAction(LinearLayout layout, Dialog dialog, String label, Runnable action) {
        Button button = new Button(this);
        button.setText(label);
        button.setOnClickListener(v -> {
            dialog.dismiss();
            action.run();
        });
        layout.addView(button);
    }

    private void runCommand(String kind, RouteGeometry.Stop stop, String recipient) {
        if (busy) return;
        busy = true;
        executor.execute(() -> {
            try {
                CommandQueue.Result result = CommandSubmitter.command(
                        this, kind, stop.jobId, stop.stopId, recipient, null);
                runOnUiThread(() -> {
                    if (result.sent > 0 && result.remaining == 0) {
                        toast(kind + " confirmed on the system");
                        loadRoute(); // repaint pins from server truth
                    } else if (result.remaining > 0) {
                        syncingStopIds.add(stop.stopId);
                        toast("No connection - saved offline. It will sync automatically.");
                        renderRoute(geometry); // amber pin feedback now
                    } else if (result.conflicts > 0) {
                        toast("Dispatch changed this stop - refreshing.");
                        loadRoute();
                    }
                });
            } catch (Exception error) {
                runOnUiThread(() -> toast("Failed: " + error.getMessage()));
            } finally {
                busy = false;
            }
        });
    }

    private void capturePhoto(RouteGeometry.Stop stop) {
        try {
            android.content.ContentValues values = new android.content.ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, "pf_" + System.currentTimeMillis() + ".jpg");
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
            pendingPhotoUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            pendingPhotoJobId = stop.jobId;
            pendingPhotoStopId = stop.stopId;
            Intent capture = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            capture.putExtra(MediaStore.EXTRA_OUTPUT, pendingPhotoUri);
            startActivityForResult(capture, 200);
        } catch (Exception error) {
            toast("Camera unavailable: " + error.getMessage());
        }
    }

    private void promptSignature(RouteGeometry.Stop stop) {
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
            dialog.dismiss();
            submitEvidence("evidence_signature", stop, "pathData", pathData);
        });
        layout.addView(save);
        dialog.setContentView(layout);
        dialog.show();
    }

    private void promptNote(RouteGeometry.Stop stop) {
        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setTitle("Note for dispatch");
        EditText input = new EditText(this);
        builder.setView(input);
        builder.setPositiveButton("Send", (d, w) -> {
            String text = input.getText().toString().trim();
            if (!text.isEmpty()) {
                submitEvidence("evidence_note", stop, "note", text);
            }
        });
        builder.setNegativeButton("Cancel", null);
        builder.show();
    }

    private void promptRecipientAndComplete(RouteGeometry.Stop stop) {
        // The window must not close silently: it reports Sending, stays open
        // on failure, and only closes with a clear confirmation or a visible
        // offline warning.
        Dialog dialog = new Dialog(this);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(20), dp(20), dp(20), dp(20));
        TextView title = new TextView(this);
        title.setText("Complete delivery");
        title.setTextSize(20);
        layout.addView(title);
        EditText input = new EditText(this);
        input.setHint("Recipient name");
        layout.addView(input);
        TextView status = new TextView(this);
        status.setTextSize(12);
        status.setPadding(0, dp(8), 0, dp(4));
        layout.addView(status);
        Button complete = new Button(this);
        complete.setText("Complete");
        complete.setOnClickListener(v -> {
            String recipient = input.getText().toString().trim();
            if (recipient.isEmpty()) {
                status.setTextColor(Color.rgb(180, 83, 9));
                status.setText("Recipient name is required.");
                return;
            }
            complete.setEnabled(false);
            status.setTextColor(Color.rgb(102, 112, 133));
            status.setText("Sending to the system\u2026");
            if (busy) {
                status.setText("Another action is still in progress - try again.");
                complete.setEnabled(true);
                return;
            }
            busy = true;
            executor.execute(() -> {
                try {
                    CommandQueue.Result result = CommandSubmitter.command(
                            this, "complete", stop.jobId, stop.stopId, recipient, null);
                    runOnUiThread(() -> {
                        busy = false;
                        if (result.sent > 0 && result.remaining == 0) {
                            status.setTextColor(0xFF16A34A);
                            status.setText("Completed and confirmed on the system.");
                            loadRoute();
                            handler.postDelayed(dialog::dismiss, 900);
                        } else if (result.remaining > 0) {
                            syncingStopIds.add(stop.stopId);
                            renderRoute(geometry);
                            status.setTextColor(Color.rgb(180, 83, 9));
                            status.setText("No connection right now. Your completion is saved offline and will sync automatically - the pin shows amber until then.");
                            complete.setEnabled(false);
                            input.setEnabled(false);
                            Button close = new Button(this);
                            close.setText("OK - I understand");
                            close.setOnClickListener(w -> dialog.dismiss());
                            layout.addView(close);
                        } else if (result.conflicts > 0) {
                            status.setTextColor(Color.rgb(180, 83, 9));
                            status.setText("Dispatch changed this stop. Refreshing the map.");
                            loadRoute();
                            handler.postDelayed(dialog::dismiss, 900);
                        }
                    });
                } catch (Exception error) {
                    runOnUiThread(() -> {
                        busy = false;
                        complete.setEnabled(true);
                        status.setTextColor(Color.rgb(190, 30, 45));
                        status.setText("Failed: " + error.getMessage());
                    });
                }
            });
        });
        layout.addView(complete);
        Button cancel = new Button(this);
        cancel.setText("Cancel");
        cancel.setOnClickListener(v -> dialog.dismiss());
        layout.addView(cancel);
        dialog.setContentView(layout);
        dialog.show();
    }

    private void submitEvidence(String kind, RouteGeometry.Stop stop, String field, String value) {
        executor.execute(() -> {
            try {
                CommandQueue.Result result = CommandSubmitter.evidence(
                        this, kind, stop.jobId, stop.stopId, field, value);
                runOnUiThread(() -> {
                    if (result.sent > 0 && result.remaining == 0) {
                        toast("Evidence saved on the system");
                    } else if (result.remaining > 0) {
                        syncingStopIds.add(stop.stopId);
                        toast("No connection - evidence saved offline, will sync automatically.");
                        renderRoute(geometry);
                    } else if (result.conflicts > 0) {
                        toast("Conflict - refreshing.");
                        loadRoute();
                    }
                });
            } catch (Exception error) {
                runOnUiThread(() -> toast("Evidence failed: " + error.getMessage()));
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != 200 || resultCode != RESULT_OK || pendingPhotoUri == null) return;
        Uri uri = pendingPhotoUri;
        String jobId = pendingPhotoJobId;
        String stopId = pendingPhotoStopId;
        pendingPhotoUri = null;
        executor.execute(() -> {
            try (InputStream stream = getContentResolver().openInputStream(uri)) {
                Bitmap bitmap = BitmapFactory.decodeStream(stream);
                if (bitmap == null) throw new IllegalStateException("Could not read photo");
                int max = 1280;
                float scale = Math.min(1f, Math.min((float) max / bitmap.getWidth(), (float) max / bitmap.getHeight()));
                Bitmap scaled = scale < 1f
                        ? Bitmap.createScaledBitmap(bitmap, Math.round(bitmap.getWidth() * scale),
                        Math.round(bitmap.getHeight() * scale), true)
                        : bitmap;
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                scaled.compress(Bitmap.CompressFormat.JPEG, 80, output);
                String path = EvidenceStore.savePhoto(this, output.toByteArray());
                RouteGeometry.Stop stop = new RouteGeometry.Stop(
                        0, stopId, jobId, "", "", "", "", "", "", null, 0, 0);
                submitEvidence("evidence_photo", stop, "path", path);
            } catch (Exception error) {
                runOnUiThread(() -> toast("Photo failed: " + error.getMessage()));
            }
        });
    }

    @Override
    protected void onStart() {
        super.onStart();
        mapView.onStart();
    }

    @Override
    protected void onStop() {
        mapView.onStop();
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        mapView.onDestroy();
        super.onDestroy();
    }

    @Override
    public void onLowMemory() {
        super.onLowMemory();
        mapView.onLowMemory();
    }

    private int dp(int value) {
        return Math.round(value * Resources.getSystem().getDisplayMetrics().density);
    }

    private void toast(String message) {
        runOnUiThread(() -> Toast.makeText(this, message, Toast.LENGTH_SHORT).show());
    }
}


