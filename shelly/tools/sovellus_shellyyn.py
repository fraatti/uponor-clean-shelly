#!/usr/bin/env python3
"""Asentaa tai paivittaa selainsovelluksen Shellyyn, jolloin Shelly jakaa sen itse osoitteesta
http://<shellyn-ip>/script/<id>/app. Muuta palvelinta tai Home Assistantia ei tarvita.

Kaytto:
  python3 sovellus_shellyyn.py <shellyn-ip> [--salasana SALASANA]

Asentaa kaksi skriptia (luo ne, jos niita ei ole, muuten paivittaa):
  uponor-clean-app       pieni latainsivu (app/uponor_clean_app_loader.js), kaynnistyy aina kun Shelly kaynnistyy
  uponor-clean-app-data  sovellus (app/uponor-clean-app.html) gzip-pakattuna ja base64-koodattuna;
                         tama on pelkka varasto eika sita koskaan kaynnisteta

Tunnistusskriptiin (uponor-clean-v3) ei kosketa. Vain Pythonin vakiokirjasto.
"""
import argparse
import base64
import gzip
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lataa_shellyyn import Shelly, CHUNK  # noqa: E402

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
APP = os.path.join(ROOT, 'app', 'uponor-clean-app.html')
LOADER = os.path.join(ROOT, 'app', 'uponor_clean_app_loader.js')
NAME_LOADER = 'uponor-clean-app'
NAME_DATA = 'uponor-clean-app-data'


def packed_app():
    html = open(APP, 'rb').read()
    return base64.b64encode(gzip.compress(html, compresslevel=9, mtime=0)).decode('ascii'), len(html)


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
    ap.add_argument('host')
    ap.add_argument('--salasana', default=None)
    a = ap.parse_args()
    sh = Shelly(a.host, a.salasana)

    data, n_html = packed_app()
    loader = open(LOADER, encoding='utf-8').read()

    sid, new = find_or_create(sh, NAME_DATA)
    print('%s: skripti %d%s, sovellus %d merkkia -> pakattuna %d merkkia' % (NAME_DATA, sid, ' (uusi)' if new else '', n_html, len(data)))
    try:
        sh.call('Script.Stop', {'id': sid})
    except RuntimeError:
        pass
    sh.call('Script.SetConfig', {'id': sid, 'config': {'enable': False}})
    put_code(sh, sid, data)

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
