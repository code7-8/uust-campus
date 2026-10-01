package ru.uust.campus;

import android.app.*;
import android.content.*;
import android.os.Build;
import org.json.*;
import java.util.*;

/** One durable alarm advances the saved queue even when the WebView is closed. */
public final class ReminderReceiver extends BroadcastReceiver {
    private static final String CHANNEL="campus_reminders", ACTION="ru.uust.campus.REMIND";
    private static android.content.SharedPreferences prefs(Context c) {return c.getSharedPreferences("reminders",Context.MODE_PRIVATE);}
    private static PendingIntent alarmIntent(Context c) {
        return PendingIntent.getBroadcast(c,64017,new Intent(c,ReminderReceiver.class).setAction(ACTION),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    static void channel(Context c) {
        NotificationChannel channel=new NotificationChannel(CHANNEL,"Пары и события",NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("Напоминания о занятиях, избранных событиях и встречах");
        c.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }
    static boolean enabled(Context c) {
        channel(c);
        NotificationManager manager=c.getSystemService(NotificationManager.class);
        return manager.areNotificationsEnabled()&&manager.getNotificationChannel(CHANNEL).getImportance()!=NotificationManager.IMPORTANCE_NONE;
    }
    static boolean exact(Context c) {return Build.VERSION.SDK_INT<31||c.getSystemService(AlarmManager.class).canScheduleExactAlarms();}
    static synchronized String status(Context c) {
        try{return new JSONObject().put("enabled",enabled(c)).put("exact",exact(c)).put("count",queue(c).length()).toString();}
        catch(JSONException e){return "{}";}
    }
    private static JSONArray queue(Context c) {
        try{return new JSONArray(prefs(c).getString("queue","[]"));}catch(JSONException e){return new JSONArray();}
    }
    private static String deliveryKey(JSONObject item) {return item.optString("id")+":"+item.optLong("start");}
    private static JSONObject delivered(Context c) {
        JSONObject saved;
        try{saved=new JSONObject(prefs(c).getString("delivered","{}"));}catch(JSONException e){saved=new JSONObject();}
        long now=System.currentTimeMillis();Iterator<String> keys=saved.keys();
        while(keys.hasNext())if(saved.optLong(keys.next())<=now)keys.remove();
        return saved;
    }
    static synchronized void replace(Context c,String text) throws JSONException {
        if(text.length()>3*1024*1024)throw new JSONException("Queue too large");
        JSONArray raw=new JSONArray(text);if(raw.length()>5000)throw new JSONException("Too many reminders");
        ArrayList<JSONObject> valid=new ArrayList<>();HashSet<String> ids=new HashSet<>();long now=System.currentTimeMillis();JSONObject sent=delivered(c);
        for(int i=0;i<raw.length();i++){
            JSONObject item=raw.getJSONObject(i);String id=item.getString("id"),tab=item.getString("tab"),date=item.getString("date");
            long at=item.getLong("at"),start=item.getLong("start");
            if(id.length()>240||!ids.add(id)||!Arrays.asList("schedule","events").contains(tab)||!date.matches("\\d{4}-\\d{2}-\\d{2}")||start<at)throw new JSONException("Invalid reminder");
            if(start<=now||at>now+370L*86400000||sent.has(deliveryKey(item)))continue;
            valid.add(new JSONObject().put("id",id).put("tab",tab).put("date",date).put("at",at).put("start",start)
                .put("title",item.getString("title").substring(0,Math.min(200,item.getString("title").length())))
                .put("body",item.getString("body").substring(0,Math.min(500,item.getString("body").length()))));
        }
        valid.sort((a,b)->Long.compare(a.optLong("at"),b.optLong("at")));
        JSONArray next=new JSONArray();for(JSONObject item:valid)next.put(item);
        if(!prefs(c).edit().putString("queue",next.toString()).putString("delivered",sent.toString()).commit())throw new JSONException("Cannot save reminders");
        if(raw.length()==0)c.getSystemService(NotificationManager.class).cancelAll();
        arm(c,next);
    }
    private static void arm(Context c,JSONArray items) {
        AlarmManager manager=c.getSystemService(AlarmManager.class);PendingIntent intent=alarmIntent(c);manager.cancel(intent);
        if(items.length()==0||!enabled(c))return;
        long at=Math.max(System.currentTimeMillis()+1000,items.optJSONObject(0).optLong("at"));
        try{if(exact(c))manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,intent);
            else manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,intent);
        }catch(SecurityException e){manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,intent);}
    }
    static synchronized void rearm(Context c) {
        JSONArray current=queue(c),future=new JSONArray();long now=System.currentTimeMillis();
        for(int i=0;i<current.length();i++){JSONObject item=current.optJSONObject(i);if(item!=null&&item.optLong("start")>now)future.put(item);}
        prefs(c).edit().putString("queue",future.toString()).commit();arm(c,future);
    }
    @Override public void onReceive(Context c,Intent intent) {
        synchronized(ReminderReceiver.class){
            if(!ACTION.equals(intent.getAction())){rearm(c);return;}
            JSONArray current=queue(c),future=new JSONArray();long now=System.currentTimeMillis();JSONObject sent=delivered(c);
            for(int i=0;i<current.length();i++){
                JSONObject item=current.optJSONObject(i);if(item==null)continue;
                if(item.optLong("at")>now){future.put(item);continue;}
                if(item.optLong("start")>now&&!sent.has(deliveryKey(item))){
                    if(enabled(c)&&show(c,item)){
                        try{sent.put(deliveryKey(item),item.optLong("start"));}catch(JSONException ignored){}
                    }else future.put(item);
                }
            }
            prefs(c).edit().putString("queue",future.toString()).putString("delivered",sent.toString()).commit();arm(c,future);
        }
    }
    static void test(Context c) throws JSONException {
        if(!enabled(c))throw new SecurityException("Notifications disabled");
        JSONObject item=new JSONObject().put("id","campus-test").put("tab","events")
            .put("title","Кампус · проверка").put("body","Уведомления разрешены. Напоминания о парах и событиях появятся здесь.")
            .put("start",System.currentTimeMillis()+300000);
        if(!show(c,item))throw new SecurityException("Notification permission revoked");
    }
    private static boolean show(Context c,JSONObject item) {
        int id=item.optString("id").hashCode();
        Intent open=new Intent(c,MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("reminderTarget",item.toString());
        PendingIntent tap=PendingIntent.getActivity(c,id,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification notification=new Notification.Builder(c,CHANNEL).setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(item.optString("title")).setContentText(item.optString("body"))
            .setStyle(new Notification.BigTextStyle().bigText(item.optString("body")))
            .setContentIntent(tap).setAutoCancel(true).setCategory(Notification.CATEGORY_REMINDER)
            .setVisibility(Notification.VISIBILITY_PRIVATE).setTimeoutAfter(Math.max(1000,item.optLong("start")-System.currentTimeMillis())).build();
        try{c.getSystemService(NotificationManager.class).notify(id,notification);return true;}catch(SecurityException ignored){return false;}
    }
}
