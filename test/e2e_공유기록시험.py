import os
# 같은 기록 시험: 로컬 Cloudflare 개발 서버(wrangler dev, 8793)에서 두 기기처럼 동시에 쓰기
# 실서버 주소로는 돌리지 말 것 (시험 기록으로 덮어씀)
import json, sys, time
from datetime import datetime, timedelta, timezone
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8793/'
assert 'localhost' in URL or '127.0.0.1' in URL, '로컬 서버에서만 돌려요'
fails, errors = [], []

# 앱의 하루는 새벽 4시(한국 시간)에 바뀜
T0 = (datetime.now(timezone(timedelta(hours=9))) - timedelta(hours=4)).date()
def day(n): return (T0 + timedelta(days=n)).isoformat()
T, Y = day(0), day(-1)

def check(name, cond, extra=''):
    print(('OK  ' if cond else 'FAIL') + ' ' + name + (' ' + str(extra) if extra else ''))
    if not cond: fails.append(name)

def server(page):
    return page.request.get(URL + 'api/state').json()

def diary(page, ds, bed, sol, night=None):
    page.goto(URL + '#diary/' + ds)
    page.wait_for_selector('input[name=bed]')
    for k, v in (night or {}).items():
        page.click('[data-seg=n_%s] button[data-v=%s]' % (k, v))
    page.fill('input[name=bed]', bed)
    page.fill('input[name=sol]', str(sol))
    page.fill('input[name=waso]', '10')
    page.fill('input[name=wake]', '06:30')
    page.fill('input[name=out]', '06:45')
    page.click('[data-act=save-diary]')
    page.wait_for_selector('.modal')
    page.click('.modal .btn')

