/* ============================================================
 * store.js —— 本地数据层（进度 / 设置 / 错词 / 自定义词库）
 * ============================================================
 *
 * 【职责】
 * 统一管理所有需要持久化的数据，全部存在 localStorage 的单个键中。
 * 界面层（app.js）不直接读写 localStorage，一律通过本模块。
 *
 * 【存储结构】localStorage['ekids_v1']
 *   {
 *     settings: { count, accent, rate, voice, ... },  // 用户偏好
 *     stat:     { "bookId|word": {n,r,w,bad} },       // 单词掌握统计
 *     stars:    123,                                   // 累计星星
 *     daily:    { "2026-09-05": {words,right,sec} },   // 每日学习量
 *     custom:   { bookId: { unitName: [wordObj] } }    // 自定义词书
 *   }
 *
 * 【单词统计字段含义】（stat 的值）
 *   n   练习总次数
 *   r   累计答对次数
 *   w   当前「连续」答对次数（答错清零）
 *   bad 是否在错词本（1=在，0=已移出）
 *
 * 【核心规则】见 mark() —— 连续答对 3 次视为掌握并移出错词本，
 *             答错一次立即清零连续计数并进入错词本。
 *
 * 【维护提示】
 *   - 修改存储结构时，务必同步 bump KEY 的版本号（如 ekids_v2），
 *     否则老用户升级后会因字段缺失而读到 undefined。
 *     若要平滑迁移，在 load() 中做旧格式的兼容转换。
 *   - 所有数据只存本地，不上传服务器（本项目的隐私底线）。
 * ============================================================ */
(function (global) {
  'use strict';

  /** localStorage 键名。变更存储结构时请递增版本号。 */
  var KEY = 'ekids_v1';

  var DEFAULT = {
    settings: {
      count: 10,          // 每轮词数
      accent: 'uk',       // uk | us
      rate: 0.85,         // 语速
      voice: 'system',    // system | online
      auto: 1,            // 进入自动朗读
      writeMode: 'audio'  // audio | zh
    },
    // 每词掌握度：{ "bookId|单词": {n:练习次数, r:答对次数, w:连续答对, bad:是否错词} }
    stat: {},
    custom: {},          // 自定义词库：{ bookId: { unitName: [ {en,zh} ] } }
    daily: {},           // { '2026-09-04': {words:12, right:10, sec:180} }
    stars: 0
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var data = clone(DEFAULT);

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var o = JSON.parse(raw);
        data.settings = Object.assign(clone(DEFAULT.settings), o.settings || {});
        data.stat = o.stat || {};
        data.custom = o.custom || {};
        data.daily = o.daily || {};
        data.stars = o.stars || 0;
      }
    } catch (e) {
      console.warn('读取本地进度失败', e);
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('保存失败', e);
    }
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0');
  }

  var Store = {
    data: data,
    load: load,
    save: save,
    today: today,

    get: function (k, d) {
      var v = data.settings[k];
      return v === undefined ? d : v;
    },
    set: function (k, v) { data.settings[k] = v; save(); },

    /* ---- 单词掌握度 ---- */
    key: function (bookId, en) { return bookId + '|' + en.toLowerCase(); },

    getWord: function (bookId, en) {
      return data.stat[this.key(bookId, en)] || null;
    },

    /** 记录一次练习结果。ok=true 答对 */
    mark: function (bookId, en, ok) {
      var k = this.key(bookId, en);
      var s = data.stat[k] || { n: 0, r: 0, w: 0, bad: 0 };
      s.n++;
      if (ok) {
        s.r++;
        s.w++;
        if (s.w >= 3) s.bad = 0;      // 连续答对 3 次，移出错词本
      } else {
        s.w = 0;
        s.bad = 1;                    // 答错即进错词本
      }
      data.stat[k] = s;
      save();
      return s;
    },

    isMastered: function (bookId, en) {
      var s = data.stat[this.key(bookId, en)];
      return !!s && s.w >= 3;
    },

    addStars: function (n) { data.stars += n; save(); },

    /* ---- 每日统计 ---- */
    addDaily: function (words, right, sec) {
      var d = today();
      var v = data.daily[d] || { words: 0, right: 0, sec: 0 };
      v.words += words; v.right += right; v.sec += sec;
      data.daily[d] = v;
      save();
    },

    streak: function () {
      var n = 0, d = new Date();
      for (var i = 0; i < 400; i++) {
        var k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
          '-' + String(d.getDate()).padStart(2, '0');
        if (data.daily[k] && data.daily[k].words > 0) {
          n++; d.setDate(d.getDate() - 1);
        } else if (i === 0) {
          d.setDate(d.getDate() - 1); // 今天还没学，从昨天开始算
        } else break;
      }
      return n;
    },

    /* ---- 错词本 ---- */
    wrongList: function () {
      var out = [];
      for (var k in data.stat) {
        if (!data.stat[k].bad) continue;
        var i = k.indexOf('|');
        out.push({ bookId: k.slice(0, i), en: k.slice(i + 1), s: data.stat[k] });
      }
      return out.sort(function (a, b) { return (b.s.n - b.s.r) - (a.s.n - a.s.r); });
    },

    removeWrong: function (bookId, en) {
      var k = this.key(bookId, en);
      if (data.stat[k]) { data.stat[k].bad = 0; data.stat[k].w = 3; save(); }
    },

    clearWrong: function () {
      for (var k in data.stat) { data.stat[k].bad = 0; }
      save();
    },

    /* ---- 自定义词库 ---- */
    customBooks: function () {
      var out = [];
      for (var bid in data.custom) {
        var units = data.custom[bid];
        var n = 0;
        for (var u in units) n += units[u].length;
        out.push({ id: bid, units: units, count: n });
      }
      return out;
    },

    addCustom: function (bookId, unitName, words) {
      data.custom[bookId] = data.custom[bookId] || {};
      var arr = data.custom[bookId][unitName] || [];
      var seen = {};
      arr.forEach(function (w) { seen[w.en.toLowerCase()] = 1; });
      var added = 0;
      words.forEach(function (w) {
        var k = w.en.toLowerCase();
        if (!seen[k]) { seen[k] = 1; arr.push(w); added++; }
      });
      data.custom[bookId][unitName] = arr;
      save();
      return added;
    },

    delCustomUnit: function (bookId, unitName) {
      if (data.custom[bookId]) {
        delete data.custom[bookId][unitName];
        if (!Object.keys(data.custom[bookId]).length) delete data.custom[bookId];
        save();
      }
    },

    reset: function () { data = clone(DEFAULT); save(); }
  };

  load();
  global.Store = Store;
})(window);
