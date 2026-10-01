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
    private volatile String reminderTarget="null";
    private ValueCallback<Uri[]> fileCallback;
    private static final String ORIGIN = "appassets.androidplatform.net";
    private static final String API = "https://dev.uust-time.ru/api/v/852972/";
    private final ConcurrentHashMap<String, Cached> cache = new ConcurrentHashMap<>();
    private final ExecutorService communityExecutor = Executors.newFixedThreadPool(2);
    private static class Cached { final byte[] data; final long at; Cached(byte[] d) {data=d; at=System.currentTimeMillis();} }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        reminderTarget=getIntent().getStringExtra("reminderTarget");
        if(reminderTarget==null)reminderTarget="null";
        ReminderReceiver.rearm(this);
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
                    String mime = asset.endsWith(".js") ? "application/javascript" : asset.endsWith(".css") ? "text/css" : asset.endsWith(".json") ? "application/json" : asset.endsWith(".svg") ? "image/svg+xml" : asset.endsWith(".png") ? "image/png" : asset.endsWith(".webp") ? "image/webp" : (asset.endsWith(".jpg")||asset.endsWith(".jpeg")) ? "image/jpeg" : asset.endsWith(".woff2") ? "font/woff2" : "text/html";
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

    private void notificationChanged() {
        ReminderReceiver.rearm(this);
        if(web!=null)web.evaluateJavascript("window.campusNotificationChanged && window.campusNotificationChanged()",null);
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results) {
        super.onRequestPermissionsResult(request,permissions,results);if(request==41)notificationChanged();
    }
    @Override protected void onResume() {super.onResume();notificationChanged();}
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);setIntent(intent);
        String target=intent.getStringExtra("reminderTarget");if(target==null)return;
        try{reminderTarget=new JSONObject(target).toString();}catch(Exception e){return;}
        if(web!=null)web.evaluateJavascript("(()=>{if(!window.campusOpenReminder)return false;window.campusOpenReminder("+reminderTarget+");return true;})()",result->{if("true".equals(result))reminderTarget="null";});
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
        @JavascriptInterface public String notificationStatus() {return ReminderReceiver.status(MainActivity.this);}
        @JavascriptInterface public void testNotification() {
            try{ReminderReceiver.test(MainActivity.this);}catch(Exception e){throw new IllegalStateException("Проверьте разрешение уведомлений Android",e);}
        }
        @JavascriptInterface public String consumeReminderTarget() {String result=reminderTarget;reminderTarget="null";return result;}
        @JavascriptInterface public void syncReminders(String payload) {
            try{ReminderReceiver.replace(MainActivity.this,payload);}catch(Exception e){throw new IllegalArgumentException("Не удалось сохранить напоминания",e);}
        }
        @JavascriptInterface public void requestNotifications() {
            runOnUiThread(()->{
                if(android.os.Build.VERSION.SDK_INT>=33&&checkSelfPermission("android.permission.POST_NOTIFICATIONS")!=android.content.pm.PackageManager.PERMISSION_GRANTED)
                    requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"},41);
                else if(!ReminderReceiver.enabled(MainActivity.this))openNotificationSettings();
                else notificationChanged();
            });
        }
        @JavascriptInterface public void openNotificationSettings() {
            runOnUiThread(()->startActivity(new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,getPackageName())));
        }
        @JavascriptInterface public void requestExactReminders() {
            if(android.os.Build.VERSION.SDK_INT>=31)runOnUiThread(()->startActivity(new Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:"+getPackageName()))));
        }
        @JavascriptInterface public void setColorTheme(String theme) {
            final boolean green = "green".equals(theme);
            runOnUiThread(() -> {
                int color = android.graphics.Color.parseColor(green ? "#f6f7f2" : "#faf8ff");
                getWindow().setStatusBarColor(color); getWindow().setNavigationBarColor(color); web.setBackgroundColor(color);
                String chosen = green ? "GreenLauncher" : "PurpleLauncher";
                String previous = getPreferences(0).getString("launcherTheme", "PurpleLauncher");
                if (!chosen.equals(previous)) {
                    android.content.pm.PackageManager pm = getPackageManager();
                    pm.setComponentEnabledSetting(new android.content.ComponentName(MainActivity.this, getPackageName()+"."+chosen), 1, android.content.pm.PackageManager.DONT_KILL_APP);
                    pm.setComponentEnabledSetting(new android.content.ComponentName(MainActivity.this, getPackageName()+"."+(green?"PurpleLauncher":"GreenLauncher")), 2, android.content.pm.PackageManager.DONT_KILL_APP);
                    getPreferences(0).edit().putString("launcherTheme", chosen).apply();
                }
            });
        }
        @JavascriptInterface public void serverRequest(String request) {
            communityExecutor.execute(() -> {
                String id = ""; int status = 0; String result = "";
                try {
                    JSONObject p = new JSONObject(request); id = p.getString("id");
                    URL base = new URL(p.getString("baseUrl"));
                    String host = base.getHost(), protocol = base.getProtocol();
                    boolean local = Arrays.asList("localhost","127.0.0.1","10.0.2.2","192.168.137.1","192.168.31.245").contains(host);
                    if (!(protocol.equals("https") || protocol.equals("http") && local) || base.getUserInfo()!=null || base.getQuery()!=null || base.getRef()!=null || !base.getPath().matches("/?")) throw new IOException("Invalid server address");
                    String path = p.getString("path"), method = p.getString("method");
                    if (!path.matches("/v1/[a-zA-Z0-9/_-]+") || !Arrays.asList("GET","POST","PATCH","DELETE").contains(method)) throw new IOException("Invalid request");
                    HttpURLConnection conn = (HttpURLConnection)new URL(protocol, host, base.getPort(), path).openConnection(Proxy.NO_PROXY);
                    conn.setConnectTimeout(8000); conn.setReadTimeout(12000); conn.setInstanceFollowRedirects(false); conn.setRequestMethod(method);
                    conn.setRequestProperty("Accept", "application/json");
                    String token = p.optString("token");
                    if (!token.isEmpty()) {if(!token.matches("[A-Za-z0-9_-]{20,200}"))throw new IOException("Invalid token");conn.setRequestProperty("Authorization", "Bearer " + token);}
                    try {
                        if (!method.equals("GET")) {
                            byte[] body = p.optJSONObject("body")==null ? "{}".getBytes(StandardCharsets.UTF_8) : p.getJSONObject("body").toString().getBytes(StandardCharsets.UTF_8);
                            if(body.length>65536)throw new IOException("Request too large");
                            conn.setRequestProperty("Content-Type", "application/json");conn.setDoOutput(true);conn.setFixedLengthStreamingMode(body.length);
                            try(OutputStream out=conn.getOutputStream()){out.write(body);}
                        }
                        status=conn.getResponseCode();
                        InputStream stream=status>=400?conn.getErrorStream():conn.getInputStream();
                        ByteArrayOutputStream out=new ByteArrayOutputStream();
                        if(stream!=null)try(InputStream in=stream){byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1){out.write(buf,0,n);if(out.size()>2*1024*1024)throw new IOException("Response too large");}}
                        result=new String(out.toByteArray(),StandardCharsets.UTF_8);
                    } finally {conn.disconnect();}
                } catch(Exception e) {status=0;result="{\"error\":\"Сервер недоступен. Проверьте интернет и HTTPS-адрес сервера.\"}";}
                final String callback="window.campusServerResult && window.campusServerResult("+JSONObject.quote(id)+","+status+","+JSONObject.quote(result)+")";
                runOnUiThread(() -> {if(!isFinishing()&&!isDestroyed())web.evaluateJavascript(callback,null);});
            });
        }
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
    @Override protected void onDestroy(){communityExecutor.shutdownNow();if(fileCallback!=null)fileCallback.onReceiveValue(null);web.removeJavascriptInterface("CampusAndroid");web.destroy();super.onDestroy();}
}
