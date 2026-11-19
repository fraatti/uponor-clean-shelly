#!/usr/bin/env python3
"""Lataa skriptin Shellyyn paloina (Script.PutCode + append), joten selaineditorin
50 000 merkin liitosraja (tekstikentän maxlength) ei rajoita. Vain Pythonin vakiokirjasto.

Kaytto:
  python3 lataa_shellyyn.py <shellyn-ip> <skriptin-id> <tiedosto.js> [--salasana SALASANA] [--kaynnista]

Esimerkki:
  python3 lataa_shellyyn.py 192.168.1.50 2 shelly/v3/uponor_clean_v3_shelly.js --kaynnista

Vaiheet: pysayttaa skriptin, kirjoittaa koodin 1024 merkin paloina, lukee koodin
takaisin ja vertaa sita tiedostoon, ja kaynnistaa skriptin vain pyydettaessa.
Jos laitteessa on salasana, kayttajatunnus on aina "admin" (Shellyn digest-tunnistus, SHA-256).
"""
import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request

CHUNK = 1024


class Shelly:
    def __init__(self, host, password=None):
        self.url = 'http://%s/rpc' % host
        self.password = password
        self.challenge = None
        self.nc = 0
        self.req_id = 0

    def _auth_header(self):
        c = self.challenge
        algo = c.get('algorithm', 'SHA-256').upper()
        h = (lambda s: hashlib.sha256(s.encode()).hexdigest()) if algo.startswith('SHA-256') else (lambda s: hashlib.md5(s.encode()).hexdigest())
        self.nc += 1
        nc = '%08x' % self.nc
        cnonce = os.urandom(8).hex()
        ha1 = h('admin:%s:%s' % (c['realm'], self.password))
        ha2 = h('POST:/rpc')
        resp = h('%s:%s:%s:%s:auth:%s' % (ha1, c['nonce'], nc, cnonce, ha2))
        return ('Digest username="admin", realm="%s", nonce="%s", uri="/rpc", algorithm=%s, '
                'response="%s", qop=auth, nc=%s, cnonce="%s"' % (c['realm'], c['nonce'], algo, resp, nc, cnonce))

    def call(self, method, params):
        self.req_id += 1
        body = json.dumps({'id': self.req_id, 'method': method, 'params': params}).encode()
        for attempt in range(3):
            req = urllib.request.Request(self.url, data=body, method='POST', headers={'Content-Type': 'application/json'})
            if self.challenge and self.password:
                req.add_header('Authorization', self._auth_header())
            try:
                with urllib.request.urlopen(req, timeout=15) as r:
                    data = json.loads(r.read().decode())
            except urllib.error.HTTPError as e:
                if e.code == 401:
                    if not self.password:
                        sys.exit('Laite vaatii salasanan: anna --salasana')
                    self.challenge = parse_challenge(e.headers.get('WWW-Authenticate', ''))
                    self.nc = 0
                    continue
                raise
            if 'error' in data:
                raise RuntimeError('%s: %s' % (method, data['error']))
            return data.get('result')
        sys.exit('Tunnistus epaonnistui: tarkista salasana')


def parse_challenge(h):
    h = h.strip()
    if h.lower().startswith('digest'):
        h = h[6:]
    out = {}
    for part in h.split(','):
        if '=' in part:
            k, v = part.split('=', 1)
            out[k.strip()] = v.strip().strip('"')
    return out


def main():
    ap = argparse.ArgumentParser(description='Lataa skripti Shellyyn paloina.')
    ap.add_argument('host')
    ap.add_argument('script_id', type=int)
    ap.add_argument('file')
    ap.add_argument('--salasana', default=None)
    ap.add_argument('--kaynnista', action='store_true', help='kaynnista skripti latauksen jalkeen')
    a = ap.parse_args()

    code = open(a.file, encoding='utf-8').read()
    sh = Shelly(a.host, a.salasana)
    print('Laite: %s, skripti %d, tiedosto %s (%d merkkia)' % (a.host, a.script_id, a.file, len(code)))

    try:
        sh.call('Script.Stop', {'id': a.script_id})
        print('Skripti pysaytetty.')
    except RuntimeError as e:
        print('Huom: pysaytys ei onnistunut (%s). Jatketaan.' % e)

    parts = [code[i:i + CHUNK] for i in range(0, len(code), CHUNK)] or ['']
    for n, part in enumerate(parts):
        sh.call('Script.PutCode', {'id': a.script_id, 'code': part, 'append': n > 0})
        print('\rLadattu %d/%d palaa' % (n + 1, len(parts)), end='', flush=True)
    print()

    got, offset = [], 0
    while True:
        r = sh.call('Script.GetCode', {'id': a.script_id, 'offset': offset, 'len': 2048})
        got.append(r.get('data', ''))
        offset += len(r.get('data', '').encode('utf-8'))
        if not r.get('left'):
            break
    if ''.join(got) != code:
        sys.exit('VIRHE: laitteelta luettu koodi ei vastaa tiedostoa. Skriptia ei kaynnistetty.')
    print('Tarkistus OK: laitteella oleva koodi vastaa tiedostoa.')

    if a.kaynnista:
        sh.call('Script.Start', {'id': a.script_id})
        print('Skripti kaynnistetty. Tarkista konsolista rivit "Power component" ja "System ready".')
    else:
        print('Skriptia ei kaynnistetty (lisaa --kaynnista tai kaynnista selaimesta).')


if __name__ == '__main__':
    main()
