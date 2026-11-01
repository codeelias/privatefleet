package com.privatefleet.driver.nativeapp;

import android.content.Context;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/** App-private, encrypted evidence files awaiting upload. */
public final class EvidenceStore {
    private static final String DIR = "pending_evidence";

    private EvidenceStore() {
    }

    public static String savePhoto(Context context, byte[] jpeg) throws Exception {
        File dir = new File(context.getFilesDir(), DIR);
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IllegalStateException("Could not create evidence directory");
        }
        String name = "photo-" + System.currentTimeMillis() + "-"
                + java.util.UUID.randomUUID() + ".enc";
        File file = new File(dir, name);
        String encoded = android.util.Base64.encodeToString(jpeg, android.util.Base64.NO_WRAP);
        Files.write(file.toPath(), SecureStore.encrypt(encoded).getBytes(StandardCharsets.UTF_8));
        return file.getAbsolutePath();
    }

    public static byte[] readPhoto(String path) throws Exception {
        String stored = new String(Files.readAllBytes(new File(path).toPath()),
                StandardCharsets.UTF_8);
        String encoded = SecureStore.decrypt(stored);
        if (encoded == null) throw new IllegalStateException("Evidence decrypt failed");
        return android.util.Base64.decode(encoded, android.util.Base64.NO_WRAP);
    }

    public static void delete(String path) {
        if (path == null) return;
        //noinspection ResultOfMethodCallIgnored
        new File(path).delete();
    }
}

