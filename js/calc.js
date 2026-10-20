/* 수면 회복 노트 — 계산 함수 모음 (브라우저와 Node 시험에서 같이 씀) */
(function (root) {
  'use strict';

  var MIN_DAYS = 4;          // 평균을 내려면 필요한 최소 기록 일수
  var MED_ID = 'hypnotic';   // 기록하는 수면제의 내부 ID (약 이름·용량은 사용자가 정함)

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  /* ---------- 날짜 (모두 'YYYY-MM-DD' 문자열, 한국 시간 기준) ---------- */
  function todayKST(now) {
    var d = now || new Date();
    // 한국은 일광절약시간이 없어서 UTC+9 고정
    var k = new Date(d.getTime() + 9 * 3600 * 1000);
    return k.getUTCFullYear() + '-' + pad(k.getUTCMonth() + 1) + '-' + pad(k.getUTCDate());
  }
  function toUTC(ds) { var p = ds.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function fromUTC(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function addDays(ds, n) { return fromUTC(toUTC(ds) + n * 86400000); }
  function daysBetween(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 86400000); }
  function isDate(ds) { return typeof ds === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ds); }
  function weekday(ds) { return new Date(toUTC(ds)).getUTCDay(); }

  /* ---------- 시각 ---------- */
  function parseHM(s) {
    if (typeof s !== 'string' || !/^\d{1,2}:\d{2}$/.test(s)) return null;
    var p = s.split(':'), h = +p[0], m = +p[1];
    if (h > 23 || m > 59) return null;
    return h * 60 + m;
  }
  // a 시각에서 b 시각까지 걸린 분 (자정을 넘으면 다음 날로 봄)
  function diffMin(a, b) { return ((b - a) % 1440 + 1440) % 1440; }

  /* ---------- 수면일지 한 건 계산 ---------- */
  var REQUIRED = ['bed', 'sol', 'waso', 'wake', 'out'];

  function calcNight(d) {
    var r = { complete: false, missing: [], error: null, tib: null, tst: null, se: null };
    if (!d) { r.missing = REQUIRED.slice(); return r; }
    var bed = parseHM(d.bed), wake = parseHM(d.wake), out = parseHM(d.out);
    if (bed === null) r.missing.push('bed');
    if (!isNum(d.sol)) r.missing.push('sol');
    if (!isNum(d.waso)) r.missing.push('waso');
    if (wake === null) r.missing.push('wake');
    if (out === null) r.missing.push('out');
    if (r.missing.length) return r;

    var tib = diffMin(bed, out);         // 침대에 머문 시간
    var toWake = diffMin(bed, wake);     // 누운 시각 → 마지막으로 깬 시각
    var wakeToOut = diffMin(wake, out);  // 마지막으로 깬 시각 → 침대에서 나온 시각
    var tst = toWake - d.sol - d.waso;   // 실제 수면시간

    if (d.sol < 0 || d.waso < 0) r.error = '분 단위 값은 0 이상이어야 합니다.';
    else if (tib === 0) r.error = '누운 시각과 침대에서 나온 시각이 같습니다.';
    else if (tib > 16 * 60) r.error = '침대에 있던 시간이 16시간을 넘습니다. 오전/오후를 확인해 주세요.';
    else if (toWake > tib || wakeToOut > 5 * 60) r.error = '마지막으로 깬 시각은 침대에서 나온 시각보다 앞서야 합니다. 시각을 확인해 주세요.';
    else if (tst < 0) r.error = '잠들기까지 걸린 시간과 밤중에 깨어 있던 시간의 합이 누워 있던 시간보다 깁니다. 확인해 주세요.';
    if (r.error) return r;

    r.complete = true;
    r.tib = tib;
    r.tst = tst;
    r.se = tst / tib * 100;
    return r;
  }

  /* ---------- CBT-I 실행률: 완료 ÷ (완료 + 미완료), 해당없음 제외 ---------- */
  function cbtRate(check) {
    if (!check || !check.items) return null;
    var done = 0, miss = 0;
    for (var k in check.items) {
      if (check.items[k] === 'done') done++;
      else if (check.items[k] === 'miss') miss++;
    }
    return done + miss === 0 ? null : done / (done + miss) * 100;
  }

  /* ---------- 수면제 복용량 ---------- */
  // 그 날짜에 실제 기록된 복용량. 기록 없음 = null, 안 먹음 = 0
  function doseOn(state, ds) {
    var day = state.intakes && state.intakes[ds];
    var rec = day && day[MED_ID];
    return rec && isNum(rec.mg) ? rec.mg : null;
  }
  // 그 날짜에 적용되는 처방 용량: 그 날짜 이전 마지막 처방 변경 기록, 없으면 약 정보의 기본 처방
  function prescribedOn(state, ds) {
    var best = null;
    (state.rx || []).forEach(function (c) {
      if (isDate(c.date) && c.date <= ds && isNum(c.afterMg)) {
        if (!best || c.date > best.date || (c.date === best.date && (c.createdAt || 0) > (best.createdAt || 0))) best = c;
      }
    });
    if (best) return best.afterMg;
    var z = (state.meds || []).filter(function (m) { return m.id === MED_ID; })[0];
    return z && isNum(z.rxMg) ? z.rxMg : null;
  }
  // 가장 최근(오늘 이전)의 처방 변경
  function lastRxChange(state, ds) {
    var best = null;
    (state.rx || []).forEach(function (c) {
      if (isDate(c.date) && c.date <= ds && (!best || c.date > best.date)) best = c;
    });
    return best;
  }

  /* ---------- 주차 ---------- */
  function weekNoOf(start, ds) {
    if (!isDate(start) || !isDate(ds)) return null;
    var n = daysBetween(start, ds);
    return n < 0 ? 0 : Math.floor(n / 7) + 1;
  }
  function weekRange(start, w) {
    var s = addDays(start, (w - 1) * 7);
    return { start: s, end: addDays(s, 6) };
  }
  function datesFrom(a, b) {
    var out = [], n = daysBetween(a, b);
    for (var i = 0; i <= n; i++) out.push(addDays(a, i));
    return out;
  }

  /* ---------- 여러 날 요약 ---------- */
  function avg(arr) {
    if (!arr.length) return null;
    var s = 0; arr.forEach(function (v) { s += v; });
    return s / arr.length;
  }

  function summarize(state, dates) {
    var tib = [], tst = [], se = [], sol = [], waso = [];
    var sleepy = [], satis = [], dose = [], rx = [], cbt = [], energy = [];
    var dangerDays = 0, dosedNights = 0, freeNights = 0, planKept = 0, overPlan = 0, nPlan = 0;
    var symDays = 0, nSym = 0, diaryDays = 0, severeDays = 0, dizzyDays = 0, napDays = 0, safeNapDays = 0;
    dates.forEach(function (ds) {
      var d = state.diary && state.diary[ds];
      if (d) {
        diaryDays++;
        var c = calcNight(d);
        if (c.complete) {
          tib.push(c.tib / 60); tst.push(c.tst / 60); se.push(c.se);
          sol.push(d.sol); waso.push(d.waso);
        }
        if (isNum(d.sleepy)) sleepy.push(d.sleepy);
        if (isNum(d.satis)) satis.push(d.satis);
        if (Array.isArray(d.symptoms)) { nSym++; if (d.symptoms.length) symDays++; }
      }
      var mg = doseOn(state, ds);
      var p = prescribedOn(state, ds);
      if (mg !== null) {
        dose.push(mg);
        if (mg > 0) dosedNights++; else freeNights++;
        if (p !== null) {
          nPlan++;
          if (Math.abs(mg - p) < 0.001) planKept++;
          else if (mg > p) overPlan++;
        }
      }
      if (p !== null) rx.push(p);
      var ch = state.checks && state.checks[ds];
      var r = cbtRate(ch);
      if (r !== null) cbt.push(r);
      if (ch && ch.danger === 'yes') dangerDays++;
      if (ch && isNum(ch.energy)) energy.push(ch.energy);
      // 심한 졸림: 그날 시간대별 졸림 '심함', 예전 '위험한 졸림', 또는 그날 아침(전날 밤 수면일지) 졸림 '심함'
      var dr = (ch && ch.drowsy) || {}, pd = state.diary && state.diary[addDays(ds, -1)];
      if ((ch && ch.danger === 'yes') || Object.keys(dr).some(function (k) { return dr[k] === 3; }) || (pd && pd.sleepy === 3)) severeDays++;
      if (ch) {
        if (ch.dizzy === 'yes') dizzyDays++;
        if (ch.nap && ch.nap.did === 'yes') { napDays++; if (ch.nap.why === 'safety') safeNapDays++; }
      }
    });
    var ok = tst.length >= MIN_DAYS;
    return {
      days: dates.length,
      diaryDays: diaryDays,
      nComplete: tst.length,
      enough: ok,
      tib: ok ? avg(tib) : null,
      tst: ok ? avg(tst) : null,
      se: ok ? avg(se) : null,
      sol: ok ? avg(sol) : null,
      waso: ok ? avg(waso) : null,
      nSleepy: sleepy.length, sleepy: sleepy.length >= MIN_DAYS ? avg(sleepy) : null,
      nSatis: satis.length, satis: satis.length >= MIN_DAYS ? avg(satis) : null,
      nSym: nSym, symDays: symDays,
      nDose: dose.length, dose: avg(dose), dosedNights: dosedNights, freeNights: freeNights,
      nPlan: nPlan, planKept: planKept, overPlan: overPlan,
      rx: avg(rx),
      nCbt: cbt.length, cbt: avg(cbt),
      nEnergy: energy.length, energy: energy.length >= MIN_DAYS ? avg(energy) : null,
      dangerDays: dangerDays, severeDays: severeDays, dizzyDays: dizzyDays, napDays: napDays, safeNapDays: safeNapDays
    };
  }

  // 주차 요약 + 그 주의 주간 점검(자신감·약 믿음·스트레스)
  function weekSummary(state, w) {
    var r = weekRange(state.settings.startDate, w);
    var s = summarize(state, datesFrom(r.start, r.end));
    s.week = w; s.start = r.start; s.end = r.end;
    var wk = (state.weekly && state.weekly[w]) || {};
    s.confidence = isNum(wk.confidence) ? wk.confidence : null;
    s.belief = isNum(wk.belief) ? wk.belief : null;
    s.stress = isNum(wk.stress) ? wk.stress : null;
    return s;
  }

  /* ---------- 그래프용 하루 단위 값 ---------- */
  function dayPoint(state, ds) {
    var d = state.diary && state.diary[ds];
    var c = calcNight(d);
    return {
      date: ds,
      tst: c.complete ? c.tst / 60 : null,
      tib: c.complete ? c.tib / 60 : null,
      se: c.complete ? c.se : null,
      dose: doseOn(state, ds),
      rx: prescribedOn(state, ds),
      sleepy: d && isNum(d.sleepy) ? d.sleepy : null,
      cbt: cbtRate(state.checks && state.checks[ds]),
      energy: state.checks && state.checks[ds] && isNum(state.checks[ds].energy) ? state.checks[ds].energy : null,
      confidence: null, belief: null
    };
  }

  /* ---------- 표시용 ---------- */
  function fmtDur(min) {
    if (!isNum(min)) return '–';
    min = Math.round(min);
    var h = Math.floor(min / 60), m = min % 60;
    if (h === 0) return m + '분';
    return m === 0 ? h + '시간' : h + '시간 ' + m + '분';
  }
  function fmtNum(v, digits) {
    if (!isNum(v)) return '–';
    var f = Math.pow(10, digits || 0);
    return String(Math.round(v * f) / f);
  }

  var api = {
    MIN_DAYS: MIN_DAYS, MED_ID: MED_ID, REQUIRED: REQUIRED,
    todayKST: todayKST, addDays: addDays, daysBetween: daysBetween, isDate: isDate, weekday: weekday,
    datesFrom: datesFrom, parseHM: parseHM, diffMin: diffMin,
    calcNight: calcNight, cbtRate: cbtRate, doseOn: doseOn, prescribedOn: prescribedOn, lastRxChange: lastRxChange,
    weekNoOf: weekNoOf, weekRange: weekRange, summarize: summarize, weekSummary: weekSummary, dayPoint: dayPoint,
    fmtDur: fmtDur, fmtNum: fmtNum, isNum: isNum, avg: avg
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(this);
