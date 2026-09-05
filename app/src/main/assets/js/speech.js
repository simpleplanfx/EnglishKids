/* ============================================================
 * speech.js —— 发音（TTS）、跟读录音、发音识别评分
 * ============================================================
 *
 * 【职责】
 * 封装所有与「声音」相关的能力，对外暴露 global.Speech 对象。
 *
 * 【发音的三级降级策略】（speak 方法）
 *   1. 原生 TTS   → window.AndroidTTS（安卓 WebView，离线，首选）
 *   2. 网页 TTS   → window.speechSynthesis（浏览器环境）
 *   3. 在线发音   → 有道接口（需联网，兜底）
 * 由 opt.source 控制偏好，页面默认 'system'。
 * 在安卓 WebView 中走原生 TTS，因此「听」模块完全离线可用。
 *
 * 【发音结束回调】原生侧通过 UtteranceProgressListener 回调
 *   window.__onTtsEnd() / window.__onTtsError()
 *
 * 【评分算法】见文件末尾的 similarity() / levRatio()
 *   基于 Levenshtein 编辑距离，刻意宽松：
 *     - 短语按词逐个匹配后取平均（"police officer" 读对一半也有分）
 *     - 包含关系保底 88 分（读出 "teach" vs 目标 "teacher"）
 *   目的是给孩子正反馈，避免因评分过严打击积极性。
 *
 * 【超时兜底】识别无结果时返回 null，页面降级为「自评模式」
 *   （让孩子听自己的录音自行判断），避免出现点了没反应的死等。
 *
 * 【维护提示】
 *   - 新增发音源：在 speak() 的分支里加，并同步 canScore() 之类的能力探测。
 *   - 调整评分松紧：改 levRatio() 的保底分 88 与 similarity() 的加权方式。
 * ============================================================ */
