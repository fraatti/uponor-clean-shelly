#!/usr/bin/env python3
"""Compact Shelly version: strips comments and blank lines, indents with one space per level.
A leading "/* @meta ... */" block (virtual components the script owns) is kept as the first
thing in the file, because the firmware reads it only from the first 1024 bytes."""
import sys

src, dst, header = sys.argv[1], sys.argv[2], sys.argv[3]
code = open(src, encoding='utf-8').read()
meta = ''
if code.lstrip().startswith('/* @meta'):
    start = code.index('/* @meta')
    end = code.index('*/', start) + 2
    meta = code[start:end] + '\n'
    code = code[end:]
    if len(meta.encode('utf-8')) > 1024:
        sys.exit('@meta block is %d bytes; the firmware reads only the first 1024' % len(meta.encode('utf-8')))

out, i, n = [], 0, len(code)
in_str = None
while i < n:
    c = code[i]
    if in_str:
        out.append(c)
        if c == '\\':
            out.append(code[i + 1]); i += 2; continue
        if c == in_str:
            in_str = None
        i += 1; continue
    if c in '"\'':
        in_str = c; out.append(c); i += 1; continue
    if code.startswith('/*', i):
        j = code.index('*/', i + 2); i = j + 2; continue
    if code.startswith('//', i):
        j = code.find('\n', i); i = n if j < 0 else j; continue
    out.append(c); i += 1

flat = '--flat' in sys.argv
lines = []
settings = False
for L in ''.join(out).split('\n'):
    s = L.rstrip()
    if not s.strip():
        continue
    lead = len(s) - len(s.lstrip(' '))
    s = s.lstrip(' ') if flat else ' ' * (lead // 4) + s.lstrip(' ')
    if s.startswith(('let CONFIG = {', 'let LIMITS = {', 'let TIME = {', 'let CFG = {')):
        settings = True
    # flat mode: join argument lists / object literals (no ASI hazard after "(" or "," or before ")").
    # Settings objects keep one entry per line so they stay easy to edit.
    if flat and not settings and lines and (lines[-1].endswith('(') or lines[-1].endswith(',') or s.startswith(')')):
        lines[-1] += ('' if lines[-1].endswith('(') or s.startswith(')') else ' ') + s
    else:
        lines.append(s)
    if settings and s == '};':
        settings = False
text = meta + header.rstrip('\n') + '\n' + '\n'.join(lines) + '\n'
open(dst, 'w', encoding='utf-8').write(text)
print(dst, len(text.encode('utf-8')), 'bytes,', len(text), 'chars')
