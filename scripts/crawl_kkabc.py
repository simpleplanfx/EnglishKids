"""抓取 fanyi.kkabc.com 的牛津上海版小学英语单词表（1A-5B 共 10 册）"""
import re
import os
import time
import html
import urllib.request

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
OUT = r'D:\software\workbuddy data\个人\english-kids\data\kk'
BASE = 'https://fanyi.kkabc.com/list/'

SEEDS = ['bk_5febb1', 'bk_2a255b', 'bk_e26c67']

os.makedirs(OUT, exist_ok=True)


def fetch(bid):
    path = os.path.join(OUT, bid + '.html')
    if os.path.exists(path) and os.path.getsize(path) > 5000:
        return open(path, encoding='utf-8', errors='ignore').read()
    url = BASE + bid
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=40) as r:
        data = r.read()
    # 尝试 utf-8，失败则 gbk
    for enc in ('utf-8', 'gbk', 'gb18030'):
        try:
            s = data.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        s = data.decode('utf-8', errors='ignore')
    open(path, 'w', encoding='utf-8').write(s)
    time.sleep(0.6)
    return s


def title_of(s):
    m = re.search(r'<title[^>]*>(.*?)</title>', s, re.S)
    return html.unescape(m.group(1)).strip() if m else ''


def links_of(s):
    out = {}
    for m in re.finditer(r'<a[^>]+href=["\']([^"\']*?(bk_[0-9a-z]{6}))[^"\']*["\'][^>]*>(.*?)</a>', s, re.S | re.I):
        bid = m.group(2)
        txt = html.unescape(re.sub(r'<[^>]+>', '', m.group(3))).strip()
        if txt:
            out.setdefault(bid, txt)
    return out


def main():
    seen = {}
    queue = list(SEEDS)
    while queue:
        bid = queue.pop(0)
        if bid in seen:
            continue
        try:
            s = fetch(bid)
        except Exception as e:
            print('FAIL', bid, e)
            seen[bid] = ('ERR', str(e))
            continue
        t = title_of(s)
        seen[bid] = (t, None)
        print(bid, '|', t[:70])
        for nb, txt in links_of(s).items():
            if nb not in seen and nb not in queue:
                queue.append(nb)
        if len(seen) > 120:  # 安全阀
            break

    print('\n=== 命中「牛津上海版小学英语」的书册 ===')
    hits = {k: v[0] for k, v in seen.items()
            if '牛津上海版' in (v[0] or '') and '小学英语' in (v[0] or '')}
    for k, v in sorted(hits.items(), key=lambda x: x[1]):
        print(k, v)
    print('总抓取', len(seen), '命中', len(hits))
    with open(os.path.join(OUT, '_index.json'), 'w', encoding='utf-8') as f:
        import json
        json.dump({k: v[0] for k, v in seen.items()}, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
