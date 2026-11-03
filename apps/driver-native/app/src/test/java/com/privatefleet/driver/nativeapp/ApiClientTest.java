package com.privatefleet.driver.nativeapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Arrays;

public class ApiClientTest {
    @Test
    public void orderedBasesContainsBothOriginsWithoutDuplicates() {
        String[] bases = ApiClient.orderedBases();
        assertEquals(2, bases.length);
        assertEquals(Arrays.stream(bases).distinct().count(), bases.length);
        assertTrue(Arrays.asList(bases).contains("https://api.privatefleet.home.arpa"));
        assertTrue(Arrays.asList(bases).contains(ApiClient.BASE));
    }
}
