import pathlib, json, sys, time, os, re
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
URL = pathlib.Path(__file__).resolve().parent.parent.joinpath('index.html').as_uri()
OUT = os.path.dirname(os.path.abspath(__file__)) + '/shots'
errors = []
fails = []

def check(name, cond, extra=''):
    print(('OK  ' if cond else 'FAIL') + ' ' + name + (' ' + str(extra) if extra else ''))
    if not cond: fails.append(name)

# 시험용 가짜 기록 (화면 시험에만 쓰고 앱에는 넣지 않음): 400일, 처방 10 → 7.5 → 5mg
GEN = """
(() => {
  const C = Calc;
  const start = C.addDays(C.todayKST(), -399);
  const s = { version: 1, settings: { startDate: start, wakeTarget: '06:30', theme: 'system', range: 52 },
    meds: APP_DATA.MEDS, intakes: {}, diary: {}, checks: {}, rx: [], thoughts: [], weekly: {}, weekNotes: {} };
  s.rx.push({ id: 'r1', date: C.addDays(start, 70), beforeMg: 10, afterMg: 7.5 });
  s.rx.push({ id: 'r2', date: C.addDays(start, 140), beforeMg: 7.5, afterMg: 5 });
  let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 400; i++) {
    const ds = C.addDays(start, i);
    if (rnd() < 0.2) continue;  // 기록 빠진 날
    const prog = Math.min(1, i / 200);
    s.diary[ds] = { bed: rnd() < 0.5 ? '23:' + String(Math.floor(rnd() * 50) + 10) : '00:' + String(Math.floor(rnd() * 40) + 10),
      sol: Math.round(60 - 35 * prog + rnd() * 20), waso: Math.round(70 - 40 * prog + rnd() * 20), wake: '06:' + String(Math.floor(rnd() * 40) + 10), out: '06:55',
      sleepy: Math.round(2 - prog + rnd()), symptoms: rnd() < 0.3 - 0.2 * prog ? ['anxious'] : [], satis: Math.min(5, Math.round(2 + 2 * prog + rnd())), note: '' };
    s.intakes[ds] = { hypnotic: { mg: C.prescribedOn(s, ds) - (rnd() < 0.1 ? 2.5 : 0), time: '23:00' } };
    const items = {}; APP_DATA.CBT_ITEMS.forEach(x => { if (x.key === 'nap') return; const r = rnd(); items[x.key] = r < 0.6 + 0.3 * prog ? 'done' : r < 0.9 ? 'miss' : 'na'; });
    const aux = {}; APP_DATA.ROUTINE.filter(x => !x.cbt).forEach(x => { aux[x.key] = rnd() < 0.5 + 0.4 * prog ? 'done' : 'miss'; });
    const napped = rnd() < 0.3 - 0.2 * prog, safe = napped && rnd() < 0.3;
    const nap = napped ? { did: 'yes', start: '13:' + String(Math.floor(rnd() * 50) + 10), min: safe ? 20 : 10 + Math.floor(rnd() * 5) * 10, why: safe ? 'safety' : 'habit' } : { did: 'no' };
    items.nap = !napped ? 'done' : safe ? 'na' : nap.min <= 30 ? 'done' : 'miss';
    const lv = () => Math.max(0, Math.min(3, Math.round(1.6 - prog + rnd() * 1.4 - 0.4)));
    const sv = [0, 3, 5, 7, 10];
    s.checks[ds] = { items, aux, nap, drowsy: { noon: lv(), pm: lv(), eve: lv() }, energy: sv[Math.min(4, Math.round(1 + 2.5 * prog + rnd()))], dizzy: rnd() < 0.05 ? 'yes' : 'no',
      memos: rnd() < 0.1 ? { light: '흐려서 실내 창가' } : undefined, note: rnd() < 0.1 ? '오후에 졸려 산책' : '' };
    if (!s.checks[ds].memos) delete s.checks[ds].memos;
    const w = C.weekNoOf(start, ds); if (!s.weekly[w]) s.weekly[w] = { confidence: sv[Math.min(4, Math.round(1 + 3 * prog))], belief: sv[Math.max(0, Math.round(4 - 4 * prog))], stress: 5, fall: 'no', focus: 'getup' };
    if (i % 20 === 0) s.thoughts.push({ id: 't' + i, date: ds, situation: '자기 전', thought: '약 없으면 못 잔다', alternative: '지난주 약 없이 잔 밤도 있었다', before: 7, after: 3 });
  }
  localStorage.setItem('sleepnote.v1', JSON.stringify(s));
  return Object.keys(s.diary).length;
})()
"""

