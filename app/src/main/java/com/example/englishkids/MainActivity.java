/*
 * 英语小超人 (EnglishKids) — 主界面 / 原生能力桥接层
 * ============================================================
 *
 * 【职责】
 * 本类是整个 App 唯一的 Activity，承担两件事：
 *   1. 作为 WebView 容器，加载打包在 assets/ 内的网页应用；
 *   2. 把「发音」「语音识别」这两个网页做不到的原生能力，
 *      通过 addJavascriptInterface 暴露给网页调用。
 *
 * 【为什么需要原生桥接】
 * 网页原生的 Web Speech API (speechSynthesis / SpeechRecognition)
 * 在 Android WebView 中不可用或行为不一致。因此改为：
 *   - 发音      → android.speech.tts.TextToSpeech
 *   - 语音识别  → android.speech.SpeechRecognizer
 * 再由本类把结果回调给网页（见 evaluate()）。
 *
 * 【网页侧对接的全局钩子】
 *   网页调用（暴露出去）：
 *     window.AndroidTTS.ttsAvailable() / ttsSpeak(text, lang, rate) / ttsStop()
 *     window.AndroidASR.asrAvailable() / asrStart() / asrStop()
 *   原生回调（网页需自行定义）：
 *     window.__onTtsEnd()     发音结束
 *     window.__onTtsError()   发音失败
 *     window.__onAsrResult(s) 识别结果（s 为字符串，失败为空串）
 *
 * 【维护提示】
 *   - 新增原生能力：照 ttsBridge / asrBridge 的模式加一个 Object，
 *     方法加 @JavascriptInterface，并在 onCreate 中 addJavascriptInterface 注册。
 *   - 所有回调网页的操作必须走 evaluate()（内部已切回 UI 线程）。
 *   - 权限与资源释放在 onDestroy 中统一处理，新增组件记得同步。
 */
package com.example.englishkids;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.ArrayList;
import java.util.Locale;

/**
 * 主 Activity：WebView 容器 + 原生 TTS / ASR 桥接。
 * 架构说明与扩展方式见本文件顶部的注释块。
 */
public class MainActivity extends Activity {

    /** 麦克风权限请求码（与 {@link #onRequestPermissionsResult} 中的分支对应） */
    private static final int REQ_MIC = 1001;

    /** 承载 assets/index.html 的 WebView 实例 */
    private WebView webView;

    /**
     * 网页通过 getUserMedia 请求录音时暂存的权限请求。
     * 用户授权结果返回后再决定 grant() 还是 deny()。
     */
    private PermissionRequest pendingRequest;

    // 原生发音（离线 TTS）
    private TextToSpeech tts;
    /** TTS 引擎是否已完成初始化并成功设置英语语言 */
    private boolean ttsReady = false;

    // 原生语音识别（跟读评分）
    private SpeechRecognizer sr;
    /** 是否正在收音，避免重复 startListening */
    private boolean srListening = false;

