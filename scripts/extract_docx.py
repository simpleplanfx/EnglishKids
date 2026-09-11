"""从三年级上册英语词汇分类整理.docx 提取词汇表（英文 | 中文）"""
import zipfile
import re
import json
import xml.etree.ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

SRC = r'D:\onedrive\文档\xwechat_files\fangxuvip_660d\msg\file\2026-09\三年级上册英语词汇分类整理.docx'


def para_text(p):
    parts = []
    for node in p.iter():
        if node.tag == W + 't':
            parts.append(node.text or '')
        elif node.tag == W + 'tab':
            parts.append('\t')
        elif node.tag == W + 'br':
            parts.append(' ')
    return ''.join(parts).strip()


def row_cells(tr):
    return [para_text(tc).strip() for tc in tr.findall(W + 'tc')]


def main():
    z = zipfile.ZipFile(SRC)
    root = ET.fromstring(z.read('word/document.xml'))
    body = root.find(W + 'body')

    blocks = []  # (type, payload)
    for child in body:
        if child.tag == W + 'p':
            t = para_text(child)
            if t:
                blocks.append(('p', t))
        elif child.tag == W + 'tbl':
            rows = [row_cells(tr) for tr in child.findall(W + 'tr')]
            rows = [r for r in rows if any(c for c in r)]
            if rows:
                blocks.append(('tbl', rows))

    out_path = r'D:\software\workbuddy data\个人\english-kids\data\raw\g3a_blocks.json'
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(blocks, f, ensure_ascii=False, indent=1)

    # 打印结构概览
    for kind, payload in blocks:
        if kind == 'p':
            print('[P]', payload)
        else:
            print('[TBL] rows=%d  first=%s' % (len(payload), payload[0][:4]))
    print('\n--- blocks:', len(blocks))


if __name__ == '__main__':
    main()
