"""把 kkabc 牛津上海版 1A-6B 词表 + 家长提供的三年级上册 docx，合并成统一词库 words.json"""
import re
import os
import json
import html
import zipfile
import xml.etree.ElementTree as ET

BASE = r'D:\software\workbuddy data\个人\english-kids'
KK = os.path.join(BASE, 'data', 'kk')
DOCX = r'D:\onedrive\文档\xwechat_files\fangxuvip_660d\msg\file\2026-09\三年级上册英语词汇分类整理.docx'

GRADE_CN = {'一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6}

# 牛津上海版 12 册（来自 fanyi.kkabc.com）
KK_BOOKS = [
    ('bk_2a255b', 1, 1), ('bk_a825fd', 1, 2),
    ('bk_29658c', 2, 1), ('bk_a80673', 2, 2),
    ('bk_5febb1', 3, 1), ('bk_b6ad30', 3, 2),
    ('bk_900d77', 4, 1), ('bk_de6dd3', 4, 2),
    ('bk_9cab2f', 5, 1), ('bk_7d0e67', 5, 2),
    ('bk_2090f7', 6, 1), ('bk_fad97c', 6, 2),
]

POS_RE = re.compile(r'^\s*(n|v|vt|vi|adj|adv|prep|pron|conj|num|art|int|aux|na|abbr|pl|pron)\.\s*')
NOISE = re.compile(r'[〔\[（(][^\]〕)）]{0,12}[\]〕)）]')


def shorten(brief, maxlen=10):
    """把词典长释义压缩成小学生看得懂的短释义"""
    if not brief:
        return ''
    first = re.split(r'[\n\r]+', brief.strip())[0]
    first = POS_RE.sub('', first).strip()
    first = NOISE.sub('', first).strip()
    chunks = [c.strip() for c in re.split(r'[；;]', first) if c.strip()]
    if not chunks:
        return first[:maxlen + 4]
    out = chunks[0]
    # 首段太短时补第二段，避免 "尺" 这种残缺
    if len(out) < 2 and len(chunks) > 1:
        out += '；' + chunks[1]
    # 单段内部过长时按逗号再切
    if len(out) > maxlen:
        parts = [p for p in re.split(r'[，,、]', out) if p.strip()]
        if len(parts) > 1:
            out = parts[0]
            for p in parts[1:]:
                if len(out) + len(p) + 1 <= maxlen:
                    out += '，' + p
                else:
                    break
    return out.strip('；，,、 ')[:maxlen + 2]


def full_meaning(brief, maxlen=46):
    """完整一点的第一义项，供展开查看"""
    if not brief:
        return ''
    parts = [p.strip() for p in re.split(r'[\n\r]+', brief.strip()) if p.strip()]
    out = []
    n = 0
    for p in parts:
        p = POS_RE.sub('', p).strip()
        p = NOISE.sub('', p).strip()
        if not p:
            continue
        out.append(p)
        n += len(p)
        if n >= 18:
            break
    s = '；'.join(out)
    return s[:maxlen]


def parse_kk(bid):
    """解析 kkabc 书页 -> [(unit_name, [(en, zh, ph_en, ph_us)])]"""
    path = os.path.join(KK, bid + '.html')
    s = open(path, encoding='utf-8', errors='ignore').read()
    # 只取词表区域
    body = s
    units = []
    # 依次扫描 h4 标题 与 dancibiao 区块
    pattern = re.compile(
        r'<h4 class="ci-list-h4">(.*?)</h4>.*?<div class="dancibiao">(.*?)(?=<div class="ci-list-title">|$)',
        re.S)
    for m in pattern.finditer(body):
        uname = html.unescape(re.sub(r'<[^>]+>', '', m.group(1))).strip()
        block = m.group(2)
        words = []
        chunks = re.split(r'<div class="dancibiao-tr">', block)[1:]
        for raw in chunks:
            mword = re.search(r'<div class="dancibiao-word"><a[^>]*>(.*?)</a>', raw, re.S)
            if not mword:
                continue
            en = html.unescape(re.sub(r'<[^>]+>', '', mword.group(1))).strip()
            mbr = re.search(r'<div class="dancibiao-brief">(.*?)</div>', raw, re.S)
            brief = html.unescape(re.sub(r'<[^>]+>', '', mbr.group(1))) if mbr else ''
            ph_en = ph_us = ''
            for pm in re.finditer(r'data-type="(en|us)"[^>]*>([^<>\[]*)\[([^\]]*)\]', raw):
                ph = pm.group(3).strip()
                if pm.group(1) == 'en':
                    ph_en = ph
                else:
                    ph_us = ph
            zh = shorten(brief)
            full = full_meaning(brief)
            if en:
                words.append({'en': en, 'zh': zh, 'ph': ph_en or ph_us or '',
                              'ph_us': ph_us or ph_en or '',
                              **({'full': full} if full and full != zh else {})})
        if words:
            units.append({'name': uname, 'words': words})
    return units


def parse_docx():
    """解析家长提供的三年级上册词汇分类整理 -> [(unit_name, [(en, zh)])]"""
    W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
    z = zipfile.ZipFile(DOCX)
    root = ET.fromstring(z.read('word/document.xml'))
    body = root.find(W + 'body')

    def ptext(p):
        s = ''.join(n.text or '' for n in p.iter() if n.tag == W + 't')
        return s.strip()

    def cells(tr):
        return [ptext(tc).strip() for tc in tr.findall(W + 'tc')]

    units = []
    cur = None
    for child in body:
        if child.tag == W + 'p':
            t = ptext(child)
            if t and not t.startswith('英文'):
                cur = t
        elif child.tag == W + 'tbl':
            words = []
            for tr in child.findall(W + 'tr'):
                cs = cells(tr)
                if len(cs) >= 2 and cs[0].strip() in ('英文', ''):
                    continue
                if len(cs) >= 2 and cs[0].strip():
                    words.append({'en': cs[0].strip(), 'zh': cs[1].strip()})
            # 表格可能是 4 列（英文|中文|英文|中文）
            if not words:
                for tr in child.findall(W + 'tr'):
                    cs = cells(tr)
                    if len(cs) >= 4 and cs[0].strip() not in ('英文', ''):
                        for k in range(0, len(cs) - 1, 2):
                            if cs[k].strip() and cs[k].strip() != '英文':
                                words.append({'en': cs[k].strip(), 'zh': cs[k + 1].strip()})
            if words:
                units.append({'name': cur or '词汇', 'words': words})
    return units


def main():
    ph_map = {}
    books = []
    total = 0

    # 先解析牛津上海版，建立音标查表
    kk_units_all = {}
    for bid, g, t in KK_BOOKS:
        units = parse_kk(bid)
        if not units:
            print('!! 无数据', bid)
            continue
        kk_units_all[(g, t)] = units
        for u in units:
            for w in u['words']:
                if w['ph'] and w['en'].lower() not in ph_map:
                    ph_map[w['en'].lower()] = (w['ph'], w['ph_us'])

    # 三年级上册优先用家长的 docx（沪教版 2024 新教材）
    docx_units = parse_docx()
    for u in docx_units:
        for w in u['words']:
            if not w.get('ph'):
                p = ph_map.get(w['en'].lower())
                if p:
                    w['ph'], w['ph_us'] = p[0], p[1]
                else:
                    w.setdefault('ph', '')
                    w.setdefault('ph_us', '')

    def mkbook(bid_, grade, term, title, subtitle, tag, units):
        nonlocal total
        words = [w for u in units for w in u['words']]
        total += len(words)
        return {
            'id': bid_, 'grade': grade, 'term': term, 'title': title,
            'subtitle': subtitle, 'tag': tag, 'count': len(words),
            'units': [{'name': u['name'], 'words': u['words']} for u in units if u['words']],
        }

    # 沪教版 2024 三年级上册（家长词汇表，当前在用教材）
    if docx_units:
        books.append(mkbook('hj3a', 3, 1, '三年级上册', '沪教版（五四制·2024 新教材）',
                            '当前教材', docx_units))

    # 牛津上海版 1A-6B
    for (g, t), units in sorted(kk_units_all.items()):
        cn = {1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六'}[g]
        term_cn = '上' if t == 1 else '下'
        tag = ''
        if g == 3 and t == 1:
            tag = '扩展'
        if g == 6:
            tag = '小升初衔接'
        books.append(mkbook('ox%d%s' % (g, term_cn), g, t,
                            '%s年级%s册' % (cn, term_cn), '牛津上海版', tag, units))

    data = {
        'meta': {
            'name': '小学英语听说默写词库',
            'region': '上海·沪教版/牛津上海版',
            'generated': '2026-09-04',
            'bookCount': len(books),
            'wordCount': total,
        },
        'books': books,
    }
    out = os.path.join(BASE, 'app', 'data', 'words.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))

    print('书册 %d，词汇 %d' % (len(books), total))
    for b in books:
        print('  %-10s %-8s %-22s 单元%2d 词%4d  %s' % (
            b['id'], b['title'], b['subtitle'], len(b['units']), b['count'], b['tag']))
    print('\n样例：')
    for b in books[:2]:
        for u in b['units'][:2]:
            print(' ', b['title'], '/', u['name'], '->',
                  ['%s %s' % (w['en'], w['zh']) for w in u['words'][:4]])


if __name__ == '__main__':
    main()
