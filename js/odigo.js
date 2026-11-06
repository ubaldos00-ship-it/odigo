/* 어디고 v1.7 — 기본 지도 (0단계)
   · 배경지도: MapLibre + VWorld WMTS (텐아르 map_libre.html과 같은 키·방식)
   · 검색: 카카오 장소(키워드) + 주소 검색 (JavaScript 키, 도메인 제한)
   · 내 조사 장소·오늘 방문·방문 기록: 이 기기 localStorage에만 저장 (서버 전송 없음)
   · 길찾기: 외부 지도 앱(네이버·카카오·T맵) 연결 */
(function () {
  'use strict';

  var APP_VERSION = 'v2.3';
  /* 키는 HTML에 노출되는 공개키 — 두 서비스 모두 허용 도메인(https://ubaldos00-ship-it.github.io)으로 제한됨 */
  var VWORLD_API_KEY = '00EB5BC0-22B4-3B7E-89D1-341699F7CE05';
  var KAKAO_JS_KEY = 'd714e9625ae9e816526288f6cde536a9';
  var GAS_URL = 'https://script.google.com/macros/s/AKfycby132T2PIJQ8VPKhQLzQZaxEUBwC6c-7N-h60PGsx3MpU0O58qD7Lg5OJqhvQjD4SJoww/exec';   // 어디고 카운터(GA4 Apps Script)

  var PLACES_KEY = 'odigo_places_v1';
  var VIEW_KEY = 'odigo_view_v1';
  var BASE_KEY = 'odigo_base_v1';

  /* ───────── 공통 ───────── */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtTime(ts) { var d = new Date(ts); return d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function dateStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayStr() { return dateStr(new Date()); }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }
  window.OdigoToast = toast;

  function loadJSON(key, dflt) { try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? dflt : v; } catch (e) { return dflt; } }
  function saveJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch (e) { toast('이 기기에 저장하지 못했습니다 (저장공간·사생활 보호 모드 확인)'); return false; } }

  /* ───────── 장소 데이터 ─────────
     place = { id, name, addr, lat, lng, memo, today:'YYYY-MM-DD'|'' , todayOrder, visits:[{at, note}], createdAt } */
  var places = loadJSON(PLACES_KEY, []);
  if (!Array.isArray(places)) places = [];
  function persist() { saveJSON(PLACES_KEY, places); renderMarkers(); updateCounts(); }
  function findPlace(id) { for (var i = 0; i < places.length; i++) if (places[i].id === id) return places[i]; return null; }
  function isToday(p) { return p.today === todayStr(); }
  function todayList() { return places.filter(isToday).sort(function (a, b) { return (a.todayOrder || 0) - (b.todayOrder || 0); }); }
  /* 방문 시각(ISO·UTC)은 기기 현지 날짜로 바꿔 비교 (자정~09시 KST가 전날로 잡히던 문제 방지) */
  function visitedToday(p) { var t = todayStr(); return (p.visits || []).some(function (v) { return v.at && dateStr(new Date(v.at)) === t; }); }

  function addPlace(obj) {
    var p = { id: uid(), name: obj.name || '이름 없는 장소', addr: obj.addr || '', lat: +obj.lat, lng: +obj.lng, memo: '', today: '', todayOrder: 0, visits: [], createdAt: new Date().toISOString() };
    places.push(p); persist(); return p;
  }
  function setToday(p, on) {
    if (on) { var list = todayList(); p.today = todayStr(); p.todayOrder = list.length ? (list[list.length - 1].todayOrder || 0) + 1 : 1; }
    else { p.today = ''; p.todayOrder = 0; }
    persist();
  }

  /* ───────── 지도 ───────── */
  function tileUrl(layer, ext) { return 'https://api.vworld.kr/req/wmts/1.0.0/' + VWORLD_API_KEY + '/' + layer + '/{z}/{y}/{x}.' + ext; }
  var view = loadJSON(VIEW_KEY, null);
  var base = loadJSON(BASE_KEY, 'Base');

  var map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: {
        base: { type: 'raster', tiles: [tileUrl('Base', 'png')], tileSize: 256, maxzoom: 19, attribution: '© <a href="https://www.vworld.kr" target="_blank" rel="noopener">VWorld</a>' },
        sat: { type: 'raster', tiles: [tileUrl('Satellite', 'jpeg')], tileSize: 256, maxzoom: 19, attribution: '© <a href="https://www.vworld.kr" target="_blank" rel="noopener">VWorld</a>' },
        hybrid: { type: 'raster', tiles: [tileUrl('Hybrid', 'png')], tileSize: 256, maxzoom: 19 }
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#eef1ef' } },
        { id: 'base', type: 'raster', source: 'base', layout: { visibility: base === 'Base' ? 'visible' : 'none' } },
        { id: 'sat', type: 'raster', source: 'sat', layout: { visibility: base === 'Sat' ? 'visible' : 'none' } },
        { id: 'hybrid', type: 'raster', source: 'hybrid', layout: { visibility: base === 'Sat' ? 'visible' : 'none' } }
      ]
    },
    center: view ? [view.lng, view.lat] : [127.9, 36.2],
    zoom: view ? view.z : 6.6,
    maxZoom: 19,
    attributionControl: { compact: true }
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
  map.on('moveend', function () { var c = map.getCenter(); saveJSON(VIEW_KEY, { lng: +c.lng.toFixed(6), lat: +c.lat.toFixed(6), z: +map.getZoom().toFixed(2) }); });
  /* VWorld 타일 오류는 지도 전체를 멈추지 않게 한 번만 안내 */
  var tileErrShown = false;
  map.on('error', function (e) { if (!tileErrShown && e && e.sourceId) { tileErrShown = true; toast('배경지도 일부를 불러오지 못했습니다'); } });

  function setBase(b) {
    base = b; saveJSON(BASE_KEY, b);
    map.setLayoutProperty('base', 'visibility', b === 'Base' ? 'visible' : 'none');
    map.setLayoutProperty('sat', 'visibility', b === 'Sat' ? 'visible' : 'none');
    map.setLayoutProperty('hybrid', 'visibility', b === 'Sat' ? 'visible' : 'none');
    $('btnBase').innerHTML = b === 'Sat' ? '<span>🗺️</span><small>일반</small>' : '<span>🛰️</span><small>위성</small>';
  }
  map.on('load', function () { setBase(base); });
  $('btnBase').addEventListener('click', function () { setBase(base === 'Sat' ? 'Base' : 'Sat'); });

  /* ───────── 내 장소 마커 (HTML 마커 = 공공시설 레이어보다 항상 위) ───────── */
  var markers = {};
  function renderMarkers() {
    Object.keys(markers).forEach(function (id) { markers[id].remove(); });
    markers = {};
    var tl = todayList();
    places.forEach(function (p) {
      if (!isFinite(p.lat) || !isFinite(p.lng)) return;
      var el = document.createElement('div');
      var ti = tl.indexOf(p);
      /* MapLibre가 마커 요소의 transform을 덮어쓰므로 회전은 안쪽 .pin에 준다 */
      el.className = 'pin-wrap';
      el.innerHTML = '<div class="pin' + (ti >= 0 ? ' today' : '') + (ti >= 0 && visitedToday(p) ? ' visited' : '') + '"><i>' + (ti >= 0 ? (ti + 1) : '') + '</i></div>';
      el.title = p.name;
      el.addEventListener('click', function (ev) { ev.stopPropagation(); openPlace(p.id); });
      var m = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -2] }).setLngLat([p.lng, p.lat]).addTo(map);
      if (ti >= 0) m.getElement().style.zIndex = 3; else m.getElement().style.zIndex = 2;
      markers[p.id] = m;
    });
  }
  function updateCounts() { $('cntPlaces').textContent = places.length; $('cntToday').textContent = todayList().length; }

  /* ───────── 시트 ───────── */
  function openSheet(title, html) {
    $('sheetTitle').textContent = title;
    $('sheetBody').innerHTML = html || '';
    $('sheet').hidden = false; $('sheetBackdrop').hidden = false;
    $('sheetBody').scrollTop = 0;
    return $('sheetBody');
  }
  function closeSheet() { $('sheet').hidden = true; $('sheetBackdrop').hidden = true; }
  $('sheetClose').addEventListener('click', closeSheet);
  $('sheetBackdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeSheet(); hideResults(); } });

  /* ───────── 장소 카드 ───────── */
  function openPlace(id) {
    var p = findPlace(id); if (!p) return;
    var tl = todayList(), ti = tl.indexOf(p);
    var visits = (p.visits || []).slice().reverse();
    var html =
      '<div class="addr">' + esc(p.addr || (p.lat.toFixed(5) + ', ' + p.lng.toFixed(5))) + '</div>' +
      '<div>' + (ti >= 0 ? '<span class="chip today">오늘 방문 ' + (ti + 1) + '번</span>' : '') + (visitedToday(p) ? '<span class="chip done">오늘 방문함</span>' : '') + '</div>' +
      '<div class="row">' +
        '<button class="btn primary" data-act="nav">🚗 길찾기</button>' +
        '<button class="btn" data-act="today">' + (ti >= 0 ? '오늘 방문 빼기' : '＋ 오늘 방문에 추가') + '</button>' +
        '<button class="btn" data-act="visit">✔ 방문 기록</button>' +
      '</div>' +
      '<div class="row"><button class="btn" style="flex:1" data-act="park">🅿 이 장소 주변 주차장</button><button class="btn" style="flex:1" data-act="crime">🛡 이 지역 범죄 통계</button></div>' +
      '<label class="fld">장소 이름</label><input class="inp" data-f="name" value="' + esc(p.name) + '">' +
      '<label class="fld">메모</label><textarea data-f="memo" placeholder="조사 대상·연락처 없이 현장 메모만 (이 기기에만 저장)">' + esc(p.memo) + '</textarea>' +
      '<label class="fld">방문 기록 (' + visits.length + ')</label>' +
      (visits.length ? visits.map(function (v) { return '<div class="visit"><time>' + esc(fmtTime(v.at)) + '</time>' + esc(v.note || '방문') + '</div>'; }).join('') : '<div class="muted">아직 방문 기록이 없습니다.</div>') +
      '<div class="row" style="margin-top:16px"><button class="btn" data-act="center">지도에서 보기</button><button class="btn danger" data-act="del">장소 삭제</button></div>';
    var body = openSheet(p.name, html);

    body.querySelectorAll('[data-f]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var f = inp.getAttribute('data-f'), v = inp.value.trim();
        if (f === 'name') { p.name = v || '이름 없는 장소'; $('sheetTitle').textContent = p.name; }
        else p.memo = inp.value;
        persist(); toast('저장했습니다');
      });
    });
    body.querySelector('[data-act="nav"]').addEventListener('click', function () { openNav(p.name, p.lat, p.lng); });
    body.querySelector('[data-act="today"]').addEventListener('click', function () { setToday(p, !isToday(p)); openPlace(p.id); });
    body.querySelector('[data-act="visit"]').addEventListener('click', function () { openVisitForm(p); });
    body.querySelector('[data-act="crime"]').addEventListener('click', function () {
      try { window.OdigoNearby.crimeSheet(p.lat, p.lng, p.name, p.addr); }
      catch (e) { toast('범죄 통계를 불러오지 못했습니다'); }
    });
    body.querySelector('[data-act="park"]').addEventListener('click', function () {
      try { window.OdigoNearby.parkingNear(p.lat, p.lng, p.name, 'place'); }
      catch (e) { toast('주차장 정보를 불러오지 못했습니다'); }
    });
    body.querySelector('[data-act="center"]').addEventListener('click', function () { closeSheet(); map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 16) }); });
    body.querySelector('[data-act="del"]').addEventListener('click', function () {
      if (!confirm('「' + p.name + '」을(를) 삭제할까요? 방문 기록도 함께 지워집니다.')) return;
      places = places.filter(function (x) { return x.id !== p.id; }); persist(); closeSheet(); toast('삭제했습니다');
    });
  }

  function openVisitForm(p) {
    var body = openSheet('방문 기록 · ' + p.name,
      '<label class="fld">방문 메모 (선택)</label><textarea id="visitNote" placeholder="예: 현장 확인 완료, 다음 주 재방문"></textarea>' +
      '<div class="row"><button class="btn primary full" id="visitSave">지금 시각으로 방문 기록 저장</button></div>' +
      '<div class="row"><button class="btn full" id="visitBack">돌아가기</button></div>');
    body.querySelector('#visitSave').addEventListener('click', function () {
      p.visits = p.visits || [];
      p.visits.push({ at: new Date().toISOString(), note: body.querySelector('#visitNote').value.trim() });
      persist(); toast('방문 기록을 저장했습니다'); openPlace(p.id);
    });
    body.querySelector('#visitBack').addEventListener('click', function () { openPlace(p.id); });
  }

  /* ───────── 장소 목록 ───────── */
  function openList(tab) {
    var list = tab === 'today' ? todayList() : places.slice().sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
    var tl = todayList();
    var html = '<div class="tabs"><button class="tab' + (tab === 'today' ? ' on' : '') + '" data-tab="today">오늘 방문 (' + tl.length + ')</button>' +
      '<button class="tab' + (tab !== 'today' ? ' on' : '') + '" data-tab="all">내 조사 장소 (' + places.length + ')</button></div>';
    if (!list.length) {
      html += '<p class="muted">' + (tab === 'today'
        ? '오늘 방문할 장소가 없습니다. 장소 카드에서 「＋ 오늘 방문에 추가」를 누르세요.'
        : '저장한 장소가 없습니다. 위 검색창에서 찾거나 지도를 눌러 장소를 저장하세요.') + '</p>';
    } else {
      list.forEach(function (p) {
        var ti = tl.indexOf(p);
        html += '<button class="plist-item' + (ti >= 0 ? ' today' : '') + '" data-id="' + p.id + '">' +
          '<span class="num">' + (ti >= 0 ? ti + 1 : '·') + '</span>' +
          '<span class="t"><b>' + esc(p.name) + '</b><span>' + esc(p.addr || '') + '</span></span>' +
          (visitedToday(p) ? '<span class="chip done">방문함</span>' : '') +
          '</button>';
      });
    }
    if (tab === 'today' && tl.length > 1) html += '<div class="row"><button class="btn full" id="fitToday">오늘 방문 장소 한눈에 보기</button></div>';
    var body = openSheet(tab === 'today' ? '오늘 방문' : '내 조사 장소', html);
    body.querySelectorAll('[data-tab]').forEach(function (b) { b.addEventListener('click', function () { openList(b.getAttribute('data-tab')); }); });
    body.querySelectorAll('[data-id]').forEach(function (b) {
      b.addEventListener('click', function () { var p = findPlace(b.getAttribute('data-id')); if (!p) return; map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 15) }); openPlace(p.id); });
    });
    var fit = body.querySelector('#fitToday');
    if (fit) fit.addEventListener('click', function () {
      var b = new maplibregl.LngLatBounds();
      tl.forEach(function (p) { b.extend([p.lng, p.lat]); });
      closeSheet(); map.fitBounds(b, { padding: 80, maxZoom: 16 });
    });
  }
  $('btnPlaces').addEventListener('click', function () { openList('all'); });
  $('btnToday').addEventListener('click', function () { openList('today'); });

  /* ───────── 길찾기 (외부 앱) ───────── */
  function openAppOrWeb(appUrl, webUrl) {
    var t = Date.now(), done = false;
    function stop() { done = true; }
    document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); }, { once: true });
    window.addEventListener('pagehide', stop, { once: true });
    var isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (!isMobile) { window.open(webUrl, '_blank', 'noopener'); return; }
    location.href = appUrl;
    setTimeout(function () { if (done || document.hidden || Date.now() - t > 3000) return; window.open(webUrl, '_blank', 'noopener'); }, 1400);
  }
  function openNav(name, lat, lng) {
    var n = encodeURIComponent(name || '목적지');
    var apps = [
      ['네이버 지도', 'nmap://route/car?dlat=' + lat + '&dlng=' + lng + '&dname=' + n + '&appname=odigo', 'https://map.naver.com/p/search/' + n],
      ['카카오맵', 'kakaomap://route?ep=' + lat + ',' + lng + '&by=CAR', 'https://map.kakao.com/link/to/' + n + ',' + lat + ',' + lng],
      ['T맵', 'tmap://route?goalname=' + n + '&goalx=' + lng + '&goaly=' + lat, 'https://tmap.life/route?goalx=' + lng + '&goaly=' + lat]
    ];
    var body = openSheet('🚗 길찾기 · ' + (name || '목적지'),
      '<p class="muted">외부 지도 앱으로 길찾기를 엽니다. 어디고의 목적지는 바뀌지 않습니다.</p>' +
      apps.map(function (a, i) { return '<div class="row"><button class="btn full" data-i="' + i + '">' + a[0] + '</button></div>'; }).join(''));
    body.querySelectorAll('[data-i]').forEach(function (b) {
      b.addEventListener('click', function () { var a = apps[+b.getAttribute('data-i')]; closeSheet(); openAppOrWeb(a[1], a[2]); });
    });
  }

  /* ───────── 카카오 SDK (장소·주소 검색, 좌표→주소) ───────── */
  var kakaoP = null;
  function ensureKakao() {
    if (kakaoP) return kakaoP;
    kakaoP = new Promise(function (resolve) {
      if (window.kakao && kakao.maps && kakao.maps.services) { resolve(true); return; }
      var done = false, s = document.createElement('script');
      var to = setTimeout(function () { if (!done) { done = true; resolve(false); } }, 8000);
      s.src = 'https://dapi.kakao.com/v2/maps/sdk.js?autoload=false&libraries=services&appkey=' + encodeURIComponent(KAKAO_JS_KEY);
      s.onload = function () {
        try { kakao.maps.load(function () { if (!done) { done = true; clearTimeout(to); resolve(!!(kakao.maps && kakao.maps.services)); } }); }
        catch (e) { if (!done) { done = true; clearTimeout(to); resolve(false); } }
      };
      s.onerror = function () { if (!done) { done = true; clearTimeout(to); resolve(false); } };
      document.head.appendChild(s);
    }).then(function (ok) { if (!ok) kakaoP = null; return ok; });   /* 실패하면 다음 검색 때 다시 시도 */
    return kakaoP;
  }
  function kakaoSearch(q) {
    return ensureKakao().then(function (ok) {
      if (!ok) return null;
      var c = map.getCenter();
      var places = new Promise(function (res) {
        try {
          new kakao.maps.services.Places().keywordSearch(q, function (r, st) {
            res(st === kakao.maps.services.Status.OK ? r.map(function (x) {
              return { kind: '장소', name: x.place_name, addr: x.road_address_name || x.address_name, lat: +x.y, lng: +x.x };
            }) : []);
          }, { location: new kakao.maps.LatLng(c.lat, c.lng), sort: kakao.maps.services.SortBy.ACCURACY });
        } catch (e) { res([]); }
      });
      var addrs = new Promise(function (res) {
        try {
          new kakao.maps.services.Geocoder().addressSearch(q, function (r, st) {
            res(st === kakao.maps.services.Status.OK ? r.map(function (x) {
              var road = x.road_address && x.road_address.address_name, jibun = x.address && x.address.address_name;
              return { kind: '주소', name: x.address_name, addr: road && jibun && road !== jibun ? (road + ' · ' + jibun) : (road || jibun || ''), lat: +x.y, lng: +x.x };
            }) : []);
          });
        } catch (e) { res([]); }
      });
      return Promise.all([addrs, places]).then(function (a) { return a[0].concat(a[1]); });
    });
  }
  /* 좌표 → 행정구역 1·2단계 (범죄 통계 지역 연결용). 실패하면 null */
  function regionOf(lat, lng) {
    return ensureKakao().then(function (ok) {
      if (!ok) return null;
      return new Promise(function (res) {
        try {
          new kakao.maps.services.Geocoder().coord2RegionCode(lng, lat, function (r, st) {
            if (st !== kakao.maps.services.Status.OK || !r.length) { res(null); return; }
            var h = r.filter(function (x) { return x.region_type === 'H'; })[0] || r[0];
            res({ r1: h.region_1depth_name, r2: h.region_2depth_name });
          });
        } catch (e) { res(null); }
      });
    });
  }
  function reverseGeocode(lat, lng) {
    return ensureKakao().then(function (ok) {
      if (!ok) return '';
      return new Promise(function (res) {
        try {
          new kakao.maps.services.Geocoder().coord2Address(lng, lat, function (r, st) {
            if (st !== kakao.maps.services.Status.OK || !r.length) { res(''); return; }
            res((r[0].road_address && r[0].road_address.address_name) || (r[0].address && r[0].address.address_name) || '');
          });
        } catch (e) { res(''); }
      });
    });
  }

  /* ───────── 검색 UI ───────── */
  var tempMarker = null, tempPopup = null;
  function clearTemp() {
    if (tempPopup) { var p = tempPopup; tempPopup = null; p.remove(); }
    if (tempMarker) { tempMarker.remove(); tempMarker = null; }
  }
  function hideResults() { $('searchResults').hidden = true; }
  $('searchForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = $('searchInput').value.trim();
    if (!q) return;
    $('searchInput').blur();
    var box = $('searchResults');
    box.hidden = false; box.innerHTML = '<div class="sr-empty">검색 중…</div>';
    kakaoSearch(q).then(function (list) {
      if (list === null) { box.innerHTML = '<div class="sr-empty">검색 서비스에 연결하지 못했습니다. 인터넷 연결을 확인하거나 지도를 길게 눌러 위치를 직접 저장하세요.</div>'; return; }
      if (!list.length) { box.innerHTML = '<div class="sr-empty">「' + esc(q) + '」 검색 결과가 없습니다.</div>'; return; }
      box.innerHTML = list.slice(0, 15).map(function (r, i) {
        return '<button class="sr-item" data-i="' + i + '"><b><span class="sr-kind">' + r.kind + '</span>' + esc(r.name) + '</b><span>' + esc(r.addr) + '</span></button>';
      }).join('');
      box.querySelectorAll('[data-i]').forEach(function (b) {
        b.addEventListener('click', function () { hideResults(); showCandidate(list[+b.getAttribute('data-i')]); });
      });
    });
  });
  map.on('click', function () { hideResults(); });
  map.on('touchstart', function () { hideResults(); });

  /* 검색 결과·지도 클릭 위치를 임시 핀으로 보여 주고 저장 버튼 제공 */
  function showCandidate(r, noFly) {
    clearTemp();
    var el = document.createElement('div'); el.className = 'pin-wrap'; el.innerHTML = '<div class="pin temp"><i>+</i></div>';
    tempMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([r.lng, r.lat]).addTo(map);
    if (!noFly) map.flyTo({ center: [r.lng, r.lat], zoom: Math.max(map.getZoom(), 16) });
    var wrap = document.createElement('div');
    wrap.innerHTML = '<b>' + esc(r.name) + '</b><div class="pop-addr">' + esc(r.addr || (r.lat.toFixed(5) + ', ' + r.lng.toFixed(5) + ' · 주소 확인 중…')) + '</div>' +
      '<button class="btn primary full" data-s>내 조사 장소로 저장</button>';
    var pop = new maplibregl.Popup({ offset: 40, closeButton: true, closeOnClick: false, maxWidth: '280px' })
      .setLngLat([r.lng, r.lat]).setDOMContent(wrap).addTo(map);
    tempPopup = pop;
    pop.on('close', function () { if (tempPopup === pop) { tempPopup = null; clearTemp(); } });
    wrap.querySelector('[data-s]').addEventListener('click', function () {
      var p = addPlace(r); pop.remove(); clearTemp(); toast('저장했습니다'); openPlace(p.id);
    });
    return wrap;
  }

  /* 지도 길게 누르기(모바일) / 오른쪽 클릭·더블탭 대신 길게 누르기 → 이 위치 저장 */
  var pressTimer = null, pressPt = null;
  function startPress(e) {
    if (e.originalEvent && e.originalEvent.touches && e.originalEvent.touches.length > 1) return;
    pressPt = e.point; clearTimeout(pressTimer);
    pressTimer = setTimeout(function () { pickPoint(e.lngLat); }, 600);
  }
  function cancelPress(e) {
    if (!pressPt) return;
    if (e && e.point && Math.hypot(e.point.x - pressPt.x, e.point.y - pressPt.y) < 8) return;   /* 손가락 떨림은 무시 */
    clearTimeout(pressTimer); pressPt = null;
  }
  map.on('touchstart', startPress);
  map.on('touchmove', cancelPress);
  map.on('touchend', function () { clearTimeout(pressTimer); pressPt = null; });
  map.on('dragstart', function () { clearTimeout(pressTimer); pressPt = null; });
  map.on('contextmenu', function (e) { pickPoint(e.lngLat); });   /* PC 오른쪽 클릭 (안드로이드는 길게 누르기에서도 발생) */
  var lastPick = 0;
  function pickPoint(ll) {
    if (Date.now() - lastPick < 1000) return;   /* 길게 누르기 + contextmenu 중복 방지 */
    lastPick = Date.now();
    hideResults();
    var r = { kind: '위치', name: '선택한 위치', addr: '', lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6) };
    var wrap = showCandidate(r, true);
    /* 주소는 받는 대로 채움 (실패해도 좌표로 저장 가능) */
    reverseGeocode(r.lat, r.lng).then(function (a) {
      if (tempMarker == null) return;
      var b = wrap.querySelector('b'), ad = wrap.querySelector('.pop-addr');
      if (!a) { if (ad) ad.textContent = r.lat.toFixed(5) + ', ' + r.lng.toFixed(5); return; }
      r.addr = a; r.name = a;
      if (b) b.textContent = a;
      if (ad) ad.textContent = '';
    });
  }

  /* ───────── 내 위치 ───────── */
  var meMarker = null;
  $('btnLocate').addEventListener('click', function () {
    if (!navigator.geolocation) { toast('이 기기에서는 위치를 확인할 수 없습니다'); return; }
    toast('현재 위치를 찾는 중…');
    navigator.geolocation.getCurrentPosition(function (pos) {
      var ll = [pos.coords.longitude, pos.coords.latitude];
      if (!meMarker) { var el = document.createElement('div'); el.className = 'me-dot'; meMarker = new maplibregl.Marker({ element: el }).setLngLat(ll).addTo(map); }
      else meMarker.setLngLat(ll);
      map.flyTo({ center: ll, zoom: Math.max(map.getZoom(), 16) });
    }, function (err) {
      toast(err && err.code === 1 ? '위치 권한이 꺼져 있습니다. 브라우저 설정에서 허용해 주세요.' : '현재 위치를 찾지 못했습니다');
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  });

  /* ───────── 주변정보 패널 (nearby.js) ───────── */
  $('btnNearby').addEventListener('click', function () {
    var body = openSheet('🧭 주변정보', '');
    try { window.OdigoNearby.render(body); }
    catch (e) { body.innerHTML = '<p class="muted">주변정보를 불러오지 못했습니다. 장소 저장·방문 기록은 그대로 사용할 수 있습니다.</p>'; }
  });

  /* ───────── 정보 · 백업 ───────── */
  $('btnInfo').addEventListener('click', function () {
    var body = openSheet('ⓘ 어디고 정보',
      '<p><b>어디고 ' + APP_VERSION + '</b> · 위치 현장조사지원</p>' +
      '<p class="muted">조사 장소를 찾고 저장하며 현장 방문을 지원하는 지도입니다.<br>' +
      '저장한 장소·메모·방문 기록은 <b>이 기기 브라우저에만</b> 저장되며 서버로 보내지 않습니다. 브라우저 데이터를 지우면 함께 지워지니 백업 파일을 저장해 두세요.</p>' +
      '<div class="row"><button class="btn" id="bkSave">💾 백업 파일 저장</button><label class="btn" style="display:inline-block">📂 백업 불러오기<input id="bkLoad" type="file" accept="application/json,.json" hidden></label></div>' +
      '<p class="muted">배경지도 © VWorld(국토교통부) · 검색 © Kakao<br>주변정보(주차장·CCTV·교통·치안)는 공공데이터 연결 후 단계별로 제공됩니다.</p>' +
      '<p class="muted">최초 빌드 2026.11.5 · by <b>Mr. Hyun</b> · <a href="https://ubaldos00-ship-it.github.io/" target="_blank" rel="noopener">텐두어 바로가기</a></p>');
    body.querySelector('#bkSave').addEventListener('click', function () {
      var blob = new Blob([JSON.stringify({ app: 'odigo', version: APP_VERSION, savedAt: new Date().toISOString(), places: places }, null, 1)], { type: 'application/json' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'odigo_backup_' + todayStr() + '.json';
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    });
    body.querySelector('#bkLoad').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var d = JSON.parse(rd.result);
          if (!d || d.app !== 'odigo' || !Array.isArray(d.places)) throw 0;
          var have = {}; places.forEach(function (p) { have[p.id] = true; });
          var add = d.places.filter(function (p) { return p && p.id && !have[p.id] && isFinite(p.lat) && isFinite(p.lng); });
          places = places.concat(add); persist(); toast(add.length + '개 장소를 불러왔습니다 (중복 제외)'); closeSheet();
        } catch (er) { toast('어디고 백업 파일이 아닙니다'); }
      };
      rd.readAsText(f);
    });
  });

  /* ───────── 접속 카운터 (텐아르 방식: 오늘 = max(서버 오늘, 실시간, 1)) ───────── */
  (function () {
    var rtEl = $('realtimeCount'), tdEl = $('todayCount'), totEl = $('totalCount'), pvEl = $('pageviewCount');
    var srvToday = 0, srvRealtime = 0;
    function renderToday() { tdEl.textContent = Math.max(srvToday || 0, srvRealtime || 0, 1).toLocaleString(); }
    renderToday();
    if (!GAS_URL) return;
    fetch(GAS_URL).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) return;
      if (typeof d.realtime === 'number') { srvRealtime = d.realtime; rtEl.textContent = d.realtime.toLocaleString(); }
      if (typeof d.today === 'number') srvToday = d.today;
      if (typeof d.total === 'number') totEl.textContent = d.total.toLocaleString();
      if (typeof d.pageviews === 'number') pvEl.textContent = d.pageviews.toLocaleString();
      renderToday();
    }).catch(function () {});
  })();

  /* 주변정보 모듈(nearby.js)이 쓰는 공용 기능 */
  window.OdigoApp = { map: map, openNav: openNav, openSheet: openSheet, closeSheet: closeSheet, toast: toast, regionOf: regionOf };

  renderMarkers();
  updateCounts();
})();
