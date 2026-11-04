package com.privatefleet.driver.nativeapp;

import android.content.Context;

import org.maplibre.android.geometry.LatLngBounds;
import org.maplibre.android.offline.OfflineManager;
import org.maplibre.android.offline.OfflineRegion;
import org.maplibre.android.offline.OfflineRegionError;
import org.maplibre.android.offline.OfflineRegionStatus;
import org.maplibre.android.offline.OfflineTilePyramidRegionDefinition;

import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Offline tile region lifecycle for the driver map (Greater London, zoom
 * 0-12). Rule: downloaded once, kept forever, refreshed incrementally in the
 * background only when the network allows. No region + no network means the
 * caller keeps the list UI.
 */
public final class MapCacheManager {
    public interface Listener {
        void onState(String message, boolean hasOfflineData);
    }

    private static final String STYLE_URI = "https://tiles.openfreemap.org/styles/liberty";
    private static final double NORTH = 51.75;
    private static final double EAST = 0.35;
    private static final double SOUTH = 51.20;
    private static final double WEST = -0.65;
    private static final int MIN_ZOOM = 0;
    private static final int MAX_ZOOM = 12;

    private final Context context;
    private final Listener listener;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private OfflineTilePyramidRegionDefinition definition;

    public MapCacheManager(Context context, Listener listener) {
        this.context = context.getApplicationContext();
        this.listener = listener;
    }

    public OfflineTilePyramidRegionDefinition definition() {
        if (definition == null) {
            definition = new OfflineTilePyramidRegionDefinition(
                    STYLE_URI, bounds(), MIN_ZOOM, MAX_ZOOM, density());
        }
        return definition;
    }

    /** Called once the map style has loaded. */
    public void start() {
        OfflineManager manager = OfflineManager.getInstance(context);
        manager.listOfflineRegions(new OfflineManager.ListOfflineRegionsCallback() {
            @Override
            public void onList(OfflineRegion[] regions) {
                if (regions.length > 0) {
                    listener.onState("Map ready (offline)", true);
                    refreshInBackground(regions[0]);
                } else if (NetworkState.online(context)) {
                    createRegion(manager);
                } else {
                    listener.onState(
                            "Map needs a first download on a better connection - staying in list mode.", false);
                }
            }

            @Override
            public void onError(String error) {
                listener.onState("Map offline store unavailable - using list mode.", false);
            }
        });
    }

    private void createRegion(OfflineManager manager) {
        listener.onState("Downloading map for offline use\u2026 0%", false);
        byte[] metadata = "{\"name\":\"Greater London\"}".getBytes(StandardCharsets.UTF_8);
        manager.createOfflineRegion(definition(), metadata, new OfflineManager.CreateOfflineRegionCallback() {
            @Override
            public void onCreate(OfflineRegion region) {
                region.setObserver(new OfflineRegion.OfflineRegionObserver() {
                    @Override
                    public void onStatusChanged(OfflineRegionStatus status) {
                        if (status.isComplete()) {
                            listener.onState("Map ready (offline)", true);
                        } else if (status.getDownloadState() == OfflineRegion.STATE_ACTIVE) {
                            long required = status.getRequiredResourceCount();
                            long completed = status.getCompletedResourceCount();
                            int percent = required == 0 ? 0
                                    : (int) Math.round(100.0 * completed / required);
                            listener.onState(String.format(Locale.US,
                                    "Downloading map for offline use\u2026 %d%%", percent), false);
                        }
                    }

                    @Override
                    public void onError(OfflineRegionError error) {
                        listener.onState("Map download failed - using list mode.", false);
                    }

                    @Override
                    public void mapboxTileCountLimitExceeded(long limit) {
                        listener.onState("Map download size limit exceeded.", false);
                    }
                });
                region.setDownloadState(OfflineRegion.STATE_ACTIVE);
            }

            @Override
            public void onError(String error) {
                listener.onState("Map download failed - using list mode.", false);
            }
        });
    }

    private void refreshInBackground(OfflineRegion region) {
        executor.execute(() -> {
            try {
                if (!NetworkState.online(context)) return;
                // Keep the region forever; invalidate marks cached tiles
                // stale so the SDK re-fetches only changed tiles, then
                // re-arm the download state.
                region.invalidate(new OfflineRegion.OfflineRegionInvalidateCallback() {
                    @Override
                    public void onInvalidate() {
                        region.setDownloadState(OfflineRegion.STATE_ACTIVE);
                    }

                    @Override
                    public void onError(String error) {
                    }
                });
            } catch (Exception ignored) {
            }
        });
    }

    private LatLngBounds bounds() {
        return LatLngBounds.from(NORTH, EAST, SOUTH, WEST);
    }

    private float density() {
        return context.getResources().getDisplayMetrics().density;
    }
}