    /**
     * 生命周期入口：配置 WebView、注册 JS 桥、初始化 TTS、加载网页、申请麦克风权限。
     *
     * <p>注意：WebView 的几项宽松设置（允许 file:// 跨源读取、允许自动播放）
     * 是本项目「离线可用」的前提，改动前请确认不会影响 assets 资源的加载。
     */
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webview);
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setAllowFileAccess(true);
        ws.setAllowContentAccess(true);
        // 允许 file:// 页面读取打包内资源（words.json 等）
        ws.setAllowFileAccessFromFileURLs(true);
        ws.setAllowUniversalAccessFromFileURLs(true);
        // 允许页面内音频自动播放（TTS / 录音回放）
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setUseWideViewPort(true);
        ws.setLoadWithOverviewMode(true);
        ws.setBuiltInZoomControls(false);
        ws.setDisplayZoomControls(false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                view.loadUrl(url);
                return true;
            }
        });

        // WebRTC 权限（跟读录音 getUserMedia 需要）
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    String[] res = request.getResources();
                    boolean needMic = false;
                    for (String r : res) {
                        if (r.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) needMic = true;
                    }
                    if (needMic && checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                            != PackageManager.PERMISSION_GRANTED) {
                        pendingRequest = request;
                        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
                    } else {
                        request.grant(res);
                    }
                });
            }
        });

        // 暴露原生能力给网页（离线发音 + 离线识别）
        webView.addJavascriptInterface(ttsBridge, "AndroidTTS");
        webView.addJavascriptInterface(asrBridge, "AndroidASR");

        // 初始化原生 TTS
        tts = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) {
                int r = tts.setLanguage(new Locale("en", "US"));
                ttsReady = (r != TextToSpeech.LANG_MISSING_DATA && r != TextToSpeech.LANG_NOT_SUPPORTED);
                tts.setSpeechRate(0.85f);
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override
                    public void onStart(String id) { }

                    @Override
                    public void onDone(String id) {
                        evaluate("window.__onTtsEnd && window.__onTtsEnd()");
                    }

                    @Override
                    public void onError(String id) {
                        evaluate("window.__onTtsError && window.__onTtsError()");
                    }
                });
            }
        });

        // 加载打包内的网页（离线可用，无需服务器）
        webView.loadUrl("file:///android_asset/index.html");

        // 首次进入申请麦克风权限（不强制，拒绝也能用听/默写，只是不能跟读/录音回放）
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
        }
    }

    /* ---------------- 原生 TTS 桥 ---------------- */
    private final Object ttsBridge = new Object() {
        @JavascriptInterface
        public boolean ttsAvailable() {
            return ttsReady;
        }

        @JavascriptInterface
        public void ttsSpeak(String text, String lang, double rate) {
            speakNative(text, lang, (float) rate);
        }

        @JavascriptInterface
        public void ttsStop() {
            if (tts != null) tts.stop();
        }
    };

    private void speakNative(String text, String lang, float rate) {
        if (tts == null || !ttsReady) return;
        try {
            Locale loc = "en-GB".equals(lang) ? new Locale("en", "GB") : new Locale("en", "US");
            int r = tts.setLanguage(loc);
            if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
                tts.setLanguage(Locale.ENGLISH);
            }
            tts.setSpeechRate(rate > 0 ? rate : 0.85f);
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "ek_" + System.currentTimeMillis());
        } catch (Exception ignored) { }
    }

    /* ---------------- 原生语音识别桥 ---------------- */
    private final Object asrBridge = new Object() {
        @JavascriptInterface
        public boolean asrAvailable() {
            return SpeechRecognizer.isRecognitionAvailable(MainActivity.this);
        }

        @JavascriptInterface
        public void asrStart() {
            runOnUiThread(MainActivity.this::startRecognition);
        }

        @JavascriptInterface
        public void asrStop() {
            runOnUiThread(() -> {
                if (sr != null && srListening) sr.stopListening();
            });
        }
    };

    private void ensureSr() {
        if (sr == null && SpeechRecognizer.isRecognitionAvailable(this)) {
            sr = SpeechRecognizer.createSpeechRecognizer(this);
            sr.setRecognitionListener(new android.speech.RecognitionListener() {
                @Override
                public void onReadyForSpeech(Bundle params) { }

                @Override
                public void onBeginningOfSpeech() { }

                @Override
                public void onRmsChanged(float rmsdB) { }

                @Override
                public void onBufferReceived(byte[] buffer) { }

                @Override
                public void onEndOfSpeech() { }

                @Override
                public void onError(int error) {
                    srListening = false;
                    evaluate("window.__onAsrResult && window.__onAsrResult('')");
                }

                @Override
                public void onResults(Bundle results) {
                    srListening = false;
                    ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    String best = (matches != null && !matches.isEmpty()) ? matches.get(0) : "";
                    evaluate("window.__onAsrResult && window.__onAsrResult(" + quoteJs(best) + ")");
                }

                @Override
                public void onPartialResults(Bundle partialResults) { }

                @Override
                public void onEvent(int eventType, Bundle params) { }
            });
        }
    }

    private void startRecognition() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            evaluate("window.__onAsrResult && window.__onAsrResult('')");
            return;
        }
        ensureSr();
        if (sr == null) {
            evaluate("window.__onAsrResult && window.__onAsrResult('')");
            return;
        }
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US");
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "en-US");
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        srListening = true;
        try {
            sr.startListening(intent);
        } catch (Exception e) {
            srListening = false;
            evaluate("window.__onAsrResult && window.__onAsrResult('')");
        }
    }

    private String quoteJs(String s) {
        if (s == null) return "''";
        return "'" + s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ") + "'";
    }

    /**
     * 在网页上下文中执行一段 JS（用于把原生事件回调给网页）。
     *
     * <p><b>必须走这个方法</b>，不要直接调用 webView.evaluateJavascript：
     * TTS 与语音识别的回调都发生在非 UI 线程，直接操作 WebView 会抛异常。
     * 本方法内部已切回 UI 线程，并对 WebView 已销毁的情况做了保护。
     *
     * @param js 要执行的 JS，例如 {@code window.__onTtsEnd && window.__onTtsEnd()}
     */
    private void evaluate(final String js) {
        if (webView == null) return;
        runOnUiThread(() -> {
            try {
                webView.evaluateJavascript(js, null);
            } catch (Exception ignored) { }
        });
    }

    /* ---------------- 权限 ---------------- */
    @Override
    public void onRequestPermissionsResult(int requestCode,
                                           String[] permissions,
                                           int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_MIC && pendingRequest != null) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                pendingRequest.grant(pendingRequest.getResources());
            } else {
                pendingRequest.deny();
            }
            pendingRequest = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    /**
     * 统一释放原生资源：TTS 引擎、语音识别器、WebView。
     *
     * <p><b>维护提示</b>：新增任何持有系统资源的组件时，务必在此同步释放，
     * 否则会导致 Activity 泄漏或再次进入时初始化失败（尤其 TTS 引擎占用音频焦点）。
     */
    @Override
    protected void onDestroy() {
        // TTS：先停止朗读再 shutdown，避免残留音频焦点
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
        // 语音识别：必须 destroy，否则麦克风资源不释放
        if (sr != null) {
            sr.destroy();
        }
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
