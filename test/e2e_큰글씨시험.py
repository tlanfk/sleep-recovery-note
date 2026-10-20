import pathlib
# 큰 글씨 시험: 휴대폰 글자 크게(카카오톡 "가가" 등)처럼 글자만 키워서 넘치는 곳 찾기
import json, sys, os
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
URL = pathlib.Path(__file__).resolve().parent.parent.joinpath('index.html').as_uri()
OUT = os.path.dirname(os.path.abspath(__file__)) + '/shots/big'
os.makedirs(OUT, exist_ok=True)
ZOOMS = [float(z) for z in (sys.argv[1].split(',') if len(sys.argv) > 1 else ['1.3', '1.6', '2'])]
SHOT = len(sys.argv) > 2

GEN = open(os.path.dirname(os.path.abspath(__file__)) + '/e2e_52주시험.py', encoding='utf-8').read().split('GEN = """')[1].split('"""')[0]

# 글자만 f배: 먼저 모든 계산값을 읽은 뒤 한 번에 적용 (상속 두 번 곱해지지 않게)
ZOOM_JS = """(f) => {
  const els = [...document.querySelectorAll('body *')];
  const sizes = els.map(el => parseFloat(getComputedStyle(el).fontSize));
  els.forEach((el, i) => { el.style.fontSize = (sizes[i] * f) + 'px'; });
}"""

# 넘치는 곳: 가로 스크롤, 글자가 상자 밖으로 삐져나옴, 화면 밖으로 나간 요소
CHECK_JS = """() => {
  const out = [], W = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > W + 1) out.push('가로 스크롤 생김 ' + document.documentElement.scrollWidth + ' > ' + W);
  document.querySelectorAll('main *, .modal *').forEach(el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('svg') || el.tagName === 'TEXTAREA') return;
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    const name = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '');
    const txt = (el.innerText || el.value || '').trim().slice(0, 18).replace(/\\n/g, ' ');
    if (r.right > W + 1 || r.left < -1) out.push('화면 밖: ' + name + ' "' + txt + '"');
    else if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll' && el.clientWidth > 0 && !['INPUT'].includes(el.tagName))
      out.push('글자 넘침: ' + name + ' "' + txt + '"');
  });
  return [...new Set(out)];
}"""

PAGES = ['#home', '#diary/' + '{y}', '#routine', '#routine/{y}', '#weekly/58', '#log/diary', '#log/check', '#log/thought', '#meds', '#stats', '#stats-tip', '#program', '#settings', '#ask', '#thought/new', '#rx/new']

with sync_playwright() as p:
    b = p.chromium.launch(channel=os.environ.get('BROWSER_CHANNEL', 'chrome'))
    page = b.new_page(viewport={'width': 360, 'height': 780}, device_scale_factor=2)
    page.goto(URL)
    page.evaluate(GEN)
    t = page.evaluate('Calc.todayKST()')
    y = page.evaluate('Calc.addDays(Calc.todayKST(), -1)')
    total = 0
    for z in ZOOMS:
        print('\n===== 글자 %.1f배 =====' % z)
        for pg in PAGES + ['onboard']:
            if pg == 'onboard':
                page.evaluate("localStorage.setItem('sleepnote.backup', localStorage.getItem('sleepnote.v1')); localStorage.removeItem('sleepnote.v1')")
                page.goto(URL + '#home'); page.reload()
            else:
                page.goto(URL + pg.replace('{t}', t).replace('{y}', y).replace('-tip', '')); page.reload()
            page.wait_for_timeout(250)
            page.evaluate(ZOOM_JS, z)
            page.wait_for_timeout(100)
            if pg == '#stats-tip':  # 짚어 보기 상자를 띄운 채로 검사
                page.locator('#ch-conf').scroll_into_view_if_needed()
                bx = page.locator('#ch-conf > svg').bounding_box()
                page.mouse.move(bx['x'] + bx['width'] * 0.97, bx['y'] + bx['height'] * 0.6)
                page.wait_for_timeout(150)

            issues = page.evaluate(CHECK_JS)
            total += len(issues)
            print('%-14s %s' % (pg, '문제 없음' if not issues else ''))
            for i in issues[:12]: print('    - ' + i)
            if len(issues) > 12: print('    ... 외 %d개' % (len(issues) - 12))
            if SHOT:
                page.screenshot(path='%s/%s_%s.png' % (OUT, str(z).replace('.', '_'), pg.strip('#').replace('/', '-').replace('{t}', 't').replace('{y}', 'y')), full_page=True)
            if pg == 'onboard':
                page.evaluate("localStorage.setItem('sleepnote.v1', localStorage.getItem('sleepnote.backup'))")
    # 8주 과정에 '#program/3'으로 들어올 때 고른 주 제목이 위 막대에 가리지 않는지:
    # 글자를 나중에 키우면 스크롤이 이미 끝난 뒤라, 화면 전체를 처음부터 키운 상태(좁은 화면)로 확인
    for w in (360, 225, 180):
        page.set_viewport_size({'width': w, 'height': 780 * w // 360})
        page.goto(URL + '#home'); page.reload(); page.wait_for_timeout(150)
        page.goto(URL + '#program/3'); page.wait_for_timeout(300)
        pos = page.evaluate("() => { const s = document.querySelector('#wk3 summary').getBoundingClientRect(), t = document.querySelector('.topbar').getBoundingClientRect(); return [s.top, t.bottom]; }")
        ok = pos[0] >= pos[1] - 1
        total += 0 if ok else 1
        print('#program/3 화면 확대 %.1f배: %s' % (360 / w, '제목 보임' if ok else '제목이 위 막대에 가림 %s' % pos))
    print('\n전체 문제 수:', total)
    b.close()
