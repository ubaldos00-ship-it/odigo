/* 어디고 v4.1 — 경로 고르기(고속도로 우선·최단거리·무료도로, Valhalla 공개 서버 · 실패하면 OSRM) + 음성 안내(휴대폰 내장 한국어 음성)
   어디고 v4.0 — 어디고 지도 안 길찾기 (사용자 요청 2026-11-09: 「네비게이션 보면서 전체 핀을 보고 싶다」)
   · 출발(현재 위치·지도에서 고르기·내 조사구) → 도착(조사구·지도에서 고르기·현재 위치) → 자동차 경로 선·거리·예상 시간·갈림길 안내
   · 경로 계산: OSRM 공개 경로 서버(router.project-osrm.org, 키 없음, OpenStreetMap 도로 기준)
     ※ 실시간 교통·통행료·단속 정보는 반영되지 않음 → 운전 중 정확한 안내는 카카오맵·네이버지도·T맵을 함께 쓰도록 안내
     ※ 공개 서버라 요청을 아껴 씀: 경로를 벗어났을 때만 다시 계산(30초에 한 번까지)
   · 안내 중에도 조사구 핀은 모두 그대로 보임 (경로 선은 핀 아래) */
(function () {
  'use strict';
  var OSRM = 'https://router.project-osrm.org/route/v1/driving/';
  var VALHALLA = 'https://valhalla1.openstreetmap.de/route';
  var MODES = [
    { id: 'hw', name: '고속도로 우선', opt: { use_highways: 1, use_tolls: 1 } },
    { id: 'short', name: '최단거리', opt: { shortest: true } },
    { id: 'free', name: '무료도로', opt: { use_tolls: 0, use_highways: 0.5 } }
  ];
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function A() { return window.OdigoApp; }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function distM(a1, o1, a2, o2) { var R = 6371000, dA = (a2 - a1) * Math.PI / 180, dO = (o2 - o1) * Math.PI / 180, x = Math.sin(dA / 2) * Math.sin(dA / 2) + Math.cos(a1 * Math.PI / 180) * Math.cos(a2 * Math.PI / 180) * Math.sin(dO / 2) * Math.sin(dO / 2); return 2 * R * Math.asin(Math.min(1, Math.sqrt(x))); }
  function fmtD(m) { return m < 1000 ? Math.round(m / 10) * 10 + 'm' : (m / 1000).toFixed(m < 10000 ? 1 : 0) + 'km'; }
  function fmtT(s) { var m = Math.round(s / 60); return m < 60 ? m + '분' : Math.floor(m / 60) + '시간 ' + (m % 60) + '분'; }

  var st = { start: null, end: null, route: null, steps: [], idx: 0, guiding: false, watch: null, lastReroute: 0, markers: [],
    mode: lsGet('odigo_navMode', 'hw'), alt: {}, voice: lsGet('odigo_navVoice', '1') === '1', said: {} };
  function modeOf(id) { return MODES.filter(function (m) { return m.id === id; })[0] || MODES[0]; }

  /* ───── 음성 안내 (Web Speech · 한국어) ───── */
  function koVoice() {
    if (!window.speechSynthesis) return null;
    var vs = speechSynthesis.getVoices() || [];
    return vs.filter(function (v) { return /^ko/i.test(v.lang); })[0] || null;
  }
  function say(txt, force) {
    if (!txt || !window.speechSynthesis || (!st.voice && !force)) return;
    try {
      var u = new SpeechSynthesisUtterance(txt.replace(/[「」]/g, ''));
      u.lang = 'ko-KR'; u.rate = 1.05; var v = koVoice(); if (v) u.voice = v;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch (e) {}
  }
  function sayDist(m) { return m >= 1000 ? (Math.round(m / 100) / 10) + '킬로미터' : (m < 200 ? Math.max(10, Math.round(m / 10) * 10) : Math.round(m / 50) * 50) + '미터'; }

  /* ───── 갈림길 안내 문장 ───── */
  var MOD = { left: ['좌회전', '↰'], right: ['우회전', '↱'], 'slight left': ['왼쪽 방향', '↖'], 'slight right': ['오른쪽 방향', '↗'], 'sharp left': ['급좌회전', '↰'], 'sharp right': ['급우회전', '↱'], straight: ['직진', '↑'], uturn: ['유턴', '↶'] };
  function osrmText(s) {
    var m = s.maneuver || {}, t = m.type, md = MOD[m.modifier] || ['', '↑'], road = s.name ? '「' + s.name + '」' : '';
    if (t === 'depart') return ['출발' + (road ? ' · ' + road + ' 방향' : ''), '🚗'];
    if (t === 'arrive') return ['목적지 도착', '🏁'];
    if (t === 'roundabout' || t === 'rotary') return ['회전교차로에서 ' + (m.exit ? m.exit + '번째 출구' : '나가기') + (road ? ' → ' + road : ''), '⟳'];
    if (t === 'merge') return [(road || '도로') + '로 합류', md[1]];
    if (t === 'on ramp') return [(road || '') + ' 진입로로 ' + (md[0] || '진입'), md[1]];
    if (t === 'off ramp') return [(md[0] || '') + ' 출구로 나가기' + (road ? ' → ' + road : ''), md[1]];
    if (t === 'fork') return ['갈림길에서 ' + (md[0] || '진행') + (road ? ' → ' + road : ''), md[1]];
    if (t === 'end of road') return ['길 끝에서 ' + (md[0] || '진행') + (road ? ' → ' + road : ''), md[1]];
    if (t === 'continue' || t === 'new name') return [(road ? road + ' 따라 ' : '') + (md[0] && md[0] !== '직진' ? md[0] : '직진'), md[1]];
    return [(md[0] || '진행') + (road ? ' → ' + road : ''), md[1]];
  }

  /* ───── 지점 고르기 ───── */
  function ptHtml(p) { return p ? esc(p.name) + (p.cur ? ' <small class="muted">(GPS ±' + Math.round(p.acc || 0) + 'm)</small>' : '') : '<span class="muted">고르세요</span>'; }
  function myPos() {
    return new Promise(function (res) {
      if (!navigator.geolocation) { res(null); return; }
      navigator.geolocation.getCurrentPosition(function (p) { res({ name: '현재 위치', lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, cur: true }); },
        function () { res(null); }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 });
    });
  }
  function pickOnMap(which) {
    var map = A().map;
    A().toast((which === 'start' ? '출발' : '도착') + ' 위치를 지도에서 누르세요');
    if (!$('sheet').hidden && !$('sheet').classList.contains('min')) $('sheetMin').click();
    map.once('click', function (e) {
      var p = { name: '지도에서 고른 위치', lat: +e.lngLat.lat.toFixed(6), lng: +e.lngLat.lng.toFixed(6) };
      st[which] = p; open();
      A().reverseGeocode(p.lat, p.lng).then(function (a) { if (a && st[which] === p) { p.name = a; open(); } });
    });
  }
  function pickSite(which) {
    var list = A().data.sites().filter(function (s) { return isFinite(s.lat); });
    var body = A().openSheet((which === 'start' ? '출발' : '도착') + ' · 내 조사구에서 고르기',
      '<input class="inp" id="nvQ" placeholder="이름·주소·조사구 검색">' + '<div id="nvList"></div>');
    function draw() {
      var q = body.querySelector('#nvQ').value.trim().toLowerCase();
      var hit = list.filter(function (s) { return !q || (A().dispName(s) + ' ' + (s.addr || '') + ' ' + (s.josaguNo || '')).toLowerCase().indexOf(q) >= 0; }).slice(0, 60);
      body.querySelector('#nvList').innerHTML = hit.map(function (s) { return '<button type="button" class="sr-item" data-id="' + s.id + '"><b>' + esc(A().dispName(s)) + '</b><span>' + esc(s.addr || '') + '</span></button>'; }).join('') || '<p class="muted">없습니다.</p>';
      body.querySelectorAll('[data-id]').forEach(function (b) {
        b.addEventListener('click', function () { var s = list.filter(function (x) { return x.id === b.getAttribute('data-id'); })[0]; st[which] = { name: A().dispName(s), lat: s.lat, lng: s.lng }; open(); });
      });
    }
    body.querySelector('#nvQ').addEventListener('input', draw); draw();
  }

  /* ───── 길찾기 창 ───── */
  function open(o) {
    o = o || {};
    if (o.end && o.end !== st.end) { st.end = o.end; st.alt = {}; }
    if (o.start) st.start = o.start;
    var html = '<div class="nv-pick"><b>🟢 출발</b><div class="val">' + ptHtml(st.start) + '</div><span></span></div>' +
      '<div class="row" style="margin-top:0"><button class="btn sm" data-p="start:cur">◎ 현재 위치</button><button class="btn sm" data-p="start:map">지도에서</button><button class="btn sm" data-p="start:site">내 조사구</button></div>' +
      '<div class="nv-pick"><b>🔴 도착</b><div class="val">' + ptHtml(st.end) + '</div><button class="btn sm" id="nvSwap" title="출발·도착 바꾸기">⇅</button></div>' +
      '<div class="row" style="margin-top:0"><button class="btn sm" data-p="end:site">내 조사구</button><button class="btn sm" data-p="end:map">지도에서</button><button class="btn sm" data-p="end:cur">◎ 현재 위치</button></div>' +
      '<label class="fld">경로 고르기</label><div class="nv-modes">' + MODES.map(function (m) {
        var a = st.alt[m.id];
        return '<button type="button" class="nv-mode' + (st.mode === m.id ? ' on' : '') + '" data-mode="' + m.id + '"><b>' + m.name + '</b><small>' + (a ? fmtD(a.distance) + ' · ' + fmtT(a.duration) : (st.start && st.end ? '…' : '')) + '</small></button>';
      }).join('') + '</div>' +
      '<div class="row"><button class="btn primary" id="nvGo" style="flex:1"' + (st.start && st.end ? '' : ' disabled') + '>🧭 경로 보기</button>' + (st.route ? '<button class="btn" id="nvClear">경로 지우기</button>' : '') + '</div>' +
      '<div id="nvOut">' + (st.route ? summaryHtml() : '') + '</div>' +
      '<p class="muted">경로는 OpenStreetMap 도로 자료로 계산합니다(Valhalla·OSRM 공개 서버). <b>실시간 교통·단속 정보는 반영되지 않습니다</b>. 운전 중에는 카카오맵·네이버지도·T맵 안내도 함께 확인하세요.</p>';
    var body = A().openSheet('🧭 어디고 길찾기', html);
    body.querySelectorAll('[data-p]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-p').split(':'), which = k[0];
        st.alt = {};
        if (k[1] === 'map') pickOnMap(which);
        else if (k[1] === 'site') pickSite(which);
        else { A().toast('현재 위치를 확인하는 중…'); myPos().then(function (p) { if (!p) { A().toast('현재 위치를 확인하지 못했습니다 (위치 권한 확인)'); return; } st[which] = p; open(); }); }
      });
    });
    body.querySelectorAll('[data-mode]').forEach(function (b) {
      b.addEventListener('click', function () {
        st.mode = b.getAttribute('data-mode'); lsSet('odigo_navMode', st.mode);
        if (st.alt[st.mode]) { useRoute(st.alt[st.mode]); open(); }
        else if (st.start && st.end) go(); else open();
      });
    });
    body.querySelector('#nvSwap').addEventListener('click', function () { var t = st.start; st.start = st.end; st.end = t; st.alt = {}; open(); });
    body.querySelector('#nvGo').addEventListener('click', go);
    var cl = body.querySelector('#nvClear'); if (cl) cl.addEventListener('click', function () { stop(); clearRoute(); open(); });
    bindSummary(body);
    if (!st.start && !o.noAuto) myPos().then(function (p) { if (p && !st.start) { st.start = p; open({ noAuto: true }); } });
  }
  /* 고른 경로 먼저 계산 → 나머지 경로도 차례로 계산해 거리·시간 비교 표시 */
  function go() {
    var a = st.start, b = st.end, me = st.mode;
    route(a, b, me).then(function (r) {
      if (!r) return;
      st.alt[me] = r; useRoute(r); fitRoute(); open();
      var rest = MODES.filter(function (m) { return m.id !== me && !st.alt[m.id]; }), k = 0;
      (function next() {
        if (k >= rest.length || st.start !== a || st.end !== b) return;
        var m = rest[k++];
        setTimeout(function () {
          route(a, b, m.id, true).then(function (r2) {
            if (r2 && st.start === a && st.end === b) { st.alt[m.id] = r2; var bt = document.querySelector('.nv-mode[data-mode="' + m.id + '"] small'); if (bt) bt.textContent = fmtD(r2.distance) + ' · ' + fmtT(r2.duration); }
            next();
          });
        }, 700);
      })();
    });
  }
  function summaryHtml() {
    var r = st.route;
    return '<div class="gift-sum">🚗 <b>' + esc(modeOf(r.mode).name) + '</b> · <b>' + fmtD(r.distance) + '</b> · 약 <b>' + fmtT(r.duration) + '</b> <small class="muted">(교통 상황 미반영' + (r.src === 'osrm' ? ' · 보조 서버(빠른 길)' : '') + ')</small></div>' +
      '<div class="row"><button class="btn primary" id="nvStart" style="flex:1">▶ 안내 시작 (핀 함께 보기)</button><button class="btn" id="nvFit">경로 전체 보기</button></div>' +
      '<label class="chk-all"><input type="checkbox" id="nvVoice"' + (st.voice ? ' checked' : '') + '> 🔊 음성 안내</label>' +
      '<details><summary class="muted">갈림길 ' + st.steps.length + '곳 보기</summary><div class="nv-steps">' + st.steps.map(function (s) { return '<div>' + s.icon + ' ' + esc(s.text) + ' <small class="muted">' + fmtD(s.distance) + '</small></div>'; }).join('') + '</div></details>' +
      '<div class="row"><button class="btn sm" data-ext="k">카카오맵으로</button><button class="btn sm" data-ext="n">네이버지도로</button><button class="btn sm" data-ext="t">T맵으로</button></div>';
  }
  function bindSummary(body) {
    var sb = body.querySelector('#nvStart'); if (sb) sb.addEventListener('click', startGuide);
    var fb = body.querySelector('#nvFit'); if (fb) fb.addEventListener('click', fitRoute);
    var vb = body.querySelector('#nvVoice'); if (vb) vb.addEventListener('change', function () { setVoice(vb.checked); });
    body.querySelectorAll('[data-ext]').forEach(function (b) {
      b.addEventListener('click', function () {
        var e = st.end, n = encodeURIComponent(e.name || '목적지'), k = b.getAttribute('data-ext');
        var apps = { n: ['nmap://route/car?dlat=' + e.lat + '&dlng=' + e.lng + '&dname=' + n + '&appname=odigo', 'https://map.naver.com/p/search/' + n],
          k: ['kakaomap://route?ep=' + e.lat + ',' + e.lng + '&by=CAR', 'https://map.kakao.com/link/to/' + n + ',' + e.lat + ',' + e.lng],
          t: ['tmap://route?goalname=' + n + '&goalx=' + e.lng + '&goaly=' + e.lat, 'https://tmap.life/route?goalx=' + e.lng + '&goaly=' + e.lat] }[k];
        A().openAppOrWeb(apps[0], apps[1]);
      });
    });
  }
  function setVoice(on) {
    st.voice = !!on; lsSet('odigo_navVoice', on ? '1' : '0');
    if (on) say('음성 안내를 켰습니다', true); else if (window.speechSynthesis) speechSynthesis.cancel();
  }

  /* ───── 경로 계산 (Valhalla → 실패하면 OSRM) ───── */
  function decode6(str) {
    var i = 0, la = 0, lo = 0, out = [];
    while (i < str.length) {
      var b, sh = 0, r = 0; do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32); la += (r & 1) ? ~(r >> 1) : (r >> 1);
      sh = 0; r = 0; do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32); lo += (r & 1) ? ~(r >> 1) : (r >> 1);
      out.push([lo / 1e6, la / 1e6]);
    }
    return out;
  }
  var VICON = { 1: '🚗', 2: '🚗', 3: '🚗', 4: '🏁', 5: '🏁', 6: '🏁', 9: '↗', 10: '↱', 11: '↱', 12: '↶', 13: '↶', 14: '↰', 15: '↰', 16: '↖', 18: '↗', 19: '↖', 20: '↗', 21: '↖', 23: '↗', 24: '↖', 26: '⟳', 27: '⟳', 37: '↗', 38: '↖' };
  function valhalla(a, b, mode) {
    var q = { locations: [{ lat: +a.lat.toFixed(6), lon: +a.lng.toFixed(6) }, { lat: +b.lat.toFixed(6), lon: +b.lng.toFixed(6) }],
      costing: 'auto', costing_options: { auto: modeOf(mode).opt }, language: 'ko-KR', units: 'kilometers' };
    return fetch(VALHALLA + '?json=' + encodeURIComponent(JSON.stringify(q))).then(function (r) { return r.json(); }).then(function (d) {
      var leg = d && d.trip && d.trip.legs && d.trip.legs[0]; if (!leg) return null;
      var c = decode6(leg.shape);
      return { src: 'valhalla', mode: mode, distance: d.trip.summary.length * 1000, duration: d.trip.summary.time, coords: c,
        steps: leg.maneuvers.map(function (m) {
          var v = m.verbal_pre_transition_instruction || m.instruction || '';
          if (/[A-Za-z]{3}/.test(v)) v = m.instruction || '';
          return { text: m.instruction || '', voice: v.trim(), icon: VICON[m.type] || '↑', distance: (m.length || 0) * 1000, loc: c[Math.min(m.begin_shape_index || 0, c.length - 1)] };
        }) };
    });
  }
  function osrm(a, b, mode) {
    var url = OSRM + a.lng.toFixed(6) + ',' + a.lat.toFixed(6) + ';' + b.lng.toFixed(6) + ',' + b.lat.toFixed(6) + '?overview=full&geometries=geojson&steps=true';
    return fetch(url).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || d.code !== 'Ok' || !d.routes || !d.routes[0]) return null;
      var r = d.routes[0];
      return { src: 'osrm', mode: mode, distance: r.distance, duration: r.duration, coords: r.geometry.coordinates,
        steps: (r.legs[0] && r.legs[0].steps || []).filter(function (s) { return s.maneuver; }).map(function (s) { var t = osrmText(s); return { text: t[0], voice: t[0], icon: t[1], distance: s.distance, loc: s.maneuver.location }; }) };
    });
  }
  function route(a, b, mode, quiet) {
    if (!a || !b) return Promise.resolve(null);
    if (!quiet) A().toast('경로를 계산하는 중…');
    return valhalla(a, b, mode).catch(function () { return null; }).then(function (r) {
      return r || osrm(a, b, mode).catch(function () { return null; });
    }).then(function (r) {
      if (!r && !quiet) A().toast('경로를 찾지 못했습니다 (인터넷 확인, 도로에서 너무 먼 위치일 수 있습니다)');
      return r;
    });
  }
  function useRoute(r) {
    st.route = r; st.steps = r.steps; st.idx = 1; st.said = {};
    draw();
  }
  function draw() {
    var map = A().map, data = { type: 'Feature', geometry: { type: 'LineString', coordinates: st.route.coords } };
    if (map.getSource('nv-route')) map.getSource('nv-route').setData(data);
    else {
      map.addSource('nv-route', { type: 'geojson', data: data });
      map.addLayer({ id: 'nv-route-case', type: 'line', source: 'nv-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 6, 16, 13] } });
      map.addLayer({ id: 'nv-route', type: 'line', source: 'nv-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1c7ed6', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3.5, 16, 8] } });
    }
    st.markers.forEach(function (m) { m.remove(); }); st.markers = [];
    [['s', '출', st.start], ['e', '도', st.end]].forEach(function (x) {
      if (!x[2]) return;
      var el = document.createElement('div'); el.className = 'nv-flag ' + x[0]; el.textContent = x[1];
      st.markers.push(new maplibregl.Marker({ element: el }).setLngLat([x[2].lng, x[2].lat]).addTo(map));
    });
  }
  function clearRoute() {
    var map = A().map;
    ['nv-route', 'nv-route-case'].forEach(function (id) { if (map.getLayer(id)) map.removeLayer(id); });
    if (map.getSource('nv-route')) map.removeSource('nv-route');
    st.markers.forEach(function (m) { m.remove(); }); st.markers = [];
    st.route = null; st.steps = []; st.alt = {};
  }
  function fitRoute() {
    if (!st.route) return;
    var b = new maplibregl.LngLatBounds(); st.route.coords.forEach(function (c) { b.extend(c); });
    var sh = document.getElementById('sheet').hidden ? 0 : document.getElementById('sheet').getBoundingClientRect().height;
    A().map.fitBounds(b, { padding: { top: st.guiding ? 140 : 80, left: 40, right: 70, bottom: Math.min(window.innerHeight - 220, sh + 40) }, maxZoom: 16, duration: 600 });
  }

  /* ───── 안내 (위쪽 막대 + 음성) ───── */
  function startGuide() {
    if (!st.route) return;
    st.guiding = true; st.idx = 1; st.said = {};
    A().closeSheet();
    if (!$('btnLocate').classList.contains('on')) $('btnLocate').click();   /* 내 위치 표시·따라가기 */
    if (st.watch == null && navigator.geolocation) st.watch = navigator.geolocation.watchPosition(onPos, function () {}, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
    bar(null);
    /* 휴대폰은 버튼을 누른 순간에 처음 말해야 음성이 열림 */
    var s1 = st.steps[1];
    say('경로 안내를 시작합니다. ' + modeOf(st.route.mode).name + ', ' + sayDist(st.route.distance) + '.' + (s1 ? ' ' + sayDist(st.steps[0].distance) + ' 앞, ' + s1.voice : ''));
    A().toast('안내를 시작합니다 · 조사구 핀은 그대로 보입니다');
  }
  function stop() {
    st.guiding = false;
    if (st.watch != null) { try { navigator.geolocation.clearWatch(st.watch); } catch (e) {} st.watch = null; }
    if (window.speechSynthesis) try { speechSynthesis.cancel(); } catch (e) {}
    $('navBar').hidden = true;
  }
  function offRoute(la, lo) {
    var best = 1e9, c = st.route.coords;
    for (var i = 0; i < c.length; i += Math.max(1, Math.floor(c.length / 400))) { var d = distM(la, lo, c[i][1], c[i][0]); if (d < best) best = d; }
    return best;
  }
  function onPos(p) {
    if (!st.guiding || !st.route) return;
    var la = p.coords.latitude, lo = p.coords.longitude, spd = p.coords.speed || 0;
    /* 다음 갈림길에 25m 안으로 오면 그다음으로 */
    while (st.idx < st.steps.length) {
      var m = st.steps[st.idx].loc;
      if (distM(la, lo, m[1], m[0]) < 25) st.idx++; else break;
    }
    var end = st.end, left = distM(la, lo, end.lat, end.lng);
    if (left < 30) { if (!st.said.arr) { st.said.arr = 1; say('목적지 근처에 도착했습니다. 안내를 마칩니다.'); } bar(null, true); return; }
    /* 경로에서 80m 넘게 벗어나면 다시 계산 (30초에 한 번까지) */
    if (offRoute(la, lo) > 80 && Date.now() - st.lastReroute > 30000) {
      st.lastReroute = Date.now(); A().toast('경로를 벗어나 다시 계산합니다'); say('경로를 벗어나 다시 계산합니다');
      st.start = { name: '현재 위치', lat: la, lng: lo, cur: true };
      route(st.start, st.end, st.mode, true).then(function (r) { if (r) { st.alt = {}; st.alt[st.mode] = r; useRoute(r); } bar([la, lo]); });
      return;
    }
    /* 음성: 빠르면(시속 60km 넘게) 1km·300m 앞, 아니면 500m·150m 앞에서 한 번씩 */
    var s = st.steps[st.idx];
    if (s) {
      var dN = distM(la, lo, s.loc[1], s.loc[0]), far = spd > 16 ? 1000 : 500, near = spd > 16 ? 300 : 150, k = st.idx;
      if (dN <= near && !st.said['n' + k]) { st.said['n' + k] = st.said['f' + k] = 1; say(s.voice); }
      else if (dN <= far && dN > near * 1.5 && !st.said['f' + k]) { st.said['f' + k] = 1; say(sayDist(dN) + ' 앞, ' + s.voice); }
    }
    bar([la, lo]);
  }
  function bar(pos, arrived) {
    var el = $('navBar'); el.hidden = false;
    var s = st.steps[Math.min(st.idx, st.steps.length - 1)], t = arrived ? ['목적지 근처에 도착했습니다', '🏁'] : [s ? s.text : '', s ? s.icon : '↑'];
    var dNext = pos && s ? distM(pos[0], pos[1], s.loc[1], s.loc[0]) : (st.steps[st.idx - 1] ? st.steps[st.idx - 1].distance : 0);
    var remain = 0; for (var i = st.idx; i < st.steps.length; i++) remain += st.steps[i].distance || 0;
    if (pos) remain += dNext;
    el.innerHTML = '<div class="nv-main"><span class="nv-turn">' + t[1] + '</span><span class="nv-txt"><b>' + (arrived ? '' : fmtD(dNext) + ' 앞 ') + esc(t[0]) + '</b>' +
      '<span class="nv-sum">' + esc(st.end.name) + ' · 남은 거리 ' + fmtD(pos ? remain : st.route.distance) + '</span></span>' +
      '<button class="nv-voice" id="nbVoice" title="음성 안내 켜기·끄기">' + (st.voice ? '🔊' : '🔇') + '</button></div>' +
      '<div class="row"><button class="btn" id="nbFit">경로 전체</button><button class="btn" id="nbInfo">길찾기 창</button><button class="btn danger" id="nbEnd" style="margin-left:auto">안내 끝내기</button></div>';
    el.querySelector('#nbVoice').onclick = function () { setVoice(!st.voice); this.textContent = st.voice ? '🔊' : '🔇'; };
    el.querySelector('#nbFit').onclick = fitRoute;
    el.querySelector('#nbInfo').onclick = function () { open({ noAuto: true }); };
    el.querySelector('#nbEnd').onclick = function () { stop(); clearRoute(); A().toast('안내를 끝냈습니다'); };
    if (arrived) { st.guiding = false; if (st.watch != null) { try { navigator.geolocation.clearWatch(st.watch); } catch (e) {} st.watch = null; } }
  }
  if (window.speechSynthesis) try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = function () {}; } catch (e) {}

  window.OdigoNav = { open: open };
})();
