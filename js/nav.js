/* 어디고 v4.5 — 검색어로 출발·도착 고르기, 아래쪽 남은 시간·거리·도착 예정, 잘못된 재탐색 고침(선분 거리·2번 연속·GPS 정확도), 단속카메라·과속방지턱 표시·음성
   어디고 v4.3 — 안내 모드: 자동차 표시(진행 방향)·3D 기울임·차는 화면 아래쪽, 경로 위 화살표, 지나온 길 지우기, 위·아래 메뉴 숨김(안내창은 끌어서 옮기기)
   어디고 v4.2 — 경로 「추천(고속도로+최단)」 추가·기본값
   어디고 v4.1 — 경로 고르기(고속도로 우선·최단거리·무료도로, Valhalla 공개 서버 · 실패하면 OSRM) + 음성 안내(휴대폰 내장 한국어 음성)
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
    { id: 'mix', name: '추천', sub: '고속도로+최단', opt: { use_highways: 1, use_distance: 0.7 } },   /* v4.2: 고속도로 우선 + 거리 비중 0.7 */
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
    mode: lsGet('odigo_navMode2', 'mix'), alt: {}, ci: 0, car: null, carH: 0, prev: null, follow: true, prog: false, voice: lsGet('odigo_navVoice', '1') === '1', said: {} };
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

  /* v4.5 검색어로 고르기 (장소·주소·내 조사구) */
  function pickSearch(which, q0) {
    var body = A().openSheet((which === 'start' ? '출발' : '도착') + ' · 검색해서 고르기',
      '<form id="nvSF" class="row" style="flex-wrap:nowrap"><input class="inp" id="nvSQ" placeholder="장소·주소 (예: 성주군청, 경산리 100)" enterkeyhint="search" style="flex:1"><button class="btn primary" type="submit">검색</button></form><div id="nvSList"></div>');
    var inp = body.querySelector('#nvSQ'), out = body.querySelector('#nvSList');
    function go(q) {
      q = (q || '').trim(); if (!q) return;
      out.innerHTML = '<p class="muted">검색 중…</p>';
      Promise.resolve(A().search ? A().search(q) : []).then(function (list) {
        list = (list || []).filter(function (r) { return r && isFinite(r.lat) && isFinite(r.lng); });
        if (!list.length) { out.innerHTML = '<p class="muted">「' + esc(q) + '」 검색 결과가 없습니다.</p>'; return; }
        out.innerHTML = list.slice(0, 20).map(function (r, i) { return '<button type="button" class="sr-item" data-i="' + i + '"><b>' + (r.kind ? '<small class="muted">' + esc(r.kind) + '</small> ' : '') + esc(r.name) + '</b><span>' + esc(r.addr || '') + '</span></button>'; }).join('');
        out.querySelectorAll('[data-i]').forEach(function (b) {
          b.addEventListener('click', function () { var r = list[+b.getAttribute('data-i')]; st[which] = { name: r.name, lat: +r.lat, lng: +r.lng }; st.alt = {}; open({ noAuto: false }); });
        });
      }, function () { out.innerHTML = '<p class="muted">검색하지 못했습니다 (인터넷 확인).</p>'; });
    }
    body.querySelector('#nvSF').addEventListener('submit', function (e) { e.preventDefault(); inp.blur(); go(inp.value); });
    if (q0) { inp.value = q0; go(q0); } else setTimeout(function () { try { inp.focus(); } catch (e) {} }, 200);
  }

  /* ───── 길찾기 창 ───── */
  function open(o) {
    o = o || {};
    if (o.searchQ) { pickSearch('end', o.searchQ); if (!st.start) myPos().then(function (p) { if (p && !st.start) st.start = p; }); return; }
    if (o.end && o.end !== st.end) { st.end = o.end; st.alt = {}; }
    if (o.start) st.start = o.start;
    var html = '<div class="nv-pick"><b>🟢 출발</b><div class="val">' + ptHtml(st.start) + '</div><span></span></div>' +
      '<div class="row" style="margin-top:0"><button class="btn sm" data-p="start:cur">◎ 현재 위치</button><button class="btn sm" data-p="start:search">🔍 검색</button><button class="btn sm" data-p="start:map">지도에서</button><button class="btn sm" data-p="start:site">내 조사구</button></div>' +
      '<div class="nv-pick"><b>🔴 도착</b><div class="val">' + ptHtml(st.end) + '</div><button class="btn sm" id="nvSwap" title="출발·도착 바꾸기">⇅</button></div>' +
      '<div class="row" style="margin-top:0"><button class="btn sm" data-p="end:search">🔍 검색</button><button class="btn sm" data-p="end:site">내 조사구</button><button class="btn sm" data-p="end:map">지도에서</button><button class="btn sm" data-p="end:cur">◎ 현재 위치</button></div>' +
      '<label class="fld">경로 고르기</label><div class="nv-modes">' + MODES.map(function (m) {
        var a = st.alt[m.id];
        return '<button type="button" class="nv-mode' + (st.mode === m.id ? ' on' : '') + '" data-mode="' + m.id + '"><b>' + m.name + '</b>' + (m.sub ? '<i>' + m.sub + '</i>' : '') + '<small>' + (a ? fmtD(a.distance) + ' · ' + fmtT(a.duration) : (st.start && st.end ? '…' : '')) + '</small></button>';
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
        else if (k[1] === 'search') pickSearch(which, '');
        else { A().toast('현재 위치를 확인하는 중…'); myPos().then(function (p) { if (!p) { A().toast('현재 위치를 확인하지 못했습니다 (위치 권한 확인)'); return; } st[which] = p; open(); }); }
      });
    });
    body.querySelectorAll('[data-mode]').forEach(function (b) {
      b.addEventListener('click', function () {
        st.mode = b.getAttribute('data-mode'); lsSet('odigo_navMode2', st.mode);
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
      '<label class="chk-all"><input type="checkbox" id="nvHz"' + (st.hzOn ? ' checked' : '') + '> 📷 단속카메라·과속방지턱 표시·알림 <small class="muted" id="nvHzN">' + hzText() + '</small></label>' +
      '<details><summary class="muted">갈림길 ' + st.steps.length + '곳 보기</summary><div class="nv-steps">' + st.steps.map(function (s) { return '<div>' + s.icon + ' ' + esc(s.text) + ' <small class="muted">' + fmtD(s.distance) + '</small></div>'; }).join('') + '</div></details>' +
      '<div class="row"><button class="btn sm" data-ext="k">카카오맵으로</button><button class="btn sm" data-ext="n">네이버지도로</button><button class="btn sm" data-ext="t">T맵으로</button></div>';
  }
  function bindSummary(body) {
    var sb = body.querySelector('#nvStart'); if (sb) sb.addEventListener('click', startGuide);
    var fb = body.querySelector('#nvFit'); if (fb) fb.addEventListener('click', fitRoute);
    var vb = body.querySelector('#nvVoice'); if (vb) vb.addEventListener('change', function () { setVoice(vb.checked); });
    var hb = body.querySelector('#nvHz'); if (hb) hb.addEventListener('change', function () { st.hzOn = hb.checked; lsSet(HZ_KEY, hb.checked ? '1' : '0'); hzDraw(); });
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
          return { text: m.instruction || '', voice: v.trim(), icon: VICON[m.type] || '↑', distance: (m.length || 0) * 1000, time: m.time || 0, si: Math.min(m.begin_shape_index || 0, c.length - 1), loc: c[Math.min(m.begin_shape_index || 0, c.length - 1)] };
        }) };
    });
  }
  function osrm(a, b, mode) {
    var url = OSRM + a.lng.toFixed(6) + ',' + a.lat.toFixed(6) + ';' + b.lng.toFixed(6) + ',' + b.lat.toFixed(6) + '?overview=full&geometries=geojson&steps=true';
    return fetch(url).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || d.code !== 'Ok' || !d.routes || !d.routes[0]) return null;
      var r = d.routes[0];
      return { src: 'osrm', mode: mode, distance: r.distance, duration: r.duration, coords: r.geometry.coordinates,
        steps: (r.legs[0] && r.legs[0].steps || []).filter(function (s) { return s.maneuver; }).map(function (s) { var t = osrmText(s); return { text: t[0], voice: t[0], icon: t[1], distance: s.distance, time: s.duration || 0, loc: s.maneuver.location }; }) };
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
  function arrowImg() {
    var c = document.createElement('canvas'); c.width = 44; c.height = 44; var g = c.getContext('2d');
    g.translate(22, 22); g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-7, -11); g.lineTo(7, 0); g.lineTo(-7, 11);   /* 오른쪽(=선 방향)을 가리키는 꺾쇠 */
    g.lineWidth = 9; g.strokeStyle = '#0b3a67'; g.stroke();
    g.lineWidth = 5; g.strokeStyle = '#fff'; g.stroke();
    return g.getImageData(0, 0, 44, 44);
  }
  /* 지나온 길 지우기: 경로에서 지금 위치와 가장 가까운 점(앞쪽으로만 찾음)부터 남은 선만 그림 */
  /* v4.5 진행 위치 = 경로 선분 중 가장 가까운 곳(앞쪽 위주로 찾음) → 지나온 길 지우기·갈림길 넘기기·남은 거리에 씀 */
  function trim(la, lo) {
    var c = st.route.coords, best = 1e9, bi = st.ci, from = Math.max(0, st.ci - 3), end = Math.min(c.length - 1, st.ci + 800);
    for (var i = from; i < end; i++) { var d = segD(la, lo, c[i], c[i + 1]); if (d < best - 0.5) { best = d; bi = i; } }
    if (best < 80) st.ci = bi;   /* 많이 벗어났을 땐 진행 위치를 그대로 둠 */
    bi = st.ci;
    var nx = c[Math.min(bi + 1, c.length - 1)];
    st.pg = st.cum[Math.min(bi + 1, c.length - 1)] - Math.min(distM(la, lo, nx[1], nx[0]), st.cum[Math.min(bi + 1, c.length - 1)] - st.cum[bi]);
    var src = A().map.getSource('nv-route');
    if (src) src.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[lo, la]].concat(c.slice(bi + 1)) } });
    return best;
  }
  function bearing(a1, o1, a2, o2) {
    var f1 = a1 * Math.PI / 180, f2 = a2 * Math.PI / 180, dl = (o2 - o1) * Math.PI / 180;
    return (Math.atan2(Math.sin(dl) * Math.cos(f2), Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl)) * 180 / Math.PI + 360) % 360;
  }
  /* 자동차 표시 (진행 방향으로 회전) */
  function carMarker(la, lo) {
    if (!st.car) {
      var el = document.createElement('div'); el.className = 'nv-car';
      el.innerHTML = '<svg viewBox="0 0 40 40" width="40" height="40"><circle cx="20" cy="20" r="18" fill="rgba(28,126,214,.18)"/><path d="M20 5 L31 33 L20 27 L9 33 Z" fill="#1c7ed6" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg>';
      st.car = new maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map', anchor: 'center' }).setLngLat([lo, la]).addTo(A().map);
    }
    st.car.setLngLat([lo, la]); st.car.setRotation(st.carH);
  }
  /* 3D 따라가기: 기울임 55°, 진행 방향이 위, 차는 화면 아래쪽(위 여백을 크게) */
  function camera(la, lo, quick) {
    if (!st.follow) return;
    var map = A().map; st.prog = true;
    map.easeTo({ center: [lo, la], bearing: st.carH, pitch: 55, zoom: Math.max(16, Math.min(map.getZoom(), 18)), padding: { top: Math.round(window.innerHeight * 0.42), bottom: 0, left: 0, right: 0 }, duration: quick ? 400 : 900, essential: true });
    setTimeout(function () { st.prog = false; }, quick ? 450 : 950);
  }
  function navMode(on) {
    document.body.classList.toggle('nav-mode', !!on);
    var map = A().map;
    if (!on) {
      if (st.car) { st.car.remove(); st.car = null; }
      st.prog = true; map.easeTo({ pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 600 }); setTimeout(function () { st.prog = false; }, 650);
      var nb = $('navBar'); nb.style.transform = '';
    }
  }
  function useRoute(r) {
    st.route = r; st.steps = r.steps; st.idx = 1; st.said = {}; st.ci = 0; st.offCnt = 0; st.pg = 0;
    var c = r.coords; st.cum = [0]; for (var i = 1; i < c.length; i++) st.cum.push(st.cum[i - 1] + distM(c[i - 1][1], c[i - 1][0], c[i][1], c[i][0]));
    var lastSi = 0;
    r.steps.forEach(function (sp) {   /* OSRM은 갈림길의 경로 위 번호가 없어서 가장 가까운 점(앞쪽으로)을 찾음 */
      if (sp.si == null) { var b = 1e9, bi = lastSi; for (var j = lastSi; j < c.length; j++) { var d = distM(sp.loc[1], sp.loc[0], c[j][1], c[j][0]); if (d < b) { b = d; bi = j; } if (d < 2) break; } sp.si = bi; }
      lastSi = sp.si;
    });
    draw(); hzLoad(r);
  }
  function draw() {
    var map = A().map, data = { type: 'Feature', geometry: { type: 'LineString', coordinates: st.route.coords } };
    if (map.getSource('nv-route')) map.getSource('nv-route').setData(data);
    else {
      map.addSource('nv-route', { type: 'geojson', data: data });
      map.addLayer({ id: 'nv-route-case', type: 'line', source: 'nv-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 6, 16, 13] } });
      map.addLayer({ id: 'nv-route', type: 'line', source: 'nv-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1c7ed6', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3.5, 16, 8] } });
      /* v4.3 경로 위 진행 방향 화살표 (중간중간) */
      if (!map.hasImage('nv-arrow')) map.addImage('nv-arrow', arrowImg(), { pixelRatio: 2 });
      map.addLayer({ id: 'nv-arrows', type: 'symbol', source: 'nv-route', layout: { 'symbol-placement': 'line', 'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 10, 70, 16, 120], 'icon-image': 'nv-arrow', 'icon-size': ['interpolate', ['linear'], ['zoom'], 10, .6, 16, 1], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
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
    ['nv-arrows', 'nv-route', 'nv-route-case'].forEach(function (id) { if (map.getLayer(id)) map.removeLayer(id); });
    if (map.getSource('nv-route')) map.removeSource('nv-route');
    st.markers.forEach(function (m) { m.remove(); }); st.markers = [];
    st.route = null; st.steps = []; st.alt = {};
    hzClear();
  }
  function fitRoute() {
    if (!st.route) return;
    try { A().map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 }); } catch (e) {}
    var b = new maplibregl.LngLatBounds(); st.route.coords.forEach(function (c) { b.extend(c); });
    var sh = document.getElementById('sheet').hidden ? 0 : document.getElementById('sheet').getBoundingClientRect().height;
    A().map.fitBounds(b, { pitch: 0, bearing: 0, padding: { top: st.guiding ? 140 : 80, left: 40, right: 70, bottom: Math.min(window.innerHeight - 220, sh + 40) }, maxZoom: 16, duration: 600 });
  }

  /* ───── 안내 (위쪽 막대 + 음성) ───── */
  function startGuide() {
    if (!st.route) return;
    st.guiding = true; st.idx = 1; st.said = {}; st.ci = 0; st.follow = true; st.prev = null;
    A().closeSheet();
    if (A().stopLocate) A().stopLocate();   /* 안내 중에는 파란 점 대신 자동차 표시 */
    navMode(true);
    var c0 = st.route.coords; st.carH = c0.length > 1 ? bearing(c0[0][1], c0[0][0], c0[Math.min(3, c0.length - 1)][1], c0[Math.min(3, c0.length - 1)][0]) : 0;
    carMarker(c0[0][1], c0[0][0]); camera(c0[0][1], c0[0][0]);
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
    bottom(null);
    navMode(false);
  }
  /* v4.5 경로까지 거리 = 꼭짓점이 아니라 선분까지 거리 (고속도로처럼 꼭짓점이 드문 곳에서 잘못 「벗어남」 되던 것 고침) */
  function segD(la, lo, a, b) {
    var k = Math.cos(la * Math.PI / 180) * 111320, M = 110540;
    var ax = (a[0] - lo) * k, ay = (a[1] - la) * M, bx = (b[0] - lo) * k, by = (b[1] - la) * M;
    var dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    var x = ax + t * dx, y = ay + t * dy; return Math.sqrt(x * x + y * y);
  }
  function offRoute(la, lo) {
    var best = 1e9, c = st.route.coords, from = Math.max(0, st.ci - 20), to = Math.min(c.length - 1, st.ci + 800);
    for (var i = from; i < to; i++) { var d = segD(la, lo, c[i], c[i + 1]); if (d < best) { best = d; if (d < 5) break; } }
    return best;
  }
  function onPos(p) {
    if (!st.guiding || !st.route) return;
    var la = p.coords.latitude, lo = p.coords.longitude, spd = p.coords.speed || 0, gh = p.coords.heading;
    /* 진행 방향: GPS 방향(움직일 때) → 없으면 직전 위치에서 5m 넘게 움직인 방향 */
    if (gh != null && !isNaN(gh) && spd > 1) st.carH = gh;
    else if (st.prev && distM(st.prev[0], st.prev[1], la, lo) > 5) st.carH = bearing(st.prev[0], st.prev[1], la, lo);
    if (!st.prev || distM(st.prev[0], st.prev[1], la, lo) > 5) st.prev = [la, lo];
    carMarker(la, lo); camera(la, lo, true);
    /* v4.5 갈림길 넘기기: 경로 위 진행 위치가 갈림길을 10m 넘게 지나면 다음으로 (예전: 갈림길 25m 안에 GPS가 찍혀야만 → 고속에서 놓쳐 안내가 멈추던 문제) */
    trim(la, lo);
    while (st.idx < st.steps.length - 1 && st.pg > st.cum[st.steps[st.idx].si] + 10) st.idx++;
    var end = st.end, left = distM(la, lo, end.lat, end.lng);
    if (left < 30) { if (!st.said.arr) { st.said.arr = 1; say('목적지 근처에 도착했습니다. 안내를 마칩니다.'); } bar(null, true); return; }
    /* 경로에서 80m 넘게 벗어나면 다시 계산 (30초에 한 번까지) */
    /* 다시 탐색: 경로 선에서 (60m 또는 GPS 오차의 2배) 넘게 떨어진 위치가 2번 연속일 때만 · 오차 100m 넘는 위치는 무시 */
    var acc = p.coords.accuracy || 0, offD = offRoute(la, lo), lim = Math.max(60, acc * 2);
    if (acc <= 100 && offD > lim) st.offCnt = (st.offCnt || 0) + 1; else if (offD <= lim) st.offCnt = 0;
    if (st.offCnt >= 2 && Date.now() - st.lastReroute > 15000) {
      st.offCnt = 0;
      st.lastReroute = Date.now(); A().toast('경로를 벗어나 다시 계산합니다'); say('경로를 벗어나 다시 계산합니다');
      st.start = { name: '현재 위치', lat: la, lng: lo, cur: true };
      route(st.start, st.end, st.mode, true).then(function (r) { if (r) { st.alt = {}; st.alt[st.mode] = r; useRoute(r); A().toast('새 경로로 안내합니다'); } bar([la, lo]); });
      return;
    }
    /* 음성: 빠르면(시속 60km 넘게) 1km·300m 앞, 아니면 500m·150m 앞에서 한 번씩 */
    var s = st.steps[st.idx];
    if (s) {
      var dN = Math.max(0, st.cum[s.si] - st.pg), far = spd > 16 ? 1000 : 500, near = spd > 16 ? 300 : 150, k = st.idx;
      if (dN <= near && !st.said['n' + k]) { st.said['n' + k] = st.said['f' + k] = 1; say(s.voice); }
      else if (dN <= far && dN > near * 1.5 && !st.said['f' + k]) { st.said['f' + k] = 1; say(sayDist(dN) + ' 앞, ' + s.voice); }
    }
    hzCheck(la, lo, spd);
    bar([la, lo]);
  }
  function bar(pos, arrived) {
    var el = $('navBar'); el.hidden = false;
    var s = st.steps[Math.min(st.idx, st.steps.length - 1)], t = arrived ? ['목적지 근처에 도착했습니다', '🏁'] : [s ? s.text : '', s ? s.icon : '↑'];
    var total = st.cum[st.cum.length - 1] || st.route.distance, pg = st.pg || 0;
    var dNext = s ? Math.max(0, st.cum[s.si] - pg) : 0;
    var remain = Math.max(0, total - pg), rtime = 0, cur = st.steps[st.idx - 1];
    for (var i = st.idx; i < st.steps.length; i++) rtime += st.steps[i].time || 0;
    if (cur) { var segL = Math.max(1, st.cum[s ? s.si : st.cum.length - 1] - st.cum[cur.si]); rtime += (cur.time || 0) * Math.min(1, dNext / segL); }
    if (!rtime && st.route.distance) rtime = st.route.duration * remain / st.route.distance;
    bottom(arrived ? null : { d: remain, t: rtime });
    el.innerHTML = '<div class="nv-main"><span class="nv-turn">' + t[1] + '</span><span class="nv-txt"><b>' + (arrived ? '' : fmtD(dNext) + ' 앞 ') + esc(t[0]) + '</b>' +
      '<span class="nv-sum">' + esc(st.end.name) + (st.hzNext ? ' <span class="nv-hz">' + st.hzNext + '</span>' : '') + '</span></span>' +
      '<button class="nv-voice" id="nbVoice" title="음성 안내 켜기·끄기">' + (st.voice ? '🔊' : '🔇') + '</button></div>' +
      '<div class="row">' + (st.follow ? '' : '<button class="btn primary" id="nbMe">🚗 현위치</button>') + '<button class="btn" id="nbFit">경로 전체</button><button class="btn" id="nbInfo">길찾기 창</button><button class="btn danger" id="nbEnd" style="margin-left:auto">안내 끝내기</button></div>';
    el.querySelector('#nbVoice').onclick = function () { setVoice(!st.voice); this.textContent = st.voice ? '🔊' : '🔇'; };
    el.querySelector('#nbFit').onclick = function () { st.follow = false; navMode(true); fitRoute(); bar(pos, arrived); };
    var me = el.querySelector('#nbMe'); if (me) me.onclick = function () { st.follow = true; var q = st.prev || (pos ? pos : null); if (q) camera(q[0], q[1]); bar(pos, arrived); };
    el.querySelector('#nbInfo').onclick = function () { open({ noAuto: true }); };
    el.querySelector('#nbEnd').onclick = function () { stop(); clearRoute(); A().toast('안내를 끝냈습니다'); };
    bindDrag(el);
    if (arrived) { st.guiding = false; if (st.watch != null) { try { navigator.geolocation.clearWatch(st.watch); } catch (e) {} st.watch = null; } }
  }
  if (window.speechSynthesis) try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = function () {}; } catch (e) {}

  /* ───── v4.5 아래쪽 남은 시간·거리·도착 예정 ───── */
  function bottom(v) {
    var el = document.getElementById('nvBottom');
    if (!v) { if (el) el.hidden = true; return; }
    if (!el) { el = document.createElement('div'); el.id = 'nvBottom'; el.className = 'nv-bottom'; document.body.appendChild(el); }
    var eta = new Date(Date.now() + v.t * 1000);
    el.innerHTML = '<span><small>남은 시간</small><b>' + fmtT(v.t) + '</b></span><span><small>남은 거리</small><b>' + fmtD(v.d) + '</b></span><span><small>도착 예정</small><b>' + eta.getHours() + ':' + ('0' + eta.getMinutes()).slice(-2) + '</b></span>';
    el.hidden = false;
  }

  /* ───── v4.5 단속카메라·과속방지턱 ─────
     ① 공공데이터 「전국무인교통단속카메라표준데이터」 → GitHub Actions가 만든 정적 파일(CAM_BASE/{격자}.json, [[위도,경도,제한속도,구분],…]) — 파일이 없으면 건너뜀
     (OpenStreetMap Overpass 공개 서버는 앱 요청을 막고(502) 한국 자료도 거의 없어 쓰지 않음 · 과속방지턱은 전국 공공데이터가 없어 지자체 자료를 모아야 함)
     경로에서 35m 안의 것만 표시, 앞쪽 카메라 300m(빠르면 600m)·방지턱 100m 앞에서 음성 */
  var HZ_KEY = 'odigo_navHz', CAM_BASE = (location.pathname.indexOf('/odigo') === 0 || location.hostname === 'localhost' && !/\/home\//.test(location.pathname) ? 'data/cameras/' : 'https://ubaldos00-ship-it.github.io/odigo/data/cameras/');
  st.hzOn = lsGet(HZ_KEY, '1') === '1'; st.hz = []; st.hzMk = [];
  function hzText() { if (!st.hz.length) return st.route ? '(경로 위 자료 없음)' : ''; var c = st.hz.filter(function (h) { return h.k === 'cam'; }).length; return '(카메라 ' + c + ' · 방지턱 ' + (st.hz.length - c) + ')'; }
  function hzClear() { st.hzMk.forEach(function (m) { m.remove(); }); st.hzMk = []; st.hz = []; st.hzNext = ''; }
  function nearIdx(la, lo, c) { var best = 1e9, bi = -1; for (var i = 0; i < c.length - 1; i++) { var d = segD(la, lo, c[i], c[i + 1]); if (d < best) { best = d; bi = i; } } return [best, bi]; }
  function hzLoad(r) {
    hzClear();
    var c = r.coords, bb = [90, 180, -90, -180];
    c.forEach(function (p) { bb[0] = Math.min(bb[0], p[1]); bb[1] = Math.min(bb[1], p[0]); bb[2] = Math.max(bb[2], p[1]); bb[3] = Math.max(bb[3], p[0]); });
    var cells = {}; for (var a = Math.floor(bb[0] / 0.5); a <= Math.floor(bb[2] / 0.5); a++) for (var b = Math.floor(bb[1] / 0.5); b <= Math.floor(bb[3] / 0.5); b++) cells[a + '_' + b] = 1;
    var pubs = Object.keys(cells).slice(0, 12).map(function (k) {
      return fetch(CAM_BASE + k + '.json').then(function (x) { return x.ok ? x.json() : []; }).then(function (rows) { return (rows || []).map(function (q) { return { k: 'cam', lat: q[0], lng: q[1], lim: q[2] || 0, t: q[3] || '' }; }); }, function () { return []; });
    });
    Promise.all(pubs).then(function (all) {
      if (st.route !== r) return;
      var out = [], seen = {};
      [].concat.apply([], all).forEach(function (h) {
        if (!isFinite(h.lat) || !isFinite(h.lng)) return;
        var key = h.k + h.lat.toFixed(4) + h.lng.toFixed(4); if (seen[key]) return;
        var ni = nearIdx(h.lat, h.lng, c); if (ni[0] > 35) return;
        seen[key] = 1; h.i = ni[1]; out.push(h);
      });
      st.hz = out.sort(function (a, b) { return a.i - b.i; }); hzDraw();
      var n = document.getElementById('nvHzN'); if (n) n.textContent = hzText();
    });
  }
  function hzDraw() {
    st.hzMk.forEach(function (m) { m.remove(); }); st.hzMk = [];
    if (!st.hzOn) return;
    st.hz.forEach(function (h) {
      var el = document.createElement('div'); el.className = 'nv-hzm ' + h.k;
      el.innerHTML = h.k === 'cam' ? '📷' + (h.lim ? '<b>' + h.lim + '</b>' : '') : '⚠︎';
      el.title = h.k === 'cam' ? '단속카메라' + (h.lim ? ' ' + h.lim + 'km/h' : '') : '과속방지턱';
      st.hzMk.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([h.lng, h.lat]).addTo(A().map));
    });
  }
  function hzCheck(la, lo, spd) {
    st.hzNext = '';
    if (!st.hzOn || !st.hz.length) return;
    for (var j = 0; j < st.hz.length; j++) {
      var h = st.hz[j]; if (h.i < st.ci - 1) continue;
      var d = Math.max(0, st.cum[Math.min(h.i + 1, st.cum.length - 1)] - st.pg), lim = h.k === 'cam' ? (spd > 22 ? 600 : 300) : 100;
      if (d > 1500) break;
      if (h.k === 'cam' && d < 1000 && !st.hzNext) st.hzNext = '📷 ' + fmtD(d) + (h.lim ? ' · ' + h.lim + 'km' : '');
      if (d <= lim && !h.said) { h.said = 1; say(h.k === 'cam' ? sayDist(d) + ' 앞, 과속 단속 카메라' + (h.lim ? ', 제한 속도 ' + h.lim + '킬로미터' : '') + ' 입니다' : '과속방지턱이 있습니다'); }
    }
  }

  /* 안내창 끌어서 옮기기 (위아래로) */
  var dragBound = false;
  function bindDrag(el) {
    if (dragBound) return; dragBound = true;
    var y0 = null, t0 = 0;
    el.addEventListener('pointerdown', function (e) { if (e.target.closest('button')) return; y0 = e.clientY; var m = /translateY\((-?[\d.]+)px\)/.exec(el.style.transform || ''); t0 = m ? +m[1] : 0; try { el.setPointerCapture(e.pointerId); } catch (x) {} });
    el.addEventListener('pointermove', function (e) { if (y0 == null) return; var t = Math.max(0, Math.min(window.innerHeight - el.offsetHeight - 30, t0 + e.clientY - y0)); el.style.transform = 'translateY(' + t + 'px)'; });
    function up() { y0 = null; }
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }
  /* 안내 중 손으로 지도를 움직이면 따라가기 멈춤 → 「🚗 현위치」로 다시 */
  function hookMap() {
    var map = A() && A().map; if (!map) { setTimeout(hookMap, 500); return; }
    map.on('dragstart', function () { if (st.guiding && !st.prog && st.follow) { st.follow = false; bar(st.prev); } });
  }
  hookMap();

  window.OdigoNav = { open: open };
})();