with sync_playwright() as p:
    b = p.chromium.launch(channel=os.environ.get('BROWSER_CHANNEL', 'chrome'))
    A = b.new_context(viewport={'width': 390, 'height': 844}).new_page()
    B = b.new_context(viewport={'width': 390, 'height': 844}).new_page()
    for pg in (A, B):
        pg.on('pageerror', lambda e: errors.append(str(e)))

    # 서버에 예전 형식 기록을 넣어 둠 (수면일지 속 카페인·낮잠, 숫자 점수)
    start = server(A)
    old = {'version': 1, 'settings': {'startDate': day(-14), 'wakeTarget': '06:30', 'theme': 'system', 'range': 4},
           'diary': {day(-5): {'bed': '23:00', 'sol': 15, 'waso': 10, 'wake': '06:20', 'out': '06:40', 'caffeine': 'yes', 'nap': 30, 'sleepy': 2}},
           'checks': {day(-5): {'items': {'wake': 'done'}, 'energy': 6}}, 'intakes': {}, 'rx': [], 'thoughts': [],
           'weekly': {'2': {'confidence': 4, 'belief': 9, 'stress': 2, 'step': 'hold'}}, 'weekNotes': {}}
    r = A.request.put(URL + 'api/state', data=json.dumps({'base': start['version'], 'data': old}), headers={'content-type': 'application/json'})
    check('예전 형식 기록 넣기', r.status == 200, r.status)

    # 기기 A: 열면 바로 그 기록 (첫 화면 없이), 예전 칸은 새 자리로
    A.goto(URL)
    A.wait_for_selector('.hero')
    time.sleep(1)
    st = json.loads(A.evaluate("localStorage.getItem('sleepnote.v1')"))
    c5 = st['checks'][day(-5)]
    check('예전 카페인·낮잠이 루틴 칸으로 옮겨짐', c5.get('aux') == {'caffeine': 'miss'} and c5.get('nap') == {'did': 'yes', 'min': 30} and 'caffeine' not in st['diary'][day(-5)], c5)
    A.goto(URL + '#weekly/2')
    A.wait_for_selector('[data-seg=confidence]')
    check('예전 숫자 점수는 말로', A.inner_text('[data-seg=confidence] button.on') == '반반')

    diary(A, Y, '23:00', 30)
    time.sleep(2)
    s = server(A)
    check('A 기록이 서버에 올라감', Y in s['data']['diary'] and 'caffeine' not in s['data']['diary'][day(-5)], s['version'])

    # 기기 B: 처음 열면 같은 기록 (첫 화면 없이)
    B.goto(URL)
    B.wait_for_selector('.hero')
    check('B는 첫 화면 없이 같은 기록', B.locator('.onboard').count() == 0)
    B.goto(URL + '#log/diary')
    B.wait_for_selector('.list')
    check('B에서 A의 수면일지 보임', '수면 ' in B.inner_text('.list'))

    # 동시에 고치기: B는 오늘 루틴 체크, A는 다른 날 수면일지 (A는 B 변경을 아직 모름)
    B.goto(URL + '#routine')
    B.wait_for_selector('[data-seg="rt|wake|%s"]' % T)
    B.click('[data-seg="rt|wake|%s"] button[data-v=done]' % T)
    diary(A, day(-2), '22:30', 20)
    time.sleep(3)
    s = server(A)
    check('동시 수정이 합쳐짐 (A 일지 2개 + B 체크)', day(-2) in s['data']['diary'] and Y in s['data']['diary'] and T in s['data']['checks'])

    # A에서 받아오기 → B의 체크가 보임
    A.goto(URL + '#settings')
    A.wait_for_selector('[data-act=sync-now]')
    A.click('[data-act=sync-now]')
    time.sleep(1.5)
    st = json.loads(A.evaluate("localStorage.getItem('sleepnote.v1')"))
    check('A가 B의 루틴 체크를 받음', T in st['checks'])
    check('설정에 같은 기록 상태 표시', '같은 기록' in A.inner_text('#syncStatus'), A.inner_text('#syncStatus'))

    # 삭제도 다른 기기에 반영
    A.goto(URL + '#diary/' + day(-2))
    A.wait_for_selector('[data-act=del-diary]')
    A.click('[data-act=del-diary]')
    A.click('.modal .btn.danger-fill')
    time.sleep(2)
    B.goto(URL + '#home')
    B.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    time.sleep(1.5)
    st = json.loads(B.evaluate("localStorage.getItem('sleepnote.v1')"))
    check('A의 삭제가 B에 반영', day(-2) not in st['diary'] and Y in st['diary'])

    # 같은 날 같은 체크 칸: B는 그날 루틴, A는 그날 밤 행동(수면일지) → 둘 다 남아야 함
    B.goto(URL + '#routine/' + day(-3))
    B.wait_for_selector('[data-seg="rt|light|%s"]' % day(-3))
    B.click('[data-seg="rt|light|%s"] button[data-v=done]' % day(-3))
    diary(A, day(-3), '23:20', 15, {'sleepy': 'done', 'getup': 'na'})
    time.sleep(3)
    s = server(A)
    c3 = s['data']['checks'].get(day(-3), {})
    check('같은 날 루틴과 밤 행동이 서로 덮지 않음', c3.get('aux', {}).get('light') == 'done' and c3.get('items', {}).get('sleepy') == 'done' and c3.get('items', {}).get('getup') == 'na', c3)

    # 설정은 칸별로 합침: B가 기상 시각을 바꾼 걸 모르는 A가 분석 기간만 바꿔도 B 값이 남음
    B.goto(URL + '#settings')
    B.wait_for_selector('input[name=wakeTarget]')
    B.fill('input[name=wakeTarget]', '07:40')
    B.click('[data-act=save-settings]')
    time.sleep(2)
    A.goto(URL + '#stats')
    A.wait_for_selector('[data-act=range]')
    A.click('[data-act=range][data-v="12"]')
    time.sleep(3)
    st_ = server(A)['data']['settings']
    check('설정 칸별 합치기 (B 기상 시각 + A 분석 기간)', st_['wakeTarget'] == '07:40' and st_['range'] == 12, st_)

    # 새 기기를 오프라인으로 처음 열면 첫 화면(시작하기) 대신 연결 안내 → 연결되면 함께 쓰는 기록
    N = b.new_context(viewport={'width': 390, 'height': 844}).new_page()
    N.on('pageerror', lambda e: errors.append(str(e)))
    N.route('**/api/state', lambda route: route.abort())
    N.goto(URL + '#routine')
    N.wait_for_selector('[data-act=sync-now]')
    check('오프라인 첫 실행은 시작하기 화면을 띄우지 않음', N.locator('.onboard').count() == 0 and '아직 못 받았어요' in N.inner_text('main'))
    N.unroute('**/api/state')
    N.click('[data-act=sync-now]')
    N.wait_for_selector('#rtProgress')
    check('연결되면 함께 쓰는 기록으로 열림', json.loads(N.evaluate("localStorage.getItem('sleepnote.v1')"))['settings']['startDate'] == day(-14))

    # 두 기기가 같은 밤을 각자 새로 적음(A는 오프라인): 서로 다른 칸이 모두 남음, 빈 칸으로 덮지 않음
    A.route('**/api/state', lambda route: route.abort())
    A.goto(URL + '#diary/' + day(-6))
    A.wait_for_selector('input[name=bed]')
    A.click('[data-seg=alcohol] button[data-v=some]')
    A.click('[data-act=save-diary]')
    A.wait_for_selector('.modal')
    A.click('.modal .btn')
    B.goto(URL + '#diary/' + day(-6))
    B.wait_for_selector('input[name=bed]')
    B.click('[data-multi=symptoms] button[data-v=anxious]')
    B.fill('textarea[name=note]', 'B: 새벽에 화장실')
    B.click('[data-act=save-diary]')
    B.wait_for_selector('.modal')
    B.click('.modal .btn')
    time.sleep(2)
    A.unroute('**/api/state')
    A.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    time.sleep(3)
    d6 = server(A)['data']['diary'].get(day(-6), {})
    check('같은 밤을 두 기기가 새로 적어도 둘 다 남음', d6.get('alcohol') == 'some' and d6.get('symptoms') == ['anxious'] and d6.get('note') == 'B: 새벽에 화장실', d6)

    print('오류:', errors if errors else '없음')
    b.close()
print('실패:', fails if fails else '없음')
