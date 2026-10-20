// 계산 시험: node test/calc.test.js
var C = require('../js/calc.js');
var fails = 0, n = 0;
function eq(name, got, want) {
  n++;
  var ok = typeof want === 'number' && typeof got === 'number' ? Math.abs(got - want) < 1e-9 : got === want;
  if (!ok) { fails++; console.log('실패:', name, '→ 받은 값', got, '/ 기대', want); }
}

// 1. 밤 11시 30분 취침, 다음 날 7시 기상 (자정 경과)
var r = C.calcNight({ bed: '23:30', sol: 0, waso: 0, wake: '07:00', out: '07:00' });
eq('자정 경과 침대시간', r.tib, 450);
eq('자정 경과 실제 수면', r.tst, 450);
eq('자정 경과 수면효율', r.se, 100);

// 2. 실제 수면시간·수면효율
r = C.calcNight({ bed: '23:30', sol: 40, waso: 30, wake: '06:30', out: '06:45' });
eq('침대시간 7시간15분', r.tib, 435);
eq('실제 수면 = 7h - 40 - 30 = 350분', r.tst, 350);
eq('수면효율 350/435', r.se, 350 / 435 * 100);

// 자정 이후에 누운 경우
r = C.calcNight({ bed: '00:40', sol: 20, waso: 10, wake: '06:00', out: '06:30' });
eq('자정 이후 취침 침대시간', r.tib, 350);
eq('자정 이후 취침 실제 수면', r.tst, 290);

// 3. 빈칸이면 계산 보류
r = C.calcNight({ bed: '23:00', sol: 10, wake: '06:00', out: '06:10' });
eq('빈칸 → 미완료', r.complete, false);
eq('빈칸 목록', r.missing.join(), 'waso');
eq('빈칸이면 수면시간 없음', r.tst, null);
eq('기록 없음', C.calcNight(null).complete, false);

// 음수 수면 / 깬 시각 > 나온 시각
r = C.calcNight({ bed: '23:00', sol: 300, waso: 200, wake: '06:00', out: '06:10' });
eq('음수 수면 → 오류', !!r.error, true);
r = C.calcNight({ bed: '23:00', sol: 10, waso: 0, wake: '07:00', out: '06:30' });
eq('깬 시각이 나온 시각보다 늦음 → 오류', !!r.error, true);
r = C.calcNight({ bed: '01:00', sol: 0, waso: 0, wake: '23:00', out: '04:00' });
eq('수면 > 침대시간 → 오류', !!r.error, true);
r = C.calcNight({ bed: '23:00', sol: 0, waso: 0, wake: '23:00', out: '23:00' });
eq('침대시간 0 → 오류', !!r.error, true);
// 한숨도 못 잔 밤은 정상 기록
r = C.calcNight({ bed: '23:00', sol: 420, waso: 0, wake: '06:00', out: '06:00' });
eq('못 잔 밤 수면 0', r.tst, 0);
eq('못 잔 밤 완료', r.complete, true);

// 4. 0mg 과 빈칸 구분
var st = {
  settings: { startDate: '2026-10-01' },
  meds: [{ id: 'hypnotic', rxMg: 10 }],
  intakes: { '2026-10-01': { hypnotic: { mg: 0 } }, '2026-10-02': { hypnotic: { mg: 10 } } },
  diary: {}, checks: {}, rx: []
};
eq('0mg 기록', C.doseOn(st, '2026-10-01'), 0);
eq('복용 기록 없음', C.doseOn(st, '2026-10-03'), null);
var s = C.summarize(st, C.datesFrom('2026-10-01', '2026-10-07'));
eq('복용 평균은 기록된 날만', s.dose, 5);
eq('복용한 밤 수', s.dosedNights, 1);
eq('수면 기록 없으면 평균 없음(0 아님)', s.tst, null);

