#!/usr/bin/env python3
"""Asentaa tai paivittaa selainsovelluksen Shellyyn, jolloin Shelly jakaa sen itse osoitteesta
http://<shellyn-ip>/script/<id>/app. Muuta palvelinta tai Home Assistantia ei tarvita.

Kaytto:
  python3 sovellus_shellyyn.py <shellyn-ip> [--salasana SALASANA]
  python3 sovellus_shellyyn.py --tiedosto      # vain app/uponor-clean-app-data*.txt (web-kayttoliittymaa varten)

Asentaa skriptit (luo ne, jos niita ei ole, muuten paivittaa):
  uponor-clean-app       pieni latainsivu (app/uponor_clean_app_loader.js), kaynnistyy aina kun Shelly kaynnistyy
  uponor-clean-app-data  sovellus (app/uponor-clean-app.html) gzip-pakattuna ja base64-koodattuna;
                         tama on pelkka varasto eika sita koskaan kaynnisteta. Yli 45 000 merkin
                         sovellus jatkuu skripteissa uponor-clean-app-data2, -data3 jne.

Helpoin tapa on sovelluksen oma Asenna Shellyyn -painike (asetuksissa). Ilman Pythonia skriptit voi
tehda myos Shellyn web-kayttoliittymassa liittamalla app/uponor-clean-app-data*.txt ja
app/uponor_clean_app_loader.js (ohje docs/sovellus.md).

Tunnistusskriptiin (uponor-clean-v3) ei kosketa. Vain Pythonin vakiokirjasto.
"""
import argparse
import base64
import gzip
import glob
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lataa_shellyyn import Shelly, CHUNK  # noqa: E402

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
APP = os.path.join(ROOT, 'app', 'uponor-clean-app.html')
LOADER = os.path.join(ROOT, 'app', 'uponor_clean_app_loader.js')
EDITOR_MAX = 50000  # Shellyn web-kayttoliittyman editori katkaisee pidemman liitoksen
PART_MAX = 45000    # merkkia yhteen varastoskriptiin (sama kuin sovelluksessa)
FS_KEEP = 65536     # tavua Shellyn tiedostojarjestelmasta jatetaan vapaaksi
NAME_LOADER = 'uponor-clean-app'
NAME_DATA = 'uponor-clean-app-data'
PART_RE = re.compile(r'^uponor-clean-app-data(\d*)$')


def part_name(i):
    return NAME_DATA + (str(i + 1) if i else '')


def part_no(name):
    m = PART_RE.match(name or '')
    return int(m.group(1) or 1) if m else None


def packed_app():
    """gzip + base64, 76 merkin riveina. Latainsivu poistaa rivinvaihdot ennen purkua."""
    html = open(APP, 'rb').read()
    b64 = base64.b64encode(gzip.compress(html, compresslevel=9, mtime=0)).decode('ascii')
    return '\n'.join(b64[i:i + 76] for i in range(0, len(b64), 76)) + '\n', len(html)


def packed_parts():
    """Pakattu sovellus enintaan PART_MAX merkin osina rivien rajoilta."""
    data, n_html = packed_app()
    parts = ['']
    for line in data.splitlines(keepends=True):
        if len(parts[-1]) + len(line) > PART_MAX:
            parts.append('')
        parts[-1] += line
    return parts, n_html


def find_or_create(sh, name):
    for s in sh.call('Script.List', {}).get('scripts', []):
        if s.get('name') == name:
            return s['id'], False
    return sh.call('Script.Create', {'name': name})['id'], True


def put_code(sh, sid, code):
    parts = [code[i:i + CHUNK] for i in range(0, len(code), CHUNK)] or ['']
    for n, part in enumerate(parts):
        sh.call('Script.PutCode', {'id': sid, 'code': part, 'append': n > 0})
        print('\r  ladattu %d/%d palaa' % (n + 1, len(parts)), end='', flush=True)
    print()
    got, offset = [], 0
    while True:
        r = sh.call('Script.GetCode', {'id': sid, 'offset': offset, 'len': 2048})
        got.append(r.get('data', ''))
        offset += len(r.get('data', '').encode('utf-8'))
        if not r.get('left'):
            break
    if ''.join(got) != code:
        sys.exit('VIRHE: laitteelta luettu koodi ei vastaa ladattua (skripti %d).' % sid)


def main():
    ap = argparse.ArgumentParser(description='Asenna selainsovellus Shellyyn.')
    ap.add_argument('host', nargs='?')
    ap.add_argument('--salasana', default=None)
    ap.add_argument('--tiedosto', action='store_true', help='kirjoita vain app/uponor-clean-app-data*.txt')
    a = ap.parse_args()
    parts, n_html = packed_parts()
    if a.tiedosto:
        for old in glob.glob(os.path.join(ROOT, 'app', NAME_DATA + '*.txt')):
            os.remove(old)
        for i, part in enumerate(parts):
            fn = os.path.join(ROOT, 'app', part_name(i) + '.txt')
            with open(fn, 'w', encoding='ascii', newline='\n') as f:
                f.write(part)
            print('%s: %d merkkia' % (os.path.relpath(fn, ROOT), len(part)))
        print('sovellus %d merkkia -> %d osaa' % (n_html, len(parts)))
        return
    if not a.host:
        ap.error('anna Shellyn osoite tai --tiedosto')
    sh = Shelly(a.host, a.salasana)
    loader = open(LOADER, encoding='utf-8').read()

    total = sum(len(p) for p in parts) + len(loader)
    fs_free = sh.call('Sys.GetStatus', {}).get('fs_free')
    if isinstance(fs_free, int) and fs_free - total < FS_KEEP:
        sys.exit('VIRHE: Shellyssa ei ole tarpeeksi tilaa: vapaana %d t, sovellus vie %d t ja %d t jatetaan vapaaksi.'
                 % (fs_free, total, FS_KEEP))

    for i, part in enumerate(parts):
        sid, new = find_or_create(sh, part_name(i))
        print('%s: skripti %d%s, %d merkkia' % (part_name(i), sid, ' (uusi)' if new else '', len(part)))
        try:
            sh.call('Script.Stop', {'id': sid})
        except RuntimeError:
            pass
        sh.call('Script.SetConfig', {'id': sid, 'config': {'enable': False}})
        put_code(sh, sid, part)
    for s in sh.call('Script.List', {}).get('scripts', []):
        n = part_no(s.get('name'))
        if n and n > len(parts):
            try:
                sh.call('Script.Stop', {'id': s['id']})
            except RuntimeError:
                pass
            sh.call('Script.Delete', {'id': s['id']})
            print('%s: skripti %d poistettu (ylimaarainen osa)' % (s['name'], s['id']))

    lid, new = find_or_create(sh, NAME_LOADER)
    print('%s: skripti %d%s' % (NAME_LOADER, lid, ' (uusi)' if new else ''))
    try:
        sh.call('Script.Stop', {'id': lid})
    except RuntimeError:
        pass
    put_code(sh, lid, loader)
    sh.call('Script.SetConfig', {'id': lid, 'config': {'enable': True}})
    sh.call('Script.Start', {'id': lid})
    st = sh.call('Script.GetStatus', {'id': lid})
    print('  kaynnissa: %s, muisti %s t (huippu %s t)' % (st.get('running'), st.get('mem_used'), st.get('mem_peak')))
    print('\nSovellus: http://%s/script/%d/app' % (a.host, lid))


if __name__ == '__main__':
    main()
