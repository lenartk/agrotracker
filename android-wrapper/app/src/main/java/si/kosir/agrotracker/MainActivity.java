package si.kosir.agrotracker;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private static final String APP_URL = "https://lenartk.github.io/agrotracker/?native=1";
    private static final int REQ_PERMISSIONS = 7001;

    private WebView webView;
    private boolean pendingTrackingStart = false;
    private boolean pendingInitialLoad = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " AgroTrackerNative/1");

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(
                    String origin, GeolocationPermissions.Callback callback) {
                boolean ok = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                        == PackageManager.PERMISSION_GRANTED;
                if (!ok) requestLocationPermission();
                callback.invoke(origin, ok, false);
            }
        });
        webView.addJavascriptInterface(new NativeBridge(), "AgroNative");

        setUiVisible(true);
        if (hasLocationPermission()) {
            requestNotificationPermissionIfNeeded();
            webView.loadUrl(APP_URL);
        } else {
            pendingInitialLoad = true;
            requestLocationPermission();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        setUiVisible(true);
        if (webView != null) {
            webView.onResume();
            webView.postDelayed(() ->
                    webView.evaluateJavascript(
                            "window.dispatchEvent(new Event('agrotrackerNativeResume'));", null),
                    250L);
        }
    }
    @Override
    protected void onPause() {
        setUiVisible(false);
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("AgroNative");
            webView.destroy();
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    private void setUiVisible(boolean visible) {
        getSharedPreferences(TrackingService.PREFS, MODE_PRIVATE)
                .edit().putBoolean(TrackingService.KEY_UI_VISIBLE, visible).apply();
    }

    private boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private void requestLocationPermission() {
        requestPermissions(
                new String[]{Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION},
                REQ_PERMISSIONS);
    }
    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_PERMISSIONS + 1);
        }
    }

    private boolean startTrackingService() {
        if (!hasLocationPermission()) {
            pendingTrackingStart = true;
            runOnUiThread(this::requestLocationPermission);
            return false;
        }

        Intent i = new Intent(this, TrackingService.class);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(i);
        else startService(i);
        return true;
    }

    private void stopTrackingService() {
        stopService(new Intent(this, TrackingService.class));
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_PERMISSIONS) {
            if (pendingInitialLoad) {
                pendingInitialLoad = false;
                requestNotificationPermissionIfNeeded();
                webView.loadUrl(APP_URL);
            }
            if (pendingTrackingStart) {
                pendingTrackingStart = false;
                if (hasLocationPermission()) startTrackingService();
            }
        }
    }

    public final class NativeBridge {
        @JavascriptInterface
        public boolean startBackgroundTracking() {
            return startTrackingService();
        }

        @JavascriptInterface
        public void stopBackgroundTracking() {
            stopTrackingService();
        }
        @JavascriptInterface
        public String drainLocations() {
            return LocationBuffer.drain(MainActivity.this);
        }

        @JavascriptInterface
        public void clearLocations() {
            LocationBuffer.clear(MainActivity.this);
        }

        @JavascriptInterface
        public boolean isBackgroundTracking() {
            return getSharedPreferences(TrackingService.PREFS, MODE_PRIVATE)
                    .getBoolean(TrackingService.KEY_TRACKING, false);
        }

        @JavascriptInterface
        public String platform() {
            return "android";
        }

        @JavascriptInterface
        public String wrapperVersion() {
            return "1";
        }
    }
}