// 5. 처방 변경 이력
eq('처방 기록 없으면 기본 10mg', C.prescribedOn(st, '2026-10-05'), 10);
st.rx.push({ id: 'a', date: '2026-10-10', beforeMg: 10, afterMg: 7.5 });
st.rx.push({ id: 'b', date: '2026-10-24', beforeMg: 7.5, afterMg: 5 });
eq('변경 전날', C.prescribedOn(st, '2026-10-09'), 10);
eq('첫 변경일', C.prescribedOn(st, '2026-10-10'), 7.5);
eq('두 번째 변경 이후', C.prescribedOn(st, '2026-11-01'), 5);

// 6. 주간 4일 미만이면 수면 평균 제한
for (var i = 0; i < 3; i++) st.diary[C.addDays('2026-10-01', i)] = { bed: '23:00', sol: 30, waso: 30, wake: '06:00', out: '06:30' };
s = C.weekSummary(st, 1);
eq('3일 기록 → 평균 없음', s.tst, null);
eq('3일 기록 → 개수 3', s.nComplete, 3);
st.diary['2026-10-05'] = { bed: '22:30', sol: 15, waso: 15, wake: '06:00', out: '06:00', sleepy: 2, symptoms: ['anxious'] };
s = C.weekSummary(st, 1);
eq('4일 기록 → 평균 계산', s.tst, (360 * 3 + 420) / 4 / 60);
eq('아침 졸림 1일 → 평균 없음', s.sleepy, null);
eq('증상 있던 날 1', s.symDays, 1);

// 7. 수정하면 즉시 반영
st.diary['2026-10-05'].sol = 75;
s = C.weekSummary(st, 1);
eq('수정 후 평균', s.tst, (360 * 3 + 360) / 4 / 60);

// 약 없는 밤 · 계획대로 · 계획보다 많이
var st2 = { settings: { startDate: '2026-10-01' }, meds: [{ id: 'hypnotic', rxMg: 10 }], diary: {}, checks: {},
  rx: [{ id: 'a', date: '2026-10-03', beforeMg: 10, afterMg: 5 }],
  intakes: { '2026-10-01': { hypnotic: { mg: 10 } }, '2026-10-02': { hypnotic: { mg: 0 } }, '2026-10-03': { hypnotic: { mg: 5 } }, '2026-10-04': { hypnotic: { mg: 10 } } },
  weekly: { 1: { confidence: 6, belief: 8 } } };
s = C.weekSummary(st2, 1);
eq('약 없는 밤', s.freeNights, 1);
eq('계획대로 먹은 밤', s.planKept, 2);
eq('계획보다 많이 먹은 밤', s.overPlan, 1);
eq('주간 점검 자신감', s.confidence, 6);
eq('주간 점검 믿음', s.belief, 8);
eq('주간 점검 없는 주', C.weekSummary(st2, 2).confidence, null);

// CBT-I 실행률: 해당없음 제외
eq('실행률', C.cbtRate({ items: { a: 'done', b: 'done', c: 'miss', d: 'na', e: 'na' } }), 200 / 3);
eq('모두 해당없음 → 없음', C.cbtRate({ items: { a: 'na' } }), null);

// 8. 52주 이상 주차 계산
eq('52주차', C.weekNoOf('2026-10-01', C.addDays('2026-10-01', 7 * 51)), 52);
eq('60주차', C.weekNoOf('2026-10-01', C.addDays('2026-10-01', 7 * 59 + 6)), 60);
eq('시작 전', C.weekNoOf('2026-10-01', '2026-09-30'), 0);
eq('윤년 넘김', C.addDays('2028-02-28', 1), '2028-02-29');

// 한국 시간 오늘
eq('한국 시간 날짜(UTC 15시 = 다음날 0시)', C.todayKST(new Date(Date.UTC(2026, 9, 19, 15, 0))), '2026-10-20');
eq('시간 표시', C.fmtDur(350), '5시간 50분');

console.log(fails ? fails + '/' + n + ' 실패' : '전부 통과 (' + n + '개)');
process.exit(fails ? 1 : 0);