with sync_playwright() as p:
    b = p.chromium.launch(channel=os.environ.get('BROWSER_CHANNEL', 'chrome'))
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' else None)
    page.goto(URL)
    n = page.evaluate(GEN)
    print('가짜 기록 일수:', n)
    t0 = time.time()
    page.goto(URL + '#stats')
    page.reload()
    page.wait_for_selector('#ch-cbt svg')
    print('52주 분석 화면 그리기: %.2f초' % (time.time() - t0))
    txt = page.inner_text('main')
    print('주간 카드 수:', page.locator('.week-card').count(), '/ 비교:', '주차 →' in txt)
    check('분석 화면에 점수 숫자 없음', not re.search(r'\d+(\.\d)?점| / ?(10|3)\b|0~3|0~10|%p', txt), re.findall(r'.{0,12}(?:\d+(\.\d)?점| / ?(10|3)\b|0~3|0~10|%p).{0,6}', txt)[:5])
    ticks = ' '.join(page.eval_on_selector_all('#ch-sym svg text, #ch-energy svg text, #ch-conf svg text', 'els => els.map(e => e.textContent)'))
    check('졸림·기운·자신감 눈금은 말', all(w in ticks for w in ['없음', '심함', '처짐', '좋음', '낮음', '높음']), ticks[:160])
    check('시간대별 졸림 3칸(점심·오후·저녁) 말로', page.locator('.bar-row').count() == 3 and not re.search(r'\d', ' '.join(page.locator('.bar-row b').all_inner_texts())), ' '.join(page.locator('.bar-row').all_inner_texts())[:120])
    page.locator('#ch-sym').scroll_into_view_if_needed()
    box = page.locator('#ch-sym > svg').bounding_box()
    page.mouse.move(box['x'] + box['width'] * 0.5, box['y'] + box['height'] * 0.5)
    time.sleep(0.2)
    tip = page.inner_text('#ch-sym .chart-tip')
    check('아침 졸림 짚어 보기도 말', any(w in tip for w in ['없음', '약간', '꽤', '심함']) and not re.search(r'\d(\.\d)?점', tip), tip.replace(chr(10), ' | '))
    page.locator('#ch-conf').scroll_into_view_if_needed()
    box = page.locator('#ch-conf > svg').bounding_box()
    page.mouse.move(box['x'] + box['width'] * 0.5, box['y'] + box['height'] * 0.5)
    time.sleep(0.2)
    tip = page.inner_text('#ch-conf .chart-tip')
    check('자신감 짚어 보기도 말', ('자신감' in tip) and not re.search(r'\d+(\.\d)?$', tip.split(chr(10))[-1]), tip.replace(chr(10), ' | '))
    page.screenshot(path=OUT + '/10_stats52.png', full_page=False)
    page.locator('.block').first.screenshot(path=OUT + '/11_stats52_sleep.png')
    page.locator('.block').nth(1).screenshot(path=OUT + '/12_stats52_dose.png')
    # 짚어 보기 툴팁
    box = page.locator('#ch-dose > svg').bounding_box()
    page.mouse.move(box['x'] + box['width'] * 0.6, box['y'] + box['height'] * 0.5)
    time.sleep(0.2)
    print('툴팁:', page.inner_text('#ch-dose .chart-tip').replace('\n', ' | '))
    page.locator('.block').nth(1).screenshot(path=OUT + '/13_tooltip.png')
    page.click('[data-act=range][data-v="1"]')
    page.wait_for_selector('#ch-cbt svg')
    page.locator('.block').first.screenshot(path=OUT + '/14_stats1w.png')

    # 홈 (기록 많을 때)
    page.goto(URL + '#home')
    page.wait_for_selector('.hero')
    page.screenshot(path=OUT + '/15_home_data.png', full_page=True)
    # 감량 화면
    page.goto(URL + '#meds')
    page.wait_for_selector('.big-num')
    page.screenshot(path=OUT + '/16_taper.png', full_page=True)
    page.goto(URL + '#ask')
    page.wait_for_selector('#promptOut')
    pr = page.input_value('#promptOut')
    print('질문 글 길이:', len(pr))
    SCORE = r'(?:졸림|기운|자신감|믿음|스트레스|걱정|만족도?)[ \t:]*\d|\(0~\d\)'
    check('질문 글에 점수 숫자 없음', not re.search(SCORE, pr) and '시간대별 졸림' in pr and '그 밖의 루틴' in pr, re.findall(r'.{0,15}(?:' + SCORE + r').{0,5}', pr)[:5])
    open(OUT + '/ask_prompt.txt', 'w', encoding='utf-8').write(page.input_value('#promptOut'))
    # 어두운 화면
    page.emulate_media(color_scheme='dark')
    page.goto(URL + '#stats')
    page.reload()
    page.wait_for_selector('#ch-cbt svg')
    page.screenshot(path=OUT + '/17_dark_stats.png')
    page.goto(URL + '#diary/' + page.evaluate('Calc.addDays(Calc.todayKST(),-1)'))
    page.wait_for_selector('#calc')
    page.screenshot(path=OUT + '/18_dark_diary.png')
    page.emulate_media(color_scheme='light')
    # 프로그램
    page.goto(URL + '#program/2')
    page.wait_for_selector('#wk2')
    page.screenshot(path=OUT + '/19_program.png')
    # 홈: 9주 이후 카드는 8주 과정으로
    page.goto(URL + '#home')
    page.wait_for_selector('.hero')
    check('장기 기록 카드 → 8주 과정', page.get_attribute('a.hero', 'href') == '#program')
    page.goto(URL + '#log/check')
    page.wait_for_selector('.list')
    check('루틴 목록', '체크 ' in page.inner_text('.list'))
    # PC 화면
    page.set_viewport_size({'width': 1280, 'height': 800})
    page.goto(URL + '#home')
    page.reload()
    page.wait_for_selector('.hero')
    page.screenshot(path=OUT + '/20_pc.png')
    print('오류:', errors if errors else '없음')
    b.close()
print('실패:', fails if fails else '없음')
