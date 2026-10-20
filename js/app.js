/* 수면 회복 노트 — 화면, 저장, 백업 */
(function () {
  'use strict';
  var C = Calc, D = APP_DATA, Z = C.MED_ID;
  var KEY = 'sleepnote.v1';
  var APP_ID = 'sleep-recovery-note';
  var WD = ['일', '월', '화', '수', '목', '금', '토'];
  var RANGES = [1, 4, 8, 12, 26, 52];

  var main = document.getElementById('main');
  var nav = document.getElementById('nav');
  var state = load();
  var ui = { logShow: 21, cameFrom: '', dirty: false, hold: false };
  var pending = [];
  var installEvt = null;

  /* ================= 공통 도구 ================= */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  // 앱의 하루는 목표 기상 2시간 전(늦어도 새벽 4시)에 바뀜: 자정을 넘겨 체크한 저녁 루틴이 다음 날로 넘어가지 않게
  function dayStartMin() {
    var w = state && state.settings ? C.parseHM(state.settings.wakeTarget) : null;
    return w === null ? 240 : Math.max(0, Math.min(240, w - 120));
  }
  function today() { return C.todayKST(new Date(Date.now() - dayStartMin() * 60000)); }
  // 수면일지는 달력 기준: 자정이 지나면 끝난 밤(달력상 어제)도 적을 수 있음
  function lastNight() { return C.addDays(C.todayKST(), -1); }
  function fmtDate(ds) { var p = ds.split('-'); return (+p[1]) + '월 ' + (+p[2]) + '일 (' + WD[C.weekday(ds)] + ')'; }
  function fmtShort(ds) { var p = ds.split('-'); return (+p[1]) + '/' + (+p[2]); }
  function fmtMg(v) { return C.isNum(v) ? C.fmtNum(v, 2) + 'mg' : '–'; }
  function fmtPct(v) { return C.isNum(v) ? Math.round(v) + '%' : '–'; }
  function fmtH(h) { return C.isNum(h) ? C.fmtDur(h * 60) : '–'; }
  function fill(t, x, y) { return t.replace('{x}', x == null ? '' : x).replace('{y}', y == null ? '' : y); }
  function later(fn) { pending.push(fn); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function numOf(v) { if (v === '' || v == null) return null; var n = +v; return isFinite(n) ? n : null; }
  function startDate() { return state.settings.startDate; }
  // 기록하는 수면제(약 이름·기본 처방 용량). 없으면 기본값으로 만든다.
  function medRec() {
    var m = state.meds.filter(function (x) { return x.id === Z; })[0];
    if (!m) { m = clone(D.MEDS[0]); state.meds.push(m); }
    return m;
  }
  function curWeek() { return C.weekNoOf(startDate(), today()); }

  /* ================= 저장 ================= */
  function defaultState() {
    return {
      version: 1,
      settings: { startDate: null, wakeTarget: '', theme: 'system', range: 4 },
      meds: clone(D.MEDS),
      intakes: {}, diary: {}, checks: {}, rx: [], thoughts: [], weekly: {}, weekNotes: {},
      profile: { started: '', reason: '', why: '수면제를 끊고 싶어요', struggles: '', question: '' }
    };
  }
  function normalize(s) {
    var d = defaultState();
    if (!s || typeof s !== 'object') return d;
    Object.keys(d).forEach(function (k) { if (s[k] == null) s[k] = d[k]; });
    Object.keys(d.settings).forEach(function (k) { if (s.settings[k] === undefined) s.settings[k] = d.settings[k]; });
    // 예전 기록 정리: CBT-I에서 빠진 햇빛·카페인 체크는 루틴 칸(aux)으로 옮겨 실행률에서 빼기
    var keys = D.CBT_ITEMS.map(function (x) { return x.key; });
    Object.keys(s.checks).forEach(function (ds) {
      var c0 = s.checks[ds], it = c0 && c0.items;
      if (it) Object.keys(it).forEach(function (k) {
        if (keys.indexOf(k) >= 0) return;
        if (k === 'light' || k === 'caffeine') {
          c0.aux = c0.aux || {};
          if (!c0.aux[k]) c0.aux[k] = it[k];
          else if (c0.aux[k] !== it[k]) { c0.old = c0.old || {}; c0.old['items.' + k] = it[k]; }  // 같은 날 다른 답은 보관만
        }
        delete it[k];
      });
    });
    // 예전 수면일지의 카페인·낮잠 칸은 이제 루틴(그날 기록)에서 받음 → 한 번만 옮기기
    Object.keys(s.diary).forEach(function (ds) {
      var d = s.diary[ds];
      if (!d) return;
      var ck = function () { var c = s.checks[ds] || (s.checks[ds] = { items: {} }); if (!c.items) c.items = {}; return c; };
      if ('caffeine' in d) {
        // 그날 루틴에 이미 값이 있으면 덮지 않고, 다른 답이면 보관(old)만 함. 다시 옮기지 않도록 수면일지에서는 뺌
        if (d.caffeine === 'no' || d.caffeine === 'yes') {
          var c1 = ck(), cv = d.caffeine === 'no' ? 'done' : 'miss';
          c1.aux = c1.aux || {};
          if (!c1.aux.caffeine) c1.aux.caffeine = cv;
          else if (c1.aux.caffeine !== cv) { c1.old = c1.old || {}; c1.old['diary.caffeine'] = d.caffeine; }
        }
        delete d.caffeine;
      }
      if ('nap' in d) {
        if (C.isNum(d.nap)) {
          var c2 = ck();
          if (!c2.nap || !Object.keys(c2.nap).length) {
            c2.nap = d.nap > 0 ? { did: 'yes', min: d.nap } : { did: 'no' };
            if (!c2.items.nap) { var nv = napItem(c2.nap); if (nv) c2.items.nap = nv; }
          } else if (!same(c2.nap, d.nap > 0 ? { did: 'yes', min: d.nap } : { did: 'no' })) { c2.old = c2.old || {}; c2.old['diary.nap'] = d.nap; }
        }
        delete d.nap;
      }
      if (!Object.keys(d).length) delete s.diary[ds];
    });
    Object.keys(s.checks).forEach(function (ds) { var c3 = s.checks[ds]; if (c3 && !c3.items) c3.items = {}; });
    return s;
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { /* 저장소를 못 쓰면 새로 시작 */ }
    return defaultState();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { toast('저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.'); }
    schedulePush();
  }

  /* ================= 여러 기기에서 같은 기록 (웹 주소로 열었을 때만) ================= */
  // 서버(Cloudflare D1)에 한 벌로 저장. 기기마다 마지막으로 맞춘 기록(base)을 기억해 두고,
  // 두 기기가 동시에 고치면 "이 기기에서 바뀐 항목"만 서버 기록 위에 덮어써 합친다.
  var SYNC_KEY = 'sleepnote.sync';
  var sync = { on: /^https?:$/.test(location.protocol), loaded: false, version: 0, base: null, status: '', timer: null, busy: false, pendingRender: false };
  try {
    var sm = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null');
    if (sm) { sync.version = sm.version || 0; sync.base = sm.base || null; }
  } catch (e) { /* 처음 */ }
  function syncSaveMeta() { try { localStorage.setItem(SYNC_KEY, JSON.stringify({ version: sync.version, base: sync.base })); } catch (e) { /* 공간 부족 */ } }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function blank(v) { return v === undefined || v === null || v === ''; }
  function eqv(a, b) { return (blank(a) && blank(b)) || same(a, b); }
  // 입력 화면을 연 뒤 다른 기기·창에서 바뀐 칸은, 이 화면에서 손대지 않았으면 새 값을 따름
  function keepOthers(nv, opened, cur) {
    Object.keys(nv).forEach(function (k) { if (eqv(nv[k], opened[k]) && !eqv(opened[k], cur[k])) nv[k] = cur[k]; });
    return nv;
  }
  function mergeMap(b, l, out) {
    Object.keys(Object.assign({}, b, l)).forEach(function (k) {
      if (same(l[k], b[k])) return;
      if (l[k] === undefined) delete out[k]; else out[k] = clone(l[k]);
    });
  }
  // 날짜·주별 기록은 통째로 덮지 않고, 이 기기에서 바꾼 칸만 서버 기록 위에 덮어 합침
  // sub: 한 단계 더 들어가 합칠 칸, whole: 이 기기에서 기록 하나를 통째로 지웠으면 통째로 지움
  function mergeRecords(b, l, out, sub, whole) {
    Object.keys(Object.assign({}, b, l)).forEach(function (k) {
      if (same(l[k], b[k])) return;
      if (l[k] === undefined && whole) { delete out[k]; return; }
      if (l[k] !== undefined && out[k] === undefined && whole) { out[k] = clone(l[k]); return; }
      var both = b[k] === undefined;  // 두 기기가 같은 기록을 각자 새로 만듦
      var bo = b[k] || {}, lo = l[k] || {}, ro = clone(out[k] || {});
      Object.keys(Object.assign({}, bo, lo)).forEach(function (f) {
        if (same(lo[f], bo[f])) return;
        if (both && blank(lo[f])) return;  // 이 기기의 빈 칸으로 다른 기기 값을 지우지 않음
        if (sub.indexOf(f) >= 0) { ro[f] = ro[f] || {}; mergeMap(bo[f] || {}, lo[f] || {}, ro[f]); }
        else if (lo[f] === undefined) delete ro[f];
        else ro[f] = clone(lo[f]);
      });
      out[k] = ro;
    });
  }
  // 체크 기록을 합친 뒤 모양 맞추기: items는 늘 있게, 낮잠 판정은 합쳐진 낮잠에서 다시 계산, 빈 날은 지움
  function tidyChecks(out) {
    Object.keys(out).forEach(function (k) {
      var c = out[k];
      c.items = c.items || {};
      ['aux', 'memos', 'drowsy', 'nap', 'old'].forEach(function (f) { if (c[f] && !Object.keys(c[f]).length) delete c[f]; });
      if (c.nap) { var nv = napItem(c.nap); if (nv) c.items.nap = nv; else delete c.items.nap; }
      if (checkEmpty(c)) delete out[k];
    });
  }
  function mergeList(b, l, r) {
    var byId = function (arr) { var m = {}; arr.forEach(function (x) { m[x.id] = x; }); return m; };
    var out = byId(r);
    mergeMap(byId(b), byId(l), out);
    return Object.keys(out).map(function (k) { return out[k]; });
  }
  function merge3(base, local, remote) {
    var out = clone(remote);
    ['diary', 'intakes', 'weekly'].forEach(function (f) { out[f] = out[f] || {}; mergeRecords(base[f] || {}, local[f] || {}, out[f], [], true); });
    out.weekNotes = out.weekNotes || {};
    mergeMap(base.weekNotes || {}, local.weekNotes || {}, out.weekNotes);
    out.checks = out.checks || {};
    mergeRecords(base.checks || {}, local.checks || {}, out.checks, ['items', 'aux', 'memos', 'drowsy', 'nap', 'old'], false);
    tidyChecks(out.checks);
    ['rx', 'thoughts', 'meds'].forEach(function (f) { out[f] = mergeList(base[f] || [], local[f] || [], remote[f] || []); });
    ['settings', 'profile'].forEach(function (f) { out[f] = Object.assign({}, out[f]); mergeMap(base[f] || {}, local[f] || {}, out[f]); });
    return out;
  }
  function baseState() { return sync.base ? normalize(JSON.parse(sync.base)) : defaultState(); }
  function setSyncStatus(t) { sync.status = t; var el = $('#syncStatus'); if (el) el.textContent = t; }
  var FORM_PAGES = ['diary', 'routine', 'thought', 'rx', 'weekly', 'ask', 'settings'];
  function applyRemote(data) {
    var fresh = !state.settings.startDate;  // 불러오는 중·연결 안내 화면에 있었음
    state = normalize(data);
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 공간 부족 */ }
    // 입력 중인 화면은 지우지 않고, 다음 화면 전환 때 반영
    if (!fresh && state.settings.startDate && FORM_PAGES.indexOf(route().name) >= 0) sync.pendingRender = true; else render();
  }
  function pull() {
    if (!sync.on || sync.busy) return Promise.resolve();
    sync.busy = true;
    return fetch('api/state', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (remote) {
      sync.busy = false;
      sync.loaded = true;
      var dirty = !!state.settings.startDate && JSON.stringify(state) !== sync.base;
      sync.offline = false;
      if (remote.version === sync.version || !remote.data) {
        sync.version = remote.version;
        if (dirty) return push(0);
        setSyncStatus('같은 기록 · 최신');
        if (!state.settings.startDate) render();
        return;
      }
      // 서버에 예전 형식 기록이 있어도 같은 형식으로 맞춘 뒤 합침
      var rd = normalize(remote.data);
      var merged = dirty ? merge3(baseState(), state, rd) : rd;
      sync.version = remote.version; sync.base = JSON.stringify(rd); syncSaveMeta();
      applyRemote(merged);
      if (dirty) return push(0);
      setSyncStatus('같은 기록 · 최신');
    }).catch(function (e) {
      sync.busy = false;
      var first = !sync.loaded;
      sync.loaded = true;
      if (String(e.message).indexOf('http 404') === 0) sync.on = false;  // 기록 서버가 없는 곳(파일 서버)
      else { sync.offline = true; setSyncStatus('인터넷 연결 없음 · 이 기기에 저장 중 (연결되면 올라가요)'); }
      if (first) render();
    });
  }
  function push(tries) {
    if (!sync.on || !state.settings.startDate) return Promise.resolve();
    if (sync.busy) { schedulePush(); return Promise.resolve(); }
    sync.busy = true;
    var text = JSON.stringify(state);
    return fetch('api/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ base: sync.version, data: state }) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (x) {
        sync.busy = false;
        if (x.status === 200) {
          sync.version = x.j.version; sync.base = text; syncSaveMeta();
          setSyncStatus('같은 기록 · 방금 저장됨');
          if (JSON.stringify(state) !== text) schedulePush();
          return;
        }
        if (x.status === 409 && (tries || 0) < 3) {  // 다른 기기가 먼저 저장 → 합쳐서 다시
          var rd = normalize(x.j.data);
          var merged = merge3(baseState(), state, rd);
          sync.version = x.j.version; sync.base = JSON.stringify(rd); syncSaveMeta();
          applyRemote(merged);
          return push((tries || 0) + 1);
        }
        throw new Error('http ' + x.status);
      }).catch(function () {
        sync.busy = false;
        setSyncStatus('인터넷 연결 없음 · 이 기기에 저장 중 (연결되면 올라가요)');
      });
  }
  function schedulePush() {
    if (!sync.on) return;
    clearTimeout(sync.timer);
    sync.timer = setTimeout(function () { push(0); }, 800);
  }

  /* ================= 아이콘 ================= */
  function icon(name) {
    var p = {
      back: '<path d="M15 5l-7 7 7 7"/>',
      gear: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
      chev: '<path d="M9 5l7 7-7 7"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
      alert: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.2v.1"/>',
      bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
      book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5M8 7h7"/>'
    }[name];
    return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + p + '</svg>';
  }

  /* ================= 화면 조각 ================= */
  function topbar(title, sub, backTo) {
    return '<header class="topbar"><button class="icon-btn" data-act="back" data-fallback="' + esc(backTo) + '" aria-label="뒤로">' + icon('back') + '</button>' +
      '<div class="topbar-t"><b>' + esc(title) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div></header>';
  }
  function pageHead(title, sub) {
    return '<header class="pagehead"><div><h1>' + esc(title) + '</h1>' + (sub ? '<p class="sub">' + esc(sub) + '</p>' : '') + '</div>' +
      '<a class="icon-btn" href="#settings" aria-label="설정·백업">' + icon('gear') + '</a></header>';
  }
  function seg(name, opts, cur, cls) {
    var h = '<div class="seg ' + (cls || '') + '" data-seg="' + esc(name) + '" role="group">';
    opts.forEach(function (o) {
      var on = cur != null && String(cur) === String(o[0]);
      h += '<button type="button" data-v="' + esc(o[0]) + '" class="' + (on ? 'on' : '') + '" aria-pressed="' + on + '">' + esc(o[1]) + '</button>';
    });
    return h + '</div>';
  }
  function segVal(root, name) {
    var b = $('[data-seg="' + name + '"] button.on', root);
    return b ? b.getAttribute('data-v') : null;
  }
  function segNum(root, name) { return numOf(segVal(root, name)); }
  function stepper(name, val, step) {
    return '<div class="stepper"><button type="button" data-step="-' + step + '" aria-label="줄이기">−</button>' +
      '<input type="number" inputmode="numeric" min="0" name="' + name + '" value="' + (C.isNum(val) ? val : '') + '">' +
      '<button type="button" data-step="' + step + '" aria-label="늘리기">+</button></div>';
  }
  function field(label, inner, hint) {
    return '<div class="field"><span class="flabel">' + label + '</span>' + inner + (hint ? '<small class="fhint">' + hint + '</small>' : '') + '</div>';
  }
  function input(type, name, val, extra) {
    return '<input type="' + type + '" name="' + name + '" value="' + esc(val == null ? '' : val) + '" ' + (extra || '') + '>';
  }
  function textarea(name, val, ph, rows) {
    return '<textarea name="' + name + '" rows="' + (rows || 3) + '" placeholder="' + esc(ph || '') + '">' + esc(val || '') + '</textarea>';
  }
  function msgCard(m) {
    var ic = m.kind === 'warn' ? icon('alert') : m.kind === 'fact' ? icon('book') : icon('bulb');
    return '<div class="msg ' + m.kind + '">' + (m.eyebrow ? '<div class="msg-eyebrow">' + esc(m.eyebrow) + '</div>' : '') +
      '<div class="msg-title">' + ic + '<b>' + esc(m.title) + '</b></div><p>' + esc(m.body) + '</p>' +
      (m.note ? '<p class="msg-note">' + esc(m.note) + '</p>' : '') +
      (m.src ? '<a class="msg-src" href="' + esc(m.url) + '" target="_blank" rel="noopener">' + esc(m.src) + ' · 원문 보기</a>' : '') +
      (m.link ? '<a class="btn small" href="' + m.link[1] + '">' + esc(m.link[0]) + '</a>' : '') + '</div>';
  }
  function tip(key, x, y, kind) {
    var t = D.TIPS[key];
    return { key: key, kind: kind || 'tip', title: fill(t.title, x, y), body: fill(t.body, x, y) };
  }
  function metric(label, value, sub) {
    return '<div class="metric"><span>' + label + '</span><b>' + value + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>';
  }

  /* ================= 메시지 고르기 ================= */
  // 그날 밤 기록에 맞는 안내
  function nightTips(ds) {
    var out = [];
    var d = state.diary[ds], c = C.calcNight(d);
    var dose = C.doseOn(state, ds), rx = C.prescribedOn(state, ds);
    // 밤중에 더 먹은 다음 날 아침: 약 기운이 남을 수 있음 (FDA)
    if (d && (d.extra === 'night' || d.extra === 'yes') && ds === C.addDays(today(), -1)) out.push(tip('nightDose', '', '', 'warn'));
    if (dose !== null && rx !== null && Math.abs(dose - rx) > 0.001) {
      if (rx === 0 && dose > 0) out.push(tip('redose', '', '', 'info'));
      else out.push(tip(dose < rx ? 'doseUnder' : 'doseOver', fmtMg(dose), fmtMg(rx), 'info'));
    }
    if (c.complete) {
      if (c.tst < 300) out.push(tip('badNight'));
      else if (d.sol >= 30) out.push(tip('solLong', C.fmtDur(d.sol)));
      else if (d.waso >= 30) out.push(tip('wasoLong', C.fmtDur(d.waso)));
      else if (c.se < 85) out.push(tip('lowSE', Math.round(c.se) + '%'));
      else out.push(tip('goodNight', C.fmtDur(c.tst)));
    }
    return out;
  }
  // 척도 값의 단계: 화면에 보이는 말과 같은 기준 (졸림 0~3은 반올림, 나머지는 SCALES)
  function levelOf(key, v) { return key === 'sleepy' ? Math.min(3, Math.max(0, Math.round(v))) : scaleLevel(key, v); }
  function stepTrend(key, a, b, up, down) { var x = levelOf(key, a), y = levelOf(key, b); return y > x ? up : y < x ? down : '비슷'; }
  function safetyTips() {
    var t = today(), out = [];
    var s7 = C.summarize(state, C.datesFrom(C.addDays(t, -7), C.addDays(t, -1)));
    var prev = C.summarize(state, C.datesFrom(C.addDays(t, -14), C.addDays(t, -8)));
    if (s7.symDays >= 2) out.push(tip('symptoms', s7.symDays, '', 'warn'));
    // 과정 중반에 잠이 눈에 띄게 줄면 점검 신호 (Belleville 2008)
    var why = [];
    if (s7.enough && prev.enough && s7.tst < prev.tst - 0.5) why.push('최근 7일 실제 수면이 그 전 주보다 ' + C.fmtDur((prev.tst - s7.tst) * 60) + ' 줄었어요');
    if (C.isNum(s7.energy) && s7.energy <= 4) why.push('최근 7일 낮 기운이 대체로 처져 있어요');
    var wk = function (i) { return weeklyAnswered(state.weekly[i]) ? state.weekly[i] : null; };
    var wNow = wk(curWeek()) || wk(curWeek() - 1), wPrev = wNow && (wNow === wk(curWeek()) ? wk(curWeek() - 1) : wk(curWeek() - 2));
    // 자신감이 낮다는 카드(beliefTips)가 따로 뜨면 여기서는 자신감 이야기를 빼서 두 번 말하지 않음
    var lw = latestWeekly(), lowConf = lw && C.isNum(lw.confidence) && lw.confidence <= 5;
    if (!lowConf && wNow && wPrev && C.isNum(wNow.confidence) && C.isNum(wPrev.confidence) && levelOf('confidence', wNow.confidence) < levelOf('confidence', wPrev.confidence)) why.push('자신감이 지난 점검보다 내려갔어요');
    if (wNow && wPrev && C.isNum(wNow.stress) && C.isNum(wPrev.stress) && levelOf('stress', wNow.stress) > levelOf('stress', wPrev.stress)) why.push('스트레스가 지난 점검보다 올라갔어요');
    if (why.length) out.push(tip('checkIn', why.join(', '), '', 'warn'));
    var wk7 = C.summarize(state, C.datesFrom(C.addDays(t, -6), t));
    if (wk7.severeDays >= 2) out.push(tip('severeDays', wk7.severeDays, '', 'warn'));
    else if (wk7.severeDays) out.push(tip('danger', wk7.severeDays, '', 'warn'));
    if (wk7.dizzyDays) out.push(tip('dizzy', '', '', 'warn'));
    var last = C.lastRxChange(state, t);
    if (last && C.isNum(last.beforeMg) && C.isNum(last.afterMg) && last.afterMg < last.beforeMg) {
      var n = C.daysBetween(last.date, t);
      if (n <= 14) out.push(tip('rebound', n + 1, '', 'info'));
    }
    if (last && C.prescribedOn(state, t) === 0) out.push(tip('maintenance', C.daysBetween(last.date, t) + 1, '', 'info'));
    return out;
  }
  function latestWeekly() {
    var w = curWeek();
    for (var i = w; i >= Math.max(1, w - 1); i--) if (weeklyAnswered(state.weekly[i])) return state.weekly[i];
    return null;
  }
  // 자신감·약에 대한 믿음 (주간 점검 기준)
  function beliefTips() {
    var out = [], x = latestWeekly();
    if (!x) return out;
    if (C.isNum(x.confidence) && x.confidence <= 5) out.push(tip('lowConfidence'));
    if (C.isNum(x.belief) && x.belief >= 7) out.push(tip('highBelief', '', ownEvidence()));
    return out;
  }
  // 내 기록 속 반대 근거: 약 없이(또는 적게) 잔 밤의 실제 수면
  function ownEvidence() {
    var z = state.meds.filter(function (m) { return m.id === Z; })[0], base = z ? z.rxMg : null;
    var free = [], low = [], full = [];
    Object.keys(state.diary).forEach(function (ds) {
      var c = C.calcNight(state.diary[ds]), mg = C.doseOn(state, ds);
      if (!c.complete || mg === null) return;
      if (mg === 0) free.push(c.tst);
      else if (C.isNum(base) && mg < base) low.push(c.tst);
      else full.push(c.tst);
    });
    if (free.length >= 2) return '내 기록을 보면 약 없이 잔 밤이 ' + free.length + '일 있었고, 그날 평균 ' + C.fmtDur(C.avg(free)) + ' 잤어요. ';
    if (low.length >= 2) return '내 기록을 보면 기본 처방보다 적게 먹은 밤이 ' + low.length + '일 있었고, 그날 평균 ' + C.fmtDur(C.avg(low)) + ' 잤어요' +
      (full.length >= 2 ? ' (기본 처방을 먹은 밤은 평균 ' + C.fmtDur(C.avg(full)) + ')' : '') + '. ';
    return '';
  }
  // 다음 날 해 볼 한 가지: 지난밤 패턴 → 이번 주 고른 행동 → 최근 7일 가장 덜 된 행동 → 이번 주 과정
  function itemByKey(k) { return D.CBT_ITEMS.filter(function (x) { return x.key === k; })[0]; }
  function nextStep(night, refDay) {
    var d = state.diary[night], c = C.calcNight(d);
    var fromItem = function (k, why) { var it = itemByKey(k); return { key: k, title: it.short, body: it.tomorrow, why: why }; };
    if (c.complete && d.sol >= 30) return fromItem('getup', '지난밤 잠들기까지 ' + C.fmtDur(d.sol) + ' 걸렸어요.');
    if (c.complete && d.waso >= 30) return fromItem('getup', '지난밤 ' + C.fmtDur(d.waso) + ' 깨어 있었어요.');
    var nm = napMinutes(night);
    if (C.isNum(nm) && nm > 30) return fromItem('nap', '낮잠을 ' + C.fmtDur(nm) + ' 잤어요.');
    var cf = ((state.checks[night] || {}).aux || {}).caffeine === 'miss';
    if (d && c.complete && (d.alcohol === 'much' || cf) && (d.sol >= 20 || c.tst < 360)) {
      return { title: '술·늦은 카페인 줄여 보기', body: '루틴의 카페인 끊는 시각(' + atTime(stepByKey('caffeine').off) + ') 이후 커피·녹차와 저녁 술을 줄여 보세요. 술은 잠들게 해도 밤중에 자주 깨게 만듭니다.',
        why: '지난밤 ' + (d.alcohol === 'much' ? '술을 많이 마셨고' : '늦게 카페인을 마셨고') + ' 잠이 좋지 않았어요.' };
    }
    var w = curWeek(), focus = (state.weekly[w - 1] || {}).focus;
    if (focus && itemByKey(focus)) return fromItem(focus, '지난 주간 점검에서 이번 주에 집중하기로 고른 행동이에요.');
    var worst = null, days = C.datesFrom(C.addDays(refDay, -6), refDay);
    D.CBT_ITEMS.forEach(function (x) {
      var done = 0, n = 0;
      days.forEach(function (ds) {
        var v = state.checks[ds] && state.checks[ds].items && state.checks[ds].items[x.key];
        if (v === 'done') { done++; n++; } else if (v === 'miss') n++;
      });
      if (n >= 2 && done / n < 0.7 && (!worst || done / n < worst.rate)) worst = { x: x, rate: done / n, done: done, n: n };
    });
    if (worst) return fromItem(worst.x.key, '최근 7일 "' + worst.x.short + '" — ' + worst.n + '번 중 ' + worst.done + '번 했어요.');
    return null;  // 기록에서 고를 게 없으면 위 이번 주 카드가 그 역할을 함
  }
  function stepCard(s, label) {
    return '<div class="msg step"><div class="msg-eyebrow">' + esc(label) + '</div><div class="msg-title">' + icon('bulb') + '<b>' + esc(s.title) + '</b></div>' +
      '<p>' + esc(s.body) + '</p>' + (s.why ? '<p class="msg-note">' + esc(s.why) + '</p>' : '') + '</div>';
  }
  // 그날 뜬 안내와 같은 연구 이야기면 다음 연구로 넘김
  var TIP_FACT = { lowConfidence: ['belanger2005', 'belleville2008'], checkIn: ['belleville2008'], maintenance: ['morinRelapse'], rebound: ['aafp2019'], highBelief: ['fung2024'] };
  function factOfDay(shown) {
    var skip = [].concat.apply([], (shown || []).map(function (m) { return TIP_FACT[m.key] || []; }));
    var i = Math.abs(C.daysBetween('2026-01-01', today())) % D.FACTS.length, n = 0;
    while (skip.indexOf(D.FACTS[i].id) >= 0 && n++ < D.FACTS.length) i = (i + 1) % D.FACTS.length;
    var f = D.FACTS[i];
    return { kind: 'fact', eyebrow: '연구로 보면', title: f.title, body: f.body, note: f.note, src: f.src, url: f.url };
  }

  /* ================= 홈 ================= */
  function heroCard() {
    var w = curWeek();
    if (w === 0) {
      return '<div class="hero"><span class="pill">시작 전</span><h2>' + esc(fmtDate(startDate())) + ' 시작</h2><p>' + C.daysBetween(today(), startDate()) + '일 뒤에 1주차가 시작돼요. 그 전 기록도 남길 수 있어요.</p></div>';
    }
    if (w <= 8) {
      var p = D.PROGRAM[w - 1];
      return '<a class="hero" href="#program/' + w + '"><div class="hero-top"><span class="pill">' + w + '주차 / 8주</span><span class="hero-stage">' + esc(p.stage) + '</span></div>' +
        '<h2>' + esc(p.title) + '</h2><p>' + esc(p.focus) + '</p><div class="progress"><i style="width:' + (w / 8 * 100) + '%"></i></div>' +
        '<span class="hero-link">이번 주 연습 보기 ' + icon('chev') + '</span></a>';
    }
    return '<a class="hero" href="#program"><div class="hero-top"><span class="pill">' + w + '주차 · 장기 기록</span></div><h2>꾸준히 이어가는 중</h2>' +
      '<p>8주 과정을 마쳤어요. 주 1회 주간 점검에서 계속할 행동을 골라 두세요.</p><span class="hero-link">8주 과정 · 근거 보기 ' + icon('chev') + '</span></a>';
  }
  function todoRow(href, title, sub, done, stateText) {
    return '<a class="todo" href="' + href + '"><span class="todo-ic ' + (done ? 'done' : '') + '">' + (done ? icon('check') : '') + '</span>' +
      '<span class="todo-main"><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></span><span class="todo-state ' + (done ? 'done' : '') + '">' + esc(stateText) + '</span></a>';
  }
  function viewHome() {
    var t = today(), y = C.addDays(t, -1);
    var d = state.diary[y], c = C.calcNight(d);
    var dose = C.doseOn(state, y), rx = C.prescribedOn(state, y);
    var h = pageHead('수면 회복 노트', fmtDate(t)) + heroCard();

    // 오늘 할 일
    var rDone = routineAnswered(state.checks[t] || { items: {} });
    var w = curWeek();
    var wr = w > 0 ? C.weekRange(startDate(), w) : null;
    var thoughtsWeek = wr ? state.thoughts.filter(function (x) { return x.date >= wr.start && x.date <= wr.end; }).length : 0;
    h += '<section class="block"><h3 class="block-h">오늘 할 일</h3><div class="todos">' +
      todoRow('#diary/' + y, '어젯밤 수면일지', fmtDate(y) + ' 밤 · 아침 3분', d && c.complete, d ? (c.complete ? '완료' : '일부만') : '쓰기') +
      todoRow('#routine', '오늘 루틴', '하루를 따라 하며 체크 · 메모', rDone >= D.ROUTINE.length, rDone >= D.ROUTINE.length ? '완료' : rDone + ' / ' + D.ROUTINE.length) +
      (w > 0 ? todoRow('#weekly/' + w, '주간 점검 (주 1회)', '자신감 · 약 없인 못 잔다는 믿음 · 어려웠던 점', weeklyAnswered(state.weekly[w]), weeklyAnswered(state.weekly[w]) ? '완료' : '쓰기') : '') +
      todoRow('#thought/new', '생각 노트 (선택)', '주 2~3회면 충분해요', thoughtsWeek >= 2, '이번 주 ' + thoughtsWeek + '회') +
      '</div></section>';
    var step = nextStep(y, t) || {};
    if (step.title) h += '<section class="block"><h3 class="block-h">오늘 해 볼 한 가지</h3>' + stepCard(step, '기록을 보고 고른 행동') + '</section>';

    // 어젯밤: 기록이 있을 때만 (쓰는 입구는 위 '오늘 할 일' 하나)
    if (d || dose !== null) {
      h += '<section class="block"><h3 class="block-h">어젯밤 <small>' + esc(fmtDate(y)) + '</small></h3><div class="card"><div class="metrics">' +
        metric('실제 수면', c.complete ? C.fmtDur(c.tst) : '–', c.complete ? '침대 ' + C.fmtDur(c.tib) : (d ? '계산 보류' : '기록 없음')) +
        metric('수면효율', c.complete ? fmtPct(c.se) : '–', c.complete ? '잔 시간 ÷ 침대 시간' : '') +
        metric('잠들기까지', d && C.isNum(d.sol) ? C.fmtDur(d.sol) : '–', '') +
        metric('수면제', dose === null ? '기록 없음' : fmtMg(dose), '처방 ' + fmtMg(rx)) +
        metric('아침 졸림', d && C.isNum(d.sleepy) ? sleepyWord(d.sleepy) : '–', '') +
        metric('몸·마음 증상', d && Array.isArray(d.symptoms) ? (d.symptoms.length ? d.symptoms.length + '가지' : '없음') : '–', '') +
        '</div>' + (d && !c.complete ? '<p class="muted small">' + esc(c.error || '필수 칸이 비어 있어 수면시간을 계산하지 않았어요.') + '</p>' : '') + '</div></section>';
    }

    // 오늘의 안내
    // 위 '오늘 해 볼 한 가지'가 이미 말한 내용(잠들기·밤중 깸)은 다시 싣지 않음
    var nt = nightTips(y).filter(function (m) {
      return !(step.key === 'getup' && (m.key === 'solLong' || m.key === 'wasoLong')) && !(step.key === 'sleepy' && m.key === 'lowSE');
    });
    var msgs = safetyTips().concat(beliefTips(), nt);
    msgs.push(factOfDay(msgs));
    h += '<section class="block"><h3 class="block-h">오늘의 안내</h3>' + msgs.map(msgCard).join('') + '</section>';

    // 최근 7일 · 30일
    var s7 = C.summarize(state, C.datesFrom(C.addDays(t, -7), y));
    var s30 = C.summarize(state, C.datesFrom(C.addDays(t, -30), y));
    function cellSleep(s, v) { return s.enough ? v : '<span class="muted">기록 부족</span>'; }
    function rowH(label, a, b) { return '<div class="sr"><span class="sr-l">' + label + '</span><span class="sr-vals"><span class="sr-v"><small>최근 7일</small><b>' + a + '</b></span><span class="sr-v"><small>최근 30일</small><b>' + b + '</b></span></span></div>'; }
    function doseCell(s) { return s.nDose ? fmtMg(s.dose) + '<small> · ' + s.dosedNights + '밤 복용</small>' : '<span class="muted">기록 없음</span>'; }
    function cnt(s, v, n) { return n >= C.MIN_DAYS ? v : '<span class="muted">기록 부족</span>'; }
    h += '<section class="block"><h3 class="block-h">최근 변화 <small>평균</small></h3><div class="card"><div class="sum">' +
      rowH('실제 수면', cellSleep(s7, fmtH(s7.tst)), cellSleep(s30, fmtH(s30.tst))) +
      rowH('수면효율', cellSleep(s7, fmtPct(s7.se)), cellSleep(s30, fmtPct(s30.se))) +
      rowH('수면제', doseCell(s7), doseCell(s30)) +
      rowH('약 없는 밤', s7.nDose ? s7.freeNights + '일' : '<span class="muted">기록 없음</span>', s30.nDose ? s30.freeNights + '일' : '<span class="muted">기록 없음</span>') +
      rowH('증상 있던 날', s7.nSym ? s7.symDays + '일' : '<span class="muted">기록 없음</span>', s30.nSym ? s30.symDays + '일' : '<span class="muted">기록 없음</span>') +
      rowH('아침 졸림', cnt(s7, sleepyWord(s7.sleepy), s7.nSleepy), cnt(s30, sleepyWord(s30.sleepy), s30.nSleepy)) +
      rowH('낮 기운', cnt(s7, scaleWord('energy', s7.energy), s7.nEnergy), cnt(s30, scaleWord('energy', s30.energy), s30.nEnergy)) +
      rowH('CBT-I 실행률', s7.nCbt ? fmtPct(s7.cbt) : '<span class="muted">기록 없음</span>', s30.nCbt ? fmtPct(s30.cbt) : '<span class="muted">기록 없음</span>') +
      rowH('수면 기록', s7.nComplete + '일', s30.nComplete + '일') +
      '</div><p class="muted small">수면 평균은 완전한 기록이 4일 이상일 때만 냅니다. 없는 날을 0으로 채우지 않아요.</p></div></section>';
    h += '<a class="btn primary wide ask-btn" href="#ask">' + icon('bulb') + ' AI에게 물어보기</a>';
    return h;
  }

  /* ================= 기록 탭 ================= */
  function earliestDay() {
    var keys = Object.keys(state.diary).concat(Object.keys(state.checks), Object.keys(state.intakes));
    var e = C.addDays(startDate(), -7);
    keys.forEach(function (k) { if (C.isDate(k) && k < e) e = k; });
    return e;
  }
  function weekLabel(ds) {
    var w = C.weekNoOf(startDate(), ds);
    if (w === 0) return '시작 전';
    var r = C.weekRange(startDate(), w);
    return w + '주차 · ' + fmtShort(r.start) + ' ~ ' + fmtShort(r.end);
  }
  function dayListHtml(kind) {
    var t = today();
    var first = t;
    if (kind === 'diary' && !state.diary[t] && C.doseOn(state, t) === null) first = C.addDays(t, -1);
    if (kind === 'check') first = C.addDays(t, -1);
    var stop = earliestDay(), ds = first, h = '', lastGroup = '';
    for (var i = 0; i < ui.logShow && ds >= stop; i++) {
      var g = weekLabel(ds);
      if (g !== lastGroup) { h += '<div class="group-h">' + esc(g) + '</div>'; lastGroup = g; }
      h += '<a class="row" href="#' + (kind === 'check' ? 'routine' : kind) + '/' + ds + '"><div class="row-date"><b>' + fmtShort(ds) + '</b><small>' + WD[C.weekday(ds)] + '</small></div>' +
        '<div class="row-body">' + (kind === 'diary' ? diarySummary(ds) : checkSummary(ds)) + '</div>' + icon('chev') + '</a>';
      ds = C.addDays(ds, -1);
    }
    if (ds >= stop) h += '<button class="btn ghost wide" data-act="more">이전 기록 더 보기</button>';
    return h;
  }
  function diarySummary(ds) {
    var d = state.diary[ds], dose = C.doseOn(state, ds), c = C.calcNight(d);
    var parts = [];
    if (d) parts.push(c.complete ? '수면 ' + C.fmtDur(c.tst) + ' · 수면효율 ' + fmtPct(c.se) : '<span class="warn-t">일부만 기록 · 계산 보류</span>');
    if (dose !== null) parts.push('수면제 ' + fmtMg(dose));
    if (d && Array.isArray(d.symptoms) && d.symptoms.length) parts.push('증상 ' + d.symptoms.length + '가지');
    return parts.length ? parts.join(' · ') : '<span class="muted">기록 없음 — 눌러서 쓰기</span>';
  }
  function checkSummary(ds) {
    var ck = state.checks[ds];
    // 수면일지에서 체크한 밤 행동만 있는 날은 루틴 기록이 없는 날
    var any = ck && (routineAnswered(ck) || ck.drowsy || ck.memos || ck.note || C.isNum(ck.energy) || ck.dizzy || ck.danger || (ck.nap && ck.nap.did));
    if (!any) return '<span class="muted">기록 없음 — 눌러서 쓰기</span>';
    var dr = ck.drowsy || {};
    var severe = ck.danger === 'yes' || Object.keys(dr).some(function (k) { return dr[k] === 3; });
    return '체크 ' + routineAnswered(ck) + '/' + D.ROUTINE.length +
      (ck.nap && ck.nap.did === 'yes' ? ' · 낮잠' + (C.isNum(ck.nap.min) ? ' ' + ck.nap.min + '분' : '') : '') +
      (severe ? ' · <span class="warn-t">심한 졸림</span>' : '') + (ck.dizzy === 'yes' ? ' · <span class="warn-t">어지럼</span>' : '');
  }
  function viewLog(r) {
    var tab = ['diary', 'check', 'thought'].indexOf(r.a) >= 0 ? r.a : 'diary';
    var h = pageHead('기록', '빠진 날은 나중에 채워도 돼요') +
      '<nav class="tabs">' + [['diary', '수면일지'], ['check', '루틴'], ['thought', '생각 노트']].map(function (x) {
        return '<a href="#log/' + x[0] + '" class="' + (tab === x[0] ? 'on' : '') + '">' + x[1] + '</a>';
      }).join('') + '</nav>';
    if (tab === 'thought') {
      h += '<a class="btn primary wide" href="#thought/new">' + icon('plus') + ' 새 생각 노트</a>';
      var list = state.thoughts.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0); });
      if (!list.length) h += '<div class="empty">아직 생각 노트가 없어요.<br>잠에 대한 걱정이 떠오른 날, 취침 전 5분만 써 보세요.</div>';
      list.forEach(function (x) {
        h += '<a class="tcard" href="#thought/' + x.id + '"><div class="tc-date">' + esc(fmtDate(x.date)) + '</div>' +
          '<div class="tc-row"><span>떠오른 생각</span><p>' + esc(x.thought || '–') + '</p></div>' +
          '<div class="tc-row"><span>균형 잡힌 생각</span><p>' + esc(x.alternative || '–') + '</p></div>' +
          (C.isNum(x.before) || C.isNum(x.after) ? '<div class="tc-worry">' + esc(worryText(x)) + '</div>' : '') + '</a>';
      });
      return h;
    }
    h += '<div class="jump"><span>다른 날짜</span><input type="date" id="jumpDate" max="' + (tab === 'thought' ? today() : tab === 'diary' ? lastNight() : C.addDays(today(), -1)) + '"><button class="btn small" data-act="jump" data-kind="' + tab + '">열기</button></div>';
    h += '<div class="list">' + dayListHtml(tab) + '</div>';
    return h;
  }

  /* ================= 수면일지 입력 ================= */
  var FIELD_NAMES = { bed: '누운 시각', sol: '잠들기까지 걸린 시간', waso: '밤중에 깨어 있던 시간', wake: '마지막으로 깬 시각', out: '침대에서 나온 시각' };
  // 졸림은 숫자 대신 말로 (저장값 0~3)
  var SLEEPY_WORDS = ['없음', '약간', '꽤', '심함'];
  var SCORE03 = SLEEPY_WORDS.map(function (w, i) { return [i, w]; });
  function sleepyWord(v) { return C.isNum(v) ? SLEEPY_WORDS[Math.min(3, Math.max(0, Math.round(v)))] : '–'; }
  // 그 밖의 평가 척도도 말로만 (data.js SCALES). 예전 숫자 값은 가까운 단계로 맞춰 보여 주고, 저장할 때 그 단계 값으로 남김
  function scaleLevel(key, v) {
    var u = D.SCALES[key].upTo;
    for (var i = 0; i < u.length; i++) if (v <= u[i]) return i;
    return u.length - 1;
  }
  function scaleWord(key, v) { return C.isNum(v) ? D.SCALES[key].words[scaleLevel(key, v)] : '–'; }
  // 예전 숫자 값(예: 4)과 새로 고른 값이 같은 말이면 예전 숫자를 그대로 둠
  function keepScale(key, old, nw) { return C.isNum(old) && C.isNum(nw) && scaleLevel(key, old) === scaleLevel(key, nw) ? old : nw; }
  function scaleSeg(name, key, v) {
    var sc = D.SCALES[key];
    return seg(name, sc.values.map(function (x, i) { return [x, sc.words[i]]; }), C.isNum(v) ? sc.values[scaleLevel(key, v)] : null, 'words');
  }

  function viewDiary(r) {
    var ds = C.isDate(r.a) ? r.a : C.addDays(today(), -1);
    var d = state.diary[ds] || {};
    var z = (state.intakes[ds] || {})[Z] || {};
    var rx = C.prescribedOn(state, ds);
    ui.opened = { key: 'diary/' + ds, rec: clone(d), mg: z.mg, time: z.time, items: clone((state.checks[ds] || {}).items || {}) };
    var exists = !!state.diary[ds] || C.doseOn(state, ds) !== null;
    var isY = ds === C.addDays(today(), -1);
    var h = topbar('수면일지', fmtDate(ds) + ' 밤', '#log/diary') + '<form class="form" id="f" onsubmit="return false">' +
      '<p class="hint">' + esc(fmtDate(ds)) + ' 밤에 잠자리에 든 기록이에요. 자정이 지나서 누웠어도 이 날짜에 적어요. 시계를 보며 재지 말고, 대략 기억나는 값이면 충분합니다. 다 적은 뒤 맨 아래 "저장"을 눌러야 남아요.</p>' +
      '<section class="card"><h3>필수 기록 <small>5칸</small></h3>' +
      field('침대에 누운 시각', input('time', 'bed', d.bed)) +
      field('잠들기까지 걸린 시간 (분)', stepper('sol', d.sol, 5)) +
      field('밤중에 깨어 있던 시간 합계 (분)', stepper('waso', d.waso, 5), '여러 번 깼다면 깨어 있던 시간을 모두 더해요. 안 깼으면 0.') +
      field('마지막으로 잠에서 깬 시각', input('time', 'wake', d.wake)) +
      field('침대에서 나온 시각', input('time', 'out', d.out)) +
      '<div class="calc" id="calc"></div></section>' +
      '<section class="card"><h3>수면제 복용</h3>' +
      '<p class="hint">현재 처방 기록 <b>' + fmtMg(rx) + '</b>. 안 먹은 날은 <b>0mg</b>, 빈칸은 "기록 안 함"으로 남아요.</p>' +
      field('실제 복용량', '<div class="dose-row">' + input('number', 'mg', C.isNum(z.mg) ? z.mg : '', 'step="0.25" min="0" inputmode="decimal"') + '<span>mg</span></div>' +
        '<div class="quick">' + (C.isNum(rx) ? '<button type="button" data-act="fill" data-target="mg" data-v="' + rx + '">처방대로 ' + fmtMg(rx) + '</button>' : '') +
        '<button type="button" data-act="fill" data-target="mg" data-v="0">안 먹음 0mg</button><button type="button" data-act="fill" data-target="mg" data-v="">비우기</button></div>',
        '더 먹었다면 <b>합친 하루 전체 양</b>을 적어요.') +
      field('복용 시각 (선택)', input('time', 'mgTime', z.time)) +
      '<div id="extraWrap">' + field('처방보다 더 먹음 (있을 때만)', seg('extra', [['no', '없음'], ['bed', '자기 전'], ['night', '밤중에']], d.extra === 'yes' ? 'night' : d.extra, 'three'),
        '언제 더 먹었는지 골라요.') + '</div>' +
      '<div id="redoseBox" hidden>' + field('다시 먹은 것은', seg('redoseType', [['once', '이번 한 번만'], ['back', '예전처럼 다시 먹기 시작']], d.redoseType, 'two')) +
        field('다시 먹은 이유', textarea('redose', d.redose, '예: 다음 날 중요한 일이 있어 걱정돼서', 2)) + '</div>' +
      '<div id="doseNote"></div></section>' +
      '<section class="card"><h3>' + (isY ? '어젯밤' : '그 밤') + ' 이렇게 했나요 <small>CBT-I</small></h3>' +
      D.NIGHT_ITEMS.map(function (x) {
        return '<div class="check-item"><b>' + esc(x.title) + '</b><small>' + esc(x.how) + '</small>' +
          seg('n_' + x.key, [['done', '했어요'], ['miss', '못 했어요'], ['na', '해당없음']], ((state.checks[ds] || {}).items || {})[x.key], 'three') + '</div>';
      }).join('') + '</section>' +
      '<section class="card"><h3>아침 몸·마음 상태</h3>' +
      field('아침 졸림', seg('sleepy', SCORE03, d.sleepy)) +
      field('수면 만족도', scaleSeg('satis', 'satis', d.satis)) +
      field('감량 중 몸·마음 증상', multiSeg('symptoms', D.SYMPTOMS, d.symptoms), (isY ? '어제부터 오늘 아침까지' : '그날 밤부터 다음 날 아침까지') + ' 있었던 것을 모두 눌러요. 없으면 "없음".') +
      '</section>' +
      '<section class="card"><h3>더 적고 싶다면 <small>선택</small></h3>' +
      field('밤중에 깬 횟수', stepper('awakenings', d.awakenings, 1)) +
      field('술', seg('alcohol', [['none', '안 마심'], ['some', '조금'], ['much', '많이']], d.alcohol, 'three')) +
      field('특이사항 (그 밤)', textarea('note', d.note, '예: 새벽 3시에 깸, 화장실 2번, 옆방 소음')) +
      '</section>' +
      '<div class="form-actions">' + (exists ? '<button type="button" class="btn ghost danger" data-act="del-diary" data-date="' + ds + '">삭제</button>' : '') +
      '<button type="button" class="btn primary big" data-act="save-diary" data-date="' + ds + '">저장</button></div></form>';
    later(function () {
      var f = $('#f');
      var upd = function () { updateDiaryCalc(f, ds); };
      f.addEventListener('input', upd);
      f.addEventListener('change', upd);
      upd();
    });
    return h;
  }
  function readDiary(f) {
    return {
      bed: f.bed.value, sol: numOf(f.sol.value), waso: numOf(f.waso.value), wake: f.wake.value, out: f.out.value,
      awakenings: numOf(f.awakenings.value),
      sleepy: segNum(f, 'sleepy'), satis: segNum(f, 'satis'), symptoms: multiVal(f, 'symptoms'),
      extra: segVal(f, 'extra'), redoseType: segVal(f, 'redoseType'), redose: f.redose.value.trim(), alcohol: segVal(f, 'alcohol'),
      note: f.note.value.trim()
    };
  }
  function multiSeg(name, opts, cur) {
    var arr = Array.isArray(cur) ? cur : null;
    var b = function (v, label, on) { return '<button type="button" data-v="' + esc(v) + '" class="' + (on ? 'on' : '') + '" aria-pressed="' + on + '">' + esc(label) + '</button>'; };
    return '<div class="seg multi wrap" data-multi="' + name + '" role="group">' + b('none', '없음', !!arr && !arr.length) +
      opts.map(function (o) { return b(o[0], o[1], !!arr && arr.indexOf(o[0]) >= 0); }).join('') + '</div>';
  }
  // 아무것도 안 누름 = 기록 안 함(undefined), "없음" = 빈 목록
  function multiVal(root, name) {
    var on = $$('[data-multi="' + name + '"] button.on', root).map(function (x) { return x.getAttribute('data-v'); });
    if (!on.length) return undefined;
    return on.indexOf('none') >= 0 ? [] : on;
  }
  function diaryEmpty(d) {
    return !d.bed && !d.wake && !d.out && d.sol === null && d.waso === null && d.awakenings === null &&
      d.sleepy === null && d.satis === null && d.symptoms === undefined && d.extra === null && d.redoseType === null && !d.redose &&
      d.alcohol === null && !d.note;
  }
  function updateDiaryCalc(f, ds) {
    var d = readDiary(f), c = C.calcNight(d), box = $('#calc');
    if (c.complete) {
      box.className = 'calc ok';
      box.innerHTML = '<div><span>침대에 있던 시간</span><b>' + C.fmtDur(c.tib) + '</b></div><div><span>실제 수면</span><b>' + C.fmtDur(c.tst) + '</b></div>' +
        '<div><span>수면효율</span><b>' + fmtPct(c.se) + '</b><small>잔 시간 ÷ 침대 시간</small></div>';
    } else if (c.error) {
      box.className = 'calc err';
      box.innerHTML = icon('alert') + '<p>' + esc(c.error) + '</p>';
    } else {
      box.className = 'calc';
      box.innerHTML = '<p>빈칸을 채우면 자동으로 계산돼요: ' + c.missing.map(function (k) { return FIELD_NAMES[k]; }).join(', ') + '</p>';
    }
    var mg = numOf(f.mg.value), rx = C.prescribedOn(state, ds), note = $('#doseNote'), ex = segVal(f, 'extra');
    if (mg !== null && mg < 0) note.innerHTML = '<p class="warn-t small">복용량은 0 이상이어야 해요.</p>';
    else if ((ex === 'bed' || ex === 'night') && mg !== null && C.isNum(rx) && mg <= rx) note.innerHTML = '<p class="warn-t small">더 먹었다면 실제 복용량에 합친 양을 적어 주세요.</p>';
    else if (mg !== null && C.isNum(rx) && Math.abs(mg - rx) > 0.001) note.innerHTML = '<p class="muted small">현재 처방 기록(' + fmtMg(rx) + ')과 다르게 기록돼요. 처방이 바뀌었다면 "감량" 탭에 처방 변경을 적어 주세요.</p>';
    else note.innerHTML = '';
    $('#redoseBox').hidden = !(rx === 0 && mg !== null && mg > 0);
    $('#extraWrap').hidden = rx === 0;
  }
  function setDose(ds, mg, time) {
    var day = state.intakes[ds] || {};
    if (mg === null && !time) delete day[Z];
    else day[Z] = { mg: mg, time: time || '' };
    if (Object.keys(day).length) state.intakes[ds] = day; else delete state.intakes[ds];
  }
  function saveDiary(btn) {
    var ds = btn.getAttribute('data-date'), f = $('#f');
    var d = readDiary(f), mg = numOf(f.mg.value), mgTime = f.mgTime.value, rx = C.prescribedOn(state, ds);
    var op = ui.opened && ui.opened.key === 'diary/' + ds ? ui.opened : null, night = {};
    D.NIGHT_ITEMS.forEach(function (x) { night[x.key] = segVal(f, 'n_' + x.key); });
    if (op) {
      var curZ = (state.intakes[ds] || {})[Z] || {};
      if (state.diary[ds]) keepOthers(d, op.rec, state.diary[ds]);
      if (eqv(mg, op.mg) && !eqv(op.mg, curZ.mg)) mg = C.isNum(curZ.mg) ? curZ.mg : null;
      if (eqv(mgTime, op.time) && !eqv(op.time, curZ.time)) mgTime = curZ.time || '';
      keepOthers(night, op.items, (state.checks[ds] || {}).items || {});
    }
    // 예전에 따로 적던 추가 복용량(mg)은 그대로 이어 둠
    var old = state.diary[ds];
    if (old && C.isNum(old.extraMg) && (d.extra === 'bed' || d.extra === 'night')) d.extraMg = old.extraMg;
    if (rx === 0) d.extra = null;
    if (rx !== 0 || !(mg > 0)) { d.redoseType = null; d.redose = ''; }
    if (mg !== null && mg < 0) { toast('복용량은 0 이상이어야 해요.'); return; }
    var empty = diaryEmpty(d), c = C.calcNight(d);
    function commit() {
      if (empty) delete state.diary[ds]; else state.diary[ds] = d;
      var ck = ensureCheck(ds);
      D.NIGHT_ITEMS.forEach(function (x) { setOrDel(ck.items, x.key, night[x.key]); });
      cleanCheck(ds);
      setDose(ds, mg, mgTime);
      save();
      goBack('#home');
      afterDiarySheet(ds);
    }
    if (!empty && c.error) {
      confirmBox('입력을 다시 확인해 주세요', esc(c.error) + '<br><br>그래도 저장하면 이 날은 수면 계산에서 빠집니다.', '그래도 저장', commit);
    } else commit();
  }
  function afterDiarySheet(ds) {
    var c = C.calcNight(state.diary[ds]);
    var body = '';
    if (c.complete) body += '<div class="metrics">' + metric('실제 수면', C.fmtDur(c.tst)) + metric('침대 시간', C.fmtDur(c.tib)) + metric('수면효율', fmtPct(c.se)) + '</div>';
    // 안내 카드는 여기서 겹쳐 띄우지 않음: 어젯밤 안내는 홈 '오늘의 안내', 처방과 다른 양은 입력 화면에서 이미 알려 줌
    body += '<p>' + esc(D.TIPS.saved[Math.floor(Math.random() * D.TIPS.saved.length)]) + '</p>';
    if (ds === C.addDays(today(), -1) && nightTips(ds).length) body += '<p class="muted small">기록에 맞는 안내는 홈에 있어요.</p>';
    modal({ title: '기록했어요', body: body, actions: [{ label: '확인', cls: 'primary' }] });
  }

  /* ================= 루틴 ================= */
  // 오늘 하루를 순서대로 따라 하며 체크·메모. CBT-I 행동은 실행률과 같은 칸(checks[날짜].items)에 저장.
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function wakeBase() { return C.parseHM(state.settings.wakeTarget) !== null ? state.settings.wakeTarget : '07:00'; }
  function atTime(off) { var m = (C.parseHM(wakeBase()) + off) % 1440; return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60); }
  function stepByKey(k) { return D.ROUTINE.filter(function (s) { return s.key === k; })[0]; }
  function stepVal(ck, st) { return st.cbt ? (ck.items || {})[st.cbt] : (ck.aux || {})[st.key]; }
  // 체크한 칸 수: 했어요·못 했어요·해당없음 모두 셈. 낮잠은 '안 잤어요/잤어요'를 고르면 체크
  function routineAnswered(ck) {
    return D.ROUTINE.filter(function (s) { return s.nap ? !!(ck.nap && ck.nap.did) : !!stepVal(ck, s); }).length;
  }
  function ensureCheck(ds) {
    var c = state.checks[ds] || (state.checks[ds] = { items: {} });
    if (!c.items) c.items = {};
    return c;
  }
  function setOrDel(obj, k, v) { if (v === null || v === undefined || v === '') delete obj[k]; else obj[k] = v; }
  function checkEmpty(c) {
    return !Object.keys(c.items || {}).length && !c.aux && !c.memos && !c.drowsy && !c.nap && !c.danger && !c.dizzy && !C.isNum(c.energy) && !c.note && !c.old;
  }
  function cleanCheck(ds) {
    var c = state.checks[ds];
    if (!c) return;
    ['aux', 'memos', 'drowsy'].forEach(function (k) { if (c[k] && !Object.keys(c[k]).length) delete c[k]; });
    if (c.nap && !Object.keys(c.nap).length) delete c.nap;
    if (checkEmpty(c)) delete state.checks[ds];
  }
  // 낮잠 → CBT-I "낮잠" 칸: 안 잤거나 이른 오후 30분 이내면 완료, 안전을 위한 휴식은 실패로 치지 않음(해당없음)
  function napItem(n) {
    if (!n || !n.did) return null;
    if (n.did === 'no') return 'done';
    if (n.why === 'safety') return 'na';
    var early = !n.start || C.parseHM(n.start) < 15 * 60;
    return C.isNum(n.min) ? (n.min <= 30 && early ? 'done' : 'miss') : null;
  }
  // 그날 낮잠(분). 안전 휴식은 다음 날 제안에서 빼기 위해 0으로 봄
  function napMinutes(ds) {
    var n = state.checks[ds] && state.checks[ds].nap;
    if (n && n.did === 'yes') return n.why === 'safety' ? 0 : n.min;
    return n && n.did === 'no' ? 0 : null;
  }
  function routineWarnings(ck) {
    var out = [], dr = ck.drowsy || {};
    if (ck.danger === 'yes' || Object.keys(dr).some(function (k) { return dr[k] === 3; })) out.push(tip('severeSleepy', '', '', 'warn'));
    if (ck.dizzy === 'yes') out.push(tip('dizzy', '', '', 'warn'));
    return out;
  }
  function routineRefresh(ds) {
    var p = $('#rtProgress');
    if (!p) return;
    var ck = state.checks[ds] || { items: {} };
    p.innerHTML = '체크한 칸 <b>' + routineAnswered(ck) + ' / ' + D.ROUTINE.length + '</b>';
    $('#rtWarn').innerHTML = routineWarnings(ck).map(msgCard).join('');
    var nb = $('#napBox');
    if (nb) nb.hidden = !(ck.nap && ck.nap.did === 'yes');
  }
  function viewRoutine(r) {
    var t = today(), ds = C.isDate(r.a) && r.a <= t ? r.a : t;
    var ck = state.checks[ds] || { items: {} }, nap = ck.nap || {}, memos = ck.memos || {};
    var opts = [['done', '했어요'], ['miss', '못 했어요'], ['na', '해당없음']];
    // 오늘은 탭 화면, 지난 날은 기록 목록에서 들어오는 하위 화면(뒤로 버튼)
    var h = (ds === t ? pageHead('루틴', fmtDate(ds) + ' · 오늘') : topbar('루틴', fmtDate(ds) + ' · 지난 날 기록', '#log/check')) +
      '<p class="hint">시각은 목표 기상 ' + wakeBase() + '에 맞춘 예시예요. 누르면 바로 저장되고, 고른 것을 한 번 더 누르면 지워져요.</p>' +
      '<div class="msg info"><div class="msg-title">' + icon('bulb') + '<b>지킬 것은 "일정한 기상 시각"이에요</b></div>' +
      '<p>낮에 무조건 안 자기, 일부러 밤새우기가 아니에요.</p></div>' +
      '<p class="rt-progress" id="rtProgress"></p><div id="rtWarn"></div>';
    D.ROUTINE_BLOCKS.forEach(function (bl) {
      h += '<section class="card"><h3>' + esc(bl[1]) + (bl[2] ? ' <small>' + esc(bl[2]) + '</small>' : '') + '</h3>';
      D.ROUTINE.filter(function (s) { return s.block === bl[0]; }).forEach(function (s) {
        var memo = memos[s.key] || '';
        h += '<div class="rt-step"><div class="rt-head">' + (C.isNum(s.off) ? '<span class="rt-time">' + atTime(s.off) + '</span>' : '') +
          '<b>' + esc(s.title) + '</b></div><small>' + esc(s.how) + '</small>';
        if (s.nap) {
          h += seg('napdid|' + ds, [['no', '안 잤어요'], ['yes', '잤어요']], nap.did, 'two') +
            '<div class="nap-box" id="napBox"' + (nap.did === 'yes' ? '' : ' hidden') + '>' +
            field('시작 시각', '<input type="time" data-nap="start|' + ds + '" value="' + esc(nap.start || '') + '">') +
            field('몇 분 잤나요', '<div class="stepper"><button type="button" data-step="-10" aria-label="줄이기">−</button>' +
              '<input type="number" inputmode="numeric" min="0" data-nap="min|' + ds + '" value="' + (C.isNum(nap.min) ? nap.min : '') + '">' +
              '<button type="button" data-step="10" aria-label="늘리기">+</button></div>') +
            field('왜 잤나요', seg('napwhy|' + ds, [['habit', '그냥 · 습관처럼'], ['safety', '너무 졸려서 안전하게 쉼']], nap.why, 'wrap')) + '</div>';
        } else {
          h += seg('rt|' + s.key + '|' + ds, opts, stepVal(ck, s), 'three');
        }
        h += '<button type="button" class="rt-memo-btn" data-act="rt-memo">' + (memo ? '메모 ✎' : '+ 메모') + '</button>' +
          '<div class="rt-memo"' + (memo ? '' : ' hidden') + '><textarea rows="2" data-rtmemo="' + s.key + '|' + ds + '" placeholder="예: 비가 와서 실내에서 걸음">' + esc(memo) + '</textarea></div></div>';
      });
      if (bl[0] === 'evening') h += '<p class="rt-guide"><b>잠자리</b> 졸릴 때 잠자리로 가요. 수면제는 누우러 갈 때(처방대로 취침 직전) 먹고, 먹은 뒤엔 기다리지 말고 바로 누워요. 7~8시간 잘 수 있을 때만 먹어요. 잠이 안 오면 안전할 때 침대 밖에서 쉬고, 침대에서는 자는 것만 해요. 어떻게 했는지는 ' + (ds === t ? '내일' : '다음 날') + ' 아침 수면일지에서 체크해요.</p>';
      h += '</section>';
    });
    h += '<section class="card"><h3>시간대별 졸림 <small>심함 = 눈이 감길 만큼, 운전·계단이 위험할 만큼</small></h3>' +
      D.DROWSY_SLOTS.map(function (sl) {
        return field(sl[1], seg('drowsy|' + sl[0] + '|' + ds, SCORE03, (ck.drowsy || {})[sl[0]]));
      }).join('') + '<small class="fhint">아침 졸림은 수면일지에서 적어요.</small>' + oldDrowsyLine(ck) + '</section>' +
      '<section class="card safety"><h3>안전</h3>' +
      field('비틀거리거나 어지러웠어요', seg('rtdizzy|' + ds, [['no', '없음'], ['yes', '있음']], ck.dizzy, 'two warnyes')) + '</section>' +
      '<section class="card"><h3>하루 마무리</h3>' +
      field((ds === t ? '오늘' : '그날') + ' 낮 기운 · 컨디션', scaleSeg('rtenergy|' + ds, 'energy', ck.energy)) +
      field((ds === t ? '오늘' : '그날') + ' 메모 · 잘된 점', '<textarea rows="3" data-rtnote="' + ds + '" placeholder="예: 오후 3시에 많이 졸려서 산책했더니 나아짐">' + esc(ck.note || '') + '</textarea>') + '</section>' +
      '<a class="btn ghost wide" href="#program">' + icon('book') + ' 8주 과정 · 근거 보기</a>';
    later(function () { routineRefresh(ds); });
    return h;
  }
  // 예전 루틴에 있던 오전 졸림·위험한 졸림 기록: 지금은 칸이 없어 읽기만
  function oldDrowsyLine(ck) {
    var am = (ck.drowsy || {}).am, bits = [];
    if (C.isNum(am)) bits.push('오전 졸림 ' + sleepyWord(am));
    if (ck.danger === 'yes') bits.push('위험할 만큼 졸림 있음');
    return bits.length ? '<p class="muted small">예전 기록: ' + bits.join(' · ') + '</p>' : '';
  }
  // 루틴의 선택 버튼 → 바로 저장
  function routineSeg(sg) {
    var name = sg.getAttribute('data-seg'), p = name.split('|'), ds = p[p.length - 1];
    var ck = ensureCheck(ds), v = segVal(sg.parentNode, name);
    if (p[0] === 'rt') {
      var st = stepByKey(p[1]);
      if (st.cbt) setOrDel(ck.items, st.cbt, v);
      else { ck.aux = ck.aux || {}; setOrDel(ck.aux, st.key, v); }
    } else if (p[0] === 'napdid' || p[0] === 'napwhy') {
      ck.nap = ck.nap || {};
      setOrDel(ck.nap, p[0] === 'napdid' ? 'did' : 'why', v);
      setOrDel(ck.items, 'nap', napItem(ck.nap));
    } else if (p[0] === 'drowsy') { ck.drowsy = ck.drowsy || {}; setOrDel(ck.drowsy, p[1], numOf(v)); }
    else if (p[0] === 'rtdizzy') setOrDel(ck, 'dizzy', v);
    else if (p[0] === 'rtenergy') setOrDel(ck, 'energy', numOf(v));
    cleanCheck(ds);
    save();
    routineRefresh(ds);
    if (v === null) toast('선택을 지웠어요.');
  }

  /* ================= 생각 노트 ================= */
  function viewThought(r) {
    var x = state.thoughts.filter(function (t) { return t.id === r.a; })[0];
    var isNew = !x;
    x = x || { date: today() };
    var h = topbar('생각 노트', isNew ? '새로 쓰기' : fmtDate(x.date), '#log/thought') + '<form class="form" id="f" onsubmit="return false">' +
      '<div class="msg tip"><div class="msg-title">' + icon('bulb') + '<b>무조건 긍정하는 게 아니에요</b></div><p>생각을 조금 더 현실적으로 바꾸는 연습이에요. 예: "오늘 못 자면 내일 아무것도 못 한다" → "내일 피곤할 수 있지만, 한 번 잠을 설친 것이 모든 것을 망치지는 않는다."</p></div>' +
      '<section class="card">' +
      field('날짜', input('date', 'date', x.date, 'max="' + today() + '"')) +
      field('상황', textarea('situation', x.situation, '예: 밤 12시, 침대에서 1시간째 잠이 안 옴', 2)) +
      field('자동으로 떠오른 생각', textarea('thought', x.thought, '예: 오늘 못 자면 내일 아무것도 못 한다', 2)) +
      field('그 생각을 믿는 이유', textarea('why', x.why, '예: 지난번에 못 잤을 때 너무 힘들었다', 2)) +
      field('다른 관점에서 볼 수 있는 근거', textarea('evidence', x.evidence, '예: 못 잔 날에도 장 보고 병원도 다녀왔다', 2)) +
      field('균형 잡힌 대안 생각', textarea('alternative', x.alternative, '예: 피곤할 수 있지만 하루는 보낼 수 있고, 잠은 날마다 달라진다', 2)) +
      '</section><section class="card">' +
      field('걱정 정도 — 쓰기 전', scaleSeg('before', 'worry', x.before)) +
      field('걱정 정도 — 쓴 후', scaleSeg('after', 'worry', x.after)) +
      field('내일 해 볼 한 가지 (선택)', input('text', 'next', x.next)) +
      '</section><div class="form-actions">' + (isNew ? '' : '<button type="button" class="btn ghost danger" data-act="del-thought" data-id="' + x.id + '">삭제</button>') +
      '<button type="button" class="btn primary big" data-act="save-thought" data-id="' + (isNew ? '' : x.id) + '">저장</button></div></form>';
    return h;
  }
  function saveThought(btn) {
    var f = $('#f'), id = btn.getAttribute('data-id');
    var rec = {
      date: f.date.value || today(), situation: f.situation.value.trim(), thought: f.thought.value.trim(), why: f.why.value.trim(),
      evidence: f.evidence.value.trim(), alternative: f.alternative.value.trim(), before: segNum(f, 'before'), after: segNum(f, 'after'), next: f.next.value.trim()
    };
    if (!rec.situation && !rec.thought && !rec.alternative && !rec.why && !rec.evidence) { toast('상황이나 생각을 한 가지 이상 적어 주세요.'); return; }
    if (id) {
      var old = state.thoughts.filter(function (t) { return t.id === id; })[0];
      rec.before = keepScale('worry', old.before, rec.before);
      rec.after = keepScale('worry', old.after, rec.after);
      Object.assign(old, rec);
    } else {
      rec.id = uid(); rec.createdAt = Date.now();
      state.thoughts.push(rec);
    }
    save();
    goBack('#log/thought');
    toast(C.isNum(rec.before) && C.isNum(rec.after) ? '저장했어요 · ' + worryText(rec) : '저장했어요.');
  }
  function worryText(x) {
    var a = scaleWord('worry', x.before), b = scaleWord('worry', x.after);
    return C.isNum(x.before) && C.isNum(x.after) && a === b ? '걱정 그대로 (' + a + ')' : '걱정 ' + a + ' → ' + b;
  }

  /* ================= 약 ================= */
  function viewMeds() {
    return pageHead('수면제 감량', '처방대로 줄여 가는 과정을 기록해요') + taperView();
  }
  function taperView() {
    var t = today(), rxNow = C.prescribedOn(state, t), last = C.lastRxChange(state, t);
    var s7 = C.summarize(state, C.datesFrom(C.addDays(t, -7), C.addDays(t, -1)));
    var h = '<div class="card big-num"><span>현재 처방 기록</span><b>' + fmtMg(rxNow) + '</b><small>' +
      (last ? '마지막 변경 ' + esc(fmtDate(last.date)) + ' (' + fmtMg(last.beforeMg) + ' → ' + fmtMg(last.afterMg) + ')' : '처방 변경 기록 없음 · 아래에서 현재 처방 용량을 기록해 주세요') + '</small>' +
      '<div class="metrics two">' + metric('최근 7일 실제 복용 평균', s7.nDose ? fmtMg(s7.dose) : '기록 없음', s7.nDose ? '기록 ' + s7.nDose + '일' : '') +
      metric('최근 7일 복용한 밤', s7.nDose ? s7.dosedNights + '일' : '–', '') + '</div></div>';
    safetyTips().filter(function (m) { return m.title.indexOf('처방 용량') === 0; }).forEach(function (m) { h += msgCard(m); });
    h += '<section class="block"><h3 class="block-h">최근 4주 · 실제 복용량과 처방</h3><div class="card"><div id="ch-taper"></div>' +
      '<p class="muted small">점은 그날 수면일지에 적은 실제 복용량, 점선은 처방 기록이에요. 기록이 없는 날은 비워 둡니다.</p></div></section>';
    later(function () { ui.redraw = drawTaper; drawTaper(); });
    function drawTaper() {
      var ds = C.datesFrom(C.addDays(t, -27), t);
      var pts = ds.map(function (x) { return C.dayPoint(state, x); });
      var mx = niceMax(pts.map(function (p) { return Math.max(p.dose || 0, p.rx || 0); }), 10, 5);
      Charts.line($('#ch-taper'), {
        title: '최근 4주 복용량', labels: ds.map(fmtShort),
        series: [{ name: '실제 복용', color: 'var(--s1)', values: pts.map(function (p) { return p.dose; }) },
          { name: '처방 기록', color: 'var(--s2)', dashed: true, values: pts.map(function (p) { return p.rx; }) }],
        yMin: 0, yMax: mx, ticks: [0, mx / 2, mx], fmt: fmtMg
      });
    }

    h += '<section class="block"><h3 class="block-h">처방 · 감량 기록</h3>' +
      '<p class="hint">의료진과 정한 변경만 적어요. 매일 실제로 먹은 양은 수면일지에 적습니다.</p>' +
      '<a class="btn primary wide" href="#rx/new">' + icon('plus') + ' 처방 변경 기록하기</a>';
    var list = state.rx.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    if (!list.length) h += '<div class="empty">아직 처방 변경 기록이 없어요.<br>처방이 바뀌는 날 날짜와 새 용량을 적어 주세요.</div>';
    list.forEach(function (x) {
      var future = x.date > t;
      h += '<a class="rxcard" href="#rx/' + x.id + '"><div class="rx-top"><b>' + esc(fmtDate(x.date)) + '</b>' + (future ? '<span class="badge">예정</span>' : '') + '</div>' +
        '<div class="rx-dose">' + fmtMg(x.beforeMg) + ' → <b>' + fmtMg(x.afterMg) + '</b></div>' +
        rxLine('처방받은 실행 기간 · 지시', x.period) + rxLine('변경 사유', x.reason) + rxLine('변경 당시 수면 상태', x.sleepState) +
        rxLine('반동 불면 · 금단 증상', x.withdrawal) + rxLine('낮 졸림 · 몸 상태', x.daytime) + rxLine('담당자 지시 · 특이사항', x.note) + '</a>';
    });
    h += '</section><section class="block"><h3 class="block-h">안전 원칙</h3><div class="card"><ul class="rules">' +
      D.SAFETY.slice(0, 4).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div></section>';
    return h;
  }
  function rxLine(label, v) { return v ? '<div class="rx-line"><span>' + label + '</span><p>' + esc(v) + '</p></div>' : ''; }

  function viewRx(r) {
    var x = state.rx.filter(function (c) { return c.id === r.a; })[0], isNew = !x;
    var t = today();
    x = x || { date: t, beforeMg: C.prescribedOn(state, t) };
    var h = topbar('처방 변경 기록', isNew ? '새 기록' : fmtDate(x.date), '#meds') +
      '<form class="form" id="f" onsubmit="return false"><div class="msg info"><div class="msg-title">' + icon('alert') + '<b>의료진과 정한 변경만 적어요</b></div><p>앱은 감량 일정을 만들거나 바꾸라고 하지 않아요. 처방받은 내용을 그대로 남겨 두면 실제 복용량과 비교해 볼 수 있어요.</p></div>' +
      '<section class="card">' +
      field('처방 변경 날짜', input('date', 'date', x.date)) +
      field('변경 전 용량 (mg)', input('number', 'beforeMg', x.beforeMg, 'step="0.25" min="0" inputmode="decimal"')) +
      field('새 처방 용량 (mg)', input('number', 'afterMg', x.afterMg, 'step="0.25" min="0" inputmode="decimal"')) +
      field('처방받은 실행 기간 · 지시', textarea('period', x.period, '예: 다음 진료 때까지, 의사가 말한 대로', 2)) +
      field('변경 사유', textarea('reason', x.reason, '', 2)) +
      field('변경 당시 수면 상태', textarea('sleepState', x.sleepState, '', 2)) +
      field('반동 불면 · 금단 증상', textarea('withdrawal', x.withdrawal, '예: 처음 3일 잠들기 어려움', 2)) +
      field('낮 졸림 · 몸 상태', textarea('daytime', x.daytime, '', 2)) +
      field('담당자 지시 · 특이사항', textarea('note', x.note, '', 2)) +
      '</section><div class="form-actions">' + (isNew ? '' : '<button type="button" class="btn ghost danger" data-act="del-rx" data-id="' + x.id + '">삭제</button>') +
      '<button type="button" class="btn primary big" data-act="save-rx" data-id="' + (isNew ? '' : x.id) + '">저장</button></div></form>';
    return h;
  }
  function saveRx(btn) {
    var f = $('#f'), id = btn.getAttribute('data-id');
    var rec = {
      date: f.date.value, beforeMg: numOf(f.beforeMg.value), afterMg: numOf(f.afterMg.value),
      period: f.period.value.trim(), reason: f.reason.value.trim(), sleepState: f.sleepState.value.trim(),
      withdrawal: f.withdrawal.value.trim(), daytime: f.daytime.value.trim(), note: f.note.value.trim()
    };
    if (!C.isDate(rec.date)) { toast('처방 변경 날짜를 골라 주세요.'); return; }
    if (rec.afterMg === null || rec.afterMg < 0) { toast('새 처방 용량을 적어 주세요. (0 이상)'); return; }
    if (rec.beforeMg !== null && rec.beforeMg < 0) { toast('변경 전 용량은 0 이상이어야 해요.'); return; }
    if (id) Object.assign(state.rx.filter(function (c) { return c.id === id; })[0], rec);
    else { rec.id = uid(); rec.createdAt = Date.now(); state.rx.push(rec); }
    save();
    goBack('#meds');
    toast('처방 변경을 기록했어요.');
  }

  /* ================= 주간 점검 ================= */
  function viewWeekly(r) {
    var w = +r.a >= 1 ? +r.a : Math.max(1, curWeek());
    var x = state.weekly[w] || {}, s = C.weekSummary(state, w), tw = w === curWeek() ? '이번 주' : '그 주';
    ui.opened = { key: 'weekly/' + w, rec: clone(x), memo: state.weekNotes[w] || '' };
    var h = topbar('주간 점검', w + '주차 · ' + fmtShort(s.start) + ' ~ ' + fmtShort(s.end), '#stats') + '<form class="form" id="f" onsubmit="return false">' +
      '<div class="card"><h3>' + tw + ' 기록 요약 <small>자동</small></h3><div class="metrics">' +
      metric('실제 수면', s.enough ? fmtH(s.tst) : '기록 부족') + metric('수면효율', s.enough ? fmtPct(s.se) : '–') +
      metric('CBT-I 실행률', s.nCbt ? fmtPct(s.cbt) : '–') +
      metric('약 없는 밤', s.nDose ? s.freeNights + '일' : '–') + metric('처방대로', s.nPlan ? s.planKept + ' / ' + s.nPlan + '밤' : '–') +
      metric('증상 있던 날', s.nSym ? s.symDays + '일' : '–') + '</div></div>' +
      '<p class="hint">연구에서 감량 성공과 관련됐던 것은 "의지"보다 계획을 지킬 자신감과 "약 없인 못 잔다"는 믿음의 변화였어요. 솔직하게 골라 주세요.</p>' +
      '<section class="card">' +
      field(D.WEEKLY.confidence, scaleSeg('confidence', 'confidence', x.confidence)) +
      field(D.WEEKLY.belief, scaleSeg('belief', 'belief', x.belief)) +
      field(D.WEEKLY.stress.replace('이번 주', tw), scaleSeg('stress', 'stress', x.stress)) +
      field(tw + ' 넘어지거나 다칠 뻔한 일', seg('fall', [['no', '없음'], ['yes', '있음']], x.fall, 'two warnyes')) +
      '</section><section class="card">' +
      field('가장 어려웠던 상황', textarea('hard', x.hard, '예: 수요일 밤, 다음 날 일정 걱정에 약을 더 먹고 싶었다', 2)) +
      field('다음 주에 집중할 CBT-I 행동 하나', seg('focus', D.CBT_ITEMS.map(function (it) { return [it.key, it.short]; }), x.focus, 'wrap')) +
      field('주간 메모 (선택)', textarea('memo', state.weekNotes[w], '', 2)) +
      '</section><div class="form-actions"><button type="button" class="btn primary big" data-act="save-weekly" data-week="' + w + '">저장</button></div></form>';
    return h;
  }
  function weeklyAnswered(x) {
    return !!x && (C.isNum(x.confidence) || C.isNum(x.belief) || C.isNum(x.stress) || !!x.fall || !!x.hard || !!x.focus);
  }
  function saveWeekly(btn) {
    var f = $('#f'), w = btn.getAttribute('data-week');
    var old = state.weekly[w] || {};
    var rec = { confidence: keepScale('confidence', old.confidence, segNum(f, 'confidence')), belief: keepScale('belief', old.belief, segNum(f, 'belief')),
      stress: keepScale('stress', old.stress, segNum(f, 'stress')), fall: segVal(f, 'fall'), hard: f.hard.value.trim(), focus: segVal(f, 'focus') };
    var memo = f.memo.value.trim();
    var op = ui.opened && ui.opened.key === 'weekly/' + w ? ui.opened : null;
    if (op) {
      ['confidence', 'belief', 'stress'].forEach(function (k) {
        var a = rec[k], o = op.rec[k];
        var untouched = C.isNum(a) && C.isNum(o) ? scaleLevel(k, a) === scaleLevel(k, o) : eqv(a, o);
        if (untouched) rec[k] = C.isNum(old[k]) ? old[k] : null;
      });
      ['fall', 'hard', 'focus'].forEach(function (k) { if (eqv(rec[k], op.rec[k]) && !eqv(op.rec[k], old[k])) rec[k] = old[k]; });
      if (eqv(memo, op.memo)) memo = state.weekNotes[w] || '';
    }
    var answered = weeklyAnswered(rec);
    if (!answered && !memo && !weeklyAnswered(old) && !state.weekNotes[w]) { toast('한 가지 이상 골라 주세요.'); return; }
    // 화면에 없는 예전 칸(처방 단계 등)은 비워도 남김
    var keep = {};
    Object.keys(old).forEach(function (k) { if (!(k in rec)) keep[k] = old[k]; });
    if (answered) state.weekly[w] = Object.assign({}, old, rec);
    else if (Object.keys(keep).length) state.weekly[w] = keep;
    else delete state.weekly[w];
    if (memo) state.weekNotes[w] = memo; else delete state.weekNotes[w];
    save();
    goBack('#stats');
    var tips = [];
    // 자신감·믿음 안내는 홈 '오늘의 안내'에 나오므로 여기서는 홈에 없는 넘어짐 경고만
    if (rec.fall === 'yes') tips.push({ kind: 'warn', title: '넘어지거나 다칠 뻔한 일이 있었어요', body: '수면제를 먹는 중이라면 특히 중요해요. 처방 의사에게 꼭 알려 주세요. 밤에 일어날 때는 불을 켜고 천천히 움직이세요.' });
    if (tips.length) modal({ title: '주간 점검을 저장했어요', body: tips.map(msgCard).join(''), actions: [{ label: '확인', cls: 'primary' }] });
    else toast('주간 점검을 저장했어요.');
  }

  /* ================= AI에게 물어보기 ================= */
  var ASK_EXAMPLES = [
    '내 기록을 보고 다음 주에 무엇을 바꾸면 좋을지 알려 주세요.',
    '감량한 뒤 잠이 나빠졌는데, 기록으로 볼 때 무엇이 원인일 수 있고 어떻게 대처하면 좋을까요?',
    '다음 진료 때 의사에게 내 상황을 어떻게 설명하면 좋을지 정리해 주세요.'
  ];
  function viewAsk() {
    var p = state.profile || {};
    var h = topbar('AI에게 물어보기', '지금까지의 과정을 한 번에 복사', '#home') + '<form class="form" id="f" onsubmit="return false">' +
      '<p class="hint">묻고 싶은 것만 적으면, 내 상황과 앱에 쌓인 기록을 묶어 질문 글을 만들어요. "복사하기"를 누른 뒤 ChatGPT·Claude 같은 AI 대화창에 붙여 넣으면 됩니다.</p>' +
      '<section class="card"><h3>이번에 묻고 싶은 것</h3>' +
      field('질문', textarea('question', p.question, '예: 내 기록을 보고 다음 주에 무엇을 바꾸면 좋을지', 3)) +
      '<div class="quick">' + ASK_EXAMPLES.map(function (q, i) {
        return '<button type="button" data-act="ask-fill" data-v="' + esc(q) + '">' + ['다음 주 행동', '잠이 나빠졌을 때', '진료 때 말할 것'][i] + '</button>';
      }).join('') + '</div></section>' +
      '<p class="muted small">내 상황(복용 시작 시기·끊고 싶은 이유·요즘 힘든 점)은 <a class="link" href="#settings">설정</a>에서 한 번만 적어 두면 돼요.</p>' +
      '<section class="card"><h3>만들어진 질문 글 <small>기록이 바뀌면 같이 바뀌어요</small></h3>' +
      '<textarea id="promptOut" rows="14" readonly></textarea>' +
      '<p class="muted small">이 글에는 수면·복용 같은 건강 정보가 들어 있어요. 믿을 수 있는 AI 서비스에만 붙여 넣으세요.</p></section>' +
      '<div class="form-actions"><button type="button" class="btn primary big" data-act="copy-prompt">복사하기</button></div></form>';
    later(function () {
      var f = $('#f');
      var upd = function () {
        state.profile.question = f.question.value.trim();
        save();
        $('#promptOut').value = buildPrompt();
      };
      f.addEventListener('input', upd);
      $('#promptOut').value = buildPrompt();
    });
    return h;
  }
  function buildPrompt() {
    var p = state.profile || {}, t = today(), y = C.addDays(t, -1), w = curWeek();
    var L = [];
    var line = function (label, v) { if (v !== '' && v != null) L.push('- ' + label + ': ' + v); };
    var orNo = function (v) { return v || '(아직 안 적음)'; };
    L.push('저는 수면제를 오랫동안 먹어 왔습니다. 담당 의사의 처방에 따라 약을 줄이면서, CBT-I(불면증 인지행동치료)를 스스로 실천하고 매일 기록하고 있습니다. 아래 제 상황과 기록을 보고 도와주세요.');
    L.push('');
    L.push('[내 상황]');
    line('수면제를 먹기 시작한 때', orNo(p.started));
    if (p.reason) line('처음 먹게 된 계기', p.reason);
    line('끊고 싶은 이유', orNo(p.why));
    line('요즘 힘든 점', orNo(p.struggles));
    L.push('');
    L.push('[현재 상황]');
    var stage = w === 0 ? '시작 전 (' + startDate() + '부터 시작)' : w <= 8 ? w + '주차 (8주 CBT-I 과정 중 "' + D.PROGRAM[w - 1].title + '" 단계)' : w + '주차 (8주 과정을 마치고 장기 기록 중)';
    line('8주 과정 시작 날짜', startDate() + ', 지금 ' + stage);
    if (state.settings.wakeTarget) line('목표 기상 시각', state.settings.wakeTarget);
    if (!Object.keys(state.diary).length && !Object.keys(state.checks).length) line('기록 상태', '아직 기록 전이에요. 이제 막 시작합니다.');
    var z = state.meds.filter(function (m) { return m.id === Z; })[0];
    line('기본 처방', ((z && z.name) || '수면제') + ' ' + fmtMg(z ? z.rxMg : null) + ', 오늘 기준 처방 기록 ' + fmtMg(C.prescribedOn(state, t)));
    var rxs = state.rx.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (rxs.length) {
      L.push('- 처방 변경 기록:');
      rxs.forEach(function (x) {
        L.push('  · ' + x.date + ': ' + fmtMg(x.beforeMg) + ' → ' + fmtMg(x.afterMg) + (x.period ? ' (' + x.period + ')' : '') + (x.reason ? ', 사유: ' + x.reason : '') +
          (x.withdrawal ? ', 반동 불면·금단: ' + x.withdrawal : ''));
      });
    } else line('처방 변경 기록', '아직 없음');
    L.push('');

    var SYM = {}; D.SYMPTOMS.forEach(function (x) { SYM[x[0]] = x[1]; });
    function sumBlock(label, from) {
      var dates = C.datesFrom(from, y), s = C.summarize(state, dates);
      L.push('[' + label + ' 요약]');
      line('완전한 수면 기록', s.nComplete + '일 / ' + dates.length + '일');
      if (s.enough) {
        line('평균 실제 수면', fmtH(s.tst) + ' (침대에 있던 시간 ' + fmtH(s.tib) + ', 수면효율 ' + fmtPct(s.se) + ')');
        line('평균 잠들기까지 / 밤중 깬 시간', C.fmtDur(s.sol) + ' / ' + C.fmtDur(s.waso));
      } else line('수면 평균', '기록이 4일 미만이라 계산 안 함');
      if (s.nDose) {
        line('수면제 실제 복용 평균', fmtMg(s.dose) + ' (기록 ' + s.nDose + '일)');
        line('약 없는 밤 / 처방대로 먹은 밤 / 처방보다 더 먹은 밤', s.freeNights + '일 / ' + s.planKept + '일 / ' + s.overPlan + '일');
      }
      if (s.nSym) {
        var cnt = {};
        dates.forEach(function (ds) { var d = state.diary[ds]; if (d && Array.isArray(d.symptoms)) d.symptoms.forEach(function (k) { cnt[k] = (cnt[k] || 0) + 1; }); });
        var kinds = Object.keys(cnt).map(function (k) { return (SYM[k] || k) + ' ' + cnt[k] + '일'; }).join(', ');
        line('몸·마음 증상 있던 날', s.symDays + '일 / 기록 ' + s.nSym + '일' + (kinds ? ' (' + kinds + ')' : ''));
      }
      if (s.nSleepy) line('아침 졸림 (대체로)', s.sleepy === null ? '기록 4일 미만' : sleepyWord(s.sleepy));
      if (s.nEnergy) line('낮 기운 (대체로)', s.energy === null ? '기록 4일 미만' : scaleWord('energy', s.energy));
      if (s.nCbt) line('CBT-I 실행률 평균', fmtPct(s.cbt));
      L.push('');
    }
    // 낮 기록(심한 졸림·어지럼·낮잠) 줄
    function dayBits(s) {
      if (s.severeDays) line('심하게 졸렸던 날 (눈이 감길 만큼·위험할 만큼)', s.severeDays + '일');
      if (s.dizzyDays) line('비틀거림·어지럼 있던 날', s.dizzyDays + '일');
      if (s.napDays) line('낮잠 잔 날', s.napDays + '일' + (s.safeNapDays ? ' (그중 너무 졸려 안전하게 쉰 날 ' + s.safeNapDays + '일)' : ''));
    }
    sumBlock('최근 7일 (어젯밤까지)', C.addDays(t, -7));
    sumBlock('최근 30일 (어젯밤까지)', C.addDays(t, -30));

    // CBT-I 행동별 (최근 14일)
    var days14 = C.datesFrom(C.addDays(t, -13), t), parts = [];
    D.CBT_ITEMS.forEach(function (x) {
      var done = 0, n = 0;
      days14.forEach(function (ds) {
        var v = state.checks[ds] && state.checks[ds].items && state.checks[ds].items[x.key];
        if (v === 'done') { done++; n++; } else if (v === 'miss') n++;
      });
      if (n) parts.push(x.short + ' ' + done + '/' + n);
    });
    if (parts.length) { L.push('[CBT-I 행동별 실천, 최근 14일 (한 날/체크한 날)]'); L.push('- ' + parts.join(', ')); L.push(''); }

    // 루틴 (최근 7일): 그 밖의 루틴, 시간대별 졸림, 낮잠, 메모
    var d7 = C.datesFrom(C.addDays(t, -6), t), rp = [], memoLines = [];
    D.ROUTINE.filter(function (s) { return !s.cbt; }).forEach(function (s) {
      var done = 0, n = 0;
      d7.forEach(function (ds) { var v = state.checks[ds] && stepVal(state.checks[ds], s); if (v === 'done') { done++; n++; } else if (v === 'miss') n++; });
      if (n) rp.push(s.short + ' ' + done + '/' + n);
    });
    var slots = D.DROWSY_SLOTS.map(function (sl) {
      var v = d7.map(function (ds) { var c2 = state.checks[ds]; return c2 && c2.drowsy ? c2.drowsy[sl[0]] : null; }).filter(C.isNum);
      return v.length ? sl[1] + ' ' + sleepyWord(C.avg(v)) : null;
    }).filter(Boolean);
    var naps = d7.map(function (ds) {
      var n2 = state.checks[ds] && state.checks[ds].nap;
      return n2 && n2.did === 'yes' ? fmtShort(ds) + ' ' + (n2.start || '시각 모름') + (C.isNum(n2.min) ? ' ' + n2.min + '분' : '') + (n2.why === 'safety' ? '(너무 졸려 안전하게 쉼)' : n2.why === 'habit' ? '(습관)' : '') : null;
    }).filter(Boolean);
    d7.slice().reverse().forEach(function (ds) {
      var c3 = state.checks[ds];
      if (!c3) return;
      Object.keys(c3.memos || {}).forEach(function (k) { var st = stepByKey(k); memoLines.push(fmtShort(ds) + ' ' + (st ? st.short : k) + ': ' + c3.memos[k]); });
      if (c3.note) memoLines.push(fmtShort(ds) + ' 하루 메모: ' + c3.note);
    });
    var s7d = C.summarize(state, d7);
    if (rp.length || slots.length || naps.length || memoLines.length || s7d.severeDays || s7d.dizzyDays) {
      L.push('[하루 루틴, 오늘 포함 최근 7일]');
      if (s7d.severeDays) line('심하게 졸렸던 날 (눈이 감길 만큼·위험할 만큼)', s7d.severeDays + '일');
      if (s7d.dizzyDays) line('비틀거림·어지럼 있던 날', s7d.dizzyDays + '일');
      if (rp.length) line('그 밖의 루틴 (한 날/체크한 날)', rp.join(', '));
      if (slots.length) line('시간대별 졸림 (대체로)', slots.join(', '));
      if (naps.length) line('낮잠', naps.join(' / '));
      memoLines.slice(0, 8).forEach(function (m) { L.push('- 메모 ' + m); });
      L.push('');
    }
    var s30d = C.summarize(state, C.datesFrom(C.addDays(t, -29), t));
    if (s30d.severeDays || s30d.dizzyDays || s30d.napDays) {
      L.push('[낮 기록, 오늘 포함 최근 30일]');
      dayBits(s30d);
      L.push('');
    }

    // 주별 추이
    if (w >= 1) {
      L.push('[주별 추이 (최근 6주)]');
      L.push('주차 | 실제 수면 | 수면효율 | 수면제 평균 | 약 없는 밤 | 증상 있던 날 | CBT-I 실행률 | 자신감 | 약 없인 못 잔다는 믿음');
      for (var i = Math.max(1, w - 5); i <= w; i++) {
        var s = C.weekSummary(state, i);
        L.push(i + '주 | ' + (s.enough ? fmtH(s.tst) : '기록 부족') + ' | ' + (s.enough ? fmtPct(s.se) : '–') + ' | ' + (s.nDose ? fmtMg(s.dose) : '–') + ' | ' +
          (s.nDose ? s.freeNights + '일' : '–') + ' | ' + (s.nSym ? s.symDays + '일' : '–') + ' | ' + (s.nCbt ? fmtPct(s.cbt) : '–') + ' | ' +
          scaleWord('confidence', s.confidence) + ' | ' + scaleWord('belief', s.belief));
      }
      L.push('');
    }

    // 최근 주간 점검
    var lw = null, lwN = 0;
    for (var k = w; k >= 1; k--) if (weeklyAnswered(state.weekly[k])) { lw = state.weekly[k]; lwN = k; break; }
    if (lw) {
      L.push('[가장 최근 주간 점검 (' + lwN + '주차)]');
      if (C.isNum(lw.confidence)) line(D.WEEKLY.confidence, scaleWord('confidence', lw.confidence));
      if (C.isNum(lw.belief)) line('약 없인 못 잔다는 믿음', scaleWord('belief', lw.belief));
      if (C.isNum(lw.stress)) line('불안·스트레스', scaleWord('stress', lw.stress));
      if (lw.fall) line('넘어지거나 다칠 뻔한 일', lw.fall === 'yes' ? '있음' : '없음');
      if (lw.hard) line('가장 어려웠던 상황', lw.hard);
      if (lw.focus && itemByKey(lw.focus)) line('다음 주 집중하기로 한 행동', itemByKey(lw.focus).short);
      if (state.weekNotes[lwN]) line('주간 메모', state.weekNotes[lwN]);
      L.push('');
    }

    // 최근 7일 일지
    var nights = C.datesFrom(C.addDays(t, -7), y).filter(function (ds) { return state.diary[ds] || C.doseOn(state, ds) !== null; });
    if (nights.length) {
      L.push('[최근 7일 수면일지]');
      nights.forEach(function (ds) {
        var d = state.diary[ds] || {}, c = C.calcNight(state.diary[ds]), mg = C.doseOn(state, ds), bits = [];
        if (d.bed) bits.push('누움 ' + d.bed);
        if (C.isNum(d.sol)) bits.push('잠들기까지 ' + C.fmtDur(d.sol));
        if (C.isNum(d.waso)) bits.push('밤중 깸 ' + C.fmtDur(d.waso));
        if (d.wake) bits.push('기상 ' + d.wake);
        if (c.complete) bits.push('실제 수면 ' + C.fmtDur(c.tst) + '(수면효율 ' + fmtPct(c.se) + ')');
        if (mg !== null) bits.push('수면제 ' + fmtMg(mg) + '(처방 ' + fmtMg(C.prescribedOn(state, ds)) + ')' + (d.extra === 'bed' ? ' 자기 전에 처방보다 더 먹음' : d.extra === 'night' || d.extra === 'yes' ? ' 밤중에 깨서 처방보다 더 먹음' : ''));
        if (C.isNum(d.sleepy)) bits.push('아침 졸림 ' + sleepyWord(d.sleepy));
        if (Array.isArray(d.symptoms)) bits.push('증상 ' + (d.symptoms.length ? d.symptoms.map(function (k2) { return SYM[k2] || k2; }).join('·') : '없음'));
        if (d.alcohol && d.alcohol !== 'none') bits.push('술 ' + (d.alcohol === 'much' ? '많이' : '조금'));
        if (d.redoseType) bits.push(d.redoseType === 'once' ? '끊은 뒤 한 번만 다시 먹음' : '끊은 뒤 예전처럼 다시 먹기 시작');
        if (d.redose) bits.push('다시 먹은 이유: ' + d.redose);
        var ck2 = state.checks[ds];
        if (ck2 && C.isNum(ck2.energy)) bits.push('그날 낮 기운 ' + scaleWord('energy', ck2.energy));
        if (d.note) bits.push('메모: ' + d.note);
        L.push('- ' + fmtDate(ds) + ' 밤: ' + bits.join(', '));
      });
      L.push('');
    }

    // 생각 노트 최근 2개
    var th = state.thoughts.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 2);
    if (th.length) {
      L.push('[최근 생각 노트]');
      th.forEach(function (x) {
        L.push('- ' + x.date + ': "' + (x.thought || '') + '" → "' + (x.alternative || '') + '"' +
          (C.isNum(x.before) && C.isNum(x.after) ? ' (' + worryText(x) + ')' : ''));
      });
      L.push('');
    }

    L.push('[부탁]');
    L.push('- 질문: ' + (p.question || ASK_EXAMPLES[0]));
    L.push('- 감량 일정이나 용량은 정해 주지 마세요. 그건 담당 의사와 정합니다.');
    L.push('- 제 기록에서 보이는 패턴을 CBT-I 관점에서 짚어 주고, 내일·이번 주에 해 볼 구체적인 행동 2~3가지를 쉬운 말로 알려 주세요.');
    L.push('- 한 번에 많은 것보다 작고 구체적인 것부터 알려 주세요.');
    L.push('- 의사와 상의해야 할 위험 신호가 보이면 따로 알려 주세요.');
    return L.join('\n');
  }
  function copyPrompt() {
    var ta = $('#promptOut'), text = ta.value;
    var done = function () { toast('복사했어요. AI 대화창에 붙여 넣으세요.'); };
    var fallback = function () {
      ta.focus(); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('자동 복사가 안 돼요. 글을 길게 눌러 직접 복사해 주세요.'); }
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  /* ================= 분석 ================= */
  function niceMax(vals, floor, step) {
    var m = floor;
    vals.forEach(function (v) { if (C.isNum(v) && v > m) m = v; });
    return Math.ceil(m / step) * step;
  }
  function rangeData(range) {
    var t = today();
    if (range === 1) {
      var ds = C.datesFrom(C.addDays(t, -6), t);
      return { labels: ds.map(fmtShort), pts: ds.map(function (x) { return C.dayPoint(state, x); }), unit: '일' };
    }
    var cur = Math.max(1, curWeek()), from = Math.max(1, cur - range + 1), weeks = [];
    for (var w = from; w <= cur; w++) weeks.push(C.weekSummary(state, w));
    return { labels: weeks.map(function (x) { return x.week + '주'; }), pts: weeks, unit: '주' };
  }
  function diffText(a, b, fmt, unitWord) {
    var d = b - a;
    if (Math.abs(d) < 1e-9) return '변화 없음';
    return (d > 0 ? '+' : '−') + fmt(Math.abs(d)) + (unitWord || '');
  }
  // 두 값의 변화를 말로: th 이상 차이가 나면 up/down, 아니면 비슷
  function trend(a, b, th, up, down) { return b - a >= th ? up : a - b >= th ? down : '비슷'; }
  function weekCompareHtml() {
    var cur = Math.max(1, curWeek()), found = [];
    for (var w = cur; w >= 1 && found.length < 2; w--) {
      var s = C.weekSummary(state, w);
      if (s.enough) found.push(s);
    }
    if (found.length < 2) {
      return msgCard({ kind: 'info', title: '주간 비교는 조금 더 기록이 쌓이면 보여 드려요', body: '수면일지를 4일 이상 쓴 주가 2주 이상 있으면, 그 두 주의 수면·복용량·증상 변화를 나란히 비교해 드려요.' });
    }
    var b = found[0], a = found[1];
    var rows = [['실제 수면', fmtH(a.tst), fmtH(b.tst), diffText(a.tst * 60, b.tst * 60, C.fmtDur)],
      ['수면효율', fmtPct(a.se), fmtPct(b.se), trend(a.se, b.se, 3, '높아짐', '낮아짐')],
      ['잠들기까지', C.fmtDur(a.sol), C.fmtDur(b.sol), diffText(a.sol, b.sol, C.fmtDur)]];
    var both = function (k) { return C.isNum(a[k]) && C.isNum(b[k]); };
    if (both('dose')) rows.push(['수면제 평균', fmtMg(a.dose), fmtMg(b.dose), diffText(a.dose, b.dose, fmtMg)]);
    var days = function (v) { return v; };
    if (a.nDose && b.nDose) rows.push(['약 없는 밤', a.freeNights + '일', b.freeNights + '일', diffText(a.freeNights, b.freeNights, days, '일')]);
    if (a.nSym && b.nSym) rows.push(['증상 있던 날', a.symDays + '일', b.symDays + '일', diffText(a.symDays, b.symDays, days, '일')]);
    if (both('confidence')) rows.push(['자신감', scaleWord('confidence', a.confidence), scaleWord('confidence', b.confidence), stepTrend('confidence', a.confidence, b.confidence, '올라감', '내려감')]);
    if (both('belief')) rows.push(['약 없인 못 잔다는 믿음', scaleWord('belief', a.belief), scaleWord('belief', b.belief), stepTrend('belief', a.belief, b.belief, '늘어남', '줄어듦')]);
    if (both('energy')) rows.push(['낮 기운', scaleWord('energy', a.energy), scaleWord('energy', b.energy), stepTrend('energy', a.energy, b.energy, '좋아짐', '처짐')]);
    if (both('sleepy')) rows.push(['아침 졸림', sleepyWord(a.sleepy), sleepyWord(b.sleepy), stepTrend('sleepy', a.sleepy, b.sleepy, '더 졸림', '덜 졸림')]);
    if (both('cbt')) rows.push(['CBT-I 실행률', fmtPct(a.cbt), fmtPct(b.cbt), trend(a.cbt, b.cbt, 10, '높아짐', '낮아짐')]);

    var notes = [];
    var dTst = b.tst - a.tst;
    if (both('dose') && b.dose < a.dose - 0.01) {
      if (dTst >= -0.25) notes.push('복용량이 줄어든 주에도 실제 수면시간이 유지됐어요. 약 없이 잠드는 힘이 자라고 있다는 신호일 수 있어요.');
      else if (dTst < -0.5) notes.push('복용량이 바뀐 뒤 실제 수면이 줄었어요. 감량 직후 잠이 흔들리는 일은 흔하고 대개 일시적입니다. 이 기록으로 의사와 속도를 상의해 보세요.');
    } else if ((!both('dose') || Math.abs(b.dose - a.dose) <= 0.01) && dTst > 0.25) {
      notes.push('복용량은 비슷한데 실제 수면이 늘었어요. CBT-I 연습이 쌓이고 있어요.');
    }
    if (a.nSym && b.nSym && b.symDays - a.symDays >= 2) notes.push('몸·마음 증상이 있던 날이 늘었어요. 이어지면 처방 의사와 속도를 상의하세요.');
    if (both('belief') && levelOf('belief', b.belief) < levelOf('belief', a.belief)) notes.push('"약 없인 못 잔다"는 믿음이 줄었어요. 연구에서 중단 유지와 관련된 변화예요.');
    if (both('confidence') && levelOf('confidence', b.confidence) > levelOf('confidence', a.confidence)) notes.push('자신감이 올랐어요. 연구에서 끝내 약을 끊은 사람들의 특징이었어요.');
    if (b.se >= 85 && dTst < -0.5) notes.push('수면효율은 높아졌지만 실제 수면시간은 줄었어요. 효율 숫자만으로 좋아졌다고 보지 않아요.');

    var h = '<div class="card"><h3>' + a.week + '주차 → ' + b.week + '주차 비교</h3><div class="sum">' +
      rows.map(function (r) {
        return '<div class="sr"><span class="sr-l">' + r[0] + '</span><span class="sr-vals"><span class="sr-v"><small>' + a.week + '주</small><b>' + r[1] + '</b></span>' +
          '<span class="sr-v"><small>' + b.week + '주</small><b>' + r[2] + '</b></span><span class="sr-v diff"><small>변화</small><b>' + r[3] + '</b></span></span></div>';
      }).join('') + '</div>' +
      notes.map(function (n) { return '<p class="cmp-note">' + esc(n) + '</p>'; }).join('') +
      '<p class="muted small">함께 변했다고 해서 한쪽이 원인이라고 단정할 수는 없어요. 수면시간·낮 기능·증상을 함께 보세요.</p></div>';
    return h;
  }
  function weekCard(s) {
    var cur = s.week === curWeek(), wk = state.weekly[s.week] || {};
    var flags = [];
    if (wk.fall === 'yes') flags.push('이번 주 넘어지거나 다칠 뻔한 일 있음');
    if (s.symDays >= 3) flags.push('몸·마음 증상 ' + s.symDays + '일: 점검 필요');
    if (s.overPlan >= 2) flags.push('처방보다 더 먹은 밤 ' + s.overPlan + '일: 그때 상황을 메모해 두기');
    if (C.isNum(s.sleepy) && s.sleepy >= 2) flags.push('아침 졸림 높음: 안전 확인');
    if (s.severeDays >= 2) flags.push('심한 졸림 ' + s.severeDays + '일: 수면 계획 점검');
    else if (s.severeDays) flags.push('심한 졸림 ' + s.severeDays + '일');
    if (s.dizzyDays) flags.push('어지럼·비틀거림 ' + s.dizzyDays + '일');
    var g = '<dl class="mgrid">' +
      [['실제 수면', s.enough ? fmtH(s.tst) : '–'], ['침대 시간', s.enough ? fmtH(s.tib) : '–'], ['수면효율', fmtPct(s.se)],
        ['잠들기까지', s.enough ? C.fmtDur(s.sol) : '–'], ['밤중 깸', s.enough ? C.fmtDur(s.waso) : '–'],
        ['아침 졸림', sleepyWord(s.sleepy)], ['낮 기운', scaleWord('energy', s.energy)], ['수면 만족도', scaleWord('satis', s.satis)],
        ['증상 있던 날', s.nSym ? s.symDays + '일' : '–'],
        ['CBT-I 실행률', s.nCbt ? fmtPct(s.cbt) : '–'], ['수면제 평균', s.nDose ? fmtMg(s.dose) : '–'], ['처방 기록', fmtMg(s.rx)],
        ['약 없는 밤', s.nDose ? s.freeNights + '일' : '–'], ['처방대로', s.nPlan ? s.planKept + ' / ' + s.nPlan + '밤' : '–'],
        ['자신감', scaleWord('confidence', s.confidence)], ['약 없인 못 잔다는 믿음', scaleWord('belief', s.belief)]].filter(function (x) { return x[1] !== '–'; }).map(function (x) {
        return '<div><dt>' + x[0] + '</dt><dd>' + x[1] + '</dd></div>';
      }).join('') + '</dl>';
    return '<div class="week-card' + (cur ? ' cur' : '') + '"><div class="wc-head"><b>' + s.week + '주차' + (cur ? ' · 이번 주' : '') + '</b><small>' + fmtShort(s.start) + ' ~ ' + fmtShort(s.end) + '</small>' +
      '<span class="badge">수면 기록 ' + s.nComplete + '/7</span></div>' +
      (s.enough ? '' : '<p class="muted small">완전한 수면 기록이 4일 미만이라 수면 평균을 내지 않았어요.</p>') + g +
      flags.map(function (f) { return '<p class="warn-t small">' + icon('alert') + esc(f) + '</p>'; }).join('') +
      (wk.hard ? '<p class="small"><b>어려웠던 상황</b> ' + esc(wk.hard) + '</p>' : '') +
      (wk.focus && itemByKey(wk.focus) ? '<p class="small"><b>다음 주 집중</b> ' + esc(itemByKey(wk.focus).short) + '</p>' : '') +
      (state.weekNotes[s.week] ? '<p class="small"><b>메모</b> ' + esc(state.weekNotes[s.week]) + '</p>' : '') +
      (wk.step ? '<p class="muted small">예전 기록: 처방 단계 ' + esc({ down: '다음 단계로 줄임', hold: '같은 용량 유지', none: '감량 전' }[wk.step] || wk.step) + '</p>' : '') +
      '<a class="btn small ' + (weeklyAnswered(wk) ? 'ghost' : 'primary') + '" href="#weekly/' + s.week + '">' + (weeklyAnswered(wk) ? '주간 점검 고치기' : '주간 점검 쓰기') + '</a></div>';
  }
  function viewStats() {
    var range = RANGES.indexOf(state.settings.range) >= 0 ? state.settings.range : 4;
    var h = pageHead('분석', '수면 · 복용량 · 증상을 함께 봐요') +
      '<div class="chips">' + RANGES.map(function (n) { return '<button data-act="range" data-v="' + n + '" class="' + (n === range ? 'on' : '') + '">' + n + '주</button>'; }).join('') + '</div>';
    h += weekCompareHtml();
    h += '<section class="block"><h3 class="block-h">수면 회복 추세</h3><div class="card"><h4>실제 수면시간 · 침대에 있던 시간</h4><div id="ch-sleep"></div>' +
      '<h4>수면효율 <small>잔 시간 ÷ 침대 시간</small></h4><div id="ch-se"></div><p class="muted small">실제 수면시간이 유지되거나 늘면서 효율이 오르면 좋은 방향이에요. 효율만 높고 수면시간이 줄면 좋아졌다고 보지 않아요.</p></div></section>' +
      '<section class="block"><h3 class="block-h">수면제 사용 추세</h3><div class="card"><h4>수면제 실제 복용량 · 처방 기록 (mg)</h4><div id="ch-dose"></div>' +
      '<p class="muted small">' + (range === 1 ? '날짜별 실제 복용량이에요.' : '주별 평균이에요. 기록한 날만 평균합니다.') + ' 처방 기록보다 아래라면 처방보다 적게 먹은 것으로 기록된 거예요.</p></div></section>' +
      '<section class="block"><h3 class="block-h">낮 상태 · 실천 추세</h3><div class="card"><h4>아침 졸림</h4><div id="ch-sym"></div><h4>낮 기운</h4><div id="ch-energy"></div><h4>CBT-I 실행률</h4><div id="ch-cbt"></div>' +
      '<p class="muted small">복용량이 줄어도 아침 졸림이 괜찮은지, 실천이 꾸준한지 같이 보세요.</p></div></section>' +
      '<section class="block"><h3 class="block-h">시간대별 졸림</h3><div class="card">' + drowsyBars(range) +
      '<p class="muted small">루틴에서 적은 시간대별 졸림을 모은 거예요. 자주 졸린 시간에 빛 쬐기·산책을 넣고, 눈이 감길 만큼이면 참지 말고 안전하게 쉬어요.</p></div></section>' +
      '<section class="block"><h3 class="block-h">자신감 · 약 없인 못 잔다는 믿음</h3><div class="card"><h4>주간 점검</h4><div id="ch-conf"></div>' +
      '<p class="muted small">' + (range === 1 ? '주간 점검은 주 단위라 4주 이상 범위에서 보여요. ' : '') + '자신감은 오르고 "약 없인 못 잔다"는 믿음은 내려가는 것이 연구에서 성공과 관련된 방향이에요.</p></div></section>';
    var rd = rangeData(range);
    later(function () { ui.redraw = function () { drawStats(rd); }; ui.redraw(); });

    h += '<section class="block"><h3 class="block-h">주간 기록</h3>';
    var cur = Math.max(1, curWeek()), from = Math.max(1, cur - Math.max(range, 1) + 1);
    for (var w = cur; w >= from; w--) h += weekCard(C.weekSummary(state, w));
    h += '</section>';
    return h;
  }
  function drowsyBars(range) {
    var t = today(), dates = C.datesFrom(C.addDays(t, -(range === 1 ? 6 : range * 7 - 1)), t), any = false;
    var rows = D.DROWSY_SLOTS.map(function (sl) {
      var v = dates.map(function (ds) { var c = state.checks[ds]; return c && c.drowsy ? c.drowsy[sl[0]] : null; }).filter(C.isNum);
      var a = v.length ? C.avg(v) : null;
      if (a !== null) any = true;
      return '<div class="bar-row"><span>' + sl[1] + '</span><div class="bar"><i style="width:' + (a === null ? 0 : a / 3 * 100) + '%"></i></div>' +
        '<b>' + (a === null ? '–' : sleepyWord(a)) + '</b><small>' + v.length + '일</small></div>';
    }).join('');
    return any ? rows : '<p class="muted">아직 기록이 없어요. 루틴의 "시간대별 졸림"에 적으면 여기에 모여요.</p>';
  }
  function drawStats(rd) {
    var pts = rd.pts, L = rd.labels;
    var pick = function (k) { return pts.map(function (p) { return p[k]; }); };
    var hMax = niceMax(pick('tib'), 10, 2);
    Charts.line($('#ch-sleep'), {
      title: '수면시간', labels: L,
      series: [{ name: '실제 수면', color: 'var(--s1)', values: pick('tst') }, { name: '침대에 있던 시간', color: 'var(--s2)', dashed: true, values: pick('tib') }],
      yMin: 0, yMax: hMax, ticks: [0, hMax / 2, hMax], fmt: function (v) { return C.fmtDur(v * 60); }
    });
    var seMin = 100;
    pick('se').forEach(function (v) { if (C.isNum(v) && v < seMin) seMin = v; });
    seMin = Math.min(60, Math.floor((seMin - 5) / 10) * 10);
    Charts.line($('#ch-se'), {
      title: '수면효율', labels: L, series: [{ name: '수면효율', color: 'var(--s1)', values: pick('se') }],
      yMin: Math.max(0, seMin), yMax: 100, ticks: [Math.max(0, seMin), 85, 100], fmt: function (v) { return Math.round(v) + '%'; }
    });
    var dMax = niceMax(pts.map(function (p) { return Math.max(p.dose || 0, p.rx || 0); }), 10, 5);
    Charts.line($('#ch-dose'), {
      title: '복용량', labels: L,
      series: [{ name: '실제 복용', color: 'var(--s1)', values: pick('dose') }, { name: '처방 기록', color: 'var(--s2)', dashed: true, values: pick('rx') }],
      yMin: 0, yMax: dMax, ticks: [0, dMax / 2, dMax], fmt: fmtMg
    });
    Charts.line($('#ch-sym'), {
      title: '아침 졸림', labels: L,
      series: [{ name: '아침 졸림', color: 'var(--s1)', values: pick('sleepy') }],
      yMin: 0, yMax: 3, ticks: [0, 1, 2, 3], tickFmt: function (v) { return SLEEPY_WORDS[v]; }, fmt: sleepyWord
    });
    Charts.line($('#ch-energy'), {
      title: '낮 기운', labels: L, series: [{ name: '낮 기운', color: 'var(--s1)', values: pick('energy') }],
      yMin: 0, yMax: 10, ticks: [0, 5, 10], tickFmt: function (v) { return { 0: '처짐', 5: '보통', 10: '좋음' }[v]; },
      fmt: function (v) { return scaleWord('energy', v); }
    });
    Charts.line($('#ch-conf'), {
      title: '자신감과 약 없인 못 잔다는 믿음', labels: L,
      series: [{ name: '자신감', color: 'var(--s1)', values: pick('confidence'), fmt: function (v) { return scaleWord('confidence', v); } },
        { name: '약 없인 못 잔다는 믿음', color: 'var(--s2)', dashed: true, values: pick('belief'), fmt: function (v) { return scaleWord('belief', v); } }],
      yMin: 0, yMax: 10, ticks: [0, 5, 10], tickFmt: function (v) { return { 0: '낮음', 5: '중간', 10: '높음' }[v]; }
    });
    Charts.line($('#ch-cbt'), {
      title: 'CBT-I 실행률', labels: L, series: [{ name: 'CBT-I 실행률', color: 'var(--s1)', values: pick('cbt') }],
      yMin: 0, yMax: 100, ticks: [0, 50, 100], fmt: function (v) { return Math.round(v) + '%'; }
    });
  }

  /* ================= 프로그램 ================= */
  function viewProgram(r) {
    var w = curWeek(), open = +r.a || (w >= 1 && w <= 8 ? w : 0);
    var h = topbar('8주 과정', '감량 + CBT-I, 근거와 함께', '#routine') +
      '<div class="msg info"><div class="msg-title">' + icon('bulb') + '<b>8주는 행동 연습 과정이에요</b></div><p>8주 안에 약을 끊는 것이 목표가 아닙니다. 약을 줄이는 속도는 의료진과 정하고, CBT-I는 매일 함께 연습합니다. 연구에서도 둘을 함께 한 사람들이 가장 많이, 가장 오래 약 없이 지냈어요.</p></div>';
    h += '<section class="block"><h3 class="block-h">주차별 과정</h3>';
    D.PROGRAM.forEach(function (p) {
      var isCur = p.week === w;
      h += '<details class="week' + (isCur ? ' cur' : '') + '" id="wk' + p.week + '"' + (p.week === open ? ' open' : '') + '><summary><span class="wk-n">' + p.week + '주</span><span class="wk-t"><b>' + esc(p.title) + '</b><small>' + esc(p.stage) + '</small></span>' +
        (isCur ? '<span class="badge">이번 주</span>' : '') + '</summary><div class="wk-body"><p class="wk-focus">' + esc(p.focus) + '</p>' +
        '<h4>이번 주 연습</h4><ul>' + p.tasks.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
        '<dl class="routine"><dt>이번 주 확인할 것</dt><dd>' + esc(p.check) + '</dd><dt>감량 원칙</dt><dd>' + esc(p.taper) + '</dd></dl>' +
        '<div class="why"><b>왜 도움이 되나요?</b><p>' + esc(p.why) + '</p></div></div></details>';
    });
    h += '<div class="card soft"><b>9주차 이후</b><p>기록을 멈추지 마세요. 52주 동안 수면·복용량·증상 변화를 이어서 볼 수 있어요. 주 1회 주간 점검에서 계속할 행동을 골라 두세요.</p></div></section>';

    h += '<section class="block"><h3 class="block-h">연구로 보면</h3>' + D.FACTS.map(function (f) {
      return msgCard({ kind: 'fact', title: f.title, body: f.body, note: f.note, src: f.src, url: f.url });
    }).join('') + '</section>';
    h += '<section class="block"><h3 class="block-h">안전 원칙</h3><div class="card"><ul class="rules">' + D.SAFETY.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div></section>';
    h += '<section class="block"><h3 class="block-h">기록 읽는 법</h3><div class="card"><dl class="routine">' + D.INTERPRET.map(function (x) { return '<dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd>'; }).join('') + '</dl></div></section>';
    h += '<section class="block"><h3 class="block-h">참고 논문 · 지침</h3><div class="card"><ul class="refs">' + D.REFERENCES.map(function (x) {
      return '<li><a href="' + esc(x[2]) + '" target="_blank" rel="noopener"><b>' + esc(x[0]) + '</b></a><span>' + esc(x[1]) + '</span></li>';
    }).join('') + '</ul><p class="muted small">이 앱은 일반적인 연구와 지침을 참고한 기록 도구입니다. 진단하거나 감량 일정·용량을 처방하지 않아요.</p></div></section>';
    if (r.a) later(function () {
      var el = $('#wk' + r.a), tb = $('.topbar');
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - (tb ? tb.offsetHeight : 0) - 8);
    });
    return h;
  }

  /* ================= 설정 · 백업 ================= */
  function viewSettings() {
    var s = state.settings, p = state.profile, web = /^https?:$/.test(location.protocol);
    var med = medRec();
    ui.opened = { key: 'settings', settings: clone(s), profile: clone(p), med: clone(med) };
    var h = topbar('설정 · 백업', '', '#home') + '<form class="form" id="f" onsubmit="return false"><section class="card"><h3>8주 과정</h3>' +
      field('8주 과정 시작 날짜', input('date', 'startDate', s.startDate), '바꾸면 주차와 주간 분석이 새 날짜 기준으로 다시 계산돼요.') +
      field('목표 기상 시각', input('time', 'wakeTarget', s.wakeTarget)) +
      field('화면', seg('theme', [['system', '기기 설정 따라'], ['light', '밝게'], ['dark', '어둡게']], s.theme, 'three')) + '</section>' +
      '<section class="card"><h3>내 수면제 <small>기본 처방 · 처방이 바뀌면 "감량" 탭에서 변경 기록</small></h3>' +
      field('수면제 이름 (선택)', input('text', 'medName', med.name === D.MEDS[0].name ? '' : med.name)) +
      field('기본 하루 처방 용량 (mg)', input('number', 'rxMg', med.rxMg, 'step="0.25" min="0" inputmode="decimal"')) + '</section>' +
      '<section class="card"><h3>내 상황 <small>AI 질문 글에 들어가요</small></h3>' +
      field('수면제를 먹기 시작한 때', input('text', 'started', p.started, 'placeholder="예: 2~3년 전"')) +
      field('처음 먹게 된 계기 (선택)', textarea('reason', p.reason, '예: 스트레스로 잠이 안 와서', 2)) +
      field('끊고 싶은 이유', textarea('why', p.why, '', 2)) +
      field('요즘 힘든 점', textarea('struggles', p.struggles, '', 2)) + '</section>' +
      '<button type="button" class="btn primary big wide" data-act="save-settings">설정 저장</button>' +
      '<section class="card"><h3>백업 · 내보내기</h3>' +
      (sync.on ? '<p class="hint">기록은 이 주소에 함께 저장돼요. 이 주소를 아는 사람은 누구나 같은 기록을 보고 고칠 수 있어요. 서버에도 하루 한 번 자동 백업(30일)이 남지만, 가끔 백업 파일을 직접 저장해 두면 더 안전해요.</p>' +
        '<p class="small">상태: <b id="syncStatus">' + esc(sync.status || '확인 중') + '</b></p><div class="btn-col"><button type="button" class="btn" data-act="sync-now">지금 최신 기록 받아오기</button></div><br>' :
        '<p class="hint">기록은 이 기기의 이 브라우저 안에만 저장돼요. 브라우저 기록을 지우거나 기기를 바꾸면 사라질 수 있으니, 가끔 백업 파일을 저장해 두세요.</p>') +
      '<div class="btn-col"><button type="button" class="btn" data-act="export-json">백업 파일 저장 (.json)</button>' +
      '<button type="button" class="btn" data-act="import-json">백업 파일로 복원</button>' +
      '<button type="button" class="btn" data-act="export-csv">엑셀용 표 저장 (.csv)</button></div>' +
      '<p class="muted small">백업 파일에는 수면·복용·증상 같은 민감한 건강 정보가 들어 있어요. 다른 사람과 공유하거나 공용 컴퓨터에 남기지 마세요.</p></section>' +
      '<section class="card"><h3>앱으로 설치</h3>' +
      (installEvt ? '<button type="button" class="btn primary" data-act="install">바탕화면 · 홈 화면에 설치</button>' :
        web ? '<p class="hint">브라우저 메뉴의 "앱 설치" 또는 "홈 화면에 추가"로 설치할 수 있어요.</p>' :
          '<p class="hint">지금은 파일로 열려 있어요. 이대로도 모든 기능을 쓸 수 있어요. 휴대폰 홈 화면에 앱처럼 설치하려면 인터넷 주소(https)로 올려야 합니다.</p>') +
      '</section><section class="card"><h3>안내</h3><p class="small">이 앱은 의료진의 진료를 대신하지 않아요. 감량 일정·용량을 정하거나 바꾸라고 지시하지 않고, 처방된 계획과 실제 복용을 기록·비교하는 도구입니다.</p></section></form>';
    return h;
  }
  function saveSettings() {
    var f = $('#f');
    if (!C.isDate(f.startDate.value)) { toast('시작 날짜를 골라 주세요.'); return; }
    var op = ui.opened && ui.opened.key === 'settings' ? ui.opened : { settings: {}, profile: {} };
    // 이 화면에서 바꾼 칸만 반영 (화면을 연 뒤 다른 기기가 바꾼 칸을 되돌리지 않게)
    var put = function (obj, o, k, v) { if (!eqv(v, o[k])) obj[k] = v; };
    put(state.settings, op.settings, 'startDate', f.startDate.value);
    put(state.settings, op.settings, 'wakeTarget', f.wakeTarget.value);
    put(state.settings, op.settings, 'theme', segVal(f, 'theme') || 'system');
    ['started', 'reason', 'why', 'struggles'].forEach(function (k) { put(state.profile, op.profile, k, f[k].value.trim()); });
    var m = medRec(), om = op.med || {}, mg = numOf(f.rxMg.value), nm = f.medName.value.trim() || D.MEDS[0].name;
    if (mg !== null && mg < 0) { toast('처방 용량은 0 이상으로 적어 주세요.'); return; }
    if (!eqv(mg, om.rxMg)) m.rxMg = mg;
    if (!eqv(nm, om.name)) m.name = nm;
    save();
    render();
    toast('설정을 저장했어요.');
  }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function exportJSON() {
    download('수면회복노트_백업_' + today() + '.json', JSON.stringify({ app: APP_ID, exportedAt: new Date().toISOString(), data: state }, null, 1), 'application/json');
    toast('백업 파일을 저장했어요.');
  }
  function exportCSV() {
    var keys = {};
    [state.diary, state.checks, state.intakes].forEach(function (o) { Object.keys(o).forEach(function (k) { if (C.isDate(k)) keys[k] = 1; }); });
    var dates = Object.keys(keys).sort();
    // 한 줄 = 그날 낮(루틴) + 그날 밤 잠(수면일지, 다음 날 아침까지)
    var head = ['날짜 (그날 낮 + 그날 밤 잠)', '주차', '누운 시각 (그날 밤)', '잠들기까지(분)', '밤중 깬 시간(분)', '마지막 깬 시각 (다음 날 아침)', '침대 나온 시각', '깬 횟수',
      '수면제 복용시각 (그날 밤)', '실제 복용량(mg)', '처방 기록(mg)', '처방보다 더 먹음(때)', '추가 복용량(mg)', '다시 먹은 종류', '다시 먹은 이유',
      '아침 졸림 (다음 날 아침)', '수면 만족도', '몸·마음 증상', '술', '특이사항',
      '침대시간(h)', '실제 수면(h)', '수면효율(%)', '입력 확인']
      .concat(D.CBT_ITEMS.map(function (x) { return 'CBT-I: ' + x.short; }), ['CBT-I 실행률(%)'],
        D.ROUTINE.filter(function (s) { return !s.cbt; }).map(function (s) { return '루틴: ' + s.short; }),
        ['낮잠(분)', '낮잠 시작', '낮잠 이유'], D.DROWSY_SLOTS.map(function (sl) { return '졸림 ' + sl[1]; }),
        ['어지럼·비틀거림', '낮 기운', '루틴 하루 메모', '루틴 단계 메모']);
    // 예전 루틴의 오전 졸림·위험한 졸림 기록이 있을 때만 칸을 붙임
    var oldAm = dates.some(function (ds) { return C.isNum(((state.checks[ds] || {}).drowsy || {}).am); });
    var oldDanger = dates.some(function (ds) { return !!(state.checks[ds] || {}).danger; });
    if (oldAm) head.push('졸림 오전 (예전 기록)');
    if (oldDanger) head.push('위험할 만큼 졸림 (예전 기록)');
    var V = { done: '완료', miss: '미완료', na: '해당없음' }, SYM = {};
    D.SYMPTOMS.forEach(function (x) { SYM[x[0]] = x[1]; });
    var rows = [head];
    dates.forEach(function (ds) {
      var d = state.diary[ds] || {}, c = C.calcNight(state.diary[ds]), z = (state.intakes[ds] || {})[Z] || {}, ck = state.checks[ds] || { items: {} }, nap = ck.nap || {};
      var r = C.cbtRate(ck);
      rows.push([ds, C.weekNoOf(startDate(), ds), d.bed, d.sol, d.waso, d.wake, d.out, d.awakenings,
        z.time, C.isNum(z.mg) ? z.mg : '', C.prescribedOn(state, ds), { no: '없음', bed: '자기 전', night: '밤중', yes: '밤중' }[d.extra], d.extraMg,
        { once: '한 번만', back: '예전처럼' }[d.redoseType], d.redose,
        C.isNum(d.sleepy) ? sleepyWord(d.sleepy) : '', C.isNum(d.satis) ? scaleWord('satis', d.satis) : '',
        Array.isArray(d.symptoms) ? (d.symptoms.length ? d.symptoms.map(function (k) { return SYM[k] || k; }).join(' / ') : '없음') : '',
        { none: '안 마심', some: '조금', much: '많이' }[d.alcohol], d.note,
        c.complete ? (c.tib / 60).toFixed(2) : '', c.complete ? (c.tst / 60).toFixed(2) : '', c.complete ? c.se.toFixed(1) : '',
        state.diary[ds] ? (c.complete ? '기록 완료' : c.error ? '시간 재확인' : '필수 칸 확인') : '']
        .concat(D.CBT_ITEMS.map(function (x) { return V[ck.items && ck.items[x.key]] || ''; }), [r === null ? '' : r.toFixed(0)],
          D.ROUTINE.filter(function (s) { return !s.cbt; }).map(function (s) { return V[(ck.aux || {})[s.key]] || ''; }),
          [nap.did === 'yes' ? nap.min : nap.did === 'no' ? 0 : '', nap.did === 'yes' ? nap.start : '', { habit: '습관', safety: '안전 휴식' }[nap.why]],
          D.DROWSY_SLOTS.map(function (sl) { var v = (ck.drowsy || {})[sl[0]]; return C.isNum(v) ? sleepyWord(v) : ''; }),
          [ck.dizzy === 'yes' ? '있음' : ck.dizzy === 'no' ? '없음' : '', C.isNum(ck.energy) ? scaleWord('energy', ck.energy) : '', ck.note,
            Object.keys(ck.memos || {}).map(function (k) { var st = stepByKey(k); return (st ? st.short : k) + ': ' + ck.memos[k]; }).join(' / ')],
          oldAm ? [C.isNum((ck.drowsy || {}).am) ? sleepyWord(ck.drowsy.am) : ''] : [],
          oldDanger ? [{ yes: '있음', no: '없음' }[ck.danger] || ''] : []));
    });
    var csv = rows.map(function (row) {
      return row.map(function (v) { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',');
    }).join('\r\n');
    download('수면회복노트_기록_' + today() + '.csv', '\ufeff' + csv, 'text/csv;charset=utf-8');
    toast('엑셀에서 열 수 있는 표를 저장했어요.');
  }
  function importJSON(file) {
    var rd = new FileReader();
    rd.onload = function () {
      var obj;
      try { obj = JSON.parse(rd.result); } catch (e) { obj = null; }
      if (!obj || obj.app !== APP_ID || !obj.data || typeof obj.data !== 'object') { modal({ title: '복원할 수 없어요', body: '<p>이 앱에서 저장한 백업 파일이 아니에요.</p>', actions: [{ label: '확인', cls: 'primary' }] }); return; }
      var d = obj.data;
      var info = '수면일지 ' + Object.keys(d.diary || {}).length + '일, 루틴 ' + Object.keys(d.checks || {}).length + '일, 생각 노트 ' + (d.thoughts || []).length + '개';
      confirmBox('백업으로 복원할까요?', '<p>' + esc(info) + '</p><p>' + (sync.on ? '이 주소로 함께 쓰는 모든 기기의 기록이 백업 내용으로 바뀝니다.' : '지금 이 기기에 있는 기록은 모두 백업 내용으로 바뀝니다.') + '</p>', '복원하기', function () {
        state = normalize(d);
        save();
        location.hash = '#home';
        render();
        toast('복원했어요.');
      }, true);
    };
    rd.readAsText(file);
  }

  /* ================= 첫 화면 (처음 한 번) ================= */
  function viewOnboarding() {
    return '<div class="onboard"><img src="icons/icon-192.png" alt="" class="ob-icon"><h1>수면 회복 노트</h1>' +
      '<p class="lead">처방에 따라 수면제를 줄여 가는 동안 잠·복용량·다음 날 몸 상태를 함께 기록하고, CBT-I(불면증 인지행동치료)를 매일 연습하는 앱이에요.</p>' +
      '<div class="card"><h3>이 앱이 하는 일</h3><ul class="rules ok"><li>매일 수면일지와 실제 복용량 기록</li><li>8주 CBT-I 연습과 근거 안내</li><li>수면 · 복용량 · 증상 변화를 함께 분석</li></ul>' +
      '<h3>하지 않는 일</h3><ul class="rules"><li>감량 일정이나 용량을 정하거나 바꾸라고 하지 않아요 — 의료진과 정합니다</li><li>진단하지 않아요</li></ul></div>' +
      '<form class="form" id="f" onsubmit="return false"><div class="card">' +
      field('8주 과정 시작 날짜', input('date', 'startDate', today())) +
      field('목표 기상 시각 (나중에 정해도 돼요)', input('time', 'wakeTarget', '')) +
      field('수면제 이름 (선택)', input('text', 'medName', '', 'placeholder="예: 처방전에 적힌 이름"')) +
      field('현재 하루 처방 용량 (mg, 나중에 적어도 돼요)', input('number', 'rxMg', '', 'step="0.25" min="0" inputmode="decimal"')) +
      '</div><p class="muted small">' + (sync.on ? '기록은 이 주소에 함께 저장돼요. 주소를 아는 사람은 같은 기록을 보고 고칠 수 있어요.' : '기록은 이 기기의 브라우저 안에만 저장돼요.') + '</p>' +
      '<button type="button" class="btn primary big wide" data-act="start">시작하기</button></form></div>';
  }

  /* ================= 창 · 알림 ================= */
  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2800);
  }
  function modal(o) {
    closeModal();
    var w = document.createElement('div');
    w.className = 'modal-wrap';
    w.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><h3>' + esc(o.title) + '</h3><div class="modal-body">' + o.body + '</div><div class="modal-actions"></div></div>';
    var box = $('.modal-actions', w);
    o.actions.forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (a.cls || '');
      b.textContent = a.label;
      b.addEventListener('click', function () { closeModal(); if (a.fn) a.fn(); });
      box.appendChild(b);
    });
    document.body.appendChild(w);
    var last = box.lastChild; if (last) last.focus();
  }
  function closeModal() { $$('.modal-wrap').forEach(function (m) { m.remove(); }); }
  function confirmBox(title, body, okLabel, fn, danger) {
    modal({ title: title, body: body, actions: [{ label: '취소', cls: 'ghost' }, { label: okLabel, cls: danger ? 'danger-fill' : 'primary', fn: fn }] });
  }
  function goBack(fallback) {
    ui.dirty = false;
    if (ui.cameFrom) history.back();
    else location.hash = fallback;
  }
  // 저장 버튼이 있는 화면에서 적은 것이 있는데 나가려 할 때
  var DIRTY_PAGES = ['diary', 'thought', 'rx', 'weekly', 'settings'];
  function askLeave(onLeave) {
    modal({ title: '저장하지 않고 나갈까요?', body: '<p>지금 적은 내용은 아직 저장되지 않았어요.</p>', actions: [
      { label: '계속 쓰기', cls: 'ghost' },
      { label: '그냥 나가기', cls: 'ghost', fn: function () { ui.dirty = false; onLeave(); } },
      { label: '저장', cls: 'primary', fn: function () {
        var b = $('.form-actions .btn.primary') || $('[data-act="save-settings"]'), st = route().name === 'settings';
        if (b) b.click();
        if (st && !ui.dirty) onLeave();  // 설정은 저장해도 그 화면에 머물므로 이어서 나감
      } }
    ] });
  }

  /* ================= 버튼 동작 ================= */
  function del(what, fn) { confirmBox('삭제할까요?', '<p>' + what + '을(를) 지웁니다. 되돌릴 수 없어요.</p>', '삭제', fn, true); }
  var ACT = {
    back: function (b) {
      var fb = b.getAttribute('data-fallback') || '#home';
      if (ui.dirty) askLeave(function () { goBack(fb); }); else goBack(fb);
    },
    start: function () {
      var f = $('#f');
      if (!C.isDate(f.startDate.value)) { toast('시작 날짜를 골라 주세요.'); return; }
      state.settings.startDate = f.startDate.value;
      state.settings.wakeTarget = f.wakeTarget.value;
      var mg0 = numOf(f.rxMg.value), nm0 = f.medName.value.trim();
      if (mg0 !== null && mg0 < 0) { toast('처방 용량은 0 이상으로 적어 주세요.'); return; }
      if (mg0 !== null) medRec().rxMg = mg0;
      if (nm0) medRec().name = nm0;
      save();
      location.hash = '#home';
      render();
    },
    more: function () { ui.logShow += 28; render(); },
    jump: function (b) {
      var v = $('#jumpDate').value;
      var kind = b.getAttribute('data-kind'), y = C.addDays(today(), -1);
      if (!C.isDate(v)) { toast('날짜를 골라 주세요.'); return; }
      if (kind === 'diary' && v > lastNight()) { toast('수면일지는 어젯밤까지 적을 수 있어요.'); return; }
      if (kind === 'check' && v > y) { location.hash = '#routine'; return; }
      location.hash = '#' + (kind === 'check' ? 'routine' : kind) + '/' + v;
    },
    fill: function (b) {
      var inp = $('[name="' + b.getAttribute('data-target') + '"]');
      inp.value = b.getAttribute('data-v');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    },
    'save-diary': saveDiary,
    'del-diary': function (b) {
      var ds = b.getAttribute('data-date');
      del(fmtDate(ds) + ' 수면일지와 수면제 복용 기록', function () {
        delete state.diary[ds]; setDose(ds, null, '');
        if (state.checks[ds]) { D.NIGHT_ITEMS.forEach(function (x) { delete (state.checks[ds].items || {})[x.key]; }); cleanCheck(ds); }
        save(); goBack('#log/diary'); toast('삭제했어요.');
      });
    },
    'save-weekly': saveWeekly,
    'sync-now': function () { setSyncStatus('받아오는 중…'); pull().then(function () { toast(sync.status || '확인했어요.'); }); },
    'copy-prompt': copyPrompt,
    'ask-fill': function (b) {
      var q = $('[name="question"]');
      q.value = b.getAttribute('data-v');
      q.dispatchEvent(new Event('input', { bubbles: true }));
    },
    'rt-memo': function (b) {
      var box = b.nextElementSibling;
      box.hidden = false;
      $('textarea', box).focus();
    },
    'save-thought': saveThought,
    'del-thought': function (b) {
      var id = b.getAttribute('data-id');
      del('이 생각 노트', function () { state.thoughts = state.thoughts.filter(function (t) { return t.id !== id; }); save(); goBack('#log/thought'); toast('삭제했어요.'); });
    },
    'save-rx': saveRx,
    'del-rx': function (b) {
      var id = b.getAttribute('data-id');
      del('이 처방 변경 기록', function () { state.rx = state.rx.filter(function (c) { return c.id !== id; }); save(); goBack('#meds'); toast('삭제했어요.'); });
    },
    range: function (b) { state.settings.range = +b.getAttribute('data-v'); save(); render(); },
    'save-settings': saveSettings,
    'export-json': exportJSON,
    'export-csv': exportCSV,
    'import-json': function () { var i = $('#restoreFile'); i.value = ''; i.click(); },
    install: function () {
      if (!installEvt) return;
      installEvt.prompt();
      installEvt = null;
    }
  };

  document.addEventListener('click', function (e) {
    // 여러 개 고르는 버튼 묶음 ("없음"은 다른 것과 함께 못 고름)
    var mb = e.target.closest('.seg.multi button');
    if (mb) {
      var box = mb.parentNode, isNone = mb.getAttribute('data-v') === 'none', turnOn = !mb.classList.contains('on');
      if (turnOn) $$('button', box).forEach(function (x) {
        if ((x.getAttribute('data-v') === 'none') !== isNone) { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); }
      });
      mb.classList.toggle('on', turnOn);
      mb.setAttribute('aria-pressed', String(turnOn));
      box.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    // 하나만 고르는 버튼 묶음
    var sb = e.target.closest('.seg button');
    if (sb) {
      var sg = sb.parentNode, was = sb.classList.contains('on');
      $$('button', sg).forEach(function (x) { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); });
      if (!was) { sb.classList.add('on'); sb.setAttribute('aria-pressed', 'true'); }
      sg.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    // +/− 버튼
    var st = e.target.closest('[data-step]');
    if (st) {
      var inp = $('input', st.parentNode), step = +st.getAttribute('data-step'), v = numOf(inp.value);
      inp.value = v === null ? (step > 0 ? step : 0) : Math.max(0, v + step);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    var a = e.target.closest('[data-act]');
    if (a && ACT[a.getAttribute('data-act')]) { e.preventDefault(); ACT[a.getAttribute('data-act')](a, e); return; }
    // 적던 것을 저장하지 않고 다른 화면(아래 탭 등)으로 가려 할 때
    var ln = e.target.closest('a[href^="#"]');
    if (ln && ui.dirty) { e.preventDefault(); askLeave(function () { location.hash = ln.getAttribute('href'); }); }
  });
  function markDirty(e) {
    if (DIRTY_PAGES.indexOf(route().name) >= 0 && e.target.id !== 'restoreFile' && e.target.closest && e.target.closest('#f')) ui.dirty = true;
  }
  document.addEventListener('input', markDirty);
  document.addEventListener('change', markDirty);

  // 바로 저장되는 입력: 루틴 버튼·메모, 백업 복원 파일
  document.addEventListener('change', function (e) {
    var t = e.target;
    var sg = t.closest && t.closest('[data-seg]');
    if (sg && /^(rt|napdid|napwhy|drowsy|rtdizzy|rtenergy)\|/.test(sg.getAttribute('data-seg'))) { routineSeg(sg); return; }
    if (t.hasAttribute && (t.hasAttribute('data-rtmemo') || t.hasAttribute('data-rtnote'))) {
      var memo = t.hasAttribute('data-rtmemo'), q = (memo ? t.getAttribute('data-rtmemo') : '|' + t.getAttribute('data-rtnote')).split('|');
      var ck = ensureCheck(q[1]);
      if (memo) { ck.memos = ck.memos || {}; setOrDel(ck.memos, q[0], t.value.trim()); } else setOrDel(ck, 'note', t.value.trim());
      cleanCheck(q[1]); save(); toast('메모를 저장했어요.');
      return;
    }
    if (t.id === 'restoreFile' && t.files && t.files[0]) importJSON(t.files[0]);
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t.hasAttribute || !t.hasAttribute('data-nap')) return;
    var q = t.getAttribute('data-nap').split('|'), ck = ensureCheck(q[1]);
    ck.nap = ck.nap || {};
    setOrDel(ck.nap, q[0], q[0] === 'min' ? numOf(t.value) : t.value);
    setOrDel(ck.items, 'nap', napItem(ck.nap));
    cleanCheck(q[1]); save(); routineRefresh(q[1]);
  });

  /* ================= 화면 전환 ================= */
  var VIEWS = { home: viewHome, log: viewLog, meds: viewMeds, stats: viewStats, program: viewProgram, settings: viewSettings,
    diary: viewDiary, routine: viewRoutine, thought: viewThought, rx: viewRx, weekly: viewWeekly, ask: viewAsk };
  var TAB = { home: 'home', settings: 'home', log: 'log', diary: 'log', routine: 'routine', thought: 'log', meds: 'meds', rx: 'meds', stats: 'stats', weekly: 'stats', ask: 'home', program: 'routine' };
  function route() {
    var p = location.hash.replace(/^#\/?/, '').split('/');
    return { name: VIEWS[p[0]] ? p[0] : 'home', a: decodeURIComponent(p[1] || '') };
  }
  var lastHash = null;
  function render() {
    var s = state.settings;
    if (s.theme === 'light' || s.theme === 'dark') document.documentElement.setAttribute('data-theme', s.theme);
    else document.documentElement.removeAttribute('data-theme');
    pending = [];
    ui.redraw = null;
    if (!s.startDate) {
      nav.hidden = true;
      main.innerHTML = sync.on && !sync.loaded ? '<div class="empty">기록을 불러오는 중이에요…</div>' :
        sync.on && sync.offline && !sync.base ? '<div class="empty"><p>함께 쓰는 기록을 아직 못 받았어요.<br>인터넷에 연결한 뒤 눌러 주세요.</p><button class="btn primary" data-act="sync-now">다시 받아오기</button></div>' :
        viewOnboarding();
      return;
    }
    sync.pendingRender = false;
    ui.dirty = false;
    var r = route();
    nav.hidden = false;
    main.innerHTML = VIEWS[r.name](r);
    // 지난 날 루틴은 기록 목록에서 들어오는 화면이라 아래 탭도 '기록'
    var tb = r.name === 'routine' && C.isDate(r.a) && r.a < today() ? 'log' : TAB[r.name];
    $$('a', nav).forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-tab') === tb); });
    document.body.classList.toggle('formpage', ['diary', 'thought', 'rx', 'weekly', 'ask', 'settings'].indexOf(r.name) >= 0);
    if (location.hash !== lastHash) { window.scrollTo(0, 0); lastHash = location.hash; }
    var p = pending; pending = [];
    p.forEach(function (fn) { fn(); });
  }
  window.addEventListener('hashchange', function (e) {
    var from = (e.oldURL || '').split('#')[1] || '';
    // 기기 '뒤로'로 적던 화면을 떠나면: 한 번 되돌아와서 저장할지 물어봄 (적은 값은 화면에 그대로)
    if (ui.hold) { ui.hold = false; lastHash = location.hash; askLeave(function () { history.back(); }); return; }
    if (ui.dirty && from && location.hash.replace(/^#/, '') === ui.cameFrom) { ui.hold = true; history.forward(); return; }
    ui.cameFrom = from && from !== (location.hash.slice(1)) ? from : '';
    if (route().name !== 'log') ui.logShow = 21;
    render();
  });
  // 다른 창(탭)에서 저장하면 이 창의 기록도 바꿈 (먼저 열어 둔 창이 나중에 저장하며 덮어쓰지 않게)
  window.addEventListener('storage', function (e) {
    try {
      if (e.key === KEY && e.newValue) {
        state = normalize(JSON.parse(e.newValue));
        if (ui.dirty) sync.pendingRender = true; else render();
      } else if (e.key === SYNC_KEY && e.newValue) {
        var m = JSON.parse(e.newValue); sync.version = m.version || 0; sync.base = m.base || null;
      }
    } catch (err) { /* 읽지 못하면 그대로 */ }
  });
  // 가로 폭이 바뀔 때만 그래프를 다시 그림 (휴대폰 자판이 올라올 때는 그대로)
  var resizeTimer, lastW = window.innerWidth;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth;
      if (ui.redraw) ui.redraw();
    }, 250);
  });
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; if (route().name === 'settings') render(); });

  // 웹 주소로 열렸을 때만 PWA 기능 켜기 (파일로 열면 그냥 웹페이지로 동작)
  if (/^https?:$/.test(location.protocol)) {
    var ln = document.createElement('link');
    ln.rel = 'manifest'; ln.href = 'manifest.webmanifest';
    document.head.appendChild(ln);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
  }

  render();
  if (sync.on) {
    pull();
    setInterval(function () { if (document.visibilityState === 'visible') pull(); }, 60000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') pull(); });
    window.addEventListener('online', function () { pull(); });
  }
})();
