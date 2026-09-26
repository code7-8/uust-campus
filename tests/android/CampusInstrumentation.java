package ru.uust.campus.tests;

import android.app.*;
import android.content.*;
import android.graphics.Bitmap;
import android.os.*;
import android.view.*;
import android.webkit.*;
import java.io.*;
import java.util.concurrent.*;

/** Runs only in the disposable Campus AVD. Never packaged with the application. */
public class CampusInstrumentation extends Instrumentation {
    private Activity activity;
    private WebView web;
    private int passed=0;
    private final StringBuilder report=new StringBuilder();
    @Override public void onCreate(Bundle arguments){super.onCreate(arguments);start();}
    @Override public void onStart(){
        try{
            Intent launch=new Intent().setClassName("ru.uust.campus","ru.uust.campus.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity=startActivitySync(launch);
            runOnMainSync(()->web=findWeb(activity.getWindow().getDecorView()));
            await("!!document.querySelector('#save-group') || !!document.querySelector('.bottom-nav')",15000);
            // Reset only this test application's local state in the isolated emulator.
            js("localStorage.clear(); location.reload(); true");
            await("!!document.querySelector('#save-group')",15000);
            check("document.body.innerText.includes('ТОП-106Б')","Bundled directory and onboarding load without remote dependencies");
            shot("android-onboarding");
            click("[data-action='save-group']");
            await("!!document.querySelector('.bottom-nav')",4000);
            check("document.querySelector('.group-chip').textContent.includes('ТОП-106Б')","Group selection persists");
            await("document.querySelector('.status-line')?.textContent.includes('Обновлено') && !document.querySelector('.status-line')?.textContent.includes('обновляем')",30000);
            check("!!localStorage.getItem('uust.campus.v1.schedule.241.14381')","Native HTTPS refresh saved a real schedule cache");
            shot("android-home");
            click("[data-tab='schedule']");
            js("var d=document.querySelector('#schedule-date');d.value='2026-09-28';d.dispatchEvent(new Event('change',{bubbles:true}));true");
            check("document.querySelectorAll('.lesson-card').length>0","Dated schedule renders actual classes");
            shot("android-schedule");
            click(".lesson-card");
            check("document.querySelector('.modal').innerText.includes('09:35')","Class detail exposes start/end times");
            click("[data-action='lesson-map']");
            check("document.querySelector('.place-body h2').textContent==='Корпус 7'","Class detail navigates to matched building 7");
            shot("android-map");
            js("var s=document.querySelector('#building-search');s.value='3 корпус';s.dispatchEvent(new Event('input',{bubbles:true}));true");
            check("document.querySelectorAll('#building-results [data-id]').length===1","Natural-language building search has one result");
            click("#building-results [data-id='3']");
            check("document.querySelector('.place-body h2').textContent==='Корпус 3'","Search result selects building 3");
            click("[data-action='save-place']");
            check("JSON.parse(localStorage.getItem('uust.campus.v1.places')).includes('3')","Saved places persist");
            click("[data-tab='events']");
            shot("android-events");
            click("[data-event='kod-uust-2026-09-29']");
            check("document.querySelector('.modal').innerText.includes('Пересекается с парой')","Real event reports class conflict");
            shot("android-event-detail");
            click(".modal [data-action='favorite']");
            check("JSON.parse(localStorage.getItem('uust.campus.v1.favorites')).includes('kod-uust-2026-09-29')","Event favorite persists");
            click("[data-action='event-map']");
            check("document.querySelector('.place-body h2').textContent==='Корпус 9'","Event navigates to building 9");
            click("[data-tab='profile']");
            shot("android-profile");
            click("[data-action='groups']");
            js("var g=document.querySelector('#group-search');g.value='ТОП-105Б';g.dispatchEvent(new Event('input',{bubbles:true}));true");
            click("[data-pick-group='14380']");
            click("[data-action='save-group']");
            await("document.querySelector('.status-line')?.textContent.includes('Обновлено') && !document.querySelector('.status-line')?.textContent.includes('обновляем')",30000);
            check("document.querySelector('.group-chip').innerText.includes('ТОП-105Б') && !!localStorage.getItem('uust.campus.v1.schedule.241.14380')","Another group has its own real schedule and cache");
            click("[data-action='groups']");
            js("var g=document.querySelector('#group-search');g.value='ТОП-106Б';g.dispatchEvent(new Event('input',{bubbles:true}));true");
            click("[data-pick-group='14381']");click("[data-action='save-group']");
            await("!document.querySelector('.status-line')?.textContent.includes('обновляем')",30000);
            shell("svc wifi disable");shell("svc data disable");
            js("location.reload(); true");
            await("!!document.querySelector('.hero')",12000);
            check("document.querySelector('.hero').innerText.includes('Программно-аппаратные комплексы')","Offline restart retains selected group and cached nearest class");
            await("document.querySelector('.status-line')?.textContent.includes('Нет обновления')",30000);
            shot("android-offline");
            click("[data-tab='map']");
            check("document.querySelectorAll('.building-path').length===9","Offline map retains all nine buildings");
            check("document.querySelector('.place-photo').complete && document.querySelector('.place-photo').naturalWidth>0","Offline building photo comes from the APK");
            click("[data-tab='events']");
            check("document.querySelectorAll('.event-card').length===3","Offline event feed remains available");
            click("[data-tab='home']");
            shell("svc wifi enable");
            ok("No crashes through schedule, map, events, profile and offline restart");
            Bundle result=new Bundle();result.putString("stream",report.toString()+"\nPASSED "+passed+" checks\n");finish(Activity.RESULT_OK,result);
        }catch(Throwable error){
            try{shot("android-failure");shell("svc wifi enable");}catch(Exception ignored){}
            Bundle result=new Bundle();result.putString("stream",report.toString()+"\nFAILED: "+error+"\n");finish(Activity.RESULT_CANCELED,result);
        }
    }
    private WebView findWeb(View v){if(v instanceof WebView)return (WebView)v;if(v instanceof ViewGroup){ViewGroup g=(ViewGroup)v;for(int i=0;i<g.getChildCount();i++){WebView result=findWeb(g.getChildAt(i));if(result!=null)return result;}}return null;}
    private String js(String script)throws Exception{CountDownLatch done=new CountDownLatch(1);String[] out={null};runOnMainSync(()->web.evaluateJavascript(script,value->{out[0]=value;done.countDown();}));if(!done.await(5,TimeUnit.SECONDS))throw new Exception("JS timeout");return out[0];}
    private void await(String expression,long timeout)throws Exception{long end=System.currentTimeMillis()+timeout;while(System.currentTimeMillis()<end){if("true".equals(js(expression)))return;Thread.sleep(150);}throw new Exception("Condition timed out: "+expression+"; screen="+js("document.body.innerText.slice(0,1600)"));}
    private void check(String expression,String message)throws Exception{if(!"true".equals(js(expression)))throw new Exception(message);ok(message);}
    private void ok(String text){passed++;report.append("PASS ").append(passed).append(" ").append(text).append('\n');Bundle progress=new Bundle();progress.putString("stream",text+"\n");sendStatus(1,progress);}
    private void click(String selector)throws Exception{js("document.querySelector("+org.json.JSONObject.quote(selector)+").click();true");Thread.sleep(200);}
    private void shot(String name)throws Exception{Thread.sleep(250);Bitmap b=getUiAutomation().takeScreenshot();File file=new File(getTargetContext().getExternalFilesDir(null),name+".png");try(FileOutputStream out=new FileOutputStream(file)){b.compress(Bitmap.CompressFormat.PNG,100,out);}b.recycle();}
    private void shell(String command)throws Exception{try(ParcelFileDescriptor descriptor=getUiAutomation().executeShellCommand(command);InputStream in=new FileInputStream(descriptor.getFileDescriptor())){byte[] buffer=new byte[1024];while(in.read(buffer)!=-1){}}}
}
