package si.kosir.agrotracker;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.util.Arrays;

public class MainActivity extends Activity {
    private static final String APP_URL = "https://lenartk.github.io/agrotracker/?native=1";
    private static final int REQ_PERMISSIONS = 7001;
    private static final int REQ_FILE_CHOOSER = 7003;
    private static final String PENDING_IMPORT_FILE = "pending_agrotracker_import.json";
    private static final long MAX_IMPORT_BYTES = 256L * 1024L * 1024L;

    private WebView webView;
    private boolean pendingTrackingStart = false;
    private boolean pendingInitialLoad = false;
    private ValueCallback<Uri[]> fileChooserCallback;

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
        s.setUserAgentString(s.getUserAgentString() + " AgroTrackerNative/2");

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

            @Override
            public boolean onShowFileChooser(
                    WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE_CHOOSER);
                    return true;
                } catch (Exception e) {
                    fileChooserCallback = null;
                    return false;
                }
            }
        });
        webView.addJavascriptInterface(new NativeBridge(), "AgroNative");

        saveIncomingBackup(getIntent());
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
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (saveIncomingBackup(intent)) notifyImportReady();
    }

    @Override
    protected void onResume() {
        super.onResume();
        setUiVisible(true);
        if (webView != null) {
            webView.onResume();
            webView.postDelayed(() -> webView.evaluateJavascript(
                    "window.dispatchEvent(new Event('agrotrackerNativeResume'));", null), 250L);
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
        if (fileChooserCallback != null) {
            fileChooserCallback.onReceiveValue(null);
            fileChooserCallback = null;
        }
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

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER) {
            Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(result);
            fileChooserCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
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

    private File pendingImportFile() {
        return new File(getFilesDir(), PENDING_IMPORT_FILE);
    }

    private Uri incomingUri(Intent intent) {
        if (intent == null) return null;
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            if (Build.VERSION.SDK_INT >= 33) {
                return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
            }
            @SuppressWarnings("deprecation")
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            return uri;
        }
        if (Intent.ACTION_VIEW.equals(intent.getAction())) return intent.getData();
        return null;
    }

    private boolean saveIncomingBackup(Intent intent) {
        Uri uri = incomingUri(intent);
        if (uri == null) return false;
        File target = pendingImportFile();
        File temp = new File(getFilesDir(), PENDING_IMPORT_FILE + ".tmp");
        long total = 0;
        try (InputStream in = getContentResolver().openInputStream(uri);
             FileOutputStream out = new FileOutputStream(temp, false)) {
            if (in == null) return false;
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > MAX_IMPORT_BYTES) throw new IllegalArgumentException("Backup je prevelik");
                out.write(buf, 0, n);
            }
            out.getFD().sync();
        } catch (Exception e) {
            temp.delete();
            return false;
        }
        if (total <= 0) {
            temp.delete();
            return false;
        }
        if (target.exists()) target.delete();
        if (!temp.renameTo(target)) {
            temp.delete();
            return false;
        }
        return true;
    }

    private void notifyImportReady() {
        if (webView == null) return;
        webView.postDelayed(() -> webView.evaluateJavascript(
                "window.dispatchEvent(new Event('agrotrackerNativeImportReady'));", null), 250L);
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
        public long pendingImportSize() {
            File f = pendingImportFile();
            return f.exists() ? f.length() : 0L;
        }

        @JavascriptInterface
        public String readPendingImportChunk(long offset, int requestedLength) {
            File f = pendingImportFile();
            if (!f.exists() || offset < 0 || offset >= f.length()) return "";
            int length = Math.max(1, Math.min(requestedLength, 256 * 1024));
            int actual = (int) Math.min((long) length, f.length() - offset);
            byte[] buf = new byte[actual];
            try (RandomAccessFile raf = new RandomAccessFile(f, "r")) {
                raf.seek(offset);
                int n = raf.read(buf);
                if (n <= 0) return "";
                if (n != buf.length) buf = Arrays.copyOf(buf, n);
                return Base64.encodeToString(buf, Base64.NO_WRAP);
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void clearPendingImport() {
            File f = pendingImportFile();
            if (f.exists()) f.delete();
        }

        @JavascriptInterface
        public String platform() {
            return "android";
        }

        @JavascriptInterface
        public String wrapperVersion() {
            return "2";
        }
    }
}
