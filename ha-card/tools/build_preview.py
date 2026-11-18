#!/usr/bin/env python3
"""Put the current card source into preview.html (the demo page with simulated history)."""
import pathlib, re
here = pathlib.Path(__file__).resolve().parent.parent
card = (here / 'uponor-clean-card.js').read_text(encoding='utf-8')
page = (here / 'preview.html').read_text(encoding='utf-8')
start = page.index('<script>/*! uponor-clean-card')
end = page.index('</script>', start)
page = page[:start] + '<script>' + card.rstrip('\n') + '\n' + page[end:]
(here / 'preview.html').write_text(page, encoding='utf-8')
print('preview.html updated with card', re.search(r"UC_VERSION = '([^']+)'", card).group(1))
