/* 冒烟测试：用 jsdom 真实加载页面并走一遍主要流程 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire('C:/Users/Eric/.workbuddy-ai/binaries/node/workspace/');
const { JSDOM, VirtualConsole } = require('jsdom');

const APP = String.raw`D:\software\workbuddy data\个人\english-kids\app`;
const BASE = 'http://127.0.0.1:8777';

const errors = [];
const warns = [];

const vc = new VirtualConsole();
vc.on('jsdomError', (e) => {
  // jsdom 未实现的媒体/录音接口不算错误
  const m = String(e.message || '');
  if (/Not implemented|Could not parse CSS|speechSynthesis|MediaRecorder|Audio/.test(m)) {
    warns.push(m.slice(0, 120));
  } else {
    errors.push('jsdomError: ' + m + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n'));
  }
});
vc.on('error', (m) => errors.push('console.error: ' + m));
vc.on('warn', (m) => warns.push('warn: ' + m));

const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');

const dom = new JSDOM(html, {
  url: BASE + '/index.html',
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    // jsdom 没有 fetch，用 node 的 fetch 打到本地服务器
    window.fetch = (u, o) => {
      const url = String(u).startsWith('http') ? String(u) : BASE + '/' + String(u).replace(/^\.?\//, '');
      return fetch(url, o);
    };
    window.confirm = () => true;
    window.prompt = () => '测试书册';
    // 关掉 TTS/录音，避免 jsdom 未实现报错
    window.SpeechSynthesisUtterance = function () { return {}; };
    window.MediaRecorder = undefined;
  }
});

const { window } = dom;
const doc = window.document;
const $ = (id) => doc.getElementById(id);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function assert(cond, msg) {
  if (cond) console.log('  ✓ ' + msg);
  else { console.log('  ✗ ' + msg); errors.push('断言失败: ' + msg); }
}

await sleep(1600);

console.log('\n【1】词库加载 + 书架渲染');
const cards = doc.querySelectorAll('.bookcard');
assert(cards.length >= 13, `书架渲染 ${cards.length} 本书`);
assert($('homeSub').textContent.includes('1337'), '顶部统计: ' + $('homeSub').textContent);

console.log('\n【2】打开「当前教材」三年级上册');
const cur = Array.from(cards).find(c => c.classList.contains('cur'));
assert(!!cur, '找到当前教材卡片: ' + (cur && cur.querySelector('.bk-title').textContent));
cur.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(300);
const unitRows = doc.querySelectorAll('.unitrow');
assert(unitRows.length === 26, `单元列表 ${unitRows.length} 个单元`);
// 151 词条去重后为 145，属预期
assert(/已选 26 个单元 · 14[0-9] 词/.test($('unitHint').textContent),
  '单元提示: ' + $('unitHint').textContent);

console.log('\n【3】认词模式');
doc.querySelector('.modebtn[data-mode="learn"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(300);
assert(!$('scr-learn').classList.contains('hidden'), '进入认词界面');
const w1 = $('learnWord').textContent;
assert(w1 && w1 !== '—', '显示单词: ' + w1);
$('learnCard').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
assert(!$('learnZh').classList.contains('hidden'), '点击卡片后显示中文: ' + $('learnZh').textContent);
const before = $('learnCount').textContent;
$('learnYes').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(200);
assert($('learnCount').textContent !== before, `翻到下一词 ${before} -> ${$('learnCount').textContent}`);

console.log('\n【4】听力模式');
// 退出回到单元页
$('scr-learn').querySelector('[data-back]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(250);
doc.querySelector('.modebtn[data-mode="listen"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(350);
const opts = doc.querySelectorAll('#listenOpts .opt');
assert(opts.length === 4, `听力 4 个选项，实际 ${opts.length}`);
const right = doc.querySelector('#listenOpts .opt[data-right]');
assert(!!right, '标记了正确选项');
right.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(250);
assert(right.classList.contains('right'), '选中后高亮正确');
assert($('listenFb').textContent.includes('答对'), '反馈文案: ' + $('listenFb').textContent.slice(0, 20));

console.log('\n【5】默写模式（看中文拼写）');
const Store = window.Store;
Store.set('writeMode', 'zh');
await sleep(1100); // 等听力自动跳下一题
$('scr-listen').querySelector('[data-back]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(250);
doc.querySelector('.modebtn[data-mode="write"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(350);
assert(!$('scr-write').classList.contains('hidden'), '进入默写界面');
const zh = $('writeZh').textContent;
assert(zh && zh !== '？？？', '显示中文提示: ' + zh);
// 用内部状态取当前答案
const slots = doc.querySelectorAll('#writeSlots .slot').length;
assert(slots > 0, `拼写格子 ${slots} 个`);
// 空提交应走 toast 提示而非判错
$('writeOk').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(150);
assert($('toast').textContent.includes('先拼写'), '空提交提示: ' + $('toast').textContent);
assert($('writeFb').textContent === '', '空提交不判错');

// 「提示」按钮应首字母显形
$('writeTipBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(120);
assert(doc.querySelectorAll('#writeSlots .slot.fill').length > 0, '提示后显形首字母');

// 「不会」应给出正确答案
$('writeSkip').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(200);
assert($('writeFb').textContent.includes('正确答案'), '不会时给出答案: ' + $('writeFb').textContent.slice(0, 24));

console.log('\n【6】错词本');
Store.mark('hj3a', 'teacher', false);
Store.mark('hj3a', 'classmate', false);
doc.querySelector('.tab[data-go="wrong"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(250);
const wrows = doc.querySelectorAll('#wrongList .wrow');
assert(wrows.length >= 2, `错词本 ${wrows.length} 条（手动 2 + 默写「不会」1）`);
assert(+$('wrongBadge').textContent === wrows.length, '角标数量与列表一致: ' + $('wrongBadge').textContent);
// 删除一条
wrows[0].querySelector('[data-del]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(200);
assert(doc.querySelectorAll('#wrongList .wrow').length === wrows.length - 1, '删除错词生效');

console.log('\n【7】我的 / 设置 / 导入');
doc.querySelector('.tab[data-go="me"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(250);
assert(doc.querySelectorAll('.statcard').length === 4, '统计卡片 4 张');
assert($('impBook').options.length >= 13, `导入下拉 ${$('impBook').options.length} 个选项`);
$('impUnit').value = 'Unit 0 测试';
$('impText').value = 'apple,苹果\nbanana 香蕉\ncoffee，咖啡\n这是一行垃圾';
$('impGo').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(200);
const impMsg = $('impMsg').textContent;
assert(impMsg.includes('新增 3 词'), '导入结果: ' + impMsg);

console.log('\n【8】进度持久化');
const raw = window.localStorage.getItem('ekids_v1');
assert(!!raw && raw.length > 50, 'localStorage 写入 ' + (raw ? raw.length : 0) + ' 字节');
const parsed = JSON.parse(raw);
assert(parsed.stat['hj3a|teacher'] && parsed.stat['hj3a|teacher'].bad === 1, '错词标记已落盘');
assert(parsed.custom && Object.keys(parsed.custom).length > 0, '自定义词库已落盘');

console.log('\n================ 结果 ================');
if (errors.length) {
  console.log('❌ 发现 ' + errors.length + ' 个错误：');
  errors.forEach(e => console.log('   - ' + e));
  process.exit(1);
} else {
  console.log('✅ 全部通过');
  if (warns.length) {
    const uniq = [...new Set(warns.map(w => w.slice(0, 60)))];
    console.log('（忽略 ' + warns.length + ' 条 jsdom 未实现的媒体接口告警，如 ' + uniq[0] + '）');
  }
}
process.exit(0);
