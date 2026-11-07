/* 어디고 v1.8 — 「주변정보」 모듈
   · 설계: 설계/v1.5/어디고맵_주변정보_설계_v1.5.md
   · v1.9: 치안·안전정보 — 경찰청 범죄 발생 지역별 통계 표 (data/crime/crime.json)
   · v2.0: CCTV 설치 위치 (data/cctv/, 매주 자동 갱신)
   · v2.1: 교통 CCTV 영상 (ITS 실시간, 누를 때만 재생)
   · v2.2: 교통상황 (ITS 실시간 속도 + 표준노드링크 도로 모양)
   · v2.3: 치안·안전정보 지도 (생활안전지도 치안사고통계(전체) WMS)
   · v3.6: ITS 월 호출 한도 초과(4001)를 알아보고 「다음 달 1일 재개」 안내
   · v3.5: 교통상황 색 기준을 ITS 지도와 같은 제한속도 대비(80%/40%)로, 선 굵게
   · v2.6: 교통상황을 레이어 패널에서도 켜고 끌 수 있게 setTraffic·isOn 공개
   · v2.4: 치안 지도를 레이어 패널(layers.js)의 브이월드 중첩(경계·지적 등)보다 아래에 놓음
   · 연결 전 항목은 스위치 잠금·「준비 중」 — 임의 자료를 실제처럼 그리지 않는다.
   · 이 모듈이 실패해도 장소 저장·방문 기록(odigo.js)은 계속 동작하도록 분리. */
