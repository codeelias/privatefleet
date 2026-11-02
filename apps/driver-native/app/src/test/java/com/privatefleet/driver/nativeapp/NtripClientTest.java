package com.privatefleet.driver.nativeapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

public class NtripClientTest {
    @Test
    public void basicAuthUsesStandardBase64Header() {
        String expected = "Basic " + Base64.getEncoder().encodeToString(
                "user:pass".getBytes(StandardCharsets.UTF_8));
        assertEquals(expected, NtripClient.basicAuth("user", "pass"));
    }

    @Test
    public void rtcmLengthDecodesTwelveBitLength() {
        // first 0x01, second 0x02, third 0x40 -> 1024 + 16 + 2 = 1042
        assertEquals(1042, NtripClient.rtcmLength((byte) 0x01, (byte) 0x02, (byte) 0x40));
        assertEquals(0, NtripClient.rtcmLength((byte) 0, (byte) 0, (byte) 0));
    }
}
