/* ============================================================
 * app.js —— 英语小超人 主逻辑（界面渲染 + 学习流程编排）
 * ============================================================
 *
 * 【职责】
 * 负责页面渲染、页面切换，以及「听 / 跟读 / 默写」三大模块的学习流程编排。
 * 发音与进度读写分别委托给 speech.js 与 store.js，本文件不做底层实现。
 *
 * 【页面结构】
 *   底部常驻 3 个 Tab（TAB_SCREENS）：home（词书）、wrong（错词本）、me（我的）
 *   其余为流程页面，学习动线如下：
 *
 *     home ──选词书──> units ──选单元──> learn ──┬──> listen  (听)
 *                                                ├──> speak   (跟读)
 *                                                └──> write   (默写)
 *                                                       │
 *                                                       v
 *                                                    result (结果)
 *
 *   所有页面切换统一走 show(name)，它会同时同步底部 Tab 高亮。
 *
 * 【数据加载】loadData() 读取 assets/data/words.json，
 *   并合并用户在 App 内自建的自定义词书（来自 store.js）。
 *   采用 fetch 优先、XHR 兜底的双通道，以应对 file:// 协议下的 CORS 限制。
 *
 * 【维护提示】
 *   - 新增页面：index.html 加节点 → 加入 SCREENS 数组 → show() 中处理显示逻辑。
 *   - 改学习流程：找到对应模块函数，判分后统一调用
 *     Store.mark(bookId, word, ok) 记录结果，再跳转 result 页。
 *   - 本文件只做流程编排；发音/评分改 speech.js，存储改 store.js。
 * ============================================================ */
