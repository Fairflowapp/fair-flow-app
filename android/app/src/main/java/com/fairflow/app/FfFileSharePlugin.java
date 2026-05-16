package com.fairflow.app;

import android.content.Context;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;

/**
 * Minimal pure-Java Capacitor plugin that writes a base64 payload to the app's
 * cache directory and returns a file:// URI. This is used as a fallback when
 * the standard @capacitor/filesystem plugin fails to load (e.g. because the
 * Android project is not configured for Kotlin).
 *
 * The matching Share plugin (Java) can then share that URI as a real image
 * file via the system share sheet.
 */
@CapacitorPlugin(name = "FfFileShare")
public class FfFileSharePlugin extends Plugin {

    @PluginMethod
    public void writeAndGetUri(PluginCall call) {
        String fileName = call.getString("fileName");
        String base64 = call.getString("data");
        if (fileName == null || base64 == null) {
            call.reject("missing fileName or data");
            return;
        }
        try {
            Context context = getContext();
            File cacheDir = context.getCacheDir();
            if (cacheDir == null) {
                call.reject("cache dir unavailable");
                return;
            }
            File outFile = new File(cacheDir, fileName);
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            FileOutputStream fos = new FileOutputStream(outFile);
            try {
                fos.write(bytes);
                fos.flush();
            } finally {
                fos.close();
            }
            String uri = "file://" + outFile.getAbsolutePath();
            JSObject ret = new JSObject();
            ret.put("uri", uri);
            ret.put("path", outFile.getAbsolutePath());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("write failed: " + (e.getMessage() == null ? e.toString() : e.getMessage()));
        }
    }
}