(function (global) {
  'use strict';

  /** 系统可用语音列表（网页 TTS 用），由 loadVoices() 填充 */
  var voices = [];
  /** 语音列表是否已加载完成 */
  var ready = false;

  function pickVoice(accent) {
    if (!voices.length) return null;
    var want = accent === 'us' ? /en[-_]US/i : /en[-_]GB/i;
    var i, v;
    // 1) 精确匹配口音，且优先本地语音
    var cands = voices.filter(function (x) { return want.test(x.lang); });
    for (i = 0; i < cands.length; i++) if (cands[i].localService) return cands[i];
    if (cands.length) return cands[0];
    // 2) 任意英语语音
    cands = voices.filter(function (x) { return /^en/i.test(x.lang); });
    for (i = 0; i < cands.length; i++) if (cands[i].localService) return cands[i];
    return cands[0] || null;
  }

  function loadVoices() {
    try {
      voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
      if (voices.length) ready = true;
    } catch (e) { voices = []; }
  }

  loadVoices();
  if (global.speechSynthesis && typeof speechSynthesis.onvoiceschanged !== 'undefined') {
    speechSynthesis.onvoiceschanged = loadVoices;
  }
  // 部分安卓/iOS 需要轮询一次
  setTimeout(loadVoices, 300);
  setTimeout(loadVoices, 1200);

  var onlineCache = {};

  function onlineUrl(text, accent) {
    // 有道公开发音接口：type=1 英式，type=2 美式
    return 'https://dict.youdao.com/dictvoice?type=' + (accent === 'us' ? 2 : 1) +
      '&audio=' + encodeURIComponent(text);
  }

  /**
   * 朗读
   * @param {string} text
   * @param {object} opt {accent:'uk'|'us', rate:0.8, source:'system'|'online', onend, onerror}
   */
  // 是否可用安卓原生 TTS（WebView 内离线发音）
  function nativeTTS() {
    try {
      return !!(global.AndroidTTS && global.AndroidTTS.ttsAvailable && global.AndroidTTS.ttsAvailable());
    } catch (e) { return false; }
  }

  // 安卓 Java 回调入口
  global.__onTtsEnd = function () { var cb = global.__ttsEnd; global.__ttsEnd = null; if (cb) cb(); };
  global.__onTtsError = function () { var cb = global.__ttsErr; global.__ttsErr = null; if (cb) cb(); };
  global.__onAsrResult = function (heard) { /* 由 scoreOnce 动态覆盖 */ };

  function speak(text, opt) {
    opt = opt || {};
    var accent = opt.accent || 'uk';
    var rate = opt.rate || 0.85;
    var source = opt.source || 'system';

    if (source === 'online') { return speakOnline(text, accent, opt); }

    // 安卓 WebView：优先走原生 TTS（离线、发音标准、不依赖网络）
    if (nativeTTS()) {
      try {
        if (global.AndroidTTS.ttsStop) global.AndroidTTS.ttsStop();
        global.__ttsEnd = opt.onend || null;
        global.__ttsErr = opt.onerror || null;
        global.AndroidTTS.ttsSpeak(text, accent === 'us' ? 'en-US' : 'en-GB', rate);
        return;
      } catch (e) { /* 落到下方兜底 */ }
    }

    if (!global.speechSynthesis) { return speakOnline(text, accent, opt); }

    try {
      global.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = accent === 'us' ? 'en-US' : 'en-GB';
      u.rate = rate;
      u.pitch = 1.02;
      var v = pickVoice(accent);
      if (v) u.voice = v;
      if (opt.onend) u.onend = opt.onend;
      u.onerror = function (ev) {
        console.warn('TTS 出错，转在线发音', ev && ev.error);
        speakOnline(text, accent, opt);
      };
      global.speechSynthesis.speak(u);
      // 兜底：某些浏览器 3 秒未开始则转在线
      var started = false;
      u.onstart = function () { started = true; };
      setTimeout(function () {
        if (!started && !global.speechSynthesis.speaking) speakOnline(text, accent, opt);
      }, 2500);
    } catch (e) {
      speakOnline(text, accent, opt);
    }
  }

  function speakOnline(text, accent, opt) {
    opt = opt || {};
    var url = onlineUrl(text, accent);
    var a;
    if (onlineCache[url]) a = onlineCache[url];
    else { a = new Audio(url); a.crossOrigin = 'anonymous'; onlineCache[url] = a; }
    try {
      a.pause();
      a.currentTime = 0;
      a.playbackRate = 1;
      if (opt.onend) { a.onended = opt.onend; a.onerror = opt.onend; }
      var p = a.play();
      if (p && p.catch) {
        p.catch(function () {
          if (opt.onerror) opt.onerror();
        });
      }
    } catch (e) {
      if (opt.onerror) opt.onerror();
    }
  }

  function stop() {
    try { if (global.speechSynthesis) global.speechSynthesis.cancel(); } catch (e) { }
  }

  /* ---------------- 录音 ---------------- */
  var rec = null, chunks = [], streamRef = null, timerRef = null;

  function supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && global.MediaRecorder);
  }

  function pickMime() {
    var types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    for (var i = 0; i < types.length; i++) {
      if (global.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(types[i])) {
        return types[i];
      }
    }
    return '';
  }

  /** 开始录音，返回 Promise */
  function startRecord() {
    return new Promise(function (resolve, reject) {
      if (!supported()) { reject(new Error('当前浏览器不支持录音')); return; }
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        streamRef = stream;
        var mime = pickMime();
        try {
          rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        } catch (e) { rec = new MediaRecorder(stream); }
        chunks = [];
        rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = function () {
          var blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
          stopStream();
          resolve(blob);
        };
        rec.onerror = function (e) { stopStream(); reject(e); };
        rec.start();
        resolve();
      }).catch(function (e) { reject(e); });
    });
  }

  function stopRecord() {
    return new Promise(function (resolve, reject) {
      if (!rec || rec.state === 'inactive') { resolve(null); return; }
      rec.onstop = function () {
        var blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        stopStream();
        resolve(blob);
      };
      try { rec.stop(); } catch (e) { reject(e); }
    });
  }

  function stopStream() {
    if (streamRef) {
      try { streamRef.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { }
      streamRef = null;
    }
  }

  var lastBlob = null, lastUrl = null;

  function playLast() {
    if (!lastBlob) return Promise.resolve(false);
    return new Promise(function (resolve) {
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = URL.createObjectURL(lastBlob);
      var a = new Audio(lastUrl);
      a.onended = function () { resolve(true); };
      a.onerror = function () { resolve(false); };
      a.play().catch(function () { resolve(false); });
    });
  }

  function saveBlob(b) {
    lastBlob = b;
    return b;
  }

  /* ---------------- 发音识别评分 ---------------- */
  var SR = global.SpeechRecognition || global.webkitSpeechRecognition || null;

  function canScore() {
    if (SR) return true;
    try {
      if (global.AndroidASR && global.AndroidASR.asrAvailable && global.AndroidASR.asrAvailable()) return true;
    } catch (e) { }
    return false;
  }

  /**
   * 听一次并评分
   * @returns Promise<{score:number, heard:string}|null>  不支持返回 null
   */
  function scoreOnce(target) {
    // 安卓 WebView：使用原生语音识别（离线优先）
    if (!SR && global.AndroidASR && global.AndroidASR.asrAvailable && global.AndroidASR.asrAvailable()) {
      return new Promise(function (resolve) {
        var done = false;
        global.__onAsrResult = function (heard) {
          if (done) return;
          done = true;
          if (!heard) { resolve(null); return; }
          var best = similarity(target, heard);
          resolve({ score: Math.round(best), heard: heard });
        };
        try { global.AndroidASR.asrStart(); }
        catch (e) { resolve(null); }
        // 兜底：7 秒无结果则放弃（交由页面自评）
        setTimeout(function () { if (!done) { done = true; resolve(null); } }, 7000);
      });
    }

    if (!SR) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var r = new SR();
      r.lang = 'en-US';
      r.interimResults = false;
      r.maxAlternatives = 3;
      var done = false;
      var finish = function (v) { if (!done) { done = true; resolve(v); } };

      r.onresult = function (ev) {
        var alts = [];
        for (var i = 0; i < ev.results[0].length; i++) alts.push(ev.results[0][i].transcript);
        var best = 0, heard = alts[0] || '';
        alts.forEach(function (a) {
          var s = similarity(target, a);
          if (s > best) { best = s; heard = a; }
        });
        finish({ score: Math.round(best), heard: heard });
      };
      r.onerror = function () { finish(null); };
      r.onend = function () { finish(null); };

      try { r.start(); } catch (e) { finish(null); }
      setTimeout(function () { try { r.stop(); } catch (e) { } finish(null); }, 6000);
    });
  }

  function similarity(target, heard) {
    var a = norm(target), b = norm(heard);
    if (!a || !b) return 0;
    if (a === b) return 100;
    // 逐词最佳匹配（短语如 police officer）
    var aw = a.split(' '), bw = b.split(' ');
    var total = 0;
    aw.forEach(function (w) {
      var best = 0;
      bw.forEach(function (x) {
        var s = levRatio(w, x);
        if (s > best) best = s;
      });
      total += best;
    });
    return Math.round(total / aw.length);
  }

  function norm(s) {
    return String(s || '').toLowerCase()
      .replace(/[^a-z0-9\s']/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function lev(a, b) {
    var m = a.length, n = b.length, i, j;
    if (!m) return n;
    if (!n) return m;
    var prev = new Array(n + 1), cur = new Array(n + 1);
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      for (j = 0; j <= n; j++) prev[j] = cur[j];
    }
    return prev[n];
  }

  function levRatio(a, b) {
    if (!a.length && !b.length) return 100;
    var d = lev(a, b);
    var max = Math.max(a.length, b.length);
    // 包含关系给高分（听出 "teacher" 里的 "teach"）
    if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) {
      return Math.max(88, Math.round((1 - d / max) * 100));
    }
    return Math.max(0, Math.round((1 - d / max) * 100));
  }

  global.Speech = {
    speak: speak,
    stop: stop,
    supportedRecord: supported,
    startRecord: startRecord,
    stopRecord: stopRecord,
    saveBlob: saveBlob,
    playLast: playLast,
    canScore: canScore,
    scoreOnce: scoreOnce,
    similarity: similarity,
    voicesReady: function () { return ready; }
  };
})(window);
