package com.privatefleet.driver.nativeapp;

import android.location.GnssMeasurement;
import android.location.GnssMeasurementsEvent;
import android.location.GnssNavigationMessage;
import android.util.Base64;
import android.util.Log;

/**
 * Raw GNSS capture for PPK validation. Emits `pf-raw` logcat lines with the
 * full observation and navigation-message fields so the RTKLIB post-processing
 * pipeline can reconstruct RINEX rover data. Volume is bounded (~1 Hz).
 */
public final class RawGnssLogger implements GnssQualityMonitor.RawListener {
    private static final String TAG = "pf-raw";
    private static final double CLIGHT = 299_792_458.0;

    @Override
    public void onMeasurements(GnssMeasurementsEvent event) {
        long timeNanos = event.getClock().getTimeNanos();
        long fullBias = event.getClock().getFullBiasNanos();
        double bias = event.getClock().getBiasNanos();
        StringBuilder line = new StringBuilder();
        line.append("meas t=").append(timeNanos)
                .append(" fullBias=").append(fullBias)
                .append(" bias=").append(bias);
        for (GnssMeasurement m : event.getMeasurements()) {
            int adrState = m.getAccumulatedDeltaRangeState();
            line.append(" | ")
                    .append("c=").append(m.getConstellationType())
                    .append(" sv=").append(m.getSvid())
                    .append(" freq=").append(m.hasCarrierFrequencyHz() ? m.getCarrierFrequencyHz() : 0)
                    .append(" cn0=").append(m.getCn0DbHz())
                    .append(" tRx=").append(m.getReceivedSvTimeNanos())
                    .append(" tOff=").append(m.getTimeOffsetNanos())
                    .append(" prRate=").append(m.getPseudorangeRateMetersPerSecond())
                    .append(" adr=").append(m.getAccumulatedDeltaRangeMeters())
                    .append(" adrState=").append(adrState)
                    .append(" mp=").append(m.getMultipathIndicator());
        }
        Log.i(TAG, line.toString());
    }

    @Override
    public void onNavigationMessage(GnssNavigationMessage message) {
        byte[] data = message.getData();
        Log.i(TAG, "nav type=" + message.getType()
                + " sv=" + message.getSvid()
                + " msgId=" + message.getMessageId()
                + " subId=" + message.getSubmessageId()
                + " data=" + Base64.encodeToString(data, Base64.NO_WRAP));
    }
}
