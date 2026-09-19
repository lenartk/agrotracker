package si.kosir.agrotracker;

import android.content.Context;
import android.location.Location;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;

final class LocationBuffer {
    private static final Object LOCK = new Object();
    private static final String FILE_NAME = "background_locations.jsonl";

    private LocationBuffer() {}

    static void append(Context context, Location loc) {
        synchronized (LOCK) {
            File file = new File(context.getFilesDir(), FILE_NAME);
            try (FileWriter out = new FileWriter(file, true)) {
                JSONObject o = new JSONObject();
                o.put("t", loc.getTime() > 0 ? loc.getTime() : System.currentTimeMillis());
                o.put("lat", loc.getLatitude());
                o.put("lng", loc.getLongitude());
                if (loc.hasSpeed()) o.put("spd", loc.getSpeed());
                if (loc.hasBearing()) o.put("hdg", loc.getBearing());
                if (loc.hasAccuracy()) o.put("acc", loc.getAccuracy());
                if (loc.hasAltitude()) o.put("alt", loc.getAltitude());
                out.write(o.toString());
                out.write("\n");
            } catch (Exception ignored) {
            }
        }
    }

    static String drain(Context context) {
        synchronized (LOCK) {
            File file = new File(context.getFilesDir(), FILE_NAME);
            JSONArray arr = new JSONArray();
            if (!file.exists()) return arr.toString();

            try (BufferedReader in = new BufferedReader(new FileReader(file))) {
                String line;
                while ((line = in.readLine()) != null) {
                    if (line.isBlank()) continue;
                    try {
                        arr.put(new JSONObject(line));
                    } catch (Exception ignored) {
                    }
                }
            } catch (Exception ignored) {
            }

            try {
                if (!file.delete()) {
                    try (FileWriter out = new FileWriter(file, false)) {
                        out.write("");
                    }
                }
            } catch (Exception ignored) {
            }
            return arr.toString();
        }
    }

    static void clear(Context context) {
        synchronized (LOCK) {
            File file = new File(context.getFilesDir(), FILE_NAME);
            if (file.exists()) file.delete();
        }
    }
}