(function () {
  'use strict';

  /* ================= 全局状态 ================= */
  var S = {
    data: null,        // 词库数据（words.json 解析结果）
    bookId: null,      // 当前选中的词书 id
    book: null,        // 当前选中的词书对象
    sel: {},           // 选中的单元名集合
    pool: [],          // 当前练习词池 [{en,zh,ph,ph_us,full}]
    queue: [],         // 本轮待练队列
    qi: 0,             // queue 的当前索引
    mode: null,        // 当前练习模式：listen / speak / write
    session: null,     // 本轮统计（词数、正确数、开始时间等）
    prevScreen: 'home' // 返回时回退到哪个页面
  };

  var $ = function (id) { return document.getElementById(id); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.classList.remove('show'); }, 1900);
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function cleanEn(w) {
    // 去掉词性标注，如 "water (v.)" / "leaf (pl. leaves)"
    return String(w).replace(/\s*\([^)]*\)\s*$/, '').trim();
  }

  /* ================= 屏幕切换 ================= */
  var SCREENS = ['home', 'units', 'learn', 'listen', 'speak', 'write', 'result', 'wrong', 'me'];
  var TAB_SCREENS = { home: 'home', wrong: 'wrong', me: 'me' };

  function show(name) {
    if (SCREENS.indexOf(name) < 0) return;
    SCREENS.forEach(function (n) { $('scr-' + n).classList.add('hidden'); });
    $('scr-' + name).classList.remove('hidden');
    var isTab = !!TAB_SCREENS[name];
    $('tabbar').classList.toggle('show', isTab);
    if (isTab) {
      $$('.tab').forEach(function (b) { b.classList.toggle('active', b.dataset.go === name); });
      if (name === 'wrong') renderWrong();
      if (name === 'me') renderMe();
    }
    S.cur = name;
    window.scrollTo(0, 0);
  }

  /* ================= 载入词库 ================= */
  // 兼容两种环境：网页(http)用 fetch；安卓 WebView(file://)用 XHR（fetch 在 file:// 下会被 CORS 拦截）
  function loadJSON(url) {
    return new Promise(function (resolve, reject) {
      var viaXhr = function () {
        try {
          var x = new XMLHttpRequest();
          x.open('GET', url, true);
          x.onreadystatechange = function () {
            if (x.readyState === 4) {
              if (x.status === 200 || (x.status === 0 && x.responseText)) resolve(x.responseText);
              else reject(new Error('HTTP ' + x.status));
            }
          };
          x.onerror = function () { reject(new Error('XHR error')); };
          x.send();
        } catch (e) { reject(e); }
      };
      if (typeof fetch === 'function' && location.protocol !== 'file:') {
        fetch(url + '?20260904').then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        }).then(resolve).catch(viaXhr);
      } else {
        viaXhr();
      }
    });
  }

  function loadData() {
    return loadJSON('data/words.json').then(function (text) {
      var j = JSON.parse(text);
      S.data = j;
      // 合并自定义词库
      Store.customBooks().forEach(function (cb) {
        var book = S.data.books.filter(function (b) { return b.id === cb.id; })[0];
        if (book) {
          for (var u in cb.units) {
            var exist = book.units.filter(function (x) { return x.name === u; })[0];
            if (exist) exist.words = exist.words.concat(cb.units[u]);
            else book.units.push({ name: u, words: cb.units[u], custom: true });
          }
          recount(book);
        } else {
          var units = [];
          for (var u2 in cb.units) units.push({ name: u2, words: cb.units[u2], custom: true });
          S.data.books.push({
            id: cb.id, grade: 99, term: 0, title: cb.id.replace(/^my:/, ''),
            subtitle: '自定义词库', tag: '自建', count: 0, units: units
          });
          recount(S.data.books[S.data.books.length - 1]);
        }
      });
      renderBooks();
      $('homeSub').textContent = S.data.meta.region + ' · ' +
        S.data.meta.bookCount + ' 册 / ' + S.data.meta.wordCount + ' 词';
    });
  }

  function recount(book) {
    book.count = book.units.reduce(function (n, u) { return n + u.words.length; }, 0);
  }

  /* ================= 书架 ================= */
  function ring(pct) {
    var r = 15, c = 2 * Math.PI * r;
    var off = c * (1 - pct / 100);
    return '<svg class="ring" viewBox="0 0 34 34">' +
      '<circle class="bg" cx="17" cy="17" r="' + r + '"></circle>' +
      '<circle class="fg" cx="17" cy="17" r="' + r + '" stroke-dasharray="' + c.toFixed(1) +
      '" stroke-dashoffset="' + off.toFixed(1) + '"></circle></svg>';
  }

  function bookProgress(book) {
    var tot = 0, mast = 0;
    book.units.forEach(function (u) {
      u.words.forEach(function (w) {
        tot++;
        if (Store.isMastered(book.id, w.en)) mast++;
      });
    });
    return tot ? Math.round(mast / tot * 100) : 0;
  }

  function renderBooks() {
    var wrap = $('bookList');
    var books = S.data.books.slice().sort(function (a, b) {
      return (a.grade - b.grade) || (a.term - b.term);
    });
    var cur = [], norm = [], ext = [];
    books.forEach(function (b) {
      if (b.tag === '当前教材') cur.push(b);
      else if (b.grade >= 90) ext.push(b);
      else norm.push(b);
    });

    var html = '';
    function block(title, list) {
      if (!list.length) return '';
      var h = '<div class="cardhead">' + title + '</div><div class="bookgrid">';
      list.forEach(function (b) {
        var p = bookProgress(b);
        var tag = b.tag ? '<div class="bk-tag' + (b.tag === '扩展' || b.tag === '小升初衔接' ? ' gray' : '') +
          '">' + b.tag + '</div>' : '';
        h += '<button class="bookcard' + (b.tag === '当前教材' ? ' cur' : '') + '" data-book="' + b.id + '">' +
          tag +
          '<div class="bk-title">' + b.title + '</div>' +
          '<div class="bk-sub">' + b.subtitle + '</div>' +
          '<div class="bk-meta"><span>' + b.count + ' 词 · ' + b.units.length + ' 单元</span>' +
          ring(p) + '</div></button>';
      });
      return h + '</div>';
    }

    html += block('当前教材', cur);
    html += block('小学全套', norm);
    html += block('自建词库', ext);
    wrap.innerHTML = html;

    $$('.bookcard', wrap).forEach(function (btn) {
      btn.addEventListener('click', function () { openBook(btn.dataset.book); });
    });
    $('starTotal').textContent = Store.data.stars;
  }

  /* ================= 单元选择 ================= */
  function findBook(id) {
    return S.data.books.filter(function (b) { return b.id === id; })[0];
  }

  function openBook(id) {
    var b = findBook(id);
    if (!b) return;
    S.bookId = id; S.book = b; S.sel = {};
    b.units.forEach(function (u) { S.sel[u.name] = true; });
    $('unitBookTitle').textContent = b.title + ' · ' + b.subtitle;
    renderUnits();
    show('units');
  }

  function selectedWords() {
    var out = [];
    S.book.units.forEach(function (u) {
      if (!S.sel[u.name]) return;
      u.words.forEach(function (w) { out.push(w); });
    });
    return out;
  }

  function renderUnits() {
    var html = '';
    S.book.units.forEach(function (u) {
      var m = 0;
      u.words.forEach(function (w) { if (Store.isMastered(S.bookId, w.en)) m++; });
      var p = u.words.length ? Math.round(m / u.words.length * 100) : 0;
      html += '<button class="unitrow' + (S.sel[u.name] ? ' on' : '') + '" data-unit="' +
        encodeURIComponent(u.name) + '">' +
        '<div class="ucheck">✓</div>' +
        '<div class="umain"><div class="uname">' + u.name + '</div>' +
        '<div class="umeta">' + u.words.length + ' 词 · 已掌握 ' + m + '</div></div>' +
        ring(p) + '</button>';
    });
    $('unitList').innerHTML = html;
    $$('.unitrow').forEach(function (r) {
      r.addEventListener('click', function () {
        var n = decodeURIComponent(r.dataset.unit);
        S.sel[n] = !S.sel[n];
        r.classList.toggle('on', S.sel[n]);
        updateUnitHint();
      });
    });
    updateUnitHint();
  }

  function updateUnitHint() {
    var n = selectedWords().length;
    // 去重后的实际词数
    var seen = {}, uniq = 0;
    selectedWords().forEach(function (w) {
      var k = w.en.toLowerCase();
      if (!seen[k]) { seen[k] = 1; uniq++; }
    });
    var cnt = Object.keys(S.sel).filter(function (k) { return S.sel[k]; }).length;
    $('unitHint').textContent = '已选 ' + cnt + ' 个单元 · ' + uniq + ' 词 · 每轮练 ' +
      Math.min(Store.get('count', 10), uniq) + ' 词';
  }

  $('unitSelectAll').addEventListener('click', function () {
    var allOn = S.book.units.every(function (u) { return S.sel[u.name]; });
    S.book.units.forEach(function (u) { S.sel[u.name] = !allOn; });
    renderUnits();
  });

  /* ================= 练习队列 ================= */
  function buildQueue(words) {
    var n = Math.min(Store.get('count', 10), words.length);
    var seen = {}, pool = [];
    words.forEach(function (w) {
      var k = w.en.toLowerCase();
      if (!seen[k]) { seen[k] = 1; pool.push(w); }
    });
    var bad = [], un = [], mid = [], mast = [];
    pool.forEach(function (w) {
      var s = Store.getWord(S.bookId, w.en);
      if (!s) un.push(w);
      else if (s.bad) bad.push(w);
      else if (s.w >= 3) mast.push(w);
      else mid.push(w);
    });
    shuffle(bad); shuffle(un); shuffle(mid); shuffle(mast);
    // 错词和没练过的优先，各占一部分
    var q = [];
    var i = 0;
    while (q.length < n) {
      var added = false;
      if (i < bad.length) { q.push(bad[i]); added = true; }
      if (q.length < n && i < un.length) { q.push(un[i]); added = true; }
      if (q.length < n && i < mid.length) { q.push(mid[i]); added = true; }
      if (q.length < n && i < mast.length) { q.push(mast[i]); added = true; }
      if (!added) break;
      i++;
    }
    return q;
  }

  function startSession(mode, words) {
    var q = buildQueue(words);
    if (!q.length) { toast('没有可练习的单词'); return; }
    S.mode = mode;
    S.queue = q;
    S.qi = 0;
    S.session = { right: 0, wrong: [], start: Date.now(), total: q.length };
    show(mode);
    if (mode === 'learn') renderLearn();
    else if (mode === 'listen') renderListen();
    else if (mode === 'speak') renderSpeak();
    else if (mode === 'write') renderWrite();
  }

  $$('.modebtn[data-mode]').forEach(function (b) {
    b.addEventListener('click', function () {
      var w = selectedWords();
      if (!w.length) { toast('请先选择单元'); return; }
      startSession(b.dataset.mode, w);
    });
  });

  function progress(i, total) {
    return Math.round(i / total * 100) + '%';
  }

  function answer(ok, word) {
    var bid = word._bookId || S.bookId;   // 错词本跨书册时按原书册统计
    if (ok) {
      S.session.right++;
      Store.mark(bid, word.en, true);
    } else {
      S.session.wrong.push(word);
      Store.mark(bid, word.en, false);
    }
  }

  function next() {
    S.qi++;
    if (S.qi >= S.queue.length) return finish();
    if (S.mode === 'learn') renderLearn();
    else if (S.mode === 'listen') renderListen();
    else if (S.mode === 'speak') renderSpeak();
    else if (S.mode === 'write') renderWrite();
  }

  function finish() {
    var s = S.session;
    var sec = Math.round((Date.now() - s.start) / 1000);
    var acc = s.total ? Math.round(s.right / s.total * 100) : 0;
    var stars = acc >= 95 ? 3 : acc >= 80 ? 2 : acc >= 60 ? 1 : 0;
    if (stars) {
      Store.addStars(stars);
      $('starTotal').textContent = Store.data.stars;
    }
    Store.addDaily(s.total, s.right, sec);

    $('resEmoji').textContent = acc >= 95 ? '🏆' : acc >= 80 ? '🎉' : acc >= 60 ? '💪' : '📖';
    $('resTitle').textContent = acc >= 95 ? '太棒了，全对！' :
      acc >= 80 ? '完成啦！' : acc >= 60 ? '还不错，继续加油' : '再练一次就会了';
    $('resStars').innerHTML = '★★★'.split('').map(function (c, i) {
      return '<i style="opacity:' + (i < stars ? 1 : .22) + '">' + c + '</i>';
    }).join('');
    $('resRight').textContent = s.right;
    $('resWrongN').textContent = s.wrong.length;
    $('resAcc').textContent = acc + '%';
    $('resTime').textContent = sec + 's';

    var wl = $('resWrongList');
    if (s.wrong.length) {
      wl.classList.remove('hidden');
      wl.innerHTML = '<h4>错词（已收入错词本）</h4>' + s.wrong.map(function (w) {
        return '<div class="wp-item"><b>' + w.en + '</b><span>' + (w.zh || '') + '</span></div>';
      }).join('');
    } else wl.classList.add('hidden');

    show('result');
  }

  $('resAgain').addEventListener('click', function () {
    startSession(S.mode, selectedWords());
  });
  $('resReview').addEventListener('click', function () {
    var w = S.session.wrong.length ? S.session.wrong : selectedWords();
    startSession(S.mode, w);
  });
  $('resHome').addEventListener('click', function () { renderBooks(); show('home'); });

  /* ================= 认词 ================= */
  var learnShown = false;

  function renderLearn() {
    var w = S.queue[S.qi];
    if (!w) return finish();
    learnShown = false;
    $('learnWord').textContent = cleanEn(w.en);
    $('learnPh').textContent = w.ph ? '/' + w.ph + '/' : '';
    $('learnZh').textContent = w.zh || '';
    $('learnZh').classList.add('hidden');
    $('learnFull').textContent = '';
    $('learnProg').style.width = progress(S.qi, S.queue.length);
    $('learnCount').textContent = (S.qi + 1) + '/' + S.queue.length;
    var c = $('learnCard');
    c.classList.remove('pop');
    void c.offsetWidth;
    c.classList.add('pop');
    if (Store.get('auto', 1)) setTimeout(function () { say(w); }, 220);
  }

  function say(w, opt) {
    Speech.speak(cleanEn(w.en), {
      accent: Store.get('accent', 'uk'),
      rate: Store.get('rate', 0.85),
      source: Store.get('voice', 'system')
    });
  }

  $('learnCard').addEventListener('click', function () {
    var w = S.queue[S.qi];
    if (!learnShown) {
      learnShown = true;
      $('learnZh').classList.remove('hidden');
      if (w.full) $('learnFull').textContent = w.full;
      say(w);
    } else say(w);
  });
  $('learnSpeak').addEventListener('click', function () { say(S.queue[S.qi]); });
  $('learnYes').addEventListener('click', function () { answer(true, S.queue[S.qi]); next(); });
  $('learnNo').addEventListener('click', function () {
    answer(false, S.queue[S.qi]);
    if (!learnShown) { learnShown = true; $('learnZh').classList.remove('hidden'); }
    next();
  });

  /* ================= 听力 ================= */
  function renderListen() {
    var w = S.queue[S.qi];
    if (!w) return finish();
    $('listenProg').style.width = progress(S.qi, S.queue.length);
    $('listenCount').textContent = (S.qi + 1) + '/' + S.queue.length;
    $('listenFb').classList.add('hidden');

    // 3 个干扰项：同书随机，优先同学科（同单元）
    var pool = [];
    S.book.units.forEach(function (u) { u.words.forEach(function (x) { pool.push(x); }); });
    var d = shuffle(pool.filter(function (x) {
      return x.en.toLowerCase() !== w.en.toLowerCase() && x.zh && x.zh !== w.zh;
    })).slice(0, 3);
    var opts = shuffle(d.concat([w]));

    var rightIdx = opts.indexOf(w);
    $('listenOpts').innerHTML = opts.map(function (o, i) {
      return '<button class="opt" data-i="' + i + '"' + (i === rightIdx ? ' data-right="1"' : '') +
        '><span class="ok"></span>' +
        '<span>' + (o.zh || o.en) + '</span></button>';
    }).join('');
    $$('#listenOpts .opt').forEach(function (b) {
      b.addEventListener('click', function () { pickListen(opts[+b.dataset.i], b, w); });
    });
    if (Store.get('auto', 1)) setTimeout(function () { playListen(w); }, 260);
  }

  function playListen(w) {
    var btn = $('listenPlay');
    btn.classList.add('playing');
    setTimeout(function () { btn.classList.remove('playing'); }, 600);
    Speech.speak(cleanEn(w.en), {
      accent: Store.get('accent', 'uk'),
      rate: Store.get('rate', 0.85),
      source: Store.get('voice', 'system')
    });
  }

  $('listenPlay').addEventListener('click', function () { if (S.queue[S.qi]) playListen(S.queue[S.qi]); });

  function pickListen(picked, btn, target) {
    if (btn.dataset.done) return;
    $$('#listenOpts .opt').forEach(function (b) { b.dataset.done = '1'; });
    var ok = picked.en.toLowerCase() === target.en.toLowerCase();
    $$('#listenOpts .opt').forEach(function (b) {
      if (b.dataset.right) { b.classList.add('right'); b.querySelector('.ok').textContent = '✓'; }
    });
    if (!ok) { btn.classList.add('wrong'); btn.querySelector('.ok').textContent = '✗'; }

    var fb = $('listenFb');
    fb.className = 'feedback ' + (ok ? 'ok' : 'no');
    fb.innerHTML = (ok ? '✓ 答对了！' : '✗ 正确答案是 ') +
      '<b>' + cleanEn(target.en) + '</b> ' + (target.zh || '') +
      (target.ph ? ' <span style="opacity:.7">/' + target.ph + '/</span>' : '');
    fb.classList.remove('hidden');

    answer(ok, target);
    setTimeout(next, ok ? 900 : 1700);
  }

  /* ================= 跟读 ================= */
  var spkState = { recording: false, blob: null, scored: false };

  function renderSpeak() {
    var w = S.queue[S.qi];
    if (!w) return finish();
    spkState = { recording: false, blob: null, scored: false };
    $('spkWord').textContent = cleanEn(w.en);
    $('spkPh').textContent = w.ph ? '/' + w.ph + '/' : '';
    $('spkZh').textContent = w.zh || '';
    $('spkWave').classList.add('hidden');
    $('spkScore').classList.add('hidden');
    $('spkNext').classList.add('hidden');
    $('spkReplay').disabled = true;
    setRecBtn(false);
    $('spkTip').textContent = '先听一遍，再点麦克风跟读';
    $('speakProg').style.width = progress(S.qi, S.queue.length);
    $('speakCount').textContent = (S.qi + 1) + '/' + S.queue.length;
    if (Store.get('auto', 1)) setTimeout(function () { spkPlay(w); }, 240);
  }

  function spkPlay(w) {
    Speech.speak(cleanEn(w.en), {
      accent: Store.get('accent', 'uk'),
      rate: Store.get('rate', 0.8),
      source: Store.get('voice', 'system')
    });
  }

  function setRecBtn(on) {
    var b = $('spkRec');
    b.classList.toggle('recording', on);
    $('spkRecTxt').textContent = on ? '停止' : '跟读';
    b.querySelector('span').textContent = on ? '⏹' : '🎤';
  }

  $('spkPlay').addEventListener('click', function () { if (S.queue[S.qi]) spkPlay(S.queue[S.qi]); });

  $('spkRec').addEventListener('click', function () {
    var w = S.queue[S.qi];
    if (!w) return;
    if (!Speech.supportedRecord()) {
      toast('这个浏览器不支持录音，请换 Chrome / Safari');
      return;
    }
    if (!spkState.recording) {
      Speech.startRecord().then(function () {
        spkState.recording = true;
        setRecBtn(true);
        $('spkWave').classList.remove('hidden');
        $('spkTip').textContent = '正在录音…大声读出来';
        $('spkScore').classList.add('hidden');
      }).catch(function (e) {
        toast('没法用麦克风：' + (e.name || e.message || '权限被拒绝'));
      });
    } else {
      Speech.stopRecord().then(function (blob) {
        spkState.recording = false;
        spkState.blob = blob;
        setRecBtn(false);
        $('spkWave').classList.add('hidden');
        if (blob) {
          Speech.saveBlob(blob);
          $('spkReplay').disabled = false;
        }
        afterRecord(w);
      }).catch(function () {
        spkState.recording = false;
        setRecBtn(false);
        $('spkWave').classList.add('hidden');
      });
    }
  });

  function afterRecord(w) {
    $('spkTip').textContent = '点 ▶️ 听听自己读得怎么样';
    if (!Speech.canScore()) {
      // 不支持识别：让孩子自己判断
      $('spkScore').className = 'spk-score';
      $('spkScore').innerHTML = '<span style="color:var(--t2);font-size:14px">' +
        '录好啦！回放对比一下，读得像就点「很像」</span>';
      $('spkScore').classList.remove('hidden');
      showSelfJudge();
      return;
    }
    $('spkTip').textContent = '正在识别…';
    Speech.scoreOnce(cleanEn(w.en)).then(function (r) {
      var el = $('spkScore');
      el.classList.remove('hidden');
      if (!r || r.score <= 0) {
        el.innerHTML = '<span style="color:var(--t2);font-size:14px">没听清，再试一次吧</span>';
        $('spkTip').textContent = '再大声读一遍';
        showSelfJudge();
        return;
      }
      var lv = r.score >= 85 ? { c: 'var(--green)', t: '很棒！' } :
        r.score >= 65 ? { c: 'var(--orange)', t: '不错' } :
          { c: 'var(--red)', t: '再练练' };
      el.innerHTML = '<span style="color:' + lv.c + '">' + r.score + ' 分 · ' + lv.t + '</span>' +
        '<div style="font-size:12px;color:var(--t3);font-weight:500;margin-top:3px">识别到：' +
        (r.heard || '') + '</div>';
      spkState.scored = true;
      answer(r.score >= 65, w);
      $('spkNext').classList.remove('hidden');
      $('spkTip').textContent = '继续下一个';
    });
  }

  function showSelfJudge() {
    var el = $('spkNext');
    el.classList.remove('hidden');
    // 自己判定：认为读得像 = 答对
    el.textContent = '读得像 ✓ 下一个 ›';
    el.dataset.self = '1';
  }

  $('spkNext').addEventListener('click', function () {
    var w = S.queue[S.qi];
    if (!w) return;
    if (!spkState.scored) answer(true, w);   // 自评通过
    next();
  });

  $('spkReplay').addEventListener('click', function () {
    Speech.playLast().then(function (ok) {
      if (!ok) toast('还没有录音');
    });
  });

  /* ================= 默写 ================= */
  var writeState = { tips: 0, done: false };

  function renderWrite() {
    var w = S.queue[S.qi];
    if (!w) return finish();
    writeState = { tips: 0, done: false };
    var target = cleanEn(w.en);
    $('writeZh').textContent = Store.get('writeMode', 'audio') === 'zh' ? (w.zh || '—') : '？？？';
    $('writeHint').textContent = Store.get('writeMode', 'audio') === 'zh' ?
      '看中文，拼出英文单词' : '点 🔊 听读音，拼出单词';
    $('writeInput').value = '';
    $('writeFb').classList.add('hidden');
    $('writeProg').style.width = progress(S.qi, S.queue.length);
    $('writeCount').textContent = (S.qi + 1) + '/' + S.queue.length;
    drawSlots(target, '');
    if (Store.get('writeMode', 'audio') === 'audio' && Store.get('auto', 1)) {
      setTimeout(function () { writePlay(w); }, 260);
    }
    setTimeout(function () { try { $('writeInput').focus(); } catch (e) { } }, 100);
  }

  function drawSlots(target, typed) {
    var h = '';
    for (var i = 0; i < target.length; i++) {
      var c = target[i];
      if (c === ' ') { h += '<div class="slot space"></div>'; continue; }
      var t = typed[i] || '';
      var cls = 'slot' + (t ? (t.toLowerCase() === c.toLowerCase() ? ' fill' : ' bad') : '');
      h += '<div class="' + cls + '">' + (t ? t : '') + '</div>';
    }
    $('writeSlots').innerHTML = h;
  }

  function writePlay(w) {
    Speech.speak(cleanEn(w.en), {
      accent: Store.get('accent', 'uk'),
      rate: Math.max(0.6, Store.get('rate', 0.85) - 0.1),
      source: Store.get('voice', 'system')
    });
  }

  $('writePlay').addEventListener('click', function () { if (S.queue[S.qi]) writePlay(S.queue[S.qi]); });

  $('writeInput').addEventListener('input', function () {
    var w = S.queue[S.qi];
    if (!w || writeState.done) return;
    drawSlots(cleanEn(w.en), this.value);
  });

  $('writeInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); $('writeOk').click(); }
  });

  $('writeOk').addEventListener('click', function () {
    var w = S.queue[S.qi];
    if (!w || writeState.done) return;
    var target = cleanEn(w.en);
    var val = $('writeInput').value.trim();
    if (!val) { toast('先拼写出来，不会就点「不会」'); return; }
    writeState.done = true;
    drawSlots(target, val);
    var ok = val.toLowerCase().replace(/\s+/g, ' ').trim() === target.toLowerCase().trim();
    var fb = $('writeFb');
    fb.className = 'feedback ' + (ok ? 'ok' : 'no');
    if (ok) {
      fb.innerHTML = '✓ 正确！<b>' + target + '</b>';
      Store.addStars(1);
      $('starTotal').textContent = Store.data.stars;
    } else {
      fb.innerHTML = '✗ 正确拼写：<b>' + target + '</b> ' + (w.zh || '') +
        '<div style="font-size:12px;opacity:.8;margin-top:4px">你写的：' + val + '</div>';
    }
    fb.classList.remove('hidden');
    answer(ok, w);
    setTimeout(next, ok ? 850 : 2000);
  });

  $('writeSkip').addEventListener('click', function () {
    var w = S.queue[S.qi];
    if (!w || writeState.done) return;
    writeState.done = true;
    var target = cleanEn(w.en);
    $('writeInput').value = target;
    drawSlots(target, target);
    var fb = $('writeFb');
    fb.className = 'feedback no';
    fb.innerHTML = '正确答案：<b>' + target + '</b> ' + (w.zh || '');
    fb.classList.remove('hidden');
    answer(false, w);
    setTimeout(next, 2000);
  });

  $('writeTipBtn').addEventListener('click', function () {
    var w = S.queue[S.qi];
    if (!w || writeState.done) return;
    var target = cleanEn(w.en);
    writeState.tips++;
    var show = Math.min(target.replace(/ /g, '').length, writeState.tips);
    var h = '', n = 0;
    for (var i = 0; i < target.length; i++) {
      var c = target[i];
      if (c === ' ') { h += '<div class="slot space"></div>'; continue; }
      h += '<div class="slot fill">' + (n < show ? c : '') + '</div>';
      n++;
    }
    $('writeSlots').innerHTML = h;
    if (writeState.tips >= 2 && w.zh) {
      $('writeHint').textContent = '提示：' + w.zh;
    }
    if (Store.get('writeMode', 'audio') === 'audio') writePlay(w);
  });

  /* ================= 错词本 ================= */
  function renderWrong() {
    var list = Store.wrongList();
    var badge = $('wrongBadge');
    badge.textContent = list.length;
    badge.classList.toggle('hidden', !list.length);

    if (!list.length) {
      $('wrongList').innerHTML = '<div class="empty"><span class="e-emoji">🌟</span>' +
        '错词本是空的<br>做错的单词会自动收进来</div>';
      $('wrongBar').classList.add('hidden');
      return;
    }
    $('wrongBar').classList.remove('hidden');
    var html = '';
    list.forEach(function (it) {
      var w = findWord(it.bookId, it.en);
      var bk = findBook(it.bookId);
      html += '<div class="wrow">' +
        '<div class="wrow-main"><div class="wrow-en">' + cleanEn(it.en) + '</div>' +
        '<div class="wrow-zh">' + (w ? (w.zh || '') : '') +
        (bk ? ' <span style="opacity:.6">· ' + bk.title + '</span>' : '') + '</div></div>' +
        '<button class="iconbtn" data-say="' + encodeURIComponent(it.en) + '">🔊</button>' +
        '<button class="iconbtn del" data-del="' + encodeURIComponent(it.bookId + '|' + it.en) + '">✕</button>' +
        '</div>';
    });
    $('wrongList').innerHTML = html;

    $$('#wrongList [data-say]').forEach(function (b) {
      b.addEventListener('click', function () {
        Speech.speak(cleanEn(decodeURIComponent(b.dataset.say)), {
          accent: Store.get('accent', 'uk'), rate: Store.get('rate', 0.85),
          source: Store.get('voice', 'system')
        });
      });
    });
    $$('#wrongList [data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = decodeURIComponent(b.dataset.del).split('|');
        Store.removeWrong(p[0], p[1]);
        renderWrong();
        toast('已移出错词本');
      });
    });
  }

  function findWord(bookId, en) {
    var b = findBook(bookId);
    if (!b) return null;
    for (var i = 0; i < b.units.length; i++) {
      for (var j = 0; j < b.units[i].words.length; j++) {
        if (b.units[i].words[j].en.toLowerCase() === en.toLowerCase()) return b.units[i].words[j];
      }
    }
    return null;
  }

  $('wrongDrill').addEventListener('click', function () {
    var list = Store.wrongList();
    if (!list.length) return;
    // 错词跨书册，逐个取回原词
    var words = [];
    list.forEach(function (it) {
      var w = findWord(it.bookId, it.en);
      if (w) { w._bookId = it.bookId; words.push(w); }
    });
    if (!words.length) { toast('错词数据缺失'); return; }
    // 用错词所属书册作为统计归属（取第一个）
    S.bookId = list[0].bookId;
    S.book = findBook(S.bookId);
    startSession('write', words);
  });

  $('wrongClear').addEventListener('click', function () {
    if (!Store.wrongList().length) return;
    if (!confirm('确定清空错词本？')) return;
    Store.clearWrong();
    renderWrong();
    toast('已清空');
  });

  /* ================= 我的 ================= */
  function renderMe() {
    var d = Store.data.daily;
    var t = Store.today();
    var td = d[t] || { words: 0, right: 0, sec: 0 };
    var totalWords = 0, totalRight = 0;
    for (var k in d) { totalWords += d[k].words; totalRight += d[k].right; }
    var wrongN = Store.wrongList().length;

    $('statGrid').innerHTML =
      '<div class="statcard"><b>' + td.words + '</b><span>今日词数</span></div>' +
      '<div class="statcard"><b>' + Store.streak() + '</b><span>连续天数</span></div>' +
      '<div class="statcard"><b>' + Store.data.stars + '</b><span>累计星星</span></div>' +
      '<div class="statcard" style="grid-column:span 3"><b>' + totalWords +
      '</b><span>累计练习 ' + totalWords + ' 词 · 正确率 ' +
      (totalWords ? Math.round(totalRight / totalWords * 100) : 0) + '% · 错词 ' + wrongN + '</span></div>';

    // 设置高亮
    [['setCount', 'count'], ['setAccent', 'accent'], ['setRate', 'rate'],
    ['setVoice', 'voice'], ['setAuto', 'auto'], ['setWriteMode', 'writeMode']]
      .forEach(function (p) {
        $$('#' + p[0] + ' button').forEach(function (b) {
          b.classList.toggle('on', String(Store.get(p[1])) === b.dataset.v);
        });
      });

    // 导入目标
    var sel = $('impBook');
    if (!sel.dataset.init) {
      sel.innerHTML = S.data.books.map(function (b) {
        return '<option value="' + b.id + '">' + b.title + '（' + b.subtitle + '）</option>';
      }).join('') + '<option value="__new__">➕ 新建自定义书册…</option>';
      sel.dataset.init = '1';
    }

    $('aboutBox').innerHTML =
      '词库共 <b>' + S.data.meta.wordCount + '</b> 词 / <b>' + S.data.books.length + '</b> 册。<br>' +
      '· <b>三年级上册</b>：来自家长整理的课本词汇表（沪教版 2024 新教材，按主题分类）<br>' +
      '· <b>其余各册</b>：牛津上海版教材词汇（按 Module / Unit 组织）<br>' +
      '· 释义取自词典并做了精简，可在「词库导入」里覆盖或补充<br><br>' +
      '进度、错词、星星都存在这台设备上（localStorage），不会上传。<br>' +
      '想让孩子每个单元都跟课本完全一致，用上面的「词库导入」把课本词汇表粘进去即可。<br><br>' +
      '<span style="opacity:.7">安装到桌面：iPhone/iPad 用 Safari 打开 → 分享 → 「添加到主屏幕」；' +
      '安卓用 Chrome 打开 → 菜单 → 「安装应用」。</span>';
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.seg button') : null;
    if (!b) return;
    var box = b.parentElement.id;
    var map = {
      setCount: 'count', setAccent: 'accent', setRate: 'rate',
      setVoice: 'voice', setAuto: 'auto', setWriteMode: 'writeMode'
    };
    if (!map[box]) return;
    var v = b.dataset.v;
    Store.set(map[box], map[box] === 'count' ? +v :
      (map[box] === 'rate' ? +v : (map[box] === 'auto' ? +v : v)));
    $$('#' + box + ' button').forEach(function (x) { x.classList.toggle('on', x === b); });
    if (map[box] === 'accent') {
      Speech.speak('hello', { accent: v, rate: 0.85, source: Store.get('voice', 'system') });
    }
  });

  $$('#impBook').forEach(function () { });
  $('impBook').addEventListener('change', function () {
    if (this.value === '__new__') {
      var name = (prompt('给新书册起个名字，例如：三年级上册 Unit 5') || '').trim();
      if (!name) { this.selectedIndex = 0; return; }
      var id = 'my:' + name;
      if (!S.data.books.filter(function (b) { return b.id === id; })[0]) {
        S.data.books.push({
          id: id, grade: 99, term: 0, title: name,
          subtitle: '自定义词库', tag: '自建', count: 0, units: []
        });
      }
      this.innerHTML = S.data.books.map(function (b) {
        return '<option value="' + b.id + '">' + b.title + '（' + b.subtitle + '）</option>';
      }).join('') + '<option value="__new__">➕ 新建自定义书册…</option>';
      this.value = id;
    }
  });

  $('impGo').addEventListener('click', function () {
    var txt = $('impText').value.trim();
    var unit = $('impUnit').value.trim();
    var bid = $('impBook').value;
    var msg = $('impMsg');
    if (!txt) { msg.className = 'impmsg err'; msg.textContent = '请先粘贴单词'; return; }
    if (!unit) { msg.className = 'impmsg err'; msg.textContent = '请填单元名'; return; }
    var lines = txt.split(/\r?\n/), words = [], bad = 0;
    lines.forEach(function (ln) {
      ln = ln.trim();
      if (!ln) return;
      // 支持：英文,中文 | 英文 中文 | 英文<Tab>中文 | 英文;中文
      var m = ln.match(/^([A-Za-z][A-Za-z0-9'’\-\. \(\)]*?)\s*[,，;；\t]\s*(.+)$/);
      if (!m) m = ln.match(/^([A-Za-z][A-Za-z0-9'’\-\. ]*?)\s+([^\x00-\x7F].*)$/);
      if (m) {
        var en = m[1].trim().replace(/\s*\([^)]*\)\s*$/, '');
        var zh = m[2].trim();
        if (en && zh) words.push({ en: en, zh: zh });
        else bad++;
      } else bad++;
    });
    if (!words.length) {
      msg.className = 'impmsg err';
      msg.textContent = '没解析出单词。请每行一个，英文在前中文在后，用逗号/空格/制表符分隔。';
      return;
    }
    var added = Store.addCustom(bid, unit, words);
    // 同步到内存
    var b = findBook(bid);
    if (b) {
      var exist = b.units.filter(function (x) { return x.name === unit; })[0];
      if (exist) exist.words = Store.data.custom[bid][unit].slice();
      else b.units.push({ name: unit, words: Store.data.custom[bid][unit].slice(), custom: true });
      recount(b);
    }
    msg.className = 'impmsg ok';
    msg.textContent = '导入成功：新增 ' + added + ' 词' + (bad ? '，' + bad + ' 行没认出来' : '') +
      '。回到书架点进这本书就能练。';
    $('impText').value = '';
    renderBooks();
  });

  $('impClear').addEventListener('click', function () {
    $('impText').value = ''; $('impMsg').textContent = '';
  });

  /* ================= 导航 ================= */
  $$('[data-back]').forEach(function (b) {
    b.addEventListener('click', function () {
      Speech.stop();
      if (S.cur === 'learn' || S.cur === 'listen' || S.cur === 'speak' || S.cur === 'write') {
        if (S.qi < S.queue.length - 1 && !confirm('这一轮还没做完，确定退出？')) return;
      }
      if (S.book && (S.cur === 'learn' || S.cur === 'listen' || S.cur === 'speak' ||
        S.cur === 'write' || S.cur === 'result')) {
        renderUnits(); show('units');
      } else { renderBooks(); show('home'); }
    });
  });

  $$('.tab').forEach(function (b) {
    b.addEventListener('click', function () { show(b.dataset.go); });
  });

  /* ================= 启动 ================= */
  show('home');
  loadData().catch(function (e) {
    $('bookList').innerHTML = '<div class="empty"><span class="e-emoji">📦</span>词库加载失败：' +
      e.message + '<br>请检查网络后刷新</div>';
  });

  // 首次触摸时预热语音（iOS 需要用户手势）
  var warmed = false;
  function warm() {
    if (warmed) return;
    warmed = true;
    try {
      var u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    } catch (e) { }
  }
  document.addEventListener('touchstart', warm, { once: true, passive: true });
  document.addEventListener('mousedown', warm, { once: true });

  // 注册 Service Worker（离线可用 / 可安装到桌面）
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (e) {
        console.warn('SW 注册失败', e);
      });
    });
  }

  // 桌面快捷方式跳转
  if (location.hash === '#wrong') setTimeout(function () { show('wrong'); }, 350);
  if (location.hash === '#write') setTimeout(function () {
    var b = S.data && S.data.books.filter(function (x) { return x.tag === '当前教材'; })[0];
    if (b) { openBook(b.id); }
  }, 350);

  // 防止输入框聚焦时页面被顶变形
  window.addEventListener('resize', function () {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') {
      setTimeout(function () {
        var el = $('writeInput');
        if (el && S.cur === 'write') el.scrollIntoView({ block: 'center' });
      }, 120);
    }
  });
})();