(function () {
  'use strict';

  /* status: 'wait' = 연결 전(스위치 비활성) / 'live' = 실제 자료 연결됨 */
  var LAYERS = [
    { id: 'parking', ico: 'P', color: '#1971c2', name: '주차장', stage: '1차',
      provider: '공공데이터포털 · 전국주차장정보표준데이터 (각 지자체)',
      basis: '기준일 불러오는 중…', status: 'live',
      note: '전체 주차면수는 빈자리 수가 아닙니다. 실시간 잔여면수는 제공하지 않습니다.' },
    { id: 'cctvLoc', ico: '◉', color: '#495057', name: 'CCTV 설치 위치', stage: '1차',
      provider: '행정안전부 · CCTV정보 조회서비스',
      basis: '기준일 불러오는 중…', status: 'live',
      note: '설치 위치 안내만 합니다. 작동 여부·촬영 범위는 알 수 없습니다.' },
    { id: 'traffic', ico: '≋', color: '#2f9e44', name: '교통상황', stage: '2차',
      provider: '국가교통정보센터(ITS) · 교통소통정보 + 표준노드링크',
      basis: '실시간 · 켜져 있을 때 2분마다 갱신 · 15분 지난 관측은 정보 없음', status: 'live',
      note: '상태는 국가교통정보센터 지도와 같은 제한속도 대비 기준: 원활 80% 이상 · 서행 40~80% · 정체 40% 미만. 경로 계산은 하지 않습니다.' },
    { id: 'cctvVideo', ico: '▶', color: '#1c7ed6', name: '교통 CCTV 영상', stage: '2차',
      provider: '국가교통정보센터(ITS) · 고속도로·국도 CCTV',
      basis: '실시간 · 재생을 누를 때만 영상을 불러옵니다', status: 'live',
      note: '점검·장애로 영상이 나오지 않을 수 있으며, 목적지 전체를 비추지 않습니다.' },
    { id: 'safety', ico: '!', color: '#7048e8', name: '치안·안전정보', stage: '3차',
      provider: '생활안전지도(행정안전부) · 경찰청 치안사고통계(전체)',
      basis: '최근 3년 9대 범죄 발생을 경찰서·지구대·파출소별 5등급으로 표시 · 갱신 1년', status: 'live',
      note: '표시 위치는 경찰관서이며, 개별 사건 발생 장소나 현재 위험도가 아닙니다.' }
  ];

  var state = {};   /* id → 켜짐 여부 */

  function app() { return window.OdigoApp; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ═════════════ 주차장 ═════════════ */
  var PARK_DIR = 'data/parking/';
  var PARK_MIN_ZOOM = 12;          /* 이보다 멀리 보면 받지 않음 (전국 자료를 한꺼번에 받지 않기) */
  var parkMeta = null, parkMetaP = null;
  var parkCells = {};              /* 격자 id → Promise<[주차장]> */
  var parkAll = {};                /* 'la,lo,n' → 주차장 (지도에 올린 것) */
  var parkLayersAdded = false, parkTimer = null, parkHintShown = false;

  function loadMeta() {
    if (parkMetaP) return parkMetaP;
    parkMetaP = fetch(PARK_DIR + 'meta.json').then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (m) {
        parkMeta = m; m._set = {}; m.cells.forEach(function (c) { m._set[c] = true; });
        var ds = Object.keys(m.referenceDates || {}).sort();
        LAYERS[0].basis = '전국 ' + m.count.toLocaleString() + '곳 · 기준일 지자체별 ' + (ds.length ? ds[0].slice(0, 7) + ' ~ ' + ds[ds.length - 1].slice(0, 7) : m.referenceDate) + ' · 반기 갱신';
        return m;
      })
      .catch(function () { parkMetaP = null; throw new Error('meta'); });
    return parkMetaP;
  }
  function loadCell(id) {
    if (!parkMeta._set[id]) return Promise.resolve([]);
    if (!parkCells[id]) {
      parkCells[id] = fetch(PARK_DIR + id + '.json').then(function (r) { if (!r.ok) throw 0; return r.json(); })
        .catch(function () { delete parkCells[id]; throw new Error('cell'); });
    }
    return parkCells[id];
  }
  function cellsInBox(s, w, n, e, cell) {
    var c = cell || parkMeta.cell, out = [];
    for (var a = Math.floor(s / c); a <= Math.floor(n / c); a++)
      for (var b = Math.floor(w / c); b <= Math.floor(e / c); b++) out.push(a + '_' + b);
    return out;
  }

  /* 지도 아이콘(P) — 글꼴 서버 없이 캔버스로 그림 */
  function makeIcon(bg) {
    var r = 2, s = 26 * r, cv = document.createElement('canvas'); cv.width = cv.height = s;
    var g = cv.getContext('2d');
    g.fillStyle = '#fff'; roundRect(g, 1 * r, 1 * r, 24 * r, 24 * r, 6 * r); g.fill();
    g.fillStyle = bg; roundRect(g, 3 * r, 3 * r, 20 * r, 20 * r, 5 * r); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold ' + (15 * r) + 'px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('P', 13 * r, 13.5 * r);
    return { width: s, height: s, data: g.getImageData(0, 0, s, s).data };
  }
  function roundRect(g, x, y, w, h, rad) { g.beginPath(); g.moveTo(x + rad, y); g.arcTo(x + w, y, x + w, y + h, rad); g.arcTo(x + w, y + h, x, y + h, rad); g.arcTo(x, y + h, x, y, rad); g.arcTo(x, y, x + w, y, rad); g.closePath(); }

  function ensureParkLayers() {
    var map = app().map;
    if (parkLayersAdded) return;
    parkLayersAdded = true;
    if (!map.hasImage('nb-park-pub')) map.addImage('nb-park-pub', makeIcon('#1971c2'), { pixelRatio: 2 });
    if (!map.hasImage('nb-park-pri')) map.addImage('nb-park-pri', makeIcon('#868e96'), { pixelRatio: 2 });
    map.addSource('nb-parking', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterMaxZoom: 14, clusterRadius: 42 });
    map.addLayer({ id: 'nb-parking-cluster', type: 'circle', source: 'nb-parking', filter: ['has', 'point_count'], minzoom: PARK_MIN_ZOOM,
      paint: { 'circle-color': 'rgba(25,113,194,.78)', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
        'circle-radius': ['step', ['get', 'point_count'], 11, 10, 15, 30, 19, 100, 24] } });
    map.addLayer({ id: 'nb-parking-pt', type: 'symbol', source: 'nb-parking', filter: ['!', ['has', 'point_count']], minzoom: PARK_MIN_ZOOM,
      layout: { 'icon-image': ['case', ['==', ['get', 'se'], '공영'], 'nb-park-pub', 'nb-park-pri'], 'icon-allow-overlap': true, 'icon-size': 1 } });
    map.on('click', 'nb-parking-pt', function (e) { var f = e.features && e.features[0]; if (f) showParkPopup(parkAll[f.properties.k]); });
    map.on('click', 'nb-parking-cluster', function (e) {
      var f = e.features[0];
      Promise.resolve(map.getSource('nb-parking').getClusterExpansionZoom(f.properties.cluster_id))
        .then(function (z) { map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(z, 18) }); });
    });
    ['nb-parking-pt', 'nb-parking-cluster'].forEach(function (id) {
      map.on('mouseenter', id, function () { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', id, function () { map.getCanvas().style.cursor = ''; });
    });
    map.on('moveend', function () { if (state.parking) { clearTimeout(parkTimer); parkTimer = setTimeout(refreshParking, 400); } });
  }

  /* 지도 스타일이 다 읽힌 뒤에만 레이어를 추가 */
  /* 지도 스타일이 바쁜 동안(처음 로딩·다른 레이어 추가 직후)에는 레이어를 추가할 수 없으므로 한가해질 때까지 기다림.
     ('load'는 처음 한 번만 오므로, 이미 지난 경우를 위해 'idle'과 짧은 재확인을 함께 사용) */
  function styleReady() {
    var map = app().map;
    /* isStyleLoaded()는 타일까지 다 받아야 true라, 레이어 추가 가능 여부는 스타일 자체(_loaded)로 판단 */
    function canAdd() { return (map.style && map.style._loaded) || map.isStyleLoaded(); }
    if (canAdd()) return Promise.resolve();
    return new Promise(function (res) {
      var done = false;
      function ok() { if (!done && canAdd()) { done = true; clearInterval(t); res(); } }
      var t = setInterval(ok, 200);
      map.once('idle', ok);
      map.once('load', ok);
      setTimeout(function () { if (!done) { done = true; clearInterval(t); res(); } }, 15000);
    });
  }

  function setParkVisible(on) {
    var map = app().map;
    ['nb-parking-cluster', 'nb-parking-pt'].forEach(function (id) { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); });
  }

  function pushToMap(list) {
    var changed = false;
    list.forEach(function (p) { var k = p.la + ',' + p.lo + ',' + p.n; if (!parkAll[k]) { parkAll[k] = p; changed = true; } });
    if (!changed) return;
    var feats = Object.keys(parkAll).map(function (k) {
      var p = parkAll[k];
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [p.lo, p.la] }, properties: { k: k, se: p.se } };
    });
    app().map.getSource('nb-parking').setData({ type: 'FeatureCollection', features: feats });
  }

  function refreshParking() {
    var map = app().map;
    if (!state.parking) return;
    if (map.getZoom() < PARK_MIN_ZOOM) {
      if (!parkHintShown) { parkHintShown = true; app().toast('지도를 더 확대하면 주차장이 보입니다'); }
      return;
    }
    var b = map.getBounds();
    var ids = cellsInBox(b.getSouth(), b.getWest(), b.getNorth(), b.getEast());
    if (ids.length > 30) return;   /* 안전장치 */
    Promise.all(ids.map(function (id) { return loadCell(id).catch(function () { return null; }); })).then(function (res) {
      if (res.some(function (x) { return x === null; })) app().toast('일부 주차장 정보를 불러오지 못했습니다');
      pushToMap([].concat.apply([], res.filter(Boolean)));
    });
  }

  function setParking(on) {
    state.parking = on;
    if (!on) { setParkVisible(false); return Promise.resolve(); }
    return Promise.all([loadMeta(), styleReady()]).then(function () {
      ensureParkLayers(); setParkVisible(true); parkHintShown = false; refreshParking();
    }).catch(function () { state.parking = false; app().toast('주차장 정보를 불러오지 못했습니다 · 잠시 후 다시 시도'); throw new Error('park'); });
  }

  /* 표시용 문구 */
  function hours(p) {
    function one(a) { return a[0] && a[1] ? (a[0] === '00:00' && (a[1] === '23:59' || a[1] === '24:00') ? '24시간' : a[0] + '~' + a[1]) : ''; }
    var wk = one(p.wk), sa = one(p.sa), ho = one(p.ho);
    if (!wk && !sa && !ho) return '정보 없음';
    if (wk && wk === sa && wk === ho) return wk;
    return ['평일 ' + (wk || '정보 없음'), '토 ' + (sa || '정보 없음'), '공휴일 ' + (ho || '정보 없음')].join(' · ');
  }
  function won(v) { var n = parseInt(v, 10); return isFinite(n) ? n.toLocaleString() + '원' : ''; }
  function fees(p) {
    if (p.fee === '무료') return '무료';
    var out = [];
    if (p.bt || p.bc) out.push('기본 ' + (p.bt ? p.bt + '분 ' : '') + (won(p.bc) || '요금 정보 없음'));
    if (p.ut || p.uc) out.push('추가 ' + (p.ut ? p.ut + '분당 ' : '') + (won(p.uc) || '정보 없음'));
    if (p.dt) out.push('1일 ' + won(p.dt));
    if (p.mt) out.push('월 ' + won(p.mt));
    return (p.fee || '요금') + (out.length ? ' · ' + out.join(' · ') : ' · 요금 상세 정보 없음');
  }
  function dist(aLat, aLng, bLat, bLng) {
    var R = 6371000, toR = Math.PI / 180, dLa = (bLat - aLat) * toR, dLo = (bLng - aLng) * toR;
    var h = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(aLat * toR) * Math.cos(bLat * toR) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function fmtDist(m) { return m < 1000 ? Math.round(m / 10) * 10 + 'm' : (m / 1000).toFixed(1) + 'km'; }

  function parkHtml(p) {
    return '<div class="pub-tag">공공데이터 · 주차장</div>' +
      '<b>' + esc(p.n) + '</b>' +
      '<div class="pop-addr">' + esc(p.a || '') + '</div>' +
      '<table class="kv">' +
      '<tr><th>구분</th><td>' + esc([p.se, p.ty].filter(Boolean).join(' · ') || '정보 없음') + '</td></tr>' +
      '<tr><th>요금</th><td>' + esc(fees(p)) + '</td></tr>' +
      '<tr><th>운영</th><td>' + esc((p.od ? p.od + ' · ' : '') + hours(p)) + '</td></tr>' +
      '<tr><th>주차면</th><td>' + (p.c ? '전체 ' + p.c.toLocaleString() + '면 <span class="muted">(빈자리 아님)</span>' : '정보 없음') + '</td></tr>' +
      '<tr><th>장애인전용</th><td>' + (p.dis === 'Y' ? '있음' : p.dis === 'N' ? '없음' : '정보 없음') + '</td></tr>' +
      (p.pay ? '<tr><th>결제</th><td>' + esc(p.pay) + '</td></tr>' : '') +
      (p.sp ? '<tr><th>특기</th><td>' + esc(p.sp) + '</td></tr>' : '') +
      '<tr><th>문의</th><td>' + esc([p.org, p.tel].filter(Boolean).join(' ') || '정보 없음') + '</td></tr>' +
      '</table>' +
      '<div class="src">기준일 ' + esc(p.ref || '정보 없음') + ' · 전국주차장정보표준데이터</div>';
  }
  var parkPopup = null;
  function showParkPopup(p) {
    if (!p) return;
    var map = app().map;
    if (parkPopup) parkPopup.remove();
    var wrap = document.createElement('div');
    wrap.className = 'pub-pop';
    wrap.innerHTML = parkHtml(p) + (app().mapAppBtns ? app().mapAppBtns(p.n, p.la, p.lo) : '') + '<button class="btn primary full" data-nav>🚗 이 주차장으로 길찾기</button>';
    wrap.querySelector('[data-nav]').addEventListener('click', function () { app().openNav(p.n, p.la, p.lo); });
    /* 팝업이 위쪽 검색창에 가리지 않도록 주차장을 화면 아래쪽(약 3/4 높이)으로 옮긴 뒤 띄움 */
    map.easeTo({ center: [p.lo, p.la], offset: [0, Math.round(map.getContainer().clientHeight * 0.22)], duration: 300 });
    parkPopup = new maplibregl.Popup({ offset: 16, maxWidth: '300px', closeOnClick: true, anchor: 'bottom' }).setLngLat([p.lo, p.la]).setDOMContent(wrap).addTo(map);
  }

  /* 주변 주차장 목록: kind = 'place'(선택한 조사 장소 기준) | 'me'(현재 위치 기준) */
  function parkingNear(lat, lng, label, kind) {
    var A = app();
    var body = A.openSheet('🅿 주변 주차장', '<p class="muted">주차장 정보를 불러오는 중…</p>');
    loadMeta().then(function () {
      var dLat = 0.02, dLng = 0.025;   /* 약 2km */
      var ids = cellsInBox(lat - dLat, lng - dLng, lat + dLat, lng + dLng);
      return Promise.all(ids.map(loadCell));
    }).then(function (res) {
      var all = [].concat.apply([], res).map(function (p) { return { p: p, d: dist(lat, lng, p.la, p.lo) }; });
      var radius = 500, list = [];
      [500, 1000, 2000].some(function (r) { radius = r; list = all.filter(function (x) { return x.d <= r; }); return list.length >= 3; });
      list.sort(function (a, b) { return a.d - b.d; });
      list = list.slice(0, 30);
      var head = (kind === 'me' ? '🧭 현재 위치' : '📍 ' + esc(label || '선택한 장소')) + ' 기준 · 반경 ' + fmtDist(radius) + ' · 직선거리';
      var html = '<div class="nb-intro">' + head + '<br>조사 목적지는 그대로 유지됩니다. 주차장을 누르면 지도에서 보고 길찾기를 열 수 있습니다.</div>';
      if (!list.length) html += '<p class="muted">반경 2km 안에 등록된 주차장 정보가 없습니다 (공공데이터 기준).</p>';
      list.forEach(function (x, i) {
        var p = x.p;
        html += '<button class="plist-item" data-i="' + i + '"><span class="num" style="background:' + (p.se === '공영' ? '#1971c2' : '#868e96') + '">P</span>' +
          '<span class="t"><b>' + esc(p.n) + '</b><span>' + esc([p.se, p.fee || '요금 정보 없음', p.c ? '전체 ' + p.c + '면' : ''].filter(Boolean).join(' · ')) + '</span></span>' +
          '<span class="chip">' + fmtDist(x.d) + '</span></button>';
      });
      html += '<p class="muted" style="margin-top:10px">전체 주차면수는 빈자리 수가 아닙니다 · 출처: 전국주차장정보표준데이터</p>';
      body.innerHTML = html;
      body.querySelectorAll('[data-i]').forEach(function (b) {
        b.addEventListener('click', function () {
          var p = list[+b.getAttribute('data-i')].p;
          A.closeSheet();
          setParking(true).catch(function () {}).then(function () {
            A.map.jumpTo({ zoom: Math.max(A.map.getZoom(), 16) });   /* 위치 이동은 showParkPopup이 함 */
            pushToMap([p]);
            showParkPopup(p);
          });
        });
      });
    }).catch(function () {
      body.innerHTML = '<p class="muted">주차장 정보를 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요. 장소 저장·방문 기록은 그대로 사용할 수 있습니다.</p>';
    });
  }
  function parkingNearMe() {
    if (!navigator.geolocation) { app().toast('이 기기에서는 위치를 확인할 수 없습니다'); return; }
    app().toast('현재 위치를 찾는 중…');
    navigator.geolocation.getCurrentPosition(function (pos) {
      parkingNear(pos.coords.latitude, pos.coords.longitude, '', 'me');
    }, function (err) {
      app().toast(err && err.code === 1 ? '위치 권한이 꺼져 있습니다' : '현재 위치를 찾지 못했습니다');
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  }

  /* ═════════════ CCTV 설치 위치 (v2.0) ═════════════
     · data/cctv/ 0.05° 격자 정적 파일 — 도구/odigo_data.py (GitHub Actions 매주 자동 갱신)
     · 행 = [위도, 경도, 대수, [설치목적 번호…], 주소, 관리기관, 전화, 촬영방면, 기준일]
     · 위치 안내만 함: 영상 버튼 없음, 작동 여부·촬영 범위를 단정하지 않음 */
  var CCTV_DIR = 'data/cctv/';
  var CCTV_MIN_ZOOM = 14;          /* 도심은 매우 촘촘해서 주차장보다 더 확대했을 때만 */
  var cctvMeta = null, cctvMetaP = null, cctvCells = {}, cctvAll = {};
  var cctvLayersAdded = false, cctvTimer = null, cctvHintShown = false, cctvPopup = null;

  function loadCctvMeta() {
    if (cctvMetaP) return cctvMetaP;
    cctvMetaP = fetch(CCTV_DIR + 'meta.json').then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (m) {
        cctvMeta = m; m._set = {}; m.cells.forEach(function (c) { m._set[c] = true; });
        LAYERS[1].basis = '전국 ' + m.places.toLocaleString() + '곳 · 카메라 ' + m.cameras.toLocaleString() + '대 · 기준일 ' + m.referenceDate + ' · 매주 자동 갱신';
        return m;
      })
      .catch(function () { cctvMetaP = null; throw new Error('meta'); });
    return cctvMetaP;
  }
  function loadCctvCell(id) {
    if (!cctvMeta._set[id]) return Promise.resolve([]);
    if (!cctvCells[id]) cctvCells[id] = fetch(CCTV_DIR + id + '.json').then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .catch(function () { delete cctvCells[id]; throw new Error('cell'); });
    return cctvCells[id];
  }
  function makeCamIcon() {
    var r = 2, s = 22 * r, cv = document.createElement('canvas'); cv.width = cv.height = s;
    var g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.beginPath(); g.arc(11 * r, 11 * r, 10 * r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#495057'; g.beginPath(); g.arc(11 * r, 11 * r, 8.5 * r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; roundRect(g, 5 * r, 8 * r, 9 * r, 6.5 * r, 1.5 * r); g.fill();          /* 몸체 */
    g.beginPath(); g.moveTo(14 * r, 10 * r); g.lineTo(17.5 * r, 8 * r); g.lineTo(17.5 * r, 14.5 * r); g.lineTo(14 * r, 12.5 * r); g.closePath(); g.fill();   /* 렌즈 */
    return { width: s, height: s, data: g.getImageData(0, 0, s, s).data };
  }
  function ensureCctvLayers() {
    var map = app().map;
    if (cctvLayersAdded) return;
    cctvLayersAdded = true;
    if (!map.hasImage('nb-cam')) map.addImage('nb-cam', makeCamIcon(), { pixelRatio: 2 });
    map.addSource('nb-cctv', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterMaxZoom: 16, clusterRadius: 36 });
    /* 주차장 레이어보다 아래에 깔리도록 (있으면 그 앞에 추가) */
    var before = map.getLayer('nb-parking-cluster') ? 'nb-parking-cluster' : undefined;
    map.addLayer({ id: 'nb-cctv-cluster', type: 'circle', source: 'nb-cctv', filter: ['has', 'point_count'], minzoom: CCTV_MIN_ZOOM,
      paint: { 'circle-color': 'rgba(73,80,87,.72)', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5,
        'circle-radius': ['step', ['get', 'point_count'], 9, 10, 12, 30, 15, 100, 19] } }, before);
    map.addLayer({ id: 'nb-cctv-pt', type: 'symbol', source: 'nb-cctv', filter: ['!', ['has', 'point_count']], minzoom: CCTV_MIN_ZOOM,
      layout: { 'icon-image': 'nb-cam', 'icon-allow-overlap': true } }, before);
    map.on('click', 'nb-cctv-pt', function (e) { var f = e.features && e.features[0]; if (f) showCctvPopup(cctvAll[f.properties.k]); });
    map.on('click', 'nb-cctv-cluster', function (e) {
      var f = e.features[0];
      Promise.resolve(map.getSource('nb-cctv').getClusterExpansionZoom(f.properties.cluster_id))
        .then(function (z) { map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(z, 19) }); });
    });
    ['nb-cctv-pt', 'nb-cctv-cluster'].forEach(function (id) {
      map.on('mouseenter', id, function () { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', id, function () { map.getCanvas().style.cursor = ''; });
    });
    map.on('moveend', function () { if (state.cctvLoc) { clearTimeout(cctvTimer); cctvTimer = setTimeout(refreshCctv, 400); } });
  }
  function setCctvVisible(on) {
    var map = app().map;
    ['nb-cctv-cluster', 'nb-cctv-pt'].forEach(function (id) { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); });
  }
  function refreshCctv() {
    var map = app().map;
    if (!state.cctvLoc) return;
    if (map.getZoom() < CCTV_MIN_ZOOM) {
      if (!cctvHintShown) { cctvHintShown = true; app().toast('지도를 더 확대하면 CCTV 위치가 보입니다'); }
      return;
    }
    var b = map.getBounds();
    var ids = cellsInBox(b.getSouth(), b.getWest(), b.getNorth(), b.getEast(), cctvMeta.cell);
    if (ids.length > 16) return;
    Promise.all(ids.map(function (id) { return loadCctvCell(id).catch(function () { return null; }); })).then(function (res) {
      if (res.some(function (x) { return x === null; })) app().toast('일부 CCTV 정보를 불러오지 못했습니다');
      var changed = false;
      res.filter(Boolean).forEach(function (lst) {
        lst.forEach(function (c) { var k = c[0] + ',' + c[1]; if (!cctvAll[k]) { cctvAll[k] = c; changed = true; } });
      });
      if (!changed) return;
      map.getSource('nb-cctv').setData({ type: 'FeatureCollection', features: Object.keys(cctvAll).map(function (k) {
        var c = cctvAll[k];
        return { type: 'Feature', geometry: { type: 'Point', coordinates: [c[1], c[0]] }, properties: { k: k } };
      }) });
    });
  }
  function setCctv(on) {
    state.cctvLoc = on;
    if (!on) { setCctvVisible(false); if (cctvPopup) cctvPopup.remove(); return Promise.resolve(); }
    return Promise.all([loadCctvMeta(), styleReady()]).then(function () {
      ensureCctvLayers(); setCctvVisible(true); cctvHintShown = false; refreshCctv();
    }).catch(function () { state.cctvLoc = false; app().toast('CCTV 정보를 불러오지 못했습니다 · 잠시 후 다시 시도'); throw new Error('cctv'); });
  }
  function showCctvPopup(c) {
    if (!c) return;
    var map = app().map;
    if (cctvPopup) cctvPopup.remove();
    var purposes = (c[3] || []).map(function (i) { return cctvMeta.purposes[i]; }).join(' · ') || '정보 없음';
    var wrap = document.createElement('div');
    wrap.className = 'pub-pop';
    wrap.innerHTML = '<div class="pub-tag">공공데이터 · CCTV 설치 위치</div>' +
      '<b>' + esc(purposes) + '</b>' +
      '<div class="pop-addr">' + esc(c[4] || '') + '</div>' + (app().mapAppBtns ? app().mapAppBtns('CCTV ' + (c[4] || ''), c[0], c[1]) : '') +
      '<table class="kv">' +
      '<tr><th>카메라</th><td>' + c[2] + '대</td></tr>' +
      (c[7] ? '<tr><th>촬영방면</th><td>' + esc(c[7]) + ' <span class="muted">(제공값)</span></td></tr>' : '') +
      '<tr><th>관리기관</th><td>' + esc([c[5], c[6]].filter(Boolean).join(' ') || '정보 없음') + '</td></tr>' +
      '</table>' +
      '<p class="crime-note" style="margin:0 0 6px">설치 위치 정보입니다. 현재 작동 여부와 촬영 범위는 알 수 없습니다.</p>' +
      '<div class="src">기준일 ' + esc(c[8] || '정보 없음') + ' · 행정안전부 CCTV정보 조회서비스</div>';
    map.easeTo({ center: [c[1], c[0]], offset: [0, Math.round(map.getContainer().clientHeight * 0.2)], duration: 300 });
    cctvPopup = new maplibregl.Popup({ offset: 12, maxWidth: '290px', closeOnClick: true, anchor: 'bottom' }).setLngLat([c[1], c[0]]).setDOMContent(wrap).addTo(map);
  }

  /* ═════════════ 교통상황 — ITS 교통소통정보 + 표준노드링크 도로 모양 (v2.2) ═════════════
     · 도로 모양: data/links/major(고속·국도·시도 등, 확대 11↑), minor(시군도, 확대 14↑) — 도구/build_links.py
     · 속도: 화면 범위만 ITS trafficInfo 실시간 조회, 켜져 있고 화면이 보일 때만 2분마다 갱신
     · 상태(v3.5): 국가교통정보센터 지도와 같은 「제한속도 대비」 기준 — 원활 80% 이상, 서행 40~80%, 정체 40% 미만
       (제한속도 = 표준노드링크 MAX_SPD. 제한속도가 없는 구간만 예전 어디고 기준 고속 70/40·그 외 30/15km/h)
     · 15분보다 오래된 관측·속도 없음 = 「정보 없음」(회색 점선) — 오래된 자료를 실시간처럼 칠하지 않음 */
  var LINK_DIR = 'data/links/';
  /* ITS 응답 공통 확인 (v3.6): 월 호출 한도 초과(resultCode 4001)를 알아보고 언제 재개되는지 안내 */
  var itsQuotaAt = 0;
  function itsResumeText() {
    var d = new Date(), n = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return (n.getMonth() + 1) + '월 1일';
  }
  function itsJson(r) {
    return r.json().catch(function () { return null; }).then(function (j) {
      var code = j && j.header && String(j.header.resultCode);
      if (code === '4001') { var e = new Error('quota'); e.quota = true; throw e; }
      if (!r.ok || !j) throw new Error('http');
      return j;
    });
  }
  function itsQuotaToast() {
    if (Date.now() - itsQuotaAt < 60000) return;
    itsQuotaAt = Date.now();
    app().toast('국가교통정보센터 이번 달 호출 한도가 다 차서 교통상황·교통 CCTV를 잠시 쓸 수 없습니다 · ' + itsResumeText() + ' 다시 열립니다(한도를 늘리면 바로 재개)');
  }
  var TRAFFIC_MIN_ZOOM = 11, MINOR_MIN_ZOOM = 14, TRAFFIC_REFRESH_MS = 120000, STALE_MIN = 15;
  var TRAFFIC_COLORS = { 1: '#2b9a3e', 2: '#f2b705', 3: '#d9230f', 0: '#adb5bd' };   /* ITS 지도와 비슷한 초록·노랑·빨강 */
  var TRAFFIC_LABEL = { 1: '원활', 2: '서행', 3: '정체', 0: '정보 없음' };
  var linkMeta = null, linkMetaP = null, linkCells = {}, links = {};   /* links[linkId] = {name, rank, coords} */
  var speeds = {}, trafficObservedAt = '', trafficLayersAdded = false, trafficTimer = null, trafficInterval = null, trafficAbort = null, trafficPopup = null, trafficHintShown = false;

  function loadLinkMeta() {
    if (!linkMetaP) linkMetaP = fetch(LINK_DIR + 'meta.json').then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (m) { m._major = {}; m._minor = {}; m.major.forEach(function (c) { m._major[c] = 1; }); m.minor.forEach(function (c) { m._minor[c] = 1; }); linkMeta = m; return m; })
      .catch(function () { linkMetaP = null; throw new Error('meta'); });
    return linkMetaP;
  }
  function loadLinkCell(group, id) {
    if (!linkMeta['_' + group][id]) return Promise.resolve(false);
    var key = group + '/' + id;
    if (!linkCells[key]) linkCells[key] = fetch(LINK_DIR + key + '.json').then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (d) {
      d.l.forEach(function (r) {
        var e = r[3], co = [], x = 0, y = 0;
        for (var i = 0; i < e.length; i += 2) { x += e[i]; y += e[i + 1]; co.push([x / 1e5, y / 1e5]); }
        links[r[0]] = { name: d.n[r[1]] || '', rank: r[2], coords: co, ms: r[4] || 0 };
      });
      return true;
    }).catch(function () { delete linkCells[key]; throw new Error('cell'); });
    return linkCells[key];
  }
  function trafficStatus(rank, spd, t, ms) {
    if (spd == null || !t) return 0;
    var y = +t.slice(0, 4), mo = +t.slice(4, 6) - 1, d = +t.slice(6, 8), h = +t.slice(8, 10), mi = +t.slice(10, 12);
    if ((Date.now() - new Date(y, mo, d, h, mi).getTime()) / 60000 > STALE_MIN) return 0;   /* 기기 시각 = 한국 시간 가정 */
    if (ms > 0) { var q = spd / ms; return q >= 0.8 ? 1 : q >= 0.4 ? 2 : 3; }   /* ITS 지도와 같은 제한속도 대비 */
    var fast = rank === 101 || rank === 102;   /* 고속국도·도시고속도로 */
    if (fast) return spd >= 70 ? 1 : spd >= 40 ? 2 : 3;
    return spd >= 30 ? 1 : spd >= 15 ? 2 : 3;
  }
  function fmtObs(t) { return t ? t.slice(0, 4) + '.' + t.slice(4, 6) + '.' + t.slice(6, 8) + ' ' + t.slice(8, 10) + ':' + t.slice(10, 12) : '정보 없음'; }

  function ensureTrafficLayers() {
    var map = app().map;
    if (trafficLayersAdded) return;
    trafficLayersAdded = true;
    map.addSource('nb-traffic', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    /* 아이콘 레이어(주차장·CCTV)보다 아래 */
    var before = ['nb-parking-cluster', 'nb-cctv-cluster', 'nb-vcam-cluster'].filter(function (id) { return map.getLayer(id); })[0];
    map.addLayer({ id: 'nb-traffic-none', type: 'line', source: 'nb-traffic', filter: ['==', ['get', 'st'], 0], minzoom: TRAFFIC_MIN_ZOOM,
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': TRAFFIC_COLORS[0], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.2, 16, 3], 'line-dasharray': [2, 2], 'line-offset': ['interpolate', ['linear'], ['zoom'], 11, 0.8, 16, 2.5], 'line-opacity': 0.8 } }, before);
    map.addLayer({ id: 'nb-traffic-line', type: 'line', source: 'nb-traffic', filter: ['>', ['get', 'st'], 0], minzoom: TRAFFIC_MIN_ZOOM,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['match', ['get', 'st'], 1, TRAFFIC_COLORS[1], 2, TRAFFIC_COLORS[2], 3, TRAFFIC_COLORS[3], TRAFFIC_COLORS[0]],
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 14, 3.5, 17, 6], 'line-offset': ['interpolate', ['linear'], ['zoom'], 11, 1, 16, 3], 'line-opacity': 0.95 } }, before);
    ['nb-traffic-line', 'nb-traffic-none'].forEach(function (id) {
      map.on('click', id, function (e) { var f = e.features && e.features[0]; if (f) showTrafficPopup(f.properties.lid, e.lngLat); });
      map.on('mouseenter', id, function () { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', id, function () { map.getCanvas().style.cursor = ''; });
    });
    map.on('moveend', function () { if (state.traffic) { clearTimeout(trafficTimer); trafficTimer = setTimeout(function () { refreshTraffic(false); }, 500); } });
    document.addEventListener('visibilitychange', function () {
      if (!state.traffic) return;
      if (document.hidden) stopTrafficTimer(); else { refreshTraffic(true); startTrafficTimer(); }
    });
  }
  function setTrafficVisible(on) {
    var map = app().map;
    ['nb-traffic-line', 'nb-traffic-none'].forEach(function (id) { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); });
  }
  function startTrafficTimer() { stopTrafficTimer(); trafficInterval = setInterval(function () { if (!document.hidden) refreshTraffic(true); }, TRAFFIC_REFRESH_MS); }
  function stopTrafficTimer() { if (trafficInterval) { clearInterval(trafficInterval); trafficInterval = null; } }

  function renderTraffic() {
    var map = app().map, b = map.getBounds(), z = map.getZoom();
    var s = b.getSouth(), w = b.getWest(), n = b.getNorth(), e = b.getEast(), feats = [];
    Object.keys(links).forEach(function (lid) {
      var L = links[lid];
      if (L.rank === 107 && z < MINOR_MIN_ZOOM) return;
      var c = L.coords, inView = false;
      for (var i = 0; i < c.length; i++) { if (c[i][0] >= w && c[i][0] <= e && c[i][1] >= s && c[i][1] <= n) { inView = true; break; } }
      if (!inView) return;
      var sp = speeds[lid];
      feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: c },
        properties: { lid: lid, st: trafficStatus(L.rank, sp ? sp.v : null, sp ? sp.t : '', L.ms) } });
    });
    map.getSource('nb-traffic').setData({ type: 'FeatureCollection', features: feats });
  }

  function refreshTraffic(speedOnly) {
    var map = app().map;
    if (!state.traffic) return;
    var z = map.getZoom();
    if (z < TRAFFIC_MIN_ZOOM) {
      if (!trafficHintShown) { trafficHintShown = true; app().toast('지도를 더 확대하면 교통상황이 보입니다'); }
      return;
    }
    var b = map.getBounds();
    if ((b.getEast() - b.getWest()) > 0.8) return;   /* 너무 넓은 범위는 조회하지 않음 */
    var ids = cellsInBox(b.getSouth(), b.getWest(), b.getNorth(), b.getEast(), linkMeta.cell);
    var shapes = speedOnly ? Promise.resolve() : Promise.all(ids.map(function (id) { return loadLinkCell('major', id); })
      .concat(z >= MINOR_MIN_ZOOM ? ids.map(function (id) { return loadLinkCell('minor', id); }) : []));
    if (trafficAbort) trafficAbort.abort();
    trafficAbort = new AbortController();
    var sig = trafficAbort.signal;
    var u = 'https://openapi.its.go.kr:9443/trafficInfo?apiKey=' + encodeURIComponent(ITS_KEY) + '&type=all&minX=' + b.getWest().toFixed(5) + '&maxX=' + b.getEast().toFixed(5) +
      '&minY=' + b.getSouth().toFixed(5) + '&maxY=' + b.getNorth().toFixed(5) + '&getType=json';
    var sp = fetch(u, { signal: sig }).then(itsJson).then(function (j) {
      var items = ((j.body || (j.response && j.response.body) || {}).items) || [];
      if (!Array.isArray(items)) items = [items];
      var latest = '';
      items.forEach(function (it) {
        var v = parseFloat(it.speed);
        speeds[String(it.linkId)] = { v: isFinite(v) ? v : null, t: String(it.createdDate || ''), dir: it.roadDrcType || '', s: it.startNodeId, e: it.endNodeId };
        if (it.createdDate > latest) latest = String(it.createdDate);
      });
      if (latest) trafficObservedAt = latest;
    });
    Promise.all([shapes, sp]).then(function () { if (!sig.aborted) renderTraffic(); })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return;
        if (err && err.quota) itsQuotaToast(); else app().toast('교통상황을 불러오지 못했습니다 · 잠시 후 다시 시도');
        if (!sig.aborted) renderTraffic();   /* 도로 모양은 그대로, 속도 없으면 「정보 없음」 */
      });
  }
  function setTraffic(on) {
    state.traffic = on;
    if (!on) { setTrafficVisible(false); stopTrafficTimer(); if (trafficAbort) trafficAbort.abort(); if (trafficPopup) trafficPopup.remove(); return Promise.resolve(); }
    return Promise.all([loadLinkMeta(), styleReady()]).then(function () {
      ensureTrafficLayers(); setTrafficVisible(true); trafficHintShown = false; refreshTraffic(false); startTrafficTimer();
    }).catch(function () { state.traffic = false; app().toast('교통상황을 불러오지 못했습니다 · 잠시 후 다시 시도'); throw new Error('traffic'); });
  }
  function showTrafficPopup(lid, lngLat) {
    var L = links[lid]; if (!L) return;
    var sp = speeds[lid] || {}, st = trafficStatus(L.rank, sp.v, sp.t, L.ms);
    var RANK = { 101: '고속국도', 102: '도시고속도로', 103: '일반국도', 104: '특별·광역시도', 105: '국가지원지방도', 106: '지방도', 107: '시군도' };
    var wrap = document.createElement('div');
    wrap.className = 'pub-pop';
    wrap.innerHTML = '<div class="pub-tag">공공데이터 · 교통상황</div><b>' + esc(L.name || '도로명 없음') + '</b>' +
      '<table class="kv">' +
      '<tr><th>상태</th><td><span class="tr-dot" style="background:' + TRAFFIC_COLORS[st] + '"></span>' + TRAFFIC_LABEL[st] + '</td></tr>' +
      '<tr><th>평균속도</th><td>' + (sp.v != null && st ? sp.v + ' km/h' + (L.ms ? ' <small>(제한 ' + L.ms + ' 의 ' + Math.round(sp.v / L.ms * 100) + '%)</small>' : '') : '정보 없음') + '</td></tr>' +
      '<tr><th>도로</th><td>' + esc(RANK[L.rank] || '기타') + (sp.dir ? ' · ' + esc(sp.dir) : '') + '</td></tr>' +
      '<tr><th>관측시각</th><td>' + esc(fmtObs(sp.t)) + '</td></tr>' +
      '</table>' +
      '<div class="src">국가교통정보센터(ITS) · 상태 = 제한속도 대비(원활 80%↑·서행 40~80%·정체 40%↓, ITS 지도와 같은 기준) · 구간 ' + esc(lid) + '</div>';
    if (trafficPopup) trafficPopup.remove();
    trafficPopup = new maplibregl.Popup({ maxWidth: '280px', closeOnClick: true }).setLngLat(lngLat).setDOMContent(wrap).addTo(app().map);
  }

  /* ═════════════ 교통 CCTV 영상 — 국가교통정보센터 ITS (v2.1) ═════════════
     · 화면에 보이는 범위만 실시간 조회(고속도로 ex + 국도 its, 실시간 스트리밍 cctvType=1)
     · 재생은 사용자가 누를 때만, 그 순간 새 영상 주소를 받아 https로 바꿔 재생(주소에 시간 제한 토큰 있음)
     · 창을 닫거나 레이어를 끄면 재생·통신 중단
     · ※ ITS 키는 도메인 제한이 없어 화면에 노출됨 — 추후 중계 서버로 옮길 예정(사용자 결정 2026-11-06) */
  var ITS_KEY = '94125f6fec5e421f9e74a6fe697afdb1';
  var ITS_CCTV = 'https://openapi.its.go.kr:9443/cctvInfo';
  var VCAM_MIN_ZOOM = 9;
  var vcamAll = {}, vcamLayersAdded = false, vcamTimer = null, vcamAbort = null, vcamPopup = null, vcamHintShown = false;
  var hlsP = null, player = null;

  function itsCctv(type, s, w, n, e, signal) {
    var u = ITS_CCTV + '?apiKey=' + encodeURIComponent(ITS_KEY) + '&type=' + type + '&cctvType=1&minX=' + w.toFixed(5) + '&maxX=' + e.toFixed(5) +
      '&minY=' + s.toFixed(5) + '&maxY=' + n.toFixed(5) + '&getType=json';
    return fetch(u, { signal: signal }).then(itsJson).then(function (j) {
      var d = (j.response && j.response.data) || j.data || [];
      if (!Array.isArray(d)) d = [d];
      return d.filter(function (x) { return x && x.cctvname; }).map(function (x) {
        return { name: x.cctvname, lng: +x.coordx, lat: +x.coordy, url: x.cctvurl || '', fmt: x.cctvformat || '', type: type };
      });
    });
  }
  function makeVcamIcon() {
    var r = 2, s = 22 * r, cv = document.createElement('canvas'); cv.width = cv.height = s;
    var g = cv.getContext('2d');
    g.fillStyle = '#fff'; roundRect(g, 1 * r, 1 * r, 20 * r, 20 * r, 5 * r); g.fill();
    g.fillStyle = '#1c7ed6'; roundRect(g, 2.5 * r, 2.5 * r, 17 * r, 17 * r, 4 * r); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(8.5 * r, 6.5 * r); g.lineTo(15.5 * r, 11 * r); g.lineTo(8.5 * r, 15.5 * r); g.closePath(); g.fill();
    return { width: s, height: s, data: g.getImageData(0, 0, s, s).data };
  }
  function ensureVcamLayers() {
    var map = app().map;
    if (vcamLayersAdded) return;
    vcamLayersAdded = true;
    if (!map.hasImage('nb-vcam')) map.addImage('nb-vcam', makeVcamIcon(), { pixelRatio: 2 });
    map.addSource('nb-vcam', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterMaxZoom: 12, clusterRadius: 30 });
    map.addLayer({ id: 'nb-vcam-cluster', type: 'circle', source: 'nb-vcam', filter: ['has', 'point_count'], minzoom: VCAM_MIN_ZOOM,
      paint: { 'circle-color': 'rgba(28,126,214,.8)', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5,
        'circle-radius': ['step', ['get', 'point_count'], 9, 10, 12, 30, 15] } });
    map.addLayer({ id: 'nb-vcam-pt', type: 'symbol', source: 'nb-vcam', filter: ['!', ['has', 'point_count']], minzoom: VCAM_MIN_ZOOM,
      layout: { 'icon-image': 'nb-vcam', 'icon-allow-overlap': true } });
    map.on('click', 'nb-vcam-pt', function (e) { var f = e.features && e.features[0]; if (f) showVcamPopup(vcamAll[f.properties.k]); });
    map.on('click', 'nb-vcam-cluster', function (e) {
      var f = e.features[0];
      Promise.resolve(map.getSource('nb-vcam').getClusterExpansionZoom(f.properties.cluster_id))
        .then(function (z) { map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(z, 16) }); });
    });
    ['nb-vcam-pt', 'nb-vcam-cluster'].forEach(function (id) {
      map.on('mouseenter', id, function () { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', id, function () { map.getCanvas().style.cursor = ''; });
    });
    map.on('moveend', function () { if (state.cctvVideo) { clearTimeout(vcamTimer); vcamTimer = setTimeout(refreshVcam, 600); } });
  }
  function setVcamVisible(on) {
    var map = app().map;
    ['nb-vcam-cluster', 'nb-vcam-pt'].forEach(function (id) { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); });
  }
  function refreshVcam() {
    var map = app().map;
    if (!state.cctvVideo) return;
    if (map.getZoom() < VCAM_MIN_ZOOM) {
      if (!vcamHintShown) { vcamHintShown = true; app().toast('지도를 더 확대하면 교통 CCTV가 보입니다'); }
      return;
    }
    if (vcamAbort) vcamAbort.abort();
    vcamAbort = new AbortController();
    var b = map.getBounds(), sig = vcamAbort.signal;
    Promise.all(['ex', 'its'].map(function (t) { return itsCctv(t, b.getSouth(), b.getWest(), b.getNorth(), b.getEast(), sig).catch(function (e) { if (e && e.quota) itsQuotaToast(); return e && (e.name === 'AbortError' || e.quota) ? [] : null; }); }))
      .then(function (res) {
        if (sig.aborted) return;
        if (res.every(function (x) { return x === null; })) { app().toast('교통 CCTV 정보를 불러오지 못했습니다'); return; }
        var changed = false;
        res.filter(Boolean).forEach(function (lst) { lst.forEach(function (c) { var k = c.name + '@' + c.lat.toFixed(4) + ',' + c.lng.toFixed(4); if (!vcamAll[k]) { vcamAll[k] = c; changed = true; } }); });
        if (!changed) return;
        map.getSource('nb-vcam').setData({ type: 'FeatureCollection', features: Object.keys(vcamAll).map(function (k) {
          var c = vcamAll[k]; return { type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] }, properties: { k: k } };
        }) });
      });
  }
  function setVcam(on) {
    state.cctvVideo = on;
    if (!on) { setVcamVisible(false); stopPlayer(); if (vcamPopup) vcamPopup.remove(); if (vcamAbort) vcamAbort.abort(); return Promise.resolve(); }
    return styleReady().then(function () { ensureVcamLayers(); setVcamVisible(true); vcamHintShown = false; refreshVcam(); });
  }
  function showVcamPopup(c) {
    if (!c) return;
    var map = app().map;
    if (vcamPopup) vcamPopup.remove();
    var wrap = document.createElement('div');
    wrap.className = 'pub-pop';
    wrap.innerHTML = '<div class="pub-tag">공공데이터 · 교통 CCTV</div><b>' + esc(c.name) + '</b>' + (app().mapAppBtns ? app().mapAppBtns(c.name, c.lat, c.lng) : '') +
      '<table class="kv"><tr><th>도로</th><td>' + (c.type === 'ex' ? '고속도로' : '국도') + '</td></tr>' +
      '<tr><th>영상 제공</th><td>' + (c.url ? '예 · 실시간 (' + esc(c.fmt || '스트리밍') + ')' : '아니오') + '</td></tr></table>' +
      '<p class="crime-note" style="margin:0 0 6px">점검·장애로 영상이 나오지 않을 수 있으며, 카메라가 목적지 전체를 비추지 않습니다.</p>' +
      (c.url ? '<button class="btn primary full" data-play>▶ 영상 보기</button>' : '') +
      '<div class="src" style="margin-top:6px">국가교통정보센터(ITS)</div>';
    var pb = wrap.querySelector('[data-play]');
    if (pb) pb.addEventListener('click', function () { if (vcamPopup) vcamPopup.remove(); playVcam(c); });
    map.easeTo({ center: [c.lng, c.lat], offset: [0, Math.round(map.getContainer().clientHeight * 0.18)], duration: 300 });
    vcamPopup = new maplibregl.Popup({ offset: 12, maxWidth: '280px', closeOnClick: true, anchor: 'bottom' }).setLngLat([c.lng, c.lat]).setDOMContent(wrap).addTo(map);
  }
  function loadHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (!hlsP) hlsP = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js';
      s.onload = function () { res(window.Hls); }; s.onerror = function () { hlsP = null; rej(new Error('hls')); };
      document.head.appendChild(s);
    });
    return hlsP;
  }
  function stopPlayer() {
    if (!player) return;
    try { if (player.hls) player.hls.destroy(); } catch (e) {}
    try { player.video.pause(); player.video.removeAttribute('src'); player.video.load(); } catch (e) {}
    if (player.obs) player.obs.disconnect();
    player = null;
  }
  function playVcam(c) {
    var A = app();
    stopPlayer();
    var body = A.openSheet('▶ ' + c.name, '<div class="vbox"><video playsinline muted controls autoplay></video><div class="vmsg">영상 주소를 받는 중…</div></div>' +
      '<p class="muted" style="margin-top:8px">국가교통정보센터 공개 교통 CCTV · 점검·장애로 영상이 나오지 않을 수 있습니다 · 창을 닫으면 재생이 멈춥니다.</p>' +
      '<p class="muted"><a href="https://www.its.go.kr/" target="_blank" rel="noopener">국가교통정보센터에서 보기 ↗</a></p>');
    var video = body.querySelector('video'), msg = body.querySelector('.vmsg');
    var me = player = { video: video, hls: null, obs: null };
    /* 시트가 닫히거나 다른 내용으로 바뀌면 재생 중단 */
    var sheet = document.getElementById('sheet');
    me.obs = new MutationObserver(function () { if (sheet.hidden || !document.body.contains(video)) { if (player === me) stopPlayer(); } });
    me.obs.observe(sheet, { attributes: true, attributeFilter: ['hidden'] });
    me.obs.observe(document.getElementById('sheetBody'), { childList: true });
    function fail(t) { if (player === me) { msg.textContent = t; msg.hidden = false; } }

    /* 재생 순간 새 주소 받기 (같은 카메라를 좁은 범위로 다시 조회) */
    var d = 0.003;
    itsCctv(c.type, c.lat - d, c.lng - d, c.lat + d, c.lng + d).then(function (lst) {
      var hit = lst.filter(function (x) { return x.name === c.name; })[0] || lst[0];
      var url = (hit && hit.url) || c.url;
      if (!url) throw new Error('nourl');
      url = url.replace(/^http:\/\//, 'https://');      /* https 페이지에서 재생 가능하도록 (실측: 같은 주소 https 제공) */
      if (player !== me) return;
      if (video.canPlayType('application/vnd.apple.mpegurl')) {           /* Safari·iOS: 기본 재생 */
        video.src = url; video.addEventListener('playing', function () { msg.hidden = true; }, { once: true });
        video.addEventListener('error', function () { fail('영상을 재생하지 못했습니다. 잠시 후 다시 시도하거나 국가교통정보센터에서 확인해 주세요.'); }, { once: true });
        return;
      }
      return loadHls().then(function (Hls) {
        if (player !== me) return;
        if (!Hls.isSupported()) { fail('이 브라우저에서는 영상을 재생할 수 없습니다.'); return; }
        var h = me.hls = new Hls({ lowLatencyMode: false, maxBufferLength: 10 });
        h.loadSource(url); h.attachMedia(video);
        h.on(Hls.Events.MANIFEST_PARSED, function () { msg.hidden = true; video.play().catch(function () {}); });
        h.on(Hls.Events.ERROR, function (ev, data) { if (data && data.fatal) { fail('영상을 재생하지 못했습니다 (카메라 점검 또는 연결 문제).'); try { h.destroy(); } catch (e) {} } });
      });
    }).catch(function (e) { fail(e && e.quota ? '국가교통정보센터 이번 달 호출 한도가 다 차서 영상을 열 수 없습니다. ' + itsResumeText() + ' 다시 열립니다.' : '영상 주소를 받지 못했습니다. 잠시 후 다시 시도해 주세요.'); });
  }

  /* ═════════════ 치안·안전정보 지도 — 생활안전지도 WMS 치안사고통계(전체) IF_0075 (v2.3) ═════════════
     · 이미지(WMS)를 그대로 겹쳐 보기만 함 — 공공누리 4유형(출처표시·상업적 이용 금지·변경 금지): 색·기호를 바꾸지 않음
     · 키는 생활안전지도에 사이트 주소를 등록해 발급받은 키(화면 노출 전제)
     · 기본 불투명도 60%(투명도 40%), 사용자가 조절 */
  var SAFEMAP_KEY = 'NBZPCVU2-NBZP-NBZP-NBZP-NBZPCVU2L2';
  var SAFETY_MIN_ZOOM = 11, safetyAdded = false, safetyOpacity = 0.6;
  function ensureSafetyLayer() {
    var map = app().map;
    if (safetyAdded) return;
    safetyAdded = true;
    map.addSource('nb-safety', { type: 'raster', tileSize: 512, minzoom: SAFETY_MIN_ZOOM,
      tiles: ['https://www.safemap.go.kr/openapi2/IF_0075_WMS?serviceKey=' + encodeURIComponent(SAFEMAP_KEY) +
        '&srs=EPSG:3857&bbox={bbox-epsg-3857}&format=image/png&width=512&height=512&transparent=TRUE'],
      attribution: '치안정보 © <a href="https://www.safemap.go.kr" target="_blank" rel="noopener">생활안전지도</a>(행정안전부)·경찰청, 공공누리 4유형' });
    /* 내 장소 핀(HTML)·아이콘·교통선보다 아래, 배경지도 바로 위 */
    var ovFirst = map.getStyle().layers.filter(function (l) { return l.id.indexOf('ov-') === 0; })[0];   /* v2.4 레이어 패널 중첩보다 아래 */
    var before = (ovFirst && ovFirst.id) || ['nb-traffic-none', 'nb-traffic-line', 'nb-cctv-cluster', 'nb-parking-cluster', 'nb-vcam-cluster'].filter(function (id) { return map.getLayer(id); })[0];
    map.addLayer({ id: 'nb-safety', type: 'raster', source: 'nb-safety', minzoom: SAFETY_MIN_ZOOM, paint: { 'raster-opacity': safetyOpacity } }, before);
  }
  function setSafety(on) {
    state.safety = on;
    var map = app().map;
    if (!on) { if (map.getLayer('nb-safety')) map.setLayoutProperty('nb-safety', 'visibility', 'none'); return Promise.resolve(); }
    return styleReady().then(function () {
      ensureSafetyLayer();
      map.setLayoutProperty('nb-safety', 'visibility', 'visible');
      if (map.getZoom() < SAFETY_MIN_ZOOM) app().toast('지도를 더 확대하면 치안정보가 보입니다');
    });
  }
  function setSafetyOpacity(v) {
    safetyOpacity = v;
    var map = app().map;
    if (map.getLayer('nb-safety')) map.setPaintProperty('nb-safety', 'raster-opacity', v);
  }

  /* ═════════════ 치안·안전정보 — 경찰청 범죄 발생 지역별 통계 (v1.9) ═════════════
     · data/crime/crime.json (도구/build_crime.py) — 시군구별 연간 발생 건수, 키 불필요
     · 지도에 색칠·순위·자체 위험지표를 만들지 않고, 장소가 속한 시군구의 표만 보여 준다. */
  var crimeP = null;
  function loadCrime() {
    if (!crimeP) crimeP = fetch('data/crime/crime.json').then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .catch(function () { crimeP = null; throw new Error('crime'); });
    return crimeP;
  }
  /* 행정구역 1단계 이름(정식·약칭·개편 전후) → 통계의 시도 표기 */
  var SIDO = {
    '서울': '서울', '서울특별시': '서울', '부산': '부산', '부산광역시': '부산', '대구': '대구', '대구광역시': '대구',
    '인천': '인천', '인천광역시': '인천', '광주': '광주', '광주광역시': '광주', '대전': '대전', '대전광역시': '대전',
    '울산': '울산', '울산광역시': '울산', '세종': '세종', '세종특별자치시': '세종',
    '경기': '경기도', '경기도': '경기도', '강원': '강원도', '강원도': '강원도', '강원특별자치도': '강원도',
    '충북': '충북', '충청북도': '충북', '충남': '충남', '충청남도': '충남',
    '전북': '전북', '전라북도': '전북', '전북특별자치도': '전북', '전남': '전남', '전라남도': '전남',
    '경북': '경북', '경상북도': '경북', '경남': '경남', '경상남도': '경남', '제주': '제주', '제주특별자치도': '제주'
  };
  var GWANGJU_GU = { '동구': 1, '서구': 1, '남구': 1, '북구': 1, '광산구': 1 };
  function crimeKey(data, r1, r2) {
    r1 = (r1 || '').trim(); r2 = (r2 || '').trim().split(/\s+/)[0] || '';   /* '수원시 장안구' → '수원시' */
    var sido = SIDO[r1];
    if (!sido && /광주/.test(r1) && /전남|전라남/.test(r1)) sido = GWANGJU_GU[r2] ? '광주' : '전남';   /* 통합 시도명 대비 */
    if (sido === '세종') return data.regions['세종시'] ? '세종시' : null;
    if (sido && data.regions[sido + ' ' + r2]) return sido + ' ' + r2;
    if (!r2) return null;
    var hit = Object.keys(data.regions).filter(function (k) { return k.split(' ')[1] === r2; });   /* 시도 표기가 달라도 시군구가 하나뿐이면 사용 */
    return hit.length === 1 ? hit[0] : null;
  }
  /* 주소 문자열에서 1·2단계 추출 (카카오 연결 실패 시 대비) */
  function regionFromAddr(addr) {
    var t = String(addr || '').trim().split(/\s+/);
    return t.length >= 2 ? { r1: t[0], r2: t[1] } : null;
  }

  function crimeSheet(lat, lng, label, addr) {
    var A = app();
    var body = A.openSheet('🛡 치안·안전정보', '<p class="muted">지역을 확인하는 중…</p>');
    var regionP = (A.regionOf ? A.regionOf(lat, lng) : Promise.resolve(null)).then(function (r) { return r || regionFromAddr(addr); });
    Promise.all([loadCrime(), regionP]).then(function (res) {
      var data = res[0], rg = res[1];
      var key = rg ? crimeKey(data, rg.r1, rg.r2) : null;
      var m = data.meta;
      var foot = '<p class="muted" style="margin-top:10px">' + esc(m.source) + ' · ' + m.year + '년 · ' + esc(m.scope) +
        ' · 공공데이터포털 등록 ' + esc(m.updated) + ' · <a href="' + esc(m.url) + '" target="_blank" rel="noopener">원자료</a></p>';
      if (!key) {
        body.innerHTML = '<div class="nb-intro">' + esc(label || '선택한 위치') + '</div>' +
          '<p class="muted">' + (rg ? esc(rg.r1 + ' ' + rg.r2) + ' 지역의 통계를 찾지 못했습니다.' : '이 위치의 시·군·구를 확인하지 못했습니다. 인터넷 연결을 확인해 주세요.') + '</p>' + foot;
        return;
      }
      var v = data.regions[key], groups = [], gi = {}, total = 0;
      data.types.forEach(function (t, i) {
        if (gi[t[0]] == null) { gi[t[0]] = groups.length; groups.push({ name: t[0], sum: 0, items: [] }); }
        var g = groups[gi[t[0]]]; g.sum += v[i]; g.items.push([t[1], v[i]]); total += v[i];
      });
      var html = '<div class="nb-intro">📍 ' + esc(label || '선택한 위치') + '<br><b>' + esc(key) + '</b> · ' + m.year + '년 범죄 발생 건수 합계 <b>' + total.toLocaleString() + '건</b></div>' +
        '<p class="crime-note">인구·면적을 반영하지 않은 <b>시·군·구 전체</b>의 연간 발생 건수입니다. 개별 사건의 발생 장소나 이 장소의 위험도를 뜻하지 않습니다.</p>';
      groups.forEach(function (g) {
        var single = g.items.length === 1 && g.items[0][0] === g.name;
        if (single) {
          html += '<div class="crime-row"><span>' + esc(g.name) + '</span><b>' + g.sum.toLocaleString() + '</b></div>';
        } else {
          html += '<details class="crime-grp"><summary class="crime-row"><span>' + esc(g.name) + ' <small>▾</small></span><b>' + g.sum.toLocaleString() + '</b></summary>' +
            g.items.map(function (it) { return '<div class="crime-row sub"><span>' + esc(it[0]) + '</span><b>' + it[1].toLocaleString() + '</b></div>'; }).join('') + '</details>';
        }
      });
      body.innerHTML = html + foot;
    }).catch(function () {
      body.innerHTML = '<p class="muted">범죄 통계를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요. 장소 저장·방문 기록은 그대로 사용할 수 있습니다.</p>';
    });
  }
  function crimeAtCenter() {
    var c = app().map.getCenter();
    crimeSheet(c.lat, c.lng, '지도 가운데 위치', '');
  }

  /* ═════════════ 패널 ═════════════ */
  function render(body) {
    var html = '<div class="nb-intro">필요한 정보만 켜서 겹쳐 봅니다. 처음에는 모두 꺼져 있습니다.<br>' +
      '연결된 항목만 켤 수 있고, 「준비 중」 항목은 실제 자료를 확인한 뒤 차례로 열립니다.</div>';
    LAYERS.forEach(function (L) {
      var wait = L.status !== 'live';
      html += '<div class="nb-item">' +
        '<div class="nb-ico" style="background:' + L.color + '">' + esc(L.ico) + '</div>' +
        '<div class="nb-main"><b>' + esc(L.name) + '</b>' + (wait ? '<span class="badge-wait">준비 중 · ' + esc(L.stage) + '</span>' : '') +
        '<div class="nb-meta" data-basis="' + L.id + '">' + esc(L.provider) + '<br>' + esc(L.basis) + (L.note ? '<br>' + esc(L.note) : '') + '</div>' +
        (L.id === 'parking' ? '<div class="nb-legend"><span class="lg" style="background:#1971c2">P</span>공영 <span class="lg" style="background:#868e96">P</span>민영 · 확대 ' + PARK_MIN_ZOOM + ' 이상에서 표시</div>' +
          '<div class="row" style="margin:8px 0 0"><button class="btn" id="nbParkMe">🧭 내 주변 주차장</button></div>' : '') +
        (L.id === 'cctvLoc' ? '<div class="nb-legend"><span class="lg" style="background:#495057">◉</span>설치 위치 · 확대 ' + CCTV_MIN_ZOOM + ' 이상에서 표시 · 영상 없음</div>' : '') +
        (L.id === 'traffic' ? '<div class="nb-legend"><span class="tr-bar" style="background:' + TRAFFIC_COLORS[1] + '"></span>원활 <span class="tr-bar" style="background:' + TRAFFIC_COLORS[2] + '"></span>서행 <span class="tr-bar" style="background:' + TRAFFIC_COLORS[3] + '"></span>정체 <span class="tr-bar dash"></span>정보 없음 · 확대 ' + TRAFFIC_MIN_ZOOM + ' 이상 (시군도 ' + MINOR_MIN_ZOOM + ' 이상)</div>' : '') +
        (L.id === 'cctvVideo' ?'<div class="nb-legend"><span class="lg" style="background:#1c7ed6">▶</span>고속도로·국도 · 확대 ' + VCAM_MIN_ZOOM + ' 이상에서 표시</div>' : '') +
        (L.id === 'safety' ? '<div class="nb-legend sf-legend">' + [1, 2, 3, 4, 5].map(function (g) {
            return '<span><img src="https://www.safemap.go.kr/images/icon_new/security_' + (g * 2) + '.svg" alt="">' + g + '등급</span>'; }).join('') +
            '<br>경찰청 요청으로 건수 대신 등급(Jenks 자연 분류)으로 제공 · 확대 ' + SAFETY_MIN_ZOOM + ' 이상</div>' +
          '<label class="sf-op">투명도 <input type="range" id="nbSafetyOp" min="0" max="80" step="10" value="' + Math.round((1 - safetyOpacity) * 100) + '"> <span id="nbSafetyOpV">' + Math.round((1 - safetyOpacity) * 100) + '%</span></label>' +
          '<div class="row" style="margin:8px 0 0"><button class="btn" id="nbCrimeCenter">📊 지도 가운데 지역 범죄 통계 (시·군·구)</button></div>' : '') +
        '</div>' +
        '<label class="switch" title="' + (wait ? '아직 연결되지 않았습니다' : '켜기/끄기') + '">' +
        '<input type="checkbox" data-nb="' + L.id + '"' + (state[L.id] ? ' checked' : '') + (wait ? ' disabled' : '') + '><span></span></label>' +
        '</div>';
    });
    html += '<div class="row"><button class="btn full" id="nbAllOff">주변정보 모두 끄기</button></div>' +
      '<p class="muted">※ 실제 자료가 연결되지 않은 항목은 예시 위치·영상·교통 상태를 보여 주지 않습니다.</p>';
    body.innerHTML = html;

    /* 기준일은 meta를 받은 뒤 채움 */
    loadMeta().then(function () {
      var el = body.querySelector('[data-basis="parking"]');
      if (el) el.innerHTML = esc(LAYERS[0].provider) + '<br>' + esc(LAYERS[0].basis) + '<br>' + esc(LAYERS[0].note);
    }).catch(function () {});
    loadCctvMeta().then(function () {
      var el = body.querySelector('[data-basis="cctvLoc"]');
      if (el) el.innerHTML = esc(LAYERS[1].provider) + '<br>' + esc(LAYERS[1].basis) + '<br>' + esc(LAYERS[1].note);
    }).catch(function () {});

    body.querySelectorAll('input[data-nb]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var id = inp.getAttribute('data-nb');
        if (id === 'parking') {
          setParking(inp.checked).then(function () {
            if (inp.checked) app().toast(app().map.getZoom() < PARK_MIN_ZOOM ? '주차장을 켰습니다 · 지도를 확대하면 보입니다' : '주차장을 켰습니다');
          }).catch(function () { inp.checked = false; });
        } else if (id === 'safety') {
          setSafety(inp.checked).then(function () { if (inp.checked && app().map.getZoom() >= SAFETY_MIN_ZOOM) app().toast('치안정보를 켰습니다'); });
        } else if (id === 'traffic') {
          setTraffic(inp.checked).then(function () {
            if (inp.checked) app().toast(app().map.getZoom() < TRAFFIC_MIN_ZOOM ? '교통상황을 켰습니다 · 지도를 확대하면 보입니다' : '교통상황을 켰습니다');
          }).catch(function () { inp.checked = false; });
        } else if (id === 'cctvVideo') {
          setVcam(inp.checked).then(function () {
            if (inp.checked) app().toast(app().map.getZoom() < VCAM_MIN_ZOOM ? '교통 CCTV를 켰습니다 · 지도를 확대하면 보입니다' : '교통 CCTV를 켰습니다');
          }).catch(function () { inp.checked = false; });
        } else if (id === 'cctvLoc') {
          setCctv(inp.checked).then(function () {
            if (inp.checked) app().toast(app().map.getZoom() < CCTV_MIN_ZOOM ? 'CCTV 위치를 켰습니다 · 지도를 더 확대하면 보입니다' : 'CCTV 위치를 켰습니다');
          }).catch(function () { inp.checked = false; });
        } else state[id] = inp.checked;
      });
    });
    var me = body.querySelector('#nbParkMe');
    if (me) me.addEventListener('click', parkingNearMe);
    var op = body.querySelector('#nbSafetyOp');
    if (op) op.addEventListener('input', function () { body.querySelector('#nbSafetyOpV').textContent = op.value + '%'; setSafetyOpacity(1 - op.value / 100); });
    var cc = body.querySelector('#nbCrimeCenter');
    if (cc) cc.addEventListener('click', crimeAtCenter);
    body.querySelector('#nbAllOff').addEventListener('click', function () {
      allOff();
      body.querySelectorAll('input[data-nb]').forEach(function (inp) { inp.checked = false; });
      app().toast('주변정보를 모두 껐습니다');
    });
  }

  function allOff() {
    if (state.parking) { setParking(false); if (parkPopup) parkPopup.remove(); }
    if (state.cctvLoc) setCctv(false);
    if (state.cctvVideo) setVcam(false);
    if (state.traffic) setTraffic(false);
    if (state.safety) setSafety(false);
    Object.keys(state).forEach(function (k) { state[k] = false; });
  }
  function anyOn() { return Object.keys(state).some(function (k) { return state[k]; }); }

  window.OdigoNearby = { render: render, allOff: allOff, anyOn: anyOn, layers: LAYERS, parkingNear: parkingNear, parkingNearMe: parkingNearMe, crimeSheet: crimeSheet,
    /* v2.6: 레이어 패널(layers.js)의 「교통상황(ITS)」 버튼이 같은 상태를 씀 */
    setTraffic: function (on) {
      return setTraffic(on).then(function () {
        if (on) app().toast(app().map.getZoom() < TRAFFIC_MIN_ZOOM ? '교통상황을 켰습니다 · 지도를 확대하면 보입니다' : '교통상황을 켰습니다');
      });
    },
    isOn: function (id) { return !!state[id]; } };
})();
