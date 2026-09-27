package ru.uust.campus;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.CalendarContract;
import android.view.View;
import android.webkit.*;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** An offline Android shell. Only packaged assets execute JS; remote content is JSON. */
public final class MainActivity extends Activity {
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private static final String ORIGIN = "appassets.androidplatform.net";
    private static final String API = "https://dev.uust-time.ru/api/v/852972/";
    private final ConcurrentHashMap<String, Cached> cache = new ConcurrentHashMap<>();
    private static class Cached { final byte[] data; final long at; Cached(byte[] d) {data=d; at=System.currentTimeMillis();} }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(0xfff6f7f2);
        web.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        setContentView(web);
        web.setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setTextZoom(Math.round(100 * getResources().getConfiguration().fontScale));
        web.addJavascriptInterface(new CampusActions(), "CampusAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if ("https".equals(u.getScheme()) && ORIGIN.equals(u.getHost())) return false;
                if (request.isForMainFrame()) openExternal(u.toString());
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (!"https".equals(u.getScheme()) || !ORIGIN.equals(u.getHost())) return response(403, "text/plain", "Blocked");
                String path = u.getPath();
                if (path == null) return response(404, "text/plain", "Not found");
                if (path.startsWith("/api/")) return apiResponse(u);
                try {
                    String asset = path.equals("/") ? "index.html" : path.substring(1);
                    if (asset.contains("..")) return response(403, "text/plain", "Blocked");
                    String mime = asset.endsWith(".js") ? "application/javascript" : asset.endsWith(".css") ? "text/css" : asset.endsWith(".json") ? "application/json" : asset.endsWith(".svg") ? "image/svg+xml" : asset.endsWith(".jpg") ? "image/jpeg" : asset.endsWith(".woff2") ? "font/woff2" : "text/html";
                    return new WebResourceResponse(mime, "UTF-8", getAssets().open(asset));
                } catch (IOException e) {android.util.Log.e("CampusAssets", path, e); return response(404, "text/plain", "Not found");}
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                pick.setType("*/*");
                pick.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain"});
                try {startActivityForResult(pick, 12);} catch (Exception e) {fileCallback.onReceiveValue(null); fileCallback=null;}
                return true;
            }
        });
        web.loadUrl("https://" + ORIGIN + "/index.html");
    }

    private WebResourceResponse apiResponse(Uri uri) {
        String target;
        if ("/api/groups".equals(uri.getPath())) target = "groups";
        else if ("/api/schedule".equals(uri.getPath())) {
            String id = uri.getQueryParameter("group");
            String semester = uri.getQueryParameter("semester");
            if (id == null || !id.matches("[1-9][0-9]{0,8}") || semester == null || !semester.matches("[1-9][0-9]{0,5}")) return response(400, "application/json", "{\"error\":\"Invalid parameters\"}");
            target = "schedule/0/"+id+"/semester/"+semester;
        } else return response(404, "application/json", "{}");
        try {
            Cached c=cache.get(target);
            if(c != null && System.currentTimeMillis()-c.at < 30000) return new WebResourceResponse("application/json","UTF-8",new ByteArrayInputStream(c.data));
            HttpURLConnection conn = (HttpURLConnection)new URL(API + target + "?site=schedule").openConnection();
            conn.setConnectTimeout(12000); conn.setReadTimeout(16000); conn.setInstanceFollowRedirects(false);
            conn.setRequestProperty("Accept","application/json");
            conn.setRequestProperty("User-Agent","UUSTCampus/0.1 (student hackathon)");
            try {
                int code=conn.getResponseCode();
                if(code != 200) throw new IOException("Source HTTP " + code);
                ByteArrayOutputStream out=new ByteArrayOutputStream();
                try(InputStream in=conn.getInputStream()) {byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1){out.write(buf,0,n);if(out.size()>8*1024*1024)throw new IOException("Response too large");}}
                byte[] data=out.toByteArray(); cache.put(target,new Cached(data));
                return new WebResourceResponse("application/json","UTF-8",new ByteArrayInputStream(data));
            } finally {conn.disconnect();}
        } catch(Exception e) {android.util.Log.w("CampusSource", e.getClass().getSimpleName()+": "+e.getMessage());return response(502,"application/json","{\"error\":\"Источник недоступен. Сохранённые данные остаются в приложении.\"}");}
    }
    private WebResourceResponse response(int code,String mime,String text) {
        return new WebResourceResponse(mime,"UTF-8",code,code==200?"OK":"Error",Collections.singletonMap("Cache-Control","no-store"),new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)));
    }
    private void openExternal(String url) {
        Uri u=Uri.parse(url);
        if(!"https".equals(u.getScheme()) || u.getHost()==null) return;
        runOnUiThread(() -> {try {startActivity(new Intent(Intent.ACTION_VIEW,u));}catch(Exception e){Toast.makeText(this,"Не найден браузер",Toast.LENGTH_SHORT).show();}});
    }
    public final class CampusActions {
        @JavascriptInterface public void openExternal(String url) {MainActivity.this.openExternal(url);}
        @JavascriptInterface public void addCalendar(String json) {
            runOnUiThread(() -> {try {
                JSONObject data=new JSONObject(json);
                Intent i=new Intent(Intent.ACTION_INSERT).setData(CalendarContract.Events.CONTENT_URI);
                i.putExtra(CalendarContract.Events.TITLE,data.getString("title"));
                i.putExtra(CalendarContract.Events.EVENT_LOCATION,data.optString("location"));
                i.putExtra(CalendarContract.Events.DESCRIPTION,data.optString("description")+"\nВремя указано для Уфы (UTC+5).");
                i.putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME,data.getLong("start"));
                i.putExtra(CalendarContract.EXTRA_EVENT_END_TIME,data.getLong("end"));
                startActivity(i);
            }catch(Exception e){Toast.makeText(MainActivity.this,"Установите приложение календаря для напоминаний",Toast.LENGTH_LONG).show();}});
        }
    }
    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data) {
        super.onActivityResult(requestCode,resultCode,data);
        if(requestCode==12 && fileCallback!=null){fileCallback.onReceiveValue(resultCode==RESULT_OK && data!=null && data.getData()!=null?new Uri[]{data.getData()}:null);fileCallback=null;}
    }
    @Override public void onBackPressed() {web.evaluateJavascript("window.campusBack && window.campusBack()",result -> {if(!"true".equals(result))finish();});}
    @Override protected void onDestroy(){if(fileCallback!=null)fileCallback.onReceiveValue(null);web.removeJavascriptInterface("CampusAndroid");web.destroy();super.onDestroy();}
}
