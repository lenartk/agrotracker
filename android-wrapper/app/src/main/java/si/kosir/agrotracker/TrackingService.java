package si.kosir.agrotracker;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

public class TrackingService extends Service implements LocationListener {
    static final String PREFS = "agrotracker_native";
    static final String KEY_TRACKING = "tracking";
    static final String KEY_UI_VISIBLE = "ui_visible";
    private static final String CHANNEL_ID = "agrotracker_gps";
    private static final int NOTIFICATION_ID = 42;

    private LocationManager locationManager;
    private PowerManager.WakeLock cpuWakeLock;
    private long lastStoredMs = 0;
    private Location lastStored = null;
    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        cpuWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AgroTracker:BackgroundGps");
        cpuWakeLock.setReferenceCounted(false);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(KEY_TRACKING, true).apply();

        if (cpuWakeLock != null && !cpuWakeLock.isHeld()) {
            cpuWakeLock.acquire();
        }
        startLocationUpdates();
        return START_STICKY;
    }

    private void startLocationUpdates() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
                && checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            stopSelf();
            return;
        }
        try {
            locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0.5f, this);
        } catch (Exception ignored) {
        }
        try {
            locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 3000L, 2.0f, this);
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onLocationChanged(Location location) {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (prefs.getBoolean(KEY_UI_VISIBLE, true)) return;

        long now = location.getTime() > 0 ? location.getTime() : System.currentTimeMillis();
        if (lastStored != null && now - lastStoredMs < 1800L
                && location.distanceTo(lastStored) < 0.7f) {
            return;
        }

        LocationBuffer.append(this, location);
        lastStoredMs = now;
        lastStored = new Location(location);
    }

    private Notification buildNotification() {
        Intent launch = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(
                this, 0, launch,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        return b.setContentTitle(getString(R.string.tracking_active))
                .setContentText(getString(R.string.tracking_note))
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentIntent(pi)
                .setOngoing(true)
                .setCategory(Notification.CATEGORY_SERVICE)
                .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID,
                getString(R.string.tracking_channel),
                NotificationManager.IMPORTANCE_LOW);
        ch.setDescription(getString(R.string.tracking_note));
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(ch);
    }

    @Override
    public void onDestroy() {
        try {
            if (locationManager != null) locationManager.removeUpdates(this);
        } catch (Exception ignored) {
        }
        if (cpuWakeLock != null && cpuWakeLock.isHeld()) cpuWakeLock.release();
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(KEY_TRACKING, false).apply();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onProviderEnabled(String provider) {}

    @Override
    public void onProviderDisabled(String provider) {}
}
