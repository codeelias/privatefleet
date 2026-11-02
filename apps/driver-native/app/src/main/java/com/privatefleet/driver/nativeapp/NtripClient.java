package com.privatefleet.driver.nativeapp;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Minimal NTRIP client for RTCM correction transport. It only receives the
 * correction stream and reports status; it does not compute a fixed position.
 * That belongs to the RTK solver, which must not claim "fixed" until it has
 * produced an ambiguity-fixed solution from raw observations + corrections.
 */
public final class NtripClient {
    public interface Listener {
        void onStatus(Status status);

        /** Raw stream bytes; the caller feeds them to the RTK solver decoder. */
        default void onCorrections(byte[] buffer, int length) {
        }
    }

    public static final class Status {
        public final boolean connected;
        public final long lastMessageAt;
        public final Set<Integer> messageTypes;
        public final String error;

        public Status(boolean connected, long lastMessageAt, Set<Integer> messageTypes, String error) {
            this.connected = connected;
            this.lastMessageAt = lastMessageAt;
            this.messageTypes = Collections.unmodifiableSet(new LinkedHashSet<>(messageTypes));
            this.error = error;
        }

        public long ageMs(long now) {
            return lastMessageAt == 0 ? Long.MAX_VALUE : Math.max(0, now - lastMessageAt);
        }
    }

    private final String host;
    private final int port;
    private final String mountpoint;
    private final String username;
    private final String password;
    private final Listener listener;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean running = new AtomicBoolean(false);
    private volatile Status status = new Status(false, 0L, Collections.emptySet(), "");

    public NtripClient(String host, int port, String mountpoint, String username,
                       String password, Listener listener) {
        this.host = host;
        this.port = port;
        this.mountpoint = mountpoint;
        this.username = username;
        this.password = password;
        this.listener = listener;
    }

    public void start() {
        if (!running.compareAndSet(false, true)) return;
        executor.execute(() -> {
            while (running.get()) {
                try {
                    streamOnce();
                } catch (Exception error) {
                    setStatus(new Status(false, status.lastMessageAt, status.messageTypes,
                            error.getMessage()));
                }
                if (running.get()) {
                    try {
                        Thread.sleep(5_000L);
                    } catch (InterruptedException interrupted) {
                        Thread.currentThread().interrupt();
                        return;
                    }
                }
            }
        });
    }

    private void streamOnce() throws IOException {
        String path = mountpoint.isEmpty() ? "/" : "/" + mountpoint;
        URL url = new URL("http://" + host + ":" + port + path);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(15_000);
        connection.setRequestMethod("GET");
        connection.setRequestProperty("Ntrip-Version", "Ntrip/2.0");
        connection.setRequestProperty("User-Agent", "NTRIP PrivateFleet/1.0");
        if (!username.isEmpty()) {
            connection.setRequestProperty("Authorization", basicAuth(username, password));
        }
        connection.connect();
        int code = connection.getResponseCode();
        if (code != 200) {
            throw new IOException("NTRIP HTTP " + code);
        }
        try (InputStream input = connection.getInputStream()) {
            readStream(input);
        }
    }

    private void readStream(InputStream input) throws IOException {
        byte[] header = new byte[3];
        byte[] length = new byte[3];
        byte[] buffer = new byte[4096];
        int headerIndex = 0;
        int lengthIndex = 0;
        int messageLength = 0;
        int messageIndex = 0;
        Set<Integer> types = new LinkedHashSet<>(status.messageTypes);
        int read;
        while (running.get() && (read = input.read(buffer)) != -1) {
            byte[] copy = new byte[read];
            System.arraycopy(buffer, 0, copy, 0, read);
            listener.onCorrections(copy, read);
            for (int index = 0; index < read; index += 1) {
                int value = buffer[index] & 0xFF;
                if (headerIndex < 3) {
                    if (headerIndex == 0 && value != 0xD3) continue;
                    header[headerIndex] = buffer[index];
                    headerIndex += 1;
                    if (headerIndex == 3) {
                        types.add((header[1] & 0xFF) << 4 | (header[2] & 0xFF) >> 4);
                    }
                } else if (lengthIndex < 3) {
                    length[lengthIndex] = buffer[index];
                    lengthIndex += 1;
                    if (lengthIndex == 3) {
                        messageLength = rtcmLength(length[0], length[1], length[2]);
                        messageIndex = 0;
                    }
                } else {
                    messageIndex += 1;
                    if (messageIndex >= messageLength + 3) {
                        setStatus(new Status(true, System.currentTimeMillis(), types, ""));
                        headerIndex = 0;
                        lengthIndex = 0;
                    }
                }
            }
        }
    }

    private void setStatus(Status next) {
        status = next;
        listener.onStatus(next);
    }

    public Status status() {
        return status;
    }

    public void stop() {
        running.set(false);
        executor.shutdownNow();
    }

    public static String basicAuth(String username, String password) {
        String token = username + ":" + password;
        return "Basic " + Base64.getEncoder().encodeToString(
                token.getBytes(StandardCharsets.UTF_8));
    }

    public static int rtcmLength(byte first, byte second, byte third) {
        return ((first & 0xFF) << 10) | ((second & 0xFF) << 3) | ((third & 0xFF) >> 5);
    }
}
