package com.privatefleet.driver.nativeapp;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.view.MotionEvent;
import android.view.View;

/** Minimal signature pad that exports an SVG path for the evidence contract. */
public class SignatureView extends View {
    private final Paint paint = new Paint();
    private final Path path = new Path();
    private final StringBuilder points = new StringBuilder();
    private float lastX;
    private float lastY;

    public SignatureView(Context context) {
        super(context);
        paint.setAntiAlias(true);
        paint.setStrokeWidth(5f);
        paint.setStyle(Paint.Style.STROKE);
        paint.setColor(0xFF111111);
        setBackgroundColor(0xFFFFFFFF);
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        float x = event.getX();
        float y = event.getY();
        switch (event.getAction()) {
            case MotionEvent.ACTION_DOWN:
                path.moveTo(x, y);
                points.append("M ").append(Math.round(x)).append(" ").append(Math.round(y));
                lastX = x;
                lastY = y;
                invalidate();
                return true;
            case MotionEvent.ACTION_MOVE:
                path.lineTo(x, y);
                points.append(" L ").append(Math.round(x)).append(" ").append(Math.round(y));
                lastX = x;
                lastY = y;
                invalidate();
                return true;
            default:
                return true;
        }
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        canvas.drawPath(path, paint);
    }

    public String getPathData() {
        return points.toString().trim();
    }

    public void clear() {
        path.reset();
        points.setLength(0);
        invalidate();
    }
}
