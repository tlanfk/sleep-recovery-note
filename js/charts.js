/* 수면 회복 노트 — 간단한 SVG 선 그래프 (외부 라이브러리 없음, 오프라인 동작) */
var Charts = (function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  /*
    opts = {
      labels: ['1주', ...],               x축 이름 (툴팁에도 사용)
      series: [{ name, color: 'var(--s1)', values: [..], dashed }],
      yMin, yMax, ticks: [..],            y축 범위·눈금
      fmt: function (v) → 툴팁 값 글자
    }
  */
  function line(box, opts) {
    box.innerHTML = '';
    box.classList.add('chart');
    var W = Math.max(280, box.clientWidth || 320), H = 170;
    var L = 34, R = 10, T = 10, B = 24;
    var n = opts.labels.length;
    var any = opts.series.some(function (s) { return s.values.some(isNum); });

    // 범례 (2개 이상일 때)
    if (opts.series.length > 1) {
      var lg = document.createElement('div');
      lg.className = 'legend';
      opts.series.forEach(function (s) {
        var item = document.createElement('span');
        item.className = 'legend-item';
        item.innerHTML = '<svg width="22" height="10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" style="stroke:' + s.color + '" stroke-width="2.5" stroke-linecap="round"' + (s.dashed ? ' stroke-dasharray="4 4"' : '') + '/></svg>';
        item.appendChild(document.createTextNode(s.name));
        lg.appendChild(item);
      });
      box.appendChild(lg);
    }

    var svg = el('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': opts.title || '그래프' });
    box.appendChild(svg);

    if (!any) {
      var t = el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'chart-empty' }, svg);
      t.textContent = '아직 그릴 기록이 없어요';
      return;
    }

    var yMin = opts.yMin, yMax = opts.yMax;
    var x = function (i) { return n === 1 ? L + (W - L - R) / 2 : L + i * (W - L - R) / (n - 1); };
    var y = function (v) { return T + (1 - (v - yMin) / (yMax - yMin)) * (H - T - B); };

    // 눈금선 (흐리게)
    (opts.ticks || [yMin, yMax]).forEach(function (v) {
      el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'chart-grid' }, svg);
      var tx = el('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'chart-axis' }, svg);
      tx.textContent = opts.tickFmt ? opts.tickFmt(v) : v;
    });
    // x축 이름 (겹치지 않게 일부만)
    var step = Math.max(1, Math.ceil(n / 6));
    for (var i = 0; i < n; i++) {
      if (i % step !== 0 && i !== n - 1) continue;
      if (i !== n - 1 && n - 1 - i < step && i !== 0) continue;
      var lx = el('text', { x: x(i), y: H - 6, 'text-anchor': i === 0 && n > 1 ? 'start' : (i === n - 1 && n > 1 ? 'end' : 'middle'), class: 'chart-axis' }, svg);
      lx.textContent = opts.labels[i];
    }

    // 선 (빈 값에서 끊김, 0으로 채우지 않음)
    var showDots = n <= 14;
    opts.series.forEach(function (s) {
      var d = '', pen = false;
      s.values.forEach(function (v, i) {
        if (!isNum(v)) { pen = false; return; }
        d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
        pen = true;
      });
      if (d) el('path', { d: d, fill: 'none', style: 'stroke:' + s.color, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': s.dashed ? '5 5' : 'none' }, svg);
      s.values.forEach(function (v, i) {
        if (!isNum(v)) return;
        var lonely = !isNum(s.values[i - 1]) && !isNum(s.values[i + 1]);
        if (showDots || lonely) el('circle', { cx: x(i), cy: y(v), r: 4, style: 'fill:' + s.color, class: 'chart-dot' }, svg);
      });
    });

    // 짚어 보기: 세로선 + 값 상자
    var cross = el('line', { y1: T, y2: H - B, class: 'chart-cross', visibility: 'hidden' }, svg);
    var tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    box.appendChild(tip);
    var hit = el('rect', { x: L - 8, y: 0, width: W - L - R + 16, height: H, fill: 'transparent' }, svg);
    function show(evt) {
      var r = svg.getBoundingClientRect();
      var px = (evt.clientX - r.left) * (W / r.width);
      var i = n === 1 ? 0 : Math.round((px - L) / ((W - L - R) / (n - 1)));
      i = Math.max(0, Math.min(n - 1, i));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
      cross.setAttribute('visibility', 'visible');
      var html = '<b>' + opts.labels[i] + '</b>';
      opts.series.forEach(function (s) {
        var v = s.values[i];
        html += '<div><i style="background:' + s.color + '"></i>' + s.name + ' <b>' + (isNum(v) ? (s.fmt || opts.fmt)(v) : '기록 없음') + '</b></div>';
      });
      tip.innerHTML = html;
      tip.hidden = false;
      var left = x(i) * (r.width / W);
      var tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(r.width - tw, left - tw / 2)) + 'px';
      var lg = box.querySelector('.legend');
      tip.style.top = (lg ? lg.offsetHeight + 6 : 2) + 'px';
    }
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', function (e) {
      if (e.pointerType === 'mouse') { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); }
    });
  }

  return { line: line };
})();
