/* 어디고 v2.4 — 「레이어」 패널 (v2.5: 네이버 지도 키 교체 · v2.6: 기본값 항공영상+하이브리드, 교통상황(ITS) 버튼) (설계: 설계/v2.4/어디고맵_통합시나리오_설계_v2.4.md 6장)
   · 지도 종류: 일반지도·항공영상(MapLibre 배경 전환) + 카카오·네이버(공식 SDK 대체 화면)
   · 중첩: 브이월드 데이터 API(JSONP → GeoJSON 벡터) — 텐아르 map_libre.html v195 OVERLAY_DEFS와 같은 자료·확대 기준
     (브이월드 WMS는 CORS 헤더가 없어 MapLibre 타일로 못 받음 → 텐아르와 같이 데이터 API 사용)
   · 하이브리드만 WMTS 래스터
   · 토지정보: 지도를 누르면 필지(지번·지목·PNU·공시지가)·용도지역·농업진흥 조회. 면적은 이 API에 없어 표시하지 않음
   · 투명도 = 실제 투명도(0% = 진하게). 지적도 0~100%, 토지이용계획 20~70%, 5% 단위
   · 설정은 localStorage odigo_layers_v2 (민감정보 아님) */
(function () {
  'use strict';

  var VWORLD_API_KEY = '00EB5BC0-22B4-3B7E-89D1-341699F7CE05';
  var VWORLD_DOMAIN = 'ubaldos00-ship-it.github.io';   /* 호스트만 · 스킴 금지 (텐아르 실측) */
  var NAVER_KEY_ID = 'l300nz0ugi';   /* v2.5: 텐아르와 같은 NCP Maps 「map」 Client ID (Dynamic Map, github.io 등록). 이전 w8m4oe36ev는 인증 실패 */
  var SET_KEY = 'odigo_layers_v2';

  function A() { return window.OdigoApp; }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n) { return Number(n).toLocaleString('ko-KR'); }
  function load(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  /* ───────── 레이어 정의 (패널에 보이는 순서) ───────── */
  var DEFS = [
    { id: 'cadastral', ko: '지적도', data: 'LP_PA_CBND_BUBUN', color: '#d92c2c', width: 1.4, minzoom: 16,
      desc: '연속지적도 · 지번은 확대 17 이상', src: '브이월드 연속지적도(국토교통부)' },
    { id: 'landinfo', ko: '토지정보', mode: true, minzoom: 16,
      desc: '켜고 지도를 누르면 필지의 지번·지목·PNU·공시지가·용도지역을 조회', src: '브이월드 데이터 API' },
    { id: 'landuse', ko: '토지이용계획', data: 'LT_C_UQ111', color: '#7c3aed', width: 0.8, minzoom: 13, fillBy: 'use',
      desc: '용도지역 색 표시 · 확대 13 이상', src: '브이월드 용도지역(LT_C_UQ111)' },
    { id: 'lhblpn', ko: '토지이용계획도', data: 'LT_C_LHBLPN', color: '#db2777', width: 1.2, minzoom: 13, fillBy: 'plain',
      desc: 'LH 택지개발 계획(개발예정) 구역 — LH 사업지구만 표시 · 확대 13 이상', src: '브이월드 LT_C_LHBLPN' },
    { id: 'agripromo', ko: '농업진흥지역', data: 'LT_C_AGRIXUE101', color: '#16a34a', width: 1.0, minzoom: 13, fillBy: 'agri',
      desc: '농업진흥구역(초록)·농업보호구역(노랑) · 확대 13 이상', src: '브이월드 농업진흥지역도(LT_C_AGRIXUE101)' },
    { id: 'terrain', ko: '지형도', data: 'LT_L_N3A0020000', color: '#8b5a2b', width: 1.2, minzoom: 15,
      desc: '브이월드 도로중심선 자료입니다(등고선 아님) · 확대 15 이상', src: '브이월드 LT_L_N3A0020000' },
    { id: 'landprice', ko: '개별공시지가', data: 'LP_PA_CBND_BUBUN', color: '#0ea5e9', width: 0.6, minzoom: 15, fillBy: 'price',
      desc: '원/㎡ 구간 색 · 금액은 확대 16 이상 · 기준 연월은 필지 자료의 공시 연월', src: '브이월드 연속지적도 jiga' },
    { id: 'adri', ko: '리 경계', data: 'LT_C_ADRI_INFO', color: '#fde047', width: 1.6, minzoom: 12,
      desc: '확대 12 이상', src: '브이월드 LT_C_ADRI_INFO', label: { key: 'li_kor_nm', color: '#facc15', halo: '#374151', size: 12.5, mz: 12 } },
    { id: 'ademd', ko: '읍면동 경계', data: 'LT_C_ADEMD_INFO', color: '#f97316', width: 1.9, minzoom: 10,
      desc: '법정 읍면동 · 확대 10 이상', src: '브이월드 LT_C_ADEMD_INFO', label: { key: 'emd_kor_nm', color: '#f97316', halo: '#fff', size: 13, mz: 11 } },
    { id: 'adsigg', ko: '시군구 경계', data: 'LT_C_ADSIGG_INFO', color: '#ea580c', width: 2.4, minzoom: 8,
      desc: '확대 8 이상', src: '브이월드 LT_C_ADSIGG_INFO', label: { key: 'sig_kor_nm', color: '#ea580c', halo: '#fff', size: 14, mz: 8 } },
    { id: 'adsido', ko: '시도 경계', data: 'LT_C_ADSIDO_INFO', color: '#7c3aed', width: 2.6, minzoom: 6,
      desc: '확대 6 이상', src: '브이월드 LT_C_ADSIDO_INFO', label: { key: 'ctp_kor_nm', color: '#7c3aed', halo: '#fff', size: 17, mz: 6 } },
    { id: 'adname', ko: '행정지역명', mode: true,
      desc: '시도·시군구·읍면동·리 이름을 구역 가운데 표시(경계선을 꺼도 이름은 보임) · 읍면동 11·리 12 이상', src: '위 경계 자료' },
    { id: 'hybrid', ko: '하이브리드', wmts: true,
      desc: '지명·도로 이름 겹치기 (항공영상과 함께 쓰면 좋음)', src: '브이월드 WMTS Hybrid' },
    { id: 'traffic', ko: '교통상황 (ITS 실시간)', ext: true, color: '#2f9e44',
      desc: '국가교통정보센터 실시간 속도로 원활·서행·정체 표시 · 확대 11 이상(시군도 14 이상) · 주변정보의 교통상황과 같은 버튼입니다. 도심의 짧은 구간은 신호 대기 때문에 한산할 때도 정체로 보일 수 있습니다.',
      src: '국가교통정보센터(ITS)' }
  ];
  /* 지도에 그리는 순서(아래→위): 하이브리드는 배경 바로 위, 경계·용도 → 지적도가 가장 위 */
  var DRAW_ORDER = ['agripromo', 'landuse', 'lhblpn', 'terrain', 'landprice', 'adri', 'ademd', 'adsigg', 'adsido', 'cadastral'];
  function def(id) { for (var i = 0; i < DEFS.length; i++) if (DEFS[i].id === id) return DEFS[i]; return null; }

  var DEFAULTS = { base: 'Sat', ov: { hybrid: true }, cadT: 35, luT: 55, collapsed: false };   /* v2.6: 기본 = 항공영상 + 하이브리드 */
  var st = load(SET_KEY, null);
  if (!st) {
    st = JSON.parse(JSON.stringify(DEFAULTS));
    /* v2.3에서 위성을 쓰던 사람은 위성+하이브리드(이전과 같은 화면)로 시작 */
    /* v2.3에서 일반지도를 쓰던 사람은 일반지도로 시작(화면이 갑자기 바뀌지 않게). 처음 온 사람은 기본값(항공영상+하이브리드) */
    if (localStorage.getItem('odigo_base_v1') && load('odigo_base_v1', 'Base') === 'Base') { st.base = 'Base'; st.ov.hybrid = false; }
  }
  st.ov = st.ov || {};
  function persist() { save(SET_KEY, st); }
  function on(id) {
    if (id === 'traffic') return !!(window.OdigoNearby && OdigoNearby.isOn && OdigoNearby.isOn('traffic'));
    return !!st.ov[id];
  }

  /* ───────── 색 (텐아르와 같은 기준) ───────── */
  function landuseColor(u) {
    u = String(u || '');
    if (/전용주거/.test(u)) return '#FFF6C2';
    if (/제1종일반주거/.test(u)) return '#FFEC99';
    if (/제2종일반주거/.test(u)) return '#FFE066';
    if (/제3종일반주거/.test(u)) return '#FFD11A';
    if (/준주거/.test(u)) return '#F6A94A';
    if (/일반주거/.test(u)) return '#FFE066';
    if (/중심상업|일반상업/.test(u)) return '#EF6E85';
    if (/근린상업|유통상업|상업/.test(u)) return '#F58CA0';
    if (/전용공업/.test(u)) return '#B48FD9';
    if (/일반공업|준공업|공업/.test(u)) return '#C6A8E4';
    if (/보전녹지/.test(u)) return '#6FBF56';
    if (/생산녹지/.test(u)) return '#93D97A';
    if (/자연녹지|녹지/.test(u)) return '#BCE5A6';
    if (/계획관리/.test(u)) return '#E4E3A6';
    if (/생산관리/.test(u)) return '#D2E0A0';
    if (/보전관리|관리지역/.test(u)) return '#C2D890';
    if (/농림/.test(u)) return '#A6D18B';
    if (/자연환경보전|보전지역/.test(u)) return '#8FD0C4';
    return '#B9B9C4';
  }
  var LU_LEGEND = [['주거', '#FFE066'], ['준주거', '#F6A94A'], ['상업', '#F58CA0'], ['공업', '#C6A8E4'], ['녹지', '#BCE5A6'], ['관리', '#D2E0A0'], ['농림', '#A6D18B'], ['자연환경보전', '#8FD0C4']];
  function priceColor(j) {
    var v = Number(j) || 0;
    if (v <= 0) return '#cccccc';
    if (v < 10000) return '#a3e635';
    if (v < 30000) return '#22c55e';
    if (v < 100000) return '#3b82f6';
    if (v < 300000) return '#f59e0b';
    if (v < 500000) return '#ef4444';
    return '#b91c1c';
  }
  var PRICE_LEGEND = [['1만 미만', '#a3e635'], ['3만 미만', '#22c55e'], ['10만 미만', '#3b82f6'], ['30만 미만', '#f59e0b'], ['50만 미만', '#ef4444'], ['50만 이상', '#b91c1c']];
  function agriColor(p) { var t = String((p && (p.uname || '')) || ''); return t.indexOf('보호') >= 0 ? '#eab308' : '#16a34a'; }
  var AGRI_LEGEND = [['농업진흥구역', '#16a34a'], ['농업보호구역', '#eab308']];
  function legendHtml(list) { return '<div class="ly-legend">' + list.map(function (x) { return '<span><i style="background:' + x[1] + '"></i>' + esc(x[0]) + '</span>'; }).join('') + '</div>'; }

  /* ───────── 브이월드 데이터 API (JSONP) ───────── */
  var seq = 0;
  function jsonp(url, cb) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script'), t = null;
      function clean() { clearTimeout(t); try { delete window[cb]; } catch (e) { window[cb] = undefined; } if (s.parentNode) s.parentNode.removeChild(s); }
      window[cb] = function (d) { clean(); resolve(d); };
      s.onerror = function () { clean(); reject(new Error('network')); };
      t = setTimeout(function () { clean(); reject(new Error('timeout')); }, 10000);
      s.src = url;
      document.head.appendChild(s);
    });
  }
  function dataUrl(data, filter, size, geometry, cb) {
    return 'https://api.vworld.kr/req/data?service=data&request=GetFeature&version=2.0&data=' + data +
      '&key=' + encodeURIComponent(VWORLD_API_KEY) + '&domain=' + VWORLD_DOMAIN + filter +
      '&crs=EPSG:4326&format=json&size=' + size + '&geometry=' + geometry + '&attribute=true&callback=' + cb;
  }
  function featuresOf(d) {
    var r = d && d.response;
    if (!r) return null;
    if (r.status === 'NOT_FOUND') return [];
    if (r.status !== 'OK') { warnApi(r); return null; }
    return (r.result && r.result.featureCollection && r.result.featureCollection.features) || [];
  }
  var apiWarned = false;
  function warnApi(r) {
    var em = String((r.error && (r.error.text || r.error.code)) || r.status);
    if (!apiWarned && /KEY|AUTH|INCORRECT|DOMAIN/i.test(em)) { apiWarned = true; A().toast('브이월드 인증 오류로 레이어를 불러오지 못했습니다'); }
  }
  var cache = {};
  function fetchBox(d) {
    var b = map().getBounds();
    var key = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map(function (v) { return v.toFixed(4); }).join(',');
    if (cache[d.id] && cache[d.id].key === key) return Promise.resolve(cache[d.id].fc);
    var box = 'BOX(' + b.getWest().toFixed(6) + ',' + b.getSouth().toFixed(6) + ',' + b.getEast().toFixed(6) + ',' + b.getNorth().toFixed(6) + ')';
    var cb = '__odVw' + (++seq);
    return jsonp(dataUrl(d.data, '&geomFilter=' + encodeURIComponent(box), 1000, 'true', cb), cb).then(function (res) {
      var fs = featuresOf(res);
      var fc = { type: 'FeatureCollection', features: fs || [] };
      if (fs) cache[d.id] = { key: key, fc: fc };
      return fc;
    }).catch(function () { netToast(); return { type: 'FeatureCollection', features: [] }; });
  }
  var netWarnAt = 0;
  function netToast() { if (Date.now() - netWarnAt > 8000) { netWarnAt = Date.now(); A().toast('레이어 자료를 잠시 불러오지 못했습니다'); } }

  /* ───────── 지도 레이어 ───────── */
  function map() { return A().map; }
  var EMPTY = { type: 'FeatureCollection', features: [] };
  function firstNbLayer() {
    var ls = map().getStyle().layers;
    for (var i = 0; i < ls.length; i++) if (ls[i].id.indexOf('nb-') === 0) return ls[i].id;
    return undefined;
  }
  var added = false;
  function addLayers() {
    if (added) return; added = true;
    var m = map(), before = firstNbLayer();
    /* 하이브리드: 배경 바로 위 — odigo.js가 만든 'hybrid' 레이어를 그대로 씀 */
    DRAW_ORDER.forEach(function (id) {
      var d = def(id), src = 'ov-' + id;
      m.addSource(src, { type: 'geojson', data: EMPTY });
      if (id === 'cadastral') m.addLayer({ id: 'ov-cadastral-fill', type: 'fill', source: src, layout: { visibility: 'none' }, paint: { 'fill-color': '#d92c2c', 'fill-opacity': 0.04 } }, before);
      if (d.fillBy) {
        var op = d.fillBy === 'use' ? 1 - st.luT / 100 : d.fillBy === 'plain' ? 0.18 : 0.35;
        m.addLayer({ id: src + '-fill', type: 'fill', source: src, layout: { visibility: 'none' },
          paint: { 'fill-color': d.fillBy === 'plain' ? d.color : ['coalesce', ['get', '_c'], '#999999'], 'fill-opacity': op } }, before);
      }
      m.addLayer({ id: src + '-line', type: 'line', source: src, layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': d.fillBy === 'use' ? ['coalesce', ['get', '_c'], d.color] : d.color, 'line-width': d.width,
                 'line-opacity': id === 'cadastral' ? 1 - st.cadT / 100 : 0.75 } }, before);
    });
    /* 토지정보: 선택한 필지 강조 */
    m.addSource('ov-sel', { type: 'geojson', data: EMPTY });
    m.addLayer({ id: 'ov-sel-fill', type: 'fill', source: 'ov-sel', paint: { 'fill-color': '#1c7ed6', 'fill-opacity': 0.18 } }, before);
    m.addLayer({ id: 'ov-sel-line', type: 'line', source: 'ov-sel', paint: { 'line-color': '#1c7ed6', 'line-width': 2.5 } }, before);
    applyAll();
    m.on('moveend', function () { clearTimeout(reloadT); reloadT = setTimeout(function () { reload(false); }, 450); });
  }
  var reloadT = null, loading = {};

  function needData(id) {
    if (on(id)) return true;
    var d = def(id);
    return !!(d.label && on('adname'));   /* 행정지역명은 경계 자료가 필요 */
  }
  function setVis(id, v) {
    var m = map();
    ['-line', '-fill'].forEach(function (s) { if (m.getLayer('ov-' + id + s)) m.setLayoutProperty('ov-' + id + s, 'visibility', v ? 'visible' : 'none'); });
    if (id === 'cadastral' && m.getLayer('ov-cadastral-fill')) m.setLayoutProperty('ov-cadastral-fill', 'visibility', v ? 'visible' : 'none');
  }
  function reload(force) {
    var m = map(), z = m.getZoom();
    DRAW_ORDER.forEach(function (id) {
      var d = def(id), src = m.getSource('ov-' + id);
      if (!src) return;
      if (!needData(id) || z < d.minzoom) {
        src.setData(EMPTY); clearMarks(id);
        return;
      }
      if (loading[id] && !force) return;
      loading[id] = true;
      fetchBox(d).then(function (fc) {
        loading[id] = false;
        if (!needData(id) || map().getZoom() < d.minzoom) return;
        fc.features.forEach(function (f) {
          var p = f.properties = f.properties || {};
          if (d.fillBy === 'use') p._c = landuseColor(p.uname);
          else if (d.fillBy === 'price') p._c = priceColor(p.jiga);
          else if (d.fillBy === 'agri') p._c = agriColor(p);
        });
        src.setData(fc);
        clearMarks(id);
        if (id === 'cadastral' && on('cadastral')) cadLabels(fc);
        if (id === 'landprice' && on('landprice')) priceLabels(fc);
        if (id === 'lhblpn' && on('lhblpn')) planLabels(fc);
        if (d.label && on('adname')) adLabels(d, fc);
      });
    });
  }

  /* ───────── 라벨 (DOM 마커 · 개수 제한) ───────── */
  var marks = {};
  function clearMarks(id) { (marks[id] || []).forEach(function (mk) { mk.remove(); }); marks[id] = []; }
  function addMark(id, ll, cls, text, style) {
    var e = document.createElement('div');
    e.className = cls; e.textContent = text;
    if (style) e.style.cssText = style;
    (marks[id] = marks[id] || []).push(new maplibregl.Marker({ element: e }).setLngLat(ll).addTo(map()));
  }
  /* 다각형 무게중심 + 넓이(가장 큰 조각을 고르기 위한 상대값) */
  function ringCentroid(r) {
    var a = 0, cx = 0, cy = 0;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      var f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
      a += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f;
    }
    if (!a) { var s = r.reduce(function (o, p) { return [o[0] + p[0], o[1] + p[1]]; }, [0, 0]); return { c: [s[0] / r.length, s[1] / r.length], a: 0 }; }
    return { c: [cx / (3 * a), cy / (3 * a)], a: Math.abs(a / 2) };
  }
  function centroid(f) {
    var g = f.geometry; if (!g) return null;
    var polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : null;
    if (!polys) return null;
    var best = null;
    polys.forEach(function (p) { if (!p[0] || p[0].length < 3) return; var r = ringCentroid(p[0]); if (!best || r.a > best.a) best = r; });
    return best;
  }
  function cadLabels(fc) {
    if (map().getZoom() < 17) return;
    var z = map().getZoom(), size = z >= 19 ? 16 : z >= 17 ? 13 + (z - 17) * 1.5 : 10;
    var seen = {}, n = 0;
    for (var i = 0; i < fc.features.length && n < 150; i++) {
      var p = fc.features[i].properties, bu = String(p.bubun || '').replace(/\D+$/, '');   /* bubun에 지목 글자가 붙어 오는 경우가 있음(예: "1전") */
      var t = String(p.bonbun || '').replace(/\D+$/, '') + (bu && bu !== '0' ? '-' + bu : '');
      if (!t) continue;
      var c = centroid(fc.features[i]); if (!c) continue;
      var k = t + '@' + c.c[0].toFixed(5); if (seen[k]) continue; seen[k] = 1;
      addMark('cadastral', c.c, 'cad-label', t, 'font-size:' + size.toFixed(1) + 'px'); n++;
    }
  }
  function priceLabels(fc) {
    if (map().getZoom() < 16) return;
    var n = 0;
    for (var i = 0; i < fc.features.length && n < 120; i++) {
      var j = Number(fc.features[i].properties.jiga) || 0; if (j <= 0) continue;
      var c = centroid(fc.features[i]); if (!c) continue;
      addMark('landprice', c.c, 'price-label', num(j) + '원'); n++;
    }
  }
  function planLabels(fc) {
    var g = {};
    fc.features.forEach(function (f) {
      var z = String(f.properties.zonename || '').trim(); if (!z) return;
      var c = centroid(f); if (!c) return;
      var o = g[z] || (g[z] = { n: 0, x: 0, y: 0 }); o.n++; o.x += c.c[0]; o.y += c.c[1];
    });
    Object.keys(g).sort(function (a, b) { return g[b].n - g[a].n; }).slice(0, 3).forEach(function (z) { addMark('lhblpn', [g[z].x / g[z].n, g[z].y / g[z].n], 'plan-label', z); });
  }
  function adLabels(d, fc) {
    var L = d.label; if (map().getZoom() < L.mz) return;
    var g = {};
    fc.features.forEach(function (f) {
      var nm = f.properties[L.key] || f.properties.full_nm; if (!nm) return;
      var c = centroid(f); if (!c) return;
      if (!g[nm] || c.a > g[nm].a) g[nm] = c;
    });
    var h = L.halo, sh = '-1px -1px 0 ' + h + ',1px -1px 0 ' + h + ',-1px 1px 0 ' + h + ',1px 1px 0 ' + h + ',0 0 3px ' + h;
    Object.keys(g).forEach(function (nm) { addMark(d.id, g[nm].c, 'ad-label', nm, 'color:' + L.color + ';font-size:' + L.size + 'px;text-shadow:' + sh); });
  }

  /* ───────── 적용 ───────── */
  function setBase(b) {
    var m = map(); st.base = b; persist();
    if (m.getLayer('base')) m.setLayoutProperty('base', 'visibility', b === 'Base' ? 'visible' : 'none');
    if (m.getLayer('sat')) m.setLayoutProperty('sat', 'visibility', b === 'Sat' ? 'visible' : 'none');
  }
  function setOverlay(id, v) {
    var d = def(id);
    if (id === 'traffic') {
      if (window.OdigoNearby && OdigoNearby.setTraffic) OdigoNearby.setTraffic(!!v).catch(function () { var i = document.querySelector('[data-ly="traffic"]'); if (i) i.checked = false; });
      else A().toast('교통상황을 불러오지 못했습니다');
      return;
    }
    st.ov[id] = !!v; persist();
    if (id === 'hybrid') { if (map().getLayer('hybrid')) map().setLayoutProperty('hybrid', 'visibility', v ? 'visible' : 'none'); return; }
    if (id === 'landinfo') { if (!v) clearSel(); else if (map().getZoom() < 16) A().toast('지도를 더 확대(16 이상)한 뒤 필지를 눌러 주세요'); else A().toast('조회할 필지를 눌러 주세요'); return; }
    if (id === 'adname') { if (!v) ['adri', 'ademd', 'adsigg', 'adsido'].forEach(clearMarks); reload(true); return; }
    setVis(id, v);
    if (!v) clearMarks(id);
    else if (map().getZoom() < d.minzoom) A().toast(d.ko + '은(는) 확대 ' + d.minzoom + ' 이상에서 보입니다');
    reload(true);
  }
  function setCadT(t) {
    st.cadT = t; persist();
    var m = map();
    if (m.getLayer('ov-cadastral-line')) m.setPaintProperty('ov-cadastral-line', 'line-opacity', 1 - t / 100);
    if (m.getLayer('ov-cadastral-fill')) m.setPaintProperty('ov-cadastral-fill', 'fill-opacity', (1 - t / 100) * 0.06);
  }
  function setLuT(t) {
    st.luT = t; persist();
    if (map().getLayer('ov-landuse-fill')) map().setPaintProperty('ov-landuse-fill', 'fill-opacity', 1 - t / 100);
  }
  function applyAll() {
    setBase(st.base);
    if (map().getLayer('hybrid')) map().setLayoutProperty('hybrid', 'visibility', on('hybrid') ? 'visible' : 'none');
    DRAW_ORDER.forEach(function (id) { setVis(id, on(id)); });
    setCadT(st.cadT); setLuT(st.luT);
    reload(true);
  }

  /* ───────── 토지정보 (필지 조회) ───────── */
  var selPopup = null;
  function clearSel() { if (map().getSource('ov-sel')) map().getSource('ov-sel').setData(EMPTY); if (selPopup) { selPopup.remove(); selPopup = null; } }
  function pad4(n) { n = String(parseInt(n, 10) || 0); return '0000'.slice(n.length) + n; }
  /* 카카오 좌표→법정동 코드·지번으로 PNU를 만든다 (지적도가 밀린 지역 대비, 텐아르 v115 방식) */
  function kakaoPnu(lat, lng) {
    var ens = A().ensureKakao;
    if (!ens) return Promise.resolve(null);
    return ens().then(function (ok) {
      if (!ok) return null;
      var gc = new kakao.maps.services.Geocoder();
      var code = new Promise(function (res) { gc.coord2RegionCode(lng, lat, function (r, s) { var b = s === kakao.maps.services.Status.OK ? r.filter(function (x) { return x.region_type === 'B'; })[0] : null; res(b ? b.code : null); }); });
      var addr = new Promise(function (res) { gc.coord2Address(lng, lat, function (r, s) { res(s === kakao.maps.services.Status.OK && r[0] && r[0].address ? r[0].address : null); }); });
      return Promise.all([code, addr]).then(function (a) {
        if (!a[0] || !a[1] || !a[1].main_address_no) return null;
        return { pnu: a[0] + (a[1].mountain_yn === 'Y' ? '2' : '1') + pad4(a[1].main_address_no) + pad4(a[1].sub_address_no || 0), addr: a[1].address_name };
      });
    }).catch(function () { return null; });
  }
  function q1(data, filter, geometry, size) {
    var cb = '__odVw' + (++seq);
    return jsonp(dataUrl(data, filter, size || 1, geometry ? 'true' : 'false', cb), cb).then(featuresOf).catch(function () { return null; });
  }
  function pointFilter(lng, lat) { return '&geomFilter=' + encodeURIComponent('POINT(' + lng.toFixed(7) + ' ' + lat.toFixed(7) + ')'); }
  function landInfoAt(ll) {
    var lat = ll.lat, lng = ll.lng;
    clearSel();
    var t0 = new Date();
    selPopup = new maplibregl.Popup({ closeOnClick: false, maxWidth: '290px' }).setLngLat(ll).setHTML('<div class="li-pop"><b>토지정보</b><p class="muted">조회 중…</p></div>').addTo(map());
    selPopup.on('close', function () { if (map().getSource('ov-sel')) map().getSource('ov-sel').setData(EMPTY); });
    var pop = selPopup;
    Promise.all([
      q1('LP_PA_CBND_BUBUN', pointFilter(lng, lat), true),
      kakaoPnu(lat, lng),
      q1('LT_C_UQ111', pointFilter(lng, lat), false, 5),
      q1('LT_C_AGRIXUE101', pointFilter(lng, lat), false, 3)
    ]).then(function (r) {
      var vw = r[0] && r[0][0], kk = r[1], basis = '지도 좌표';
      var next = Promise.resolve(vw);
      /* 카카오 지번과 브이월드 필지가 다르면 카카오 PNU로 다시 조회 (지적 밀림 지역) */
      if (kk && (!vw || vw.properties.pnu !== kk.pnu)) {
        next = q1('LP_PA_CBND_BUBUN', '&attrFilter=' + encodeURIComponent('pnu:=:' + kk.pnu), true).then(function (fs) {
          if (fs && fs[0]) { basis = '카카오 주소 기준'; return fs[0]; }
          return vw;
        });
      }
      return next.then(function (f) { return { f: f, basis: basis, uq: r[2], ag: r[3], moved: kk && vw && vw.properties.pnu !== kk.pnu }; });
    }).then(function (o) {
      if (pop !== selPopup) return;
      if (!o.f) { pop.setHTML('<div class="li-pop"><b>토지정보</b><p class="muted">이 지점의 필지를 찾지 못했습니다.</p></div>'); return; }
      var p = o.f.properties, jb = String(p.jibun || ''), m = jb.match(/^(\S+)\s*(\S*)$/);
      var jimok = m && m[2] ? m[2] : '—';
      var uses = (o.uq || []).map(function (f) { return f.properties.uname; }).filter(Boolean);
      var agri = (o.ag || []).map(function (f) { return f.properties.uname; }).filter(Boolean);
      var jiga = Number(p.jiga) || 0;
      map().getSource('ov-sel').setData({ type: 'FeatureCollection', features: [o.f] });
      pop.setHTML('<div class="li-pop"><b>' + esc(p.addr || jb) + '</b>' +
        '<table class="kv">' +
        '<tr><th>지목</th><td>' + esc(jimok) + '</td></tr>' +
        '<tr><th>PNU</th><td>' + esc(p.pnu || '—') + '</td></tr>' +
        '<tr><th>공시지가</th><td>' + (jiga ? num(jiga) + ' 원/㎡' + (p.gosi_year ? ' <small>(' + esc(p.gosi_year) + '년' + (p.gosi_month ? ' ' + Number(p.gosi_month) + '월' : '') + ' 공시)</small>' : '') : '정보 없음') + '</td></tr>' +
        '<tr><th>용도지역</th><td>' + (uses.length ? esc(uses.join(', ')) : '정보 없음') + '</td></tr>' +
        '<tr><th>농업진흥</th><td>' + (agri.length ? esc(agri.join(', ')) : '해당 없음') + '</td></tr>' +
        '<tr><th>면적</th><td><span class="muted">이 자료에는 없음</span></td></tr>' +
        '</table>' +
        (o.moved && o.basis === '카카오 주소 기준' ? '<p class="li-warn">이 지역은 지적도가 실제와 밀려 있을 수 있어 카카오 주소 기준으로 조회했습니다.</p>' : '') +
        '<div class="src">조회 ' + pad2(t0.getHours()) + ':' + pad2(t0.getMinutes()) + ' · 출처 브이월드(국토교통부)' + (o.basis === '카카오 주소 기준' ? ' · 위치 확인 카카오' : '') + '</div></div>');
    });
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* ───────── 패널 ───────── */
  var panelOpen = false;
  function buildPanel() {
    var p = $('layerPanel');
    var items = DEFS.map(function (d) {
      var legend = d.id === 'landuse' ? legendHtml(LU_LEGEND) : d.id === 'landprice' ? legendHtml(PRICE_LEGEND) : d.id === 'agripromo' ? legendHtml(AGRI_LEGEND) : '';
      var extra = '';
      if (d.id === 'cadastral') extra = slider('cadT', '지적도 투명도', 0, 100, st.cadT);
      if (d.id === 'landuse') extra = slider('luT', '토지이용계획 투명도', 20, 70, st.luT);
      return '<div class="ly-item' + (d.id === 'landinfo' || d.id === 'adname' ? ' sub' : '') + (d.ext ? ' ext' : '') + '">' +
        '<label class="ly-row"><span class="ly-sw" style="background:' + (d.color || (d.wmts ? '#495057' : '#1c7ed6')) + '"></span>' +
        '<span class="ly-txt"><b>' + esc(d.ko) + '</b><small>' + esc(d.desc) + '</small></span>' +
        '<span class="switch"><input type="checkbox" data-ly="' + d.id + '"' + (on(d.id) ? ' checked' : '') + '><span></span></span></label>' +
        (legend ? '<div class="ly-more" data-for="' + d.id + '"' + (on(d.id) ? '' : ' hidden') + '>' + legend + '</div>' : '') +
        extra + '</div>';
    }).join('');
    $('lpBody').innerHTML =
      '<div class="ly-sec">지도 종류</div>' +
      '<div class="ly-base"><button data-base="Base" class="' + (st.base === 'Base' ? 'on' : '') + '">일반지도</button><button data-base="Sat" class="' + (st.base === 'Sat' ? 'on' : '') + '">항공영상</button></div>' +
      '<div class="ly-base alt"><button data-alt="kakao" class="kakao">카카오 지도</button><button data-alt="naver" class="naver">네이버 지도</button></div>' +
      '<p class="ly-note">카카오·네이버 지도에서는 내 조사 장소·오늘 방문 번호·내 위치만 보입니다. 아래 브이월드 레이어와 주변정보는 보이지 않습니다.</p>' +
      '<div class="ly-sec">중첩 · 조회</div>' + items +
      '<p class="ly-note">자료: 브이월드(국토교통부) 데이터 API · 화면에 보이는 범위만 불러옵니다. 레이어를 여러 개 켜도 내 조사 장소 핀은 항상 맨 위에 보입니다.</p>';
    p.querySelectorAll('[data-base]').forEach(function (b) {
      b.addEventListener('click', function () {
        setBase(b.getAttribute('data-base'));
        p.querySelectorAll('[data-base]').forEach(function (x) { x.classList.toggle('on', x === b); });
      });
    });
    p.querySelectorAll('[data-alt]').forEach(function (b) { b.addEventListener('click', function () { openAlt(b.getAttribute('data-alt')); }); });
    p.querySelectorAll('[data-ly]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var id = inp.getAttribute('data-ly');
        setOverlay(id, inp.checked);
        var more = p.querySelector('.ly-more[data-for="' + id + '"]'); if (more) more.hidden = !inp.checked;
      });
    });
    bindSlider('cadT', setCadT); bindSlider('luT', setLuT);
  }
  function slider(id, label, min, max, v) {
    return '<label class="ly-op">' + label + ' <input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="5" value="' + v + '"> <span id="' + id + 'V">' + v + '%</span></label>';
  }
  function bindSlider(id, fn) {
    var r = $(id); if (!r) return;
    r.addEventListener('input', function () { var v = Number(r.value); $(id + 'V').textContent = v + '%'; fn(v); });
  }
  var savedScroll = 0;
  function openPanel() {
    panelOpen = true;
    buildPanel();
    $('layerPanel').hidden = false;
    setCollapsed(!!st.collapsed);
    $('btnLayer').classList.add('on');
    document.body.classList.add('lp-open');
  }
  function closePanel() {
    panelOpen = false;
    savedScroll = $('lpBody').scrollTop;
    $('layerPanel').hidden = true;
    $('btnLayer').classList.remove('on');
    document.body.classList.remove('lp-open');
  }
  function setCollapsed(c) {
    if (c) savedScroll = $('lpBody').scrollTop;
    st.collapsed = c; persist();
    $('layerPanel').classList.toggle('collapsed', c);
    $('lpFold').textContent = c ? '▴ 펼치기' : '▾ 접기';
    $('lpFold').setAttribute('aria-expanded', String(!c));
    if (!c) requestAnimationFrame(function () { $('lpBody').scrollTop = savedScroll; });
  }
  function resetAll() {
    if (!window.confirm('레이어 설정을 기본값으로 되돌릴까요?\n(항공영상 · 하이브리드 켜기 · 나머지 중첩 레이어 끄기 · 투명도 기본값)')) return;
    if (on('traffic') && window.OdigoNearby) OdigoNearby.setTraffic(false);
    var keep = st.collapsed;
    st = JSON.parse(JSON.stringify(DEFAULTS)); st.collapsed = keep; persist();
    clearSel();
    Object.keys(marks).forEach(clearMarks);
    applyAll();
    savedScroll = 0;
    buildPanel();
    $('lpBody').scrollTop = 0;
    A().toast('레이어를 기본값으로 되돌렸습니다');
  }

  /* ───────── 카카오·네이버 대체 화면 ───────── */
  var alt = { kind: null, map: null, objs: [], me: null, acc: null, watch: null, kmap: null, nmap: null, kOv: {}, nOv: {} };
  var naverP = null, naverAuthFailed = false;
  function ensureNaver() {
    if (naverAuthFailed) return Promise.resolve(false);
    if (window.naver && naver.maps && naver.maps.Map) return Promise.resolve(true);
    if (naverP) return naverP;
    naverP = new Promise(function (res) {
      var done = false, s = document.createElement('script');
      var to = setTimeout(function () { if (!done) { done = true; res(false); } }, 10000);
      /* 인증 실패(도메인 미등록)는 SDK가 로드된 뒤에 따로 알려 옴 → 열려 있으면 닫고 안내 */
      window.navermap_authFailure = function () {
        naverAuthFailed = true;
        if (!done) { done = true; clearTimeout(to); res(false); }
        if (alt.kind === 'naver') { closeAlt(true); A().toast('네이버 지도 인증에 실패했습니다 (사이트 주소 등록 확인 필요)'); }
      };
      s.src = 'https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=' + encodeURIComponent(NAVER_KEY_ID);
      s.onload = function () { if (!done) { done = true; clearTimeout(to); res(!!(window.naver && naver.maps && naver.maps.Map)); } };
      s.onerror = function () { if (!done) { done = true; clearTimeout(to); res(false); } };
      document.head.appendChild(s);
    }).then(function (ok) { if (!ok) naverP = null; return ok; });
    return naverP;
  }
  function altPins() { return (A().pinsForAlt && A().pinsForAlt()) || []; }
  function pinHtml(p) {
    return '<div class="alt-pin' + (p.order ? ' today' : '') + (p.sel ? ' sel' : '') + '" title="' + esc(p.name) + '">' +
      '<b>' + (p.order || '') + '</b><span>' + esc(p.name) + '</span></div>';
  }
  function openAlt(kind) {
    var m = map(), c = m.getCenter(), z = m.getZoom();
    alt.kind = kind;
    $('altView').hidden = false;
    $('altTitle').textContent = kind === 'kakao' ? '카카오 지도' : '네이버 지도';
    $('altView').className = 'alt-view ' + kind;
    $('altInfo').textContent = '지도를 불러오는 중…';
    var ready = kind === 'kakao' ? (A().ensureKakao ? A().ensureKakao() : Promise.resolve(false)) : ensureNaver();
    var guard = setTimeout(function () {
      if (alt.kind === kind && !(kind === 'kakao' ? alt.kmap : alt.nmap)) { closeAlt(true); A().toast((kind === 'kakao' ? '카카오' : '네이버') + ' 지도를 표시하지 못했습니다'); }
    }, 12000);
    ready.then(function (ok) {
      if (alt.kind !== kind) return;
      if (!ok) { clearTimeout(guard); closeAlt(true); A().toast((kind === 'kakao' ? '카카오' : '네이버') + ' 지도를 불러오지 못했습니다 (배포 주소에서만 동작)'); return; }
      clearTimeout(guard);
      if (kind === 'kakao') initKakao(c, z); else initNaver(c, z);
      buildAltBar(kind);
      drawAlt();
      startWatch();
      $('altInfo').textContent = '조사 장소 ' + altPins().length + '곳 · 내 위치 확인 중…';
    });
  }
  function initKakao(c, z) {
    var el = $('altKakao'); el.hidden = false; $('altNaver').hidden = true;
    var level = Math.max(1, Math.min(14, Math.round(19 - z)));
    var ll = new kakao.maps.LatLng(c.lat, c.lng);
    if (!alt.kmap) {
      alt.kmap = new kakao.maps.Map(el, { center: ll, level: level });
      alt.kmap.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
    } else { alt.kmap.relayout(); alt.kmap.setLevel(level); alt.kmap.setCenter(ll); }
    alt.kmap.setMapTypeId(st.base === 'Sat' ? kakao.maps.MapTypeId.HYBRID : kakao.maps.MapTypeId.ROADMAP);
    setTimeout(function () { try { alt.kmap.relayout(); alt.kmap.setCenter(ll); } catch (e) {} }, 200);
  }
  function initNaver(c, z) {
    var el = $('altNaver'); el.hidden = false; $('altKakao').hidden = true;
    var ll = new naver.maps.LatLng(c.lat, c.lng), nz = Math.max(6, Math.min(21, Math.round(z + 1)));
    if (!alt.nmap) {
      alt.nmap = new naver.maps.Map(el, { center: ll, zoom: nz, zoomControl: true, zoomControlOptions: { position: naver.maps.Position.RIGHT_CENTER } });
    } else { alt.nmap.setCenter(ll); alt.nmap.setZoom(nz); naver.maps.Event.trigger(alt.nmap, 'resize'); }
    alt.nmap.setMapTypeId(st.base === 'Sat' ? naver.maps.MapTypeId.HYBRID : naver.maps.MapTypeId.NORMAL);
  }
  /* 지도별로 쓸 수 있는 겹침 — SDK가 직접 제공하는 것만 */
  function buildAltBar(kind) {
    var sat = st.base === 'Sat';
    var opts = kind === 'kakao'
      ? [['type', sat ? '일반' : '스카이뷰'], ['USE_DISTRICT', '지적편집도'], ['TRAFFIC', '교통정보']]
      : [['type', sat ? '일반' : '위성'], ['cadastral', '지적편집도'], ['traffic', '교통정보']];
    $('altBar').innerHTML = opts.map(function (o) { return '<button data-ao="' + o[0] + '">' + o[1] + '</button>'; }).join('');
    $('altBar').querySelectorAll('[data-ao]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-ao');
        if (k === 'type') {
          if (kind === 'kakao') { var h = alt.kmap.getMapTypeId() === kakao.maps.MapTypeId.HYBRID; alt.kmap.setMapTypeId(h ? kakao.maps.MapTypeId.ROADMAP : kakao.maps.MapTypeId.HYBRID); b.textContent = h ? '스카이뷰' : '일반'; }
          else { var s = alt.nmap.getMapTypeId() !== naver.maps.MapTypeId.NORMAL; alt.nmap.setMapTypeId(s ? naver.maps.MapTypeId.NORMAL : naver.maps.MapTypeId.HYBRID); b.textContent = s ? '위성' : '일반'; }
          return;
        }
        var onNow = !b.classList.contains('on');
        b.classList.toggle('on', onNow);
        if (kind === 'kakao') { var t = kakao.maps.MapTypeId[k]; if (onNow) alt.kmap.addOverlayMapTypeId(t); else alt.kmap.removeOverlayMapTypeId(t); }
        else {
          if (!alt.nOv[k]) alt.nOv[k] = k === 'cadastral' ? new naver.maps.CadastralLayer() : new naver.maps.TrafficLayer();
          alt.nOv[k].setMap(onNow ? alt.nmap : null);
        }
      });
    });
  }
  function clearAltObjs() { alt.objs.forEach(function (o) { try { o.setMap(null); } catch (e) {} }); alt.objs = []; }
  function drawAlt() {
    clearAltObjs();
    altPins().forEach(function (p) {
      if (alt.kind === 'kakao') {
        var ov = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(p.lat, p.lng), content: pinHtml(p), yAnchor: 1, zIndex: p.order ? 3 : 2 });
        ov.setMap(alt.kmap); alt.objs.push(ov);
      } else {
        alt.objs.push(new naver.maps.Marker({ position: new naver.maps.LatLng(p.lat, p.lng), map: alt.nmap, zIndex: p.order ? 3 : 2,
          icon: { content: '<div style="transform:translate(-50%,-100%)">' + pinHtml(p) + '</div>' } }));
      }
    });
    var sel = altPins().filter(function (p) { return p.sel; })[0];
    if (sel) $('altInfo').textContent = '선택: ' + sel.name;
  }
  function updateMe(lat, lng, acc) {
    try { updateMe2(lat, lng, acc); } catch (e) {}
  }
  function updateMe2(lat, lng, acc) {
    if (alt.kind === 'kakao' && alt.kmap) {
      var ll = new kakao.maps.LatLng(lat, lng);
      if (!alt.me) { alt.me = new kakao.maps.CustomOverlay({ position: ll, content: '<div class="me-dot"></div>', zIndex: 5 }); alt.me.setMap(alt.kmap); }
      else alt.me.setPosition(ll);
      if (!alt.acc) { alt.acc = new kakao.maps.Circle({ center: ll, radius: acc || 0, strokeWeight: 1, strokeColor: '#1c7ed6', strokeOpacity: 0.5, fillColor: '#1c7ed6', fillOpacity: 0.12 }); alt.acc.setMap(alt.kmap); }
      else { alt.acc.setPosition(ll); alt.acc.setRadius(acc || 0); }
    } else if (alt.kind === 'naver' && alt.nmap) {
      var nl = new naver.maps.LatLng(lat, lng);
      if (!alt.me) alt.me = new naver.maps.Marker({ position: nl, map: alt.nmap, zIndex: 5, icon: { content: '<div class="me-dot" style="transform:translate(-50%,-50%)"></div>' } });
      else alt.me.setPosition(nl);
      if (!alt.acc) alt.acc = new naver.maps.Circle({ map: alt.nmap, center: nl, radius: acc || 0, strokeColor: '#1c7ed6', strokeWeight: 1, strokeOpacity: 0.5, fillColor: '#1c7ed6', fillOpacity: 0.12 });
      else { alt.acc.setCenter(nl); alt.acc.setRadius(acc || 0); }
    }
    var sel = altPins().filter(function (p) { return p.sel; })[0];
    $('altInfo').textContent = (sel ? '선택: ' + sel.name + ' · ' : '') + '내 위치 GPS ±' + Math.round(acc || 0) + 'm';
  }
  function startWatch() {
    stopWatch();
    if (!navigator.geolocation) return;
    alt.watch = navigator.geolocation.watchPosition(function (p) { updateMe(p.coords.latitude, p.coords.longitude, p.coords.accuracy); },
      function () { $('altInfo').textContent = '내 위치를 확인하지 못했습니다 (위치 권한 확인)'; }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  }
  function stopWatch() { if (alt.watch != null) { try { navigator.geolocation.clearWatch(alt.watch); } catch (e) {} alt.watch = null; } }
  /* 닫을 때 대체 지도의 중심을 어디고 지도로 이어 줌 (실패로 닫힐 때는 그대로) */
  function closeAlt(failed) {
    stopWatch();
    if (!failed) {
      try {
        if (alt.kind === 'kakao' && alt.kmap) { var c = alt.kmap.getCenter(); map().jumpTo({ center: [c.getLng(), c.getLat()], zoom: Math.max(6, Math.min(19, 19 - alt.kmap.getLevel())) }); }
        if (alt.kind === 'naver' && alt.nmap) { var n = alt.nmap.getCenter(); map().jumpTo({ center: [n.lng(), n.lat()], zoom: Math.max(6, Math.min(19, alt.nmap.getZoom() - 1)) }); }
      } catch (e) {}
    }
    clearAltObjs();
    if (alt.me) { try { alt.me.setMap(null); } catch (e) {} alt.me = null; }
    if (alt.acc) { try { alt.acc.setMap(null); } catch (e) {} alt.acc = null; }
    alt.kind = null;
    $('altView').hidden = true;
  }

  /* ───────── 시작 ───────── */
  function init() {
    if (!A() || !A().map) return setTimeout(init, 50);
    var m = map();
    $('btnLayer').addEventListener('click', function () { if (panelOpen) closePanel(); else openPanel(); });
    $('lpClose').addEventListener('click', closePanel);
    $('lpFold').addEventListener('click', function () { setCollapsed(!st.collapsed); });
    $('lpReset').addEventListener('click', resetAll);
    $('altClose').addEventListener('click', function () { closeAlt(false); });
    /* 토지정보: 주변정보 아이콘·내 장소 핀을 누른 경우는 제외 */
    m.on('click', function (e) {
      if (!on('landinfo')) return;
      var nb = m.getStyle().layers.filter(function (l) { return l.id.indexOf('nb-') === 0 && l.type !== 'raster'; }).map(function (l) { return l.id; });
      if (nb.length && m.queryRenderedFeatures(e.point, { layers: nb }).length) return;
      if (m.getZoom() < 16) { A().toast('지도를 더 확대(16 이상)한 뒤 필지를 눌러 주세요'); return; }
      landInfoAt(e.lngLat);
    });
    function go() { addLayers(); }
    if (m.isStyleLoaded()) go(); else m.once('load', go);
  }
  window.OdigoLayers = { isLandInfo: function () { return on('landinfo'); }, closePanel: closePanel, base: function () { return st.base; } };
  init();
})();
