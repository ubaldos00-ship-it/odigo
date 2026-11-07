/* 어디고 v2.7 — 지도·조사구·방문 (통합 2단계, 설계: 설계/v2.4) · v2.8: 나 조사하러 간다(safety.js) 연결·안전 연락 설정·공유 위치 링크 열기
   · v3.9: 시트 뒤로 가기(‹)·닫기 동그라미 버튼, 주소 복사 버튼, 핀 누르면 핀이 시트 위로·카드 닫으면 보던 업무 목록으로, 목록 행은 위치만 이동(카드 안 열림),
           드롭다운 고르면 그 핀으로 이동·시도›시군구›읍면동 트리식, 모든 업무 ＋추가(주소로 입력·이름/주소 필수, 작물재배 층·조사구·주소 필수, 이름 없으면 「없음」),
           전체/메모 보기·메모 표시, 연락처(이름·휴대폰·사무실·집·직급·관계), 방문 기록(메모) 날짜별 결과(조사완료·부분완료·부재중·재방문),
           작물재배 변동 사항(합필·분필·밭으로·논으로·건물건축·편입증감·유휴지·기타, 바로 저장)·지도에서 필지 찍어 지번 표시,
           생산량 층·조사구가 같은 작물재배 카드에 생산량 작물명, 내 설정 주요업무분야 여러 개(고른 분야만 지도에), 답례품·수첩·달력 월별 지급 기록과 월별 조회 화면,
           업무별 핀 기본 모양·색이 모두 다르게(생산량 = 물방울)
   · v3.8: 조사구 번호(#순번, 읍면동별·바꾸면 나머지 당김), 목록(리동 주소·메모·수정·삭제·번호 순), 조사구 입력(번호·시도~읍면동·초입주소 확인·작물재배 필수칸), 지도에서 위치 수정, 시트(지도 움직임·크기 조절·접기·핀이 시트 위로), 카카오·네이버 지도 앱 버튼, 핀·글자 확대 단계별 크기(텐아르와 같은 값)
   · v3.7: 핀 글자 텐아르 방식 — 핀 위 조사명(남색), 핀 아래 조사별 정보(갈색): 작물재배=읍면동 층-조사구, 가축=축종·이름·농장·읍면동 등. 가축·축비에 축종·농장명 칸
   · v3.6: 확대·축소 버튼 왼쪽 아래 + 확대 단계 표시, 핀 제목 항상 표시(레이어에서 켜고 끄기), 작물재배는 읍면동별 색(텐아르와 같은 색), 검색창 아래 KAKAO·NAVER 빠른 버튼
   · v3.5: 텐아르 방식 핀 — 기본 동그라미(좌표 가운데에 놓여 가까운 핀은 겹쳐 보임), 이름표는 상자 없이 테두리 글자
   · v3.4: 조사구 삭제(전체·업무별·선택), 텐아르 파일 가져오기 버튼을 ⓘ에 바로
   · v3.2: 텐아르 내보내기 파일로도 가져오기(홈 화면 앱은 저장소가 따로)
   · v3.1: 텐아르 핀 가져오기(files.js), 가져온 자료는 이름이 같으면 최신으로 갱신
   · v3.0: 핀 모양·색·이름표를 업무(조사 유형)별로, 업무별 자료 공유·엑셀 올리기(files.js) 연결
   · v2.9: 조사구 항목(조사구번호·층·카드·구분), 업무별 핀 모양·색·이름표 설정, 핀 안 번호(조사별·읍면동 순서), 목록 드롭다운 필터, 내 위치 3단(이동·방향·해제)
   · 배경지도: MapLibre + VWorld WMTS (레이어 패널은 layers.js)
   · 검색: 내 조사구(이 기기) → 카카오 주소·장소
   · 자료: 프로필·조사구·방문 기록을 store.js가 암호화해 이 기기에만 저장 (서버 전송 없음)
     - 조사구(site)와 방문 기록(visit)을 분리 → 같은 곳을 여러 날 방문 가능
     - 업무분야·조사 유형·작물을 각각 저장, 집계 열쇠 = 분야id/유형id (사회과 고용 ≠ 대행 고용)
     - 지역은 법정동(B) 기준: 시도 › 시군구 › 읍면동 › 리 (카카오 coord2RegionCode B)
   · 길찾기: 외부 지도 앱(네이버·카카오·T맵) 연결 */
(function () {
  'use strict';

  var APP_VERSION = 'v3.9';
  /* 키는 HTML에 노출되는 공개키 — 두 서비스 모두 허용 도메인(https://ubaldos00-ship-it.github.io)으로 제한됨 */
  var VWORLD_API_KEY = '00EB5BC0-22B4-3B7E-89D1-341699F7CE05';
  var KAKAO_JS_KEY = 'd714e9625ae9e816526288f6cde536a9';
  var GAS_URL = 'https://script.google.com/macros/s/AKfycby132T2PIJQ8VPKhQLzQZaxEUBwC6c-7N-h60PGsx3MpU0O58qD7Lg5OJqhvQjD4SJoww/exec';   // 어디고 카운터(GA4 Apps Script)

  var OPENED_BY_PIN = /[?&]pin=/.test(location.search);   /* 카톡으로 받은 위치 링크로 열면 처음 설정 창을 바로 띄우지 않음 */
  var VIEW_KEY = 'odigo_view_v1';
  var BASE_KEY = 'odigo_base_v1';

  /* ───────── 업무분야·조사 유형 (id는 바꾸지 않음) ───────── */
  var CROPS = ['마늘', '양파', '감자', '논벼', '고추', '참깨', '사과', '배', '겉보리', '쌀보리', '밀', '고구마', '무', '배추', '콩'];
  var DIVISIONS = [
    { id: 'agri', name: '농어업과', short: '농어업', color: '#2f9e44', types: [
      { id: 'area', name: '재배면적' }, { id: 'prod', name: '생산량', crops: CROPS }, { id: 'rice', name: '쌀값' }, { id: 'farmsale', name: '농판' },
      { id: 'livecost', name: '축비' }, { id: 'livestock', name: '가축' }, { id: 'farmecon', name: '농가경제' }, { id: 'farmcost', name: '농비' },
      { id: 'census', name: '농림어업' }, { id: 'grain', name: '양곡' }, { id: 'etc', name: '기타농업' }] },
    { id: 'econ', name: '경제과', short: '경제', color: '#1971c2', types: [
      { id: 'mining', name: '광제조업' }, { id: 'service', name: '서비스업' }, { id: 'constr', name: '건설경기' }, { id: 'online', name: '온라인' },
      { id: 'price', name: '물가' }, { id: 'etc', name: '기타경제' }] },
    { id: 'social', name: '사회과', short: '사회', color: '#9c36b5', types: [
      { id: 'household', name: '가계' }, { id: 'econact', name: '경제활동' }, { id: 'employ', name: '고용' }, { id: 'etc', name: '기타사회' }] },
    { id: 'region', name: '지역과', short: '지역', color: '#e67700', types: [
      { id: 'univ', name: '대학교' }, { id: 'inst', name: '연구원' }, { id: 'sido', name: '시도' }, { id: 'sigungu', name: '시군구' }] },
    { id: 'support', name: '지원과', short: '지원', color: '#0c8599', types: [
      { id: 'agency', name: '유관기관' }, { id: 'company', name: '업체' }, { id: 'etc', name: '기타지원' }] },
    { id: 'proxy', name: '대행업무(기타)', short: '대행', color: '#5c5f66', types: [
      { id: 'employ', name: '고용' }, { id: 'census', name: '농림어업' }, { id: 'finance', name: '가계금융' }] }
  ];
  var UNASSIGNED_COLOR = '#f07a22';
  var KINDS = ['논', '밭', '대지', '축사', '응답자집', '기타'];   /* 조사구 「구분」 */
  /* v3.8: 핀 모양 12가지 */
  var SHAPES = [['circle', '동그라미'], ['square', '네모'], ['diamond', '마름모'], ['triangle', '세모'], ['star', '별'], ['hexagon', '육각형'],
    ['pentagon', '오각형'], ['octagon', '팔각형'], ['tridown', '역삼각형'], ['cross', '십자'], ['ring', '도넛'], ['drop', '물방울']];
  var LABEL_FIELDS = [['type', '조사명'], ['name', '이름'], ['addr', '주소'], ['floorCard', '층-카드'], ['josaguNo', '조사구번호'], ['crop', '작물']];
  var DEFAULT_LABEL = ['name'];
  /* 핀 모양·색·이름표는 업무(조사 유형)별: 열쇠 = 분야id/유형id. 정하지 않으면 업무마다 다른 기본색 */
  var TYPE_PALETTE = ['#2f9e44', '#1971c2', '#e8590c', '#9c36b5', '#c2255c', '#0c8599', '#f08c00', '#5f3dc4', '#66a80f', '#d6336c', '#495057', '#1098ad'];
  function styleKey(divId, typeId) { return divId ? divId + '/' + (typeId || '_') : '_none'; }
  /* v3.9: 모든 업무의 기본 모양·색이 서로 다르게 — 전체 업무를 한 줄로 세운 순번으로 색(12가지)·모양(10가지)을 돌려 씀
     (같은 과 안에서는 색도 모양도 겹치지 않음). 작물재배 = 동그라미, 생산량 = 물방울은 고정 */
  var FIXED_SHAPE = { 'agri/area': 'circle', 'agri/prod': 'drop' };
  function globalIdx(divId, typeId) {
    var n = 0;
    for (var i = 0; i < DIVISIONS.length; i++) {
      var d = DIVISIONS[i];
      for (var k = 0; k < d.types.length; k++) {
        var key = d.id + '/' + d.types[k].id;
        if (FIXED_SHAPE[key]) { if (d.id === divId && d.types[k].id === typeId) return -1; continue; }
        if (d.id === divId && d.types[k].id === typeId) return n;
        n++;
      }
    }
    return -2;
  }
  function defaultColor(divId, typeId) {
    var d = divOf(divId); if (!d) return UNASSIGNED_COLOR;
    if (divId === 'agri' && typeId === 'prod') return '#0ca678';
    var i = globalIdx(divId, typeId);
    if (i === -2) return d.color;
    if (i === -1) return '#2f9e44';
    return TYPE_PALETTE[i % TYPE_PALETTE.length];
  }
  /* v3.8: 기본 모양은 업무마다 다르게(업무 이름으로 정해져 늘 같음). 작물재배는 텐아르처럼 동그라미 */
  function defaultShape(divId, typeId) {
    if (!divId) return 'circle';
    var fx = FIXED_SHAPE[divId + '/' + typeId]; if (fx) return fx;
    var rest = SHAPES.map(function (x) { return x[0]; }).filter(function (x) { return x !== 'circle' && x !== 'drop'; });
    var i = globalIdx(divId, typeId);
    return i < 0 ? 'circle' : rest[i % rest.length];
  }
  function pinStyleOf(divId, typeId) {
    var P = (db.profile && db.profile.pinStyle) || {};
    var ps = P[styleKey(divId, typeId)] || {};
    return { color: ps.color || defaultColor(divId, typeId), shape: ps.shape || defaultShape(divId, typeId) };
  }
  function labelFieldsOf(divId, typeId) { var L = (db.profile && db.profile.pinLabel) || {}; var pl = L[styleKey(divId, typeId)]; return Array.isArray(pl) ? pl : DEFAULT_LABEL; }
  function floorCard(s) { return [s.floor, s.card].filter(function (x) { return x != null && String(x).trim() !== ''; }).join('-'); }
  /* v3.7 핀 글자 (텐아르 방식): 위 = 조사명, 아래 = 조사별 정보 (사용자 지정 2026-11-07) */
  var TOP_ALIAS = { 'agri/area': '작물재배' };
  function pad0(v, n) { v = String(v == null ? '' : v).trim(); return /^\d+$/.test(v) ? ('0000' + v).slice(-Math.max(n, v.length)) : v; }
  function emdOf(s) {
    if (s.region && s.region.emd) return s.region.emd;
    var m = String(s.addr || '').match(/(\S+(?:읍|면|동|가))(?=\s|$)/); return m ? m[1] : '';
  }
  function memoPick(s, key) { var m = String(s.memo || '').match(new RegExp(key + '\\s+([^/]+)')); return m ? m[1].trim() : ''; }
  function speciesOf(s) { return s.species || memoPick(s, '축종'); }
  function farmOf(s) { return s.farmName || memoPick(s, '농장'); }
  /* 생산량: 읍면동 리 번지 (주소에서 시도·시군구를 뺀 나머지) */
  function addrTail(s) {
    var a = String(s.addr || '').trim(), e = emdOf(s);
    if (e && a.indexOf(e) >= 0) return a.slice(a.indexOf(e));
    return a.replace(/^(\S+\s+){1,2}/, '');
  }
  function topText(s) {
    if (!s.division) return '';
    if (s.type === 'prod' && s.division === 'agri') return s.crop || '생산량';
    var t = typeOf(s.division, s.type);
    return TOP_ALIAS[s.division + '/' + s.type] || (t ? t.name : '');
  }
  function bottomText(s) {
    var e = emdOf(s), nm = nameOf(s);
    var key = s.division + '/' + s.type;
    if (key === 'agri/area') {
      var fc = [s.floor ? pad0(s.floor, 2) : '', s.josaguNo ? pad0(s.josaguNo, 4) : ''].filter(Boolean).join('-');
      return [e, fc].filter(Boolean).join(' ');
    }
    if (key === 'agri/prod') return addrTail(s) || e;
    if (key === 'agri/livestock') return [speciesOf(s), nm, farmOf(s), e].filter(Boolean).join(' ');
    if (key === 'agri/farmcost') return [s.kind, nm, e].filter(Boolean).join(' ');
    return [nm, e].filter(Boolean).join(' ');   /* 축비·쌀값(정미소)·농가경제·양곡·농림어업 등 / 다른 과도 우선 이름 + 읍면동 */
  }
  /* v3.9: 이름이 없으면 「없음」 */
  function nameOf(s) { var n = String(s.name || '').trim(); return !n || n === '이름 없는 조사구' ? '없음' : n; }
  function divOf(id) { for (var i = 0; i < DIVISIONS.length; i++) if (DIVISIONS[i].id === id) return DIVISIONS[i]; return null; }
  function typeOf(divId, typeId) { var d = divOf(divId); if (!d) return null; for (var i = 0; i < d.types.length; i++) if (d.types[i].id === typeId) return d.types[i]; return null; }
  /* 작물재배(농어업과 재배면적)는 읍면동별 색 — 텐아르 eupColor 와 같은 색표·계산이라 두 앱에서 같은 색 */
  var EUP_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#06b6d4', '#d946ef', '#eab308', '#22c55e'];
  function eupColor(name) { name = String(name || ''); var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0; return EUP_COLORS[h % EUP_COLORS.length]; }
  function emdKey(s) { var r = s.region || {}; return [r.sido || '', r.sigungu || '', r.emd || ''].join('|'); }
  function areaByEmd() { return !(db.profile && db.profile.areaByEmd === false); }
  function siteColor(s) {
    if (s.division === 'agri' && s.type === 'area' && areaByEmd() && s.region && s.region.emd) {
      var ec = db.profile && db.profile.emdColors && db.profile.emdColors[emdKey(s)];
      return ec || eupColor(s.region.emd);
    }
    return pinStyleOf(s.division, s.type).color;
  }
  function siteLabel(s) {
    var d = divOf(s.division); if (!d) return '미분류';
    var t = typeOf(s.division, s.type);
    return d.name + (t ? ' · ' + t.name : '') + (s.crop ? ' · ' + s.crop : '');
  }

  /* ───────── 공통 ───────── */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtTime(ts) { var d = new Date(ts); return d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function dateStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayStr() { return dateStr(new Date()); }
  function nowIso() { return new Date().toISOString(); }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }
  window.OdigoToast = toast;

  function loadJSON(key, dflt) { try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? dflt : v; } catch (e) { return dflt; } }
  function saveJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch (e) { return false; } }

  /* ───────── 자료 (store.js가 암호화 저장) ───────── */
  var db = { v: 2, profile: null, sites: [], visits: [] };
  var ready = false, storeStatus = '';
  var activeDiv = null;   /* 오른쪽 분야 버튼으로 고른 분야 (null = 전체) */
  function persist() {
    if (!ready) return;
    if (window.OdigoStore && !OdigoStore.isBlocked()) OdigoStore.save(db);
    else warnNotSaved();
    renderMarkers(); updateCounts(); renderDivBtns();
  }
  var notSavedShown = 0;
  function warnNotSaved() { if (Date.now() - notSavedShown > 8000) { notSavedShown = Date.now(); toast('지금은 이 기기에 저장되지 않습니다 (ⓘ에서 확인)'); } }
  if (window.OdigoStore) OdigoStore.onError = function () { toast('이 기기에 저장하지 못했습니다 (저장공간·사생활 보호 모드 확인)'); };

  function findSite(id) { for (var i = 0; i < db.sites.length; i++) if (db.sites[i].id === id) return db.sites[i]; return null; }
  function visitsOf(siteId) { return db.visits.filter(function (v) { return v.siteId === siteId; }); }
  function todayVisit(siteId) { var t = todayStr(); for (var i = 0; i < db.visits.length; i++) { var v = db.visits[i]; if (v.siteId === siteId && v.date === t) return v; } return null; }
  function todayPlanned() {
    var t = todayStr();
    return db.visits.filter(function (v) { return v.date === t && v.planned && findSite(v.siteId); }).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  }
  function todayOrderOf(siteId) { var tl = todayPlanned(); for (var i = 0; i < tl.length; i++) if (tl[i].siteId === siteId) return i + 1; return 0; }
  function visitedToday(siteId) { var v = todayVisit(siteId); return !!(v && v.events && v.events.length); }

  function addSite(o) {
    var s = { id: uid(), name: o.name || '', addr: o.addr || '', lat: +o.lat, lng: +o.lng, memo: o.memo || '',
      josaguNo: o.josaguNo || '', floor: o.floor || '', card: o.card || '', kind: o.kind || '', species: o.species || '', farmName: o.farmName || '',
      contacts: o.contacts || [], changes: o.changes || [], jibuns: o.jibuns || [], gifts: o.gifts || {},
      division: o.division || null, type: o.type || null, crop: o.crop || null, region: o.region || null, createdAt: nowIso(), updatedAt: nowIso() };
    db.sites.push(s); persist();
    if (!s.region || s.region.status !== 'ok' && s.region.status !== 'manual') fillRegion(s);
    return s;
  }
  function touch(s) { s.updatedAt = nowIso(); }
  function setToday(siteId, on) {
    var v = todayVisit(siteId), tl = todayPlanned();
    if (on) {
      var next = tl.length ? (tl[tl.length - 1].order || 0) + 1 : 1;
      if (!v) { v = { id: uid(), siteId: siteId, date: todayStr(), planned: true, order: next, status: 'todo', events: [], createdAt: nowIso(), updatedAt: nowIso() }; db.visits.push(v); }
      else if (!v.planned) { v.planned = true; v.order = next; v.updatedAt = nowIso(); }
    } else if (v) {
      if (v.events && v.events.length) { v.planned = false; v.updatedAt = nowIso(); }   /* 기록은 남기고 목록에서만 뺌 */
      else db.visits = db.visits.filter(function (x) { return x !== v; });
    }
    persist();
  }
  /* v3.9 방문 기록(메모): 날짜별 결과(조사완료·부분완료·부재중·재방문·기타) + 메모 */
  var VISIT_RESULTS = [['done', '조사완료', '#2b8a3e'], ['partial', '부분완료', '#1971c2'], ['absent', '부재중', '#e8590c'], ['revisit', '재방문', '#9c36b5'], ['etc', '기타', '#5c5f66']];
  function resultOf(id) { for (var i = 0; i < VISIT_RESULTS.length; i++) if (VISIT_RESULTS[i][0] === id) return VISIT_RESULTS[i]; return null; }
  function visitOn(siteId, date) { for (var i = 0; i < db.visits.length; i++) { var v = db.visits[i]; if (v.siteId === siteId && v.date === date) return v; } return null; }
  function addVisitEvent(siteId, note, date, result) {
    date = date || todayStr();
    var v = visitOn(siteId, date);
    if (!v) { v = { id: uid(), siteId: siteId, date: date, planned: false, order: 0, status: 'done', events: [], createdAt: nowIso(), updatedAt: nowIso() }; db.visits.push(v); }
    v.events = v.events || [];
    var at = date === todayStr() ? nowIso() : new Date(date + 'T12:00:00').toISOString();
    v.events.push({ at: at, status: result || 'done', note: note || '', noTime: date !== todayStr() || undefined });
    if (result) v.result = result;
    v.status = 'done'; v.updatedAt = nowIso();
    persist();
  }
  /* 가장 최근 방문 결과 (목록 표시용) */
  function lastResult(siteId) {
    var best = null;
    db.visits.forEach(function (v) { if (v.siteId === siteId && v.result && (!best || v.date > best.date)) best = v; });
    return best;
  }
  function deleteSite(siteId) {
    db.sites = db.sites.filter(function (s) { return s.id !== siteId; });
    db.visits = db.visits.filter(function (v) { return v.siteId !== siteId; });
    persist();
  }

  /* ───────── 지도 ───────── */
  function tileUrl(layer, ext) { return 'https://api.vworld.kr/req/wmts/1.0.0/' + VWORLD_API_KEY + '/' + layer + '/{z}/{y}/{x}.' + ext; }
  var view = loadJSON(VIEW_KEY, null);
  /* 배경·하이브리드 선택은 레이어 패널(layers.js, odigo_layers_v2)이 관리. 첫 화면 깜빡임을 막으려고 여기서 미리 읽음 */
  var lyrSet = loadJSON('odigo_layers_v2', null);
  var base = lyrSet ? lyrSet.base : loadJSON(BASE_KEY, 'Sat');
  var hybridOn = lyrSet ? !!(lyrSet.ov && lyrSet.ov.hybrid) : base === 'Sat';

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
        { id: 'hybrid', type: 'raster', source: 'hybrid', layout: { visibility: hybridOn ? 'visible' : 'none' } }
      ]
    },
    center: view ? [view.lng, view.lat] : [127.9, 36.2],
    zoom: view ? view.z : 6.6,
    maxZoom: 19,
    attributionControl: { compact: true }
  });
  /* v3.6: 확대·축소 버튼은 왼쪽 아래, 그 위에 축척 막대와 확대 단계(레벨) */
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-left');
  (function () {
    function Lv() {}
    /* 레벨 표시 옆에 KAKAO·NAVER (같은 크기) */
    Lv.prototype.onAdd = function (m) {
      this._el = document.createElement('div'); this._el.className = 'maplibregl-ctrl lv-row';
      this._el.innerHTML = '<span class="zoom-level"></span><button type="button" data-quick="kakao" class="qm-kakao">KAKAO</button><button type="button" data-quick="naver" class="qm-naver">NAVER</button>';
      var el = this._el.querySelector('.zoom-level'); function up() { el.textContent = '레벨 ' + m.getZoom().toFixed(1); } m.on('zoom', up); up(); return this._el;
    };
    Lv.prototype.onRemove = function () { this._el.remove(); };
    map.addControl(new Lv(), 'bottom-left');
  })();
  map.on('moveend', function () { var c = map.getCenter(); saveJSON(VIEW_KEY, { lng: +c.lng.toFixed(6), lat: +c.lat.toFixed(6), z: +map.getZoom().toFixed(2) }); });
  var tileErrShown = false;
  map.on('error', function (e) { if (!tileErrShown && e && e.sourceId) { tileErrShown = true; toast('배경지도 일부를 불러오지 못했습니다'); } });

  /* ───────── 조사구 핀 (HTML 마커 = 레이어보다 항상 위) ───────── */
  var markers = {};
  var mapFilter = null;   /* 목록에서 「지도에서 보기」로 고른 조건 (분야·유형·작물·드롭다운) */
  /* v3.9: 내 설정에서 고른 주요업무분야(여러 개)만 지도에 (미분류는 늘 표시) */
  function myDivs() {
    var p = db.profile || {};
    var a = Array.isArray(p.divisions) && p.divisions.length ? p.divisions : (p.division ? [p.division] : []);
    return a.filter(function (x) { return divOf(x); });
  }
  function visibleSites() {
    if (mapFilter) return filterSites(mapFilter);
    /* 내 설정에서 분야를 직접 고른 뒤부터 적용 (예전 설정은 모두 표시) */
    var md = db.profile && Array.isArray(db.profile.divisions) ? myDivs() : [];
    return db.sites.filter(function (s) {
      if (activeDiv) return activeDiv === '_none' ? !s.division : s.division === activeDiv;
      return !s.division || !md.length || md.indexOf(s.division) >= 0;
    });
  }
  /* v3.8 조사구 번호(#): 텐아르처럼 같은 업무·작물·읍면동 안의 순번 = 가는 순서. 저장값(no) → 이름의 #숫자 → 조사구번호 순 */
  function groupKey(s) { var r = s.region || {}; return [s.division || '_', s.type || '_', s.crop || '_', r.status === 'ok' ? (r.sido + r.sigungu + r.emd) : '?'].join('|'); }
  function noOf(s) {
    if (s.no) return +s.no;
    var m = String(s.name || '').match(/#(\d+)/); if (m) return +m[1];
    return seqCache[s.id] || 0;
  }
  function groupOf(s) { var k = groupKey(s); return db.sites.filter(function (x) { return groupKey(x) === k; }); }
  function sortByNo(list) { return list.slice().sort(function (a, b) { return (noOf(a) || 1e9) - (noOf(b) || 1e9) || natCmp(a.josaguNo, b.josaguNo) || natCmp(a.createdAt, b.createdAt); }); }
  /* 번호를 바꾸면 같은 묶음의 다른 번호가 밀리거나 당겨짐 (5 → 3 이면 3·4 가 4·5 로) */
  function renumber(s, newNo) {
    var g = sortByNo(groupOf(s)).filter(function (x) { return x !== s; });
    newNo = Math.max(1, Math.min(g.length + 1, parseInt(newNo, 10) || g.length + 1));
    g.splice(newNo - 1, 0, s);
    g.forEach(function (x, i) { if (x.no !== i + 1) { x.no = i + 1; touch(x); } });
  }
  function nextNo(s) { var mx = 0; groupOf(s).forEach(function (x) { if (x !== s) mx = Math.max(mx, noOf(x)); }); return mx + 1; }
  function p2(v) { return pad0(v, 2); } function p4(v) { return pad0(v, 4); }
  /* 화면에 보일 이름: 작물재배 = 「작물재배 07층 0008조사구 #6」 */
  function dispName(s) {
    if (s.division === 'agri' && s.type === 'area') {
      return ['작물재배', s.floor ? p2(s.floor) + '층' : '', s.josaguNo ? p4(s.josaguNo) + '조사구' : '', noOf(s) ? '#' + noOf(s) : ''].filter(Boolean).join(' ');
    }
    return nameOf(s);
  }
  function floorJosagu(s) { return [s.floor ? p2(s.floor) + '층' : '', s.josaguNo ? p4(s.josaguNo) + '조사구' : ''].filter(Boolean).join(' '); }
  /* 카카오맵·네이버지도 앱 바로가기 (모든 팝업 공용) */
  function mapAppBtns(name, lat, lng) {
    var a = ' data-n="' + esc(name || '위치') + '" data-lat="' + (+lat).toFixed(6) + '" data-lng="' + (+lng).toFixed(6) + '"';
    return '<span class="mapapps"><button type="button" class="ma-k" data-mapapp="k"' + a + '>K 카카오맵</button><button type="button" class="ma-n" data-mapapp="n"' + a + '>N 네이버지도</button></span>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-mapapp]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var n = b.getAttribute('data-n'), la = b.getAttribute('data-lat'), lo = b.getAttribute('data-lng'), en = encodeURIComponent(String(n).replace(/[,\n]/g, ' '));
    if (b.getAttribute('data-mapapp') === 'k') openAppOrWeb('kakaomap://look?p=' + la + ',' + lo, 'https://map.kakao.com/link/map/' + en + ',' + la + ',' + lo);
    else openAppOrWeb('nmap://place?lat=' + la + '&lng=' + lo + '&name=' + en + '&appname=odigo', 'https://map.naver.com/?lng=' + lo + '&lat=' + la + '&title=' + en);
  }, true);
  /* 핀 안 번호: 같은 분야·조사 유형·작물·읍면동 안에서 조사구번호(숫자 순) → 등록 순 */
  function natCmp(a, b) { return String(a || '').localeCompare(String(b || ''), 'ko', { numeric: true }); }
  function seqMap() {
    var g = {}, out = {};
    db.sites.forEach(function (s) {
      var r = s.region || {};
      var k = [s.division || '_', s.type || '_', s.crop || '_', r.status === 'ok' ? (r.sido + r.sigungu + r.emd) : '?'].join('|');
      (g[k] = g[k] || []).push(s);
    });
    Object.keys(g).forEach(function (k) {
      g[k].sort(function (a, b) { return natCmp(a.josaguNo, b.josaguNo) || natCmp(a.createdAt, b.createdAt); }).forEach(function (s, i) { out[s.id] = i + 1; });
    });
    return out;
  }
  var seqCache = {};
  function renderMarkers() {
    Object.keys(markers).forEach(function (id) { markers[id].remove(); });
    markers = {};
    seqCache = seqMap();
    visibleSites().forEach(function (s) {
      if (!isFinite(s.lat) || !isFinite(s.lng)) return;
      var ord = todayOrderOf(s.id), el = document.createElement('div'), ps = pinStyleOf(s.division, s.type), tp = topText(s), lb = bottomText(s);
      el.className = 'pin-wrap w-' + ps.shape;
      el.innerHTML = '<div class="pin s-' + ps.shape + (ord ? ' today' : '') + (ord && visitedToday(s.id) ? ' visited' : '') + '" style="--pc:' + siteColor(s) + '"><i>' + (noOf(s) || '') + '</i></div>' +
        (ord ? '<span class="pin-today">' + ord + '</span>' : '') +
        (tp ? '<span class="pin-top">' + esc(tp) + '</span>' : '') +
        (lb ? '<span class="pin-label">' + esc(lb) + '</span>' : '');
      el.title = dispName(s) + ' · ' + siteLabel(s);
      el.addEventListener('click', function (ev) { ev.stopPropagation(); openSite(s.id, { fromPin: true }); flyToVisible(s, map.getZoom()); });
      /* 물방울은 끝이 좌표, 나머지 모양은 가운데가 좌표 (텐아르 동그라미 핀과 같이 겹쳐 보임) */
      var m = new maplibregl.Marker({ element: el, anchor: ps.shape === 'drop' ? 'bottom' : 'center' }).setLngLat([s.lng, s.lat]).addTo(map);
      m.getElement().style.zIndex = ord ? 3 : 2;
      markers[s.id] = m;
      /* v3.9 작물재배: 지도에서 찍은 필지(지번) 표시 */
      (s.jibuns || []).forEach(function (j, k) {
        if (!isFinite(j.lat)) return;
        var je = document.createElement('div'); je.className = 'jb-mark' + (j.changes && j.changes.length ? ' chg' : '');
        je.textContent = j.jibun + (j.changes && j.changes.length ? ' · ' + j.changes.join(',') : '');
        je.addEventListener('click', function (ev) { ev.stopPropagation(); openSite(s.id, { fromPin: true }); });
        markers[s.id + '#j' + k] = new maplibregl.Marker({ element: je, anchor: 'center' }).setLngLat([j.lng, j.lat]).addTo(map);
      });
    });
  }
  /* v3.8 확대 단계별 핀·글자 크기 — 텐아르 area-plots 와 같은 값 (축소하면 작게, 확대하면 크게) */
  function interp(z, pts) {
    if (z <= pts[0][0]) return pts[0][1];
    for (var i = 1; i < pts.length; i++) if (z <= pts[i][0]) { var a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (z - a[0]) / (b[0] - a[0]); }
    return pts[pts.length - 1][1];
  }
  function pinVars(z) {
    var r = interp(z, [[8, 5.5], [11, 8.5], [14, 9.5], [16, 11], [18, 13]]), h = interp(z, [[8, 7], [11, 10], [14, 13], [16, 16], [18, 19]]);
    return { '--pd': (r * 2 + 3.2).toFixed(1) + 'px', '--ph': Math.max(0, h - r).toFixed(1) + 'px',
      '--pn': interp(z, [[8, 7], [10, 9], [13, 10], [16, 12], [18, 13]]).toFixed(1) + 'px',
      '--pt': interp(z, [[10, 10], [14, 12], [18, 13]]).toFixed(1) + 'px', '--pb': interp(z, [[10, 10], [14, 11]]).toFixed(1) + 'px' };
  }
  function applyPinVars(el, z) { var v = pinVars(z); Object.keys(v).forEach(function (k) { el.style.setProperty(k, v[k]); }); }
  map.on('zoom', function () { applyPinVars(document.documentElement, map.getZoom()); });
  applyPinVars(document.documentElement, map.getZoom());
  function updateCounts() { $('cntPlaces').textContent = db.sites.length; $('cntToday').textContent = todayPlanned().length; }

  /* ───────── 시트 ───────── */
  var sheetLocked = false, curView = null;   /* curView = 지금 열린 조사구 카드 id (지역 확인 후 새로 그리기용) */
  /* v3.9 뒤로 가기: 시트 내용은 화면마다 따로 담는 칸(pane)에 그리고, 새 화면을 열면 이전 칸을 통째로(버튼 동작 포함) 보관했다가 ‹ 로 되살림.
     이미 보관한 화면과 같은 제목을 다시 열면 그 화면으로 「돌아간」 것으로 보고 그 뒤 기록은 정리 */
  var navStack = [], curTitle = '';
  function curPane() { return $('sheetBody').firstElementChild; }
  function updBack() { $('sheetBack').hidden = sheetLocked || !navStack.length; }
  function openSheet(title, html, opt) {
    var b = $('sheetBody'), open = !$('sheet').hidden;
    if (!open || sheetLocked || (opt && opt.lock) || (opt && opt.fresh)) navStack = [];
    else {
      var idx = -1; navStack.forEach(function (e, i) { if (idx < 0 && (e.title === title || (opt && opt.view && e.view === opt.view))) idx = i; });
      if (idx >= 0) navStack.length = idx;
      else if (curPane() && curTitle !== title) { navStack.push({ title: curTitle, pane: curPane(), view: curView, top: b.scrollTop }); if (navStack.length > 12) navStack.shift(); }
    }
    curView = null;
    sheetLocked = !!(opt && opt.lock);
    $('sheetClose').hidden = sheetLocked;
    $('sheetTitle').textContent = title; curTitle = title;
    var pane = document.createElement('div'); pane.className = 'pane'; pane.innerHTML = html || '';
    while (b.firstChild) b.removeChild(b.firstChild);
    b.appendChild(pane);
    $('sheet').hidden = false;
    $('sheetBackdrop').hidden = !sheetLocked;   /* v3.8: 처음 설정 창만 지도를 막고, 나머지는 시트가 열려 있어도 지도를 움직일 수 있음 */
    setSheetMin(false);
    b.scrollTop = 0;
    updBack();
    return pane;
  }
  function sheetBack() {
    var e = navStack.pop(); if (!e) { closeSheet(); return; }
    var b = $('sheetBody');
    while (b.firstChild) b.removeChild(b.firstChild);
    b.appendChild(e.pane);
    $('sheetTitle').textContent = e.title; curTitle = e.title; curView = e.view;
    setSheetMin(false); b.scrollTop = e.top || 0; updBack();
    if (e.view && findSite(e.view)) openSite(e.view, { refresh: true });   /* 조사구 카드는 최신 내용으로 다시 그림 */
  }
  function closeSheet(force) { if (sheetLocked && force !== true) return; sheetLocked = false; navStack = []; $('sheetClose').hidden = false; $('sheet').hidden = true; $('sheetBackdrop').hidden = true; updBack(); }
  /* 접기(머리만 남김) · 위 막대를 끌어 높이 조절 (텐아르 시트처럼) */
  var sheetH = null;
  function setSheetMin(m) { $('sheet').classList.toggle('min', !!m); $('sheetMin').textContent = m ? '▴' : '▾'; $('sheetMin').title = m ? '펼치기' : '접기'; }
  $('sheetMin').addEventListener('click', function () { setSheetMin(!$('sheet').classList.contains('min')); });
  (function () {
    var g = $('sheetGrab'), startY = 0, startH = 0, drag = false;
    function down(e) { drag = true; startY = (e.touches ? e.touches[0] : e).clientY; startH = $('sheet').getBoundingClientRect().height; setSheetMin(false); e.preventDefault(); }
    function move(e) {
      if (!drag) return;
      var y = (e.touches ? e.touches[0] : e).clientY, vh = window.innerHeight;
      var h = Math.max(110, Math.min(vh * 0.92, startH + (startY - y)));
      $('sheet').style.height = h + 'px'; $('sheet').style.maxHeight = 'none'; sheetH = h;
      e.preventDefault();
    }
    function up() { if (!drag) return; drag = false; if (sheetH && sheetH < 140) { setSheetMin(true); $('sheet').style.height = ''; $('sheet').style.maxHeight = ''; sheetH = null; } }
    g.addEventListener('mousedown', down); g.addEventListener('touchstart', down, { passive: false });
    window.addEventListener('mousemove', move); window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', up); window.addEventListener('touchend', up);
  })();
  /* 시트에 가리지 않게: 핀이 시트 위쪽 보이는 곳 가운데에 오도록 이동 */
  function flyToVisible(s, zoom) {
    var sh = $('sheet').hidden ? 0 : $('sheet').getBoundingClientRect().height;
    if ($('sheet').classList.contains('min')) sh = 60;
    map.easeTo({ center: [s.lng, s.lat], zoom: zoom || Math.max(map.getZoom(), 15), offset: [0, -Math.round(sh / 2)], duration: 600 });
  }
  /* v3.9: 조사구 카드를 닫으면 보던 업무 목록이 다시 나옴 (목록에서 닫으면 그때 닫힘) */
  var lastList = null;
  $('sheetClose').addEventListener('click', function () {
    var s = curView && findSite(curView);
    if (s && lastList && lastList.div === s.division) { var o = lastList; closeSheet(); openList(o); return; }
    closeSheet();
  });
  $('sheetBack').addEventListener('click', sheetBack);
  $('sheetBackdrop').addEventListener('click', function () { closeSheet(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeSheet(); hideResults(); } });

  /* ───────── 처음 접속 · 내 설정 ───────── */
  /* v3.9: 주요업무분야 여러 개 체크 — 고른 분야만 지도에 표시 */
  function divRadios(sel) {
    var on = Array.isArray(sel) ? sel : (sel ? [sel] : []);
    return '<div class="div-pick">' + DIVISIONS.map(function (d) {
      return '<label class="div-opt" style="--c:' + d.color + '"><input type="checkbox" name="pdiv" value="' + d.id + '"' + (on.indexOf(d.id) >= 0 ? ' checked' : '') + '><span>' + esc(d.name) + '</span></label>';
    }).join('') + '</div>';
  }
  function openProfile(first) {
    var p = db.profile || {};
    var body = openSheet(first ? '어디고에 오신 것을 환영합니다' : '⚙ 내 설정',
      (first ? '<p class="muted">처음 한 번만 설정합니다. 나중에 ⓘ › 내 설정에서 바꿀 수 있습니다.</p>' : '') +
      '<label class="fld">닉네임</label><input class="inp" id="pfNick" maxlength="12" value="' + esc(p.nickname || '') + '" placeholder="예: 현장하늘" autocomplete="nickname">' +
      '<p class="muted">텐아르 게임에서 쓰는 이름을 넣어 주세요. 어디고 화면과 카톡·문자 메시지에 이 이름이 들어갑니다.</p>' +
      '<label class="fld">주요업무분야 (여러 개 고를 수 있음)</label>' + divRadios(p.divisions && p.divisions.length ? p.divisions : p.division) +
      '<p class="muted">고른 분야의 조사구만 지도에 보입니다(미분류는 늘 보임). 맨 처음 고른 분야(이미 있던 기본 분야)가 시작 화면이 됩니다.</p>' +
      (first ? '' : '<p class="muted">이미 저장한 조사구의 분야는 조사구 수정에서 바꿉니다.</p>' +
        '<label class="fld">🚨 현장 안전 연락 — 기본 문자 수신 번호</label><input class="inp" id="pfSms" inputmode="tel" maxlength="20" placeholder="예: 010-1234-5678" value="' + esc((p.safety || {}).smsTo || '') + '">' +
        '<label class="fld">카카오톡 안전 연락방 이름</label><input class="inp" id="pfRoom" maxlength="30" placeholder="예: 고령 현장 안전방" value="' + esc((p.safety || {}).kakaoRoom || '') + '">' +
        '<p class="muted">「나 조사하러 간다」에서 문자 받는 번호의 기본값과, 카톡 공유 때 고를 방 이름 안내에 씁니다. 보내기 전에 바꿀 수 있습니다.</p>' +
        '<p class="muted">※ 카카오톡은 사생활 보호를 위해 웹·앱이 <b>정해진 단체방으로 자동 전송하는 기능을 제공하지 않습니다</b>(공식 공유는 매번 방을 직접 고름). 그래서 방 이름을 화면에 크게 보여 주고, 문구는 미리 복사해 둡니다.</p>' +
        '<div class="row"><button class="btn full" id="pfPins" type="button">📍 업무별 핀 모양·색·이름표 설정</button></div>') +
      '<div class="row"><button class="btn primary full" id="pfSave" disabled>' + (first ? '저장하고 시작' : '저장') + '</button></div>',
      { lock: !!first });
    var nick = body.querySelector('#pfNick'), btn = body.querySelector('#pfSave');
    function check() { btn.disabled = !(nick.value.trim() && body.querySelector('input[name="pdiv"]:checked')); }
    var order = (p.divisions || []).slice();
    body.querySelectorAll('input[name="pdiv"]').forEach(function (r) { r.addEventListener('change', function () { order = order.filter(function (x) { return x !== r.value; }); if (r.checked) order.push(r.value); }); });
    nick.addEventListener('input', check);
    var pinsBtn = body.querySelector('#pfPins'); if (pinsBtn) pinsBtn.addEventListener('click', function () { openPinSettings(); });
    body.querySelectorAll('input[name="pdiv"]').forEach(function (r) { r.addEventListener('change', check); });
    check();
    btn.addEventListener('click', function () {
      var checked = Array.prototype.map.call(body.querySelectorAll('input[name="pdiv"]:checked'), function (x) { return x.value; });
      var ds = order.filter(function (x) { return checked.indexOf(x) >= 0; }).concat(checked.filter(function (x) { return order.indexOf(x) < 0; }));
      var d = p.division && ds.indexOf(p.division) >= 0 ? p.division : ds[0];
      ds = [d].concat(ds.filter(function (x) { return x !== d; }));
      var sf = (db.profile && db.profile.safety) || {};
      var smsEl = body.querySelector('#pfSms'), roomEl = body.querySelector('#pfRoom');
      if (smsEl) sf = { smsTo: smsEl.value.replace(/[^\d+\-\s]/g, '').trim(), kakaoRoom: roomEl.value.trim() };
      db.profile = Object.assign({}, db.profile || {}, { v: 1, nickname: nick.value.trim().slice(0, 12), division: d, divisions: ds, safety: sf,
        createdAt: (db.profile && db.profile.createdAt) || nowIso(), updatedAt: nowIso() });
      activeDiv = null; mapFilter = null;
      persist();
      closeSheet(true);
      toast('저장했습니다');
      if (first) openHome(d);
    });
  }

  /* ───────── 업무별 핀 모양·색·이름표 ───────── */
  /* 작물재배 읍면동별 색 목록 (지금 저장된 재배면적 조사구의 읍면동만) */
  function emdColorHtml() {
    var seen = {}, keys = [];
    db.sites.forEach(function (s) { if (s.division === 'agri' && s.type === 'area' && s.region && s.region.emd) { var k = emdKey(s); if (!seen[k]) { seen[k] = 0; keys.push(k); } seen[k]++; } });
    keys.sort();
    var ec = (db.profile && db.profile.emdColors) || {};
    return '<div class="ps-emd"><label class="chk-all"><input type="checkbox" id="psAreaEmd"' + (areaByEmd() ? ' checked' : '') + '> <b>작물재배(재배면적)는 읍면동별 색</b> <small class="muted">— 텐아르와 같은 색</small></label>' +
      '<div id="psEmdList"' + (areaByEmd() ? '' : ' hidden') + '>' + (keys.length ? keys.map(function (k) {
        var p = k.split('|');
        return '<label class="ps-emd-row"><input type="color" data-emd="' + esc(k) + '" value="' + (ec[k] || eupColor(p[2])) + '"> ' + esc(p[1] + ' ' + p[2]) + ' <small class="muted">' + seen[k] + '곳</small></label>';
      }).join('') : '<p class="muted">읍면동이 확인된 재배면적 조사구가 아직 없습니다.</p>') + '</div></div>';
  }
  /* 업무(조사 유형)별 핀 설정 — 기본은 내 과의 업무만, 다른 과는 골라서 */
  function openPinSettings(divSel) {
    if (!db.profile) return;
    var dv = divOf(divSel || db.profile.division) || DIVISIONS[0];
    var rows = dv.types.map(function (t) { return [dv.id, t.id, t.name]; });
    if (!divSel || divSel === db.profile.division) rows.push([null, null, '미분류']);
    var html = '<p class="muted">업무마다 핀의 모양·색을 고릅니다. 핀 위·아래 글자는 조사별로 정해져 있습니다(예: 작물재배 → 위 「작물재배」, 아래 「논공읍 06-0022」). 레이어 › 「핀 제목」으로 켜고 끕니다.</p>' +
      '<label class="fld">과</label><select class="inp" id="psDiv">' + DIVISIONS.map(function (d) { return '<option value="' + d.id + '"' + (d.id === dv.id ? ' selected' : '') + '>' + esc(d.name) + (d.id === db.profile.division ? ' (내 과)' : '') + '</option>'; }).join('') + '</select>' +
      '<div class="row ps-top"><button class="btn" id="psReset">↺ 이 과 기본값으로</button><button class="btn primary" id="psSave" style="flex:1">저장</button></div>' +
      rows.map(function (r) {
        var ps = pinStyleOf(r[0], r[1]), lf = labelFieldsOf(r[0], r[1]), n = r[0] ? countBy(r[0], r[1]) : unassigned().length;
        return '<div class="ps-row" data-key="' + styleKey(r[0], r[1]) + '">' +
          '<div class="ps-head"><span class="ps-prev"><span class="pin-wrap demo"><span class="pin s-' + ps.shape + '" style="--pc:' + ps.color + '"><i>1</i></span></span></span><b>' + esc(r[2]) + ' <small class="muted">' + n + '곳</small></b>' +
          '<input type="color" data-k="color" value="' + ps.color + '"><select data-k="shape">' + SHAPES.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === ps.shape ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></div>' +
          '</div>';
      }).join('') +
      (dv.id === 'agri' ? emdColorHtml() : '');
    var body = openSheet('📍 업무별 핀 모양·색·이름표', html);
    var abe = body.querySelector('#psAreaEmd');
    if (abe) abe.addEventListener('change', function () { body.querySelector('#psEmdList').hidden = !abe.checked; });
    body.querySelector('#psDiv').addEventListener('change', function (e) { openPinSettings(e.target.value); });
    body.querySelectorAll('.ps-row').forEach(function (row) {
      function prev() { var p = row.querySelector('.ps-prev .pin'); p.className = 'pin s-' + row.querySelector('[data-k=shape]').value; p.style.setProperty('--pc', row.querySelector('[data-k=color]').value); }
      row.querySelectorAll('[data-k]').forEach(function (x) { x.addEventListener('input', prev); x.addEventListener('change', prev); });
    });
    function keys() { return Array.prototype.map.call(body.querySelectorAll('.ps-row'), function (r) { return r.getAttribute('data-key'); }); }
    body.querySelector('#psReset').addEventListener('click', function () {
      if (!confirm(dv.name + ' 업무들의 핀 모양·색·이름표를 기본값으로 되돌릴까요?')) return;
      keys().forEach(function (k) { if (db.profile.pinStyle) delete db.profile.pinStyle[k]; if (db.profile.pinLabel) delete db.profile.pinLabel[k]; });
      persist(); openPinSettings(dv.id); toast('기본값으로 되돌렸습니다');
    });
    body.querySelector('#psSave').addEventListener('click', function () {
      var st = db.profile.pinStyle || {}, lb = db.profile.pinLabel || {};
      DIVISIONS.forEach(function (d) { delete st[d.id]; delete lb[d.id]; });   /* v2.9의 과 단위 설정은 정리 */
      body.querySelectorAll('.ps-row').forEach(function (row) {
        var k = row.getAttribute('data-key'), pr = k === '_none' ? [null, null] : k.split('/');
        var c = row.querySelector('[data-k=color]').value, sh = row.querySelector('[data-k=shape]').value;
        /* v3.9: 기본값과 같으면 저장하지 않음 → 나중에 기본값이 바뀌어도 따라감 */
        if (c.toLowerCase() === defaultColor(pr[0], pr[1]).toLowerCase() && sh === defaultShape(pr[0], pr[1])) delete st[k];
        else st[k] = { color: c, shape: sh };
        delete lb[k];
      });
      db.profile.pinStyle = st; db.profile.pinLabel = lb; db.profile.updatedAt = nowIso();
      if (abe) {
        db.profile.areaByEmd = abe.checked;
        var ec = db.profile.emdColors || {};
        body.querySelectorAll('[data-emd]').forEach(function (inp) { var k = inp.getAttribute('data-emd'); if (inp.value.toLowerCase() !== eupColor(k.split('|')[2]).toLowerCase()) ec[k] = inp.value; else delete ec[k]; });
        db.profile.emdColors = ec;
      }
      persist(); closeSheet(); toast('핀 설정을 저장했습니다');
    });
  }
  /* 지도를 확대했을 때만 핀 이름표 표시 */
  /* v3.6: 핀 제목은 모든 확대 단계에서 보임 · 레이어 패널 「핀 제목」으로 켜고 끔 (odigo_layers_v2.pinTitles, 기본 켬) */
  function setPinLabels(on) { document.body.classList.toggle('pin-labels', !!on); }
  setPinLabels(!(lyrSet && lyrSet.pinTitles === false));

  /* ───────── 업무 시작 화면 (나의 조사구 현황) ───────── */
  function countBy(divId, typeId, crop) {
    return db.sites.filter(function (s) { return s.division === divId && (!typeId || s.type === typeId) && (!crop || s.crop === crop); }).length;
  }
  function unassigned() { return db.sites.filter(function (s) { return !s.division; }); }
  function openHome(divId) {
    var d = divOf(divId || (db.profile && db.profile.division)) || DIVISIONS[0];
    var html = '<div class="home-head" style="--c:' + d.color + '"><b>' + esc(d.name) + '</b> · 나의 조사구 <span class="chip">' + countBy(d.id) + '건</span>' +
      (db.profile ? '<span class="home-nick">' + esc(db.profile.nickname) + '</span>' : '') + '</div>' +
      '<div class="home-grid">' + d.types.map(function (t) {
        var n = countBy(d.id, t.id);
        var crops = t.crops ? '<div class="home-crops">' + t.crops.map(function (c) {
          var k = countBy(d.id, t.id, c);
          return '<button class="crop-n' + (k ? '' : ' zero') + '" data-type="' + t.id + '" data-crop="' + esc(c) + '">' + esc(c) + ' ' + k + '</button>';
        }).join('') + '</div>' : '';
        return '<div class="home-cell' + (t.crops ? ' wide' : '') + '"><button class="home-t' + (n ? '' : ' zero') + '" data-type="' + t.id + '"><span>' + esc(t.name) + '</span><b>' + n + '건</b></button>' + crops + '</div>';
      }).join('') + '</div>';
    var un = unassigned().length;
    if (un) html += '<button class="home-un" data-un="1"><span>미분류 (v2.3에서 옮겨 온 장소 등)</span><b>' + un + '건 ›</b></button>';
    html += '<div class="row"><button class="btn" id="hmMap" style="flex:1">지도에서 보기</button><button class="btn" id="hmGift">🎁 답례품</button><button class="btn" id="hmSet">⚙ 내 설정</button></div>' +
      '<div class="row home-divs">' + DIVISIONS.filter(function (x) { return x.id !== d.id; }).map(function (x) {
        return '<button class="btn sm" data-div="' + x.id + '">' + esc(x.name) + ' ' + countBy(x.id) + '</button>';
      }).join('') + '</div>';
    var body = openSheet('나의 조사구 현황', html);
    body.querySelectorAll('[data-type]').forEach(function (b) {
      b.addEventListener('click', function () { openList({ div: d.id, type: b.getAttribute('data-type'), crop: b.getAttribute('data-crop') || null }); });
    });
    var ub = body.querySelector('[data-un]'); if (ub) ub.addEventListener('click', function () { openUnassigned(); });
    body.querySelector('#hmMap').addEventListener('click', function () { setActiveDiv(d.id); closeSheet(); fitSites(visibleSites()); });
    body.querySelector('#hmSet').addEventListener('click', function () { openProfile(false); });
    body.querySelector('#hmGift').addEventListener('click', function () { openGifts({ div: d.id }); });
    body.querySelectorAll('[data-div]').forEach(function (b) { b.addEventListener('click', function () { openHome(b.getAttribute('data-div')); }); });
  }
  function fitSites(list) {
    var pts = list.filter(function (s) { return isFinite(s.lat); });
    if (!pts.length) return;
    /* v3.9: 시트가 열려 있으면 시트 위 보이는 곳에 맞춤 */
    var sh = $('sheet').hidden ? 0 : ($('sheet').classList.contains('min') ? 60 : $('sheet').getBoundingClientRect().height);
    if (pts.length === 1) { flyToVisible(pts[0], Math.max(map.getZoom(), 15)); return; }
    var b = new maplibregl.LngLatBounds(); pts.forEach(function (s) { b.extend([s.lng, s.lat]); });
    var maxB = Math.max(70, window.innerHeight - 200);
    map.fitBounds(b, { padding: { top: 90, left: 50, right: 70, bottom: Math.min(maxB, sh + 40) }, maxZoom: 16, duration: 600 });
  }

  /* ───────── 오른쪽 분야 버튼 ───────── */
  var MAIN_DIVS = ['agri', 'econ', 'social', 'proxy'];
  var divMoreOpen = false;
  function renderDivBtns() {
    var box = $('divCol'); if (!box) return;
    if (!db.profile) { box.hidden = true; return; }
    box.hidden = false;
    var mine = db.profile.division;
    /* v3.9: 내 설정에서 고른 주요업무분야만 버튼으로, 나머지는 ⋯ 안 */
    var order = Array.isArray(db.profile.divisions) && myDivs().length ? myDivs() : [mine].concat(MAIN_DIVS.filter(function (x) { return x !== mine; }));
    var rest = DIVISIONS.map(function (d) { return d.id; }).filter(function (x) { return order.indexOf(x) < 0; });
    var compact = window.innerHeight < 700 && order.length > 3 || window.innerHeight < 600 && order.length > 1;
    var shown = compact ? order.slice(0, 3) : order;
    var hiddenIds = compact ? order.slice(3).concat(rest) : rest;
    var html = shown.map(btn).join('');
    if (hiddenIds.length) html += '<button class="div-btn more" data-more="1">' + (divMoreOpen ? '접기' : '⋯ 분야') + '</button>';
    if (divMoreOpen) html += hiddenIds.map(btn).join('');
    if (unassigned().length) html += btn('_none');
    box.innerHTML = html;
    function btn(id) {
      var d = divOf(id), n = id === '_none' ? unassigned().length : countBy(id);
      return '<button class="div-btn' + (activeDiv === id ? ' on' : '') + (id === mine ? ' mine' : '') + '" data-d="' + id + '" style="--c:' + (d ? d.color : UNASSIGNED_COLOR) + '">' +
        '<b>' + esc(d ? d.short : '미분류') + '</b><small>' + n + '</small></button>';
    }
    box.querySelectorAll('[data-d]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-d');
        if (activeDiv === id) { setActiveDiv(null); lastList = null; toast('고른 주요업무분야의 조사구를 모두 표시합니다'); return; }
        setActiveDiv(id);
        if (id === '_none') openUnassigned(); else openList({ div: id });
      });
    });
    var mb = box.querySelector('[data-more]'); if (mb) mb.addEventListener('click', function () { divMoreOpen = !divMoreOpen; renderDivBtns(); });
  }
  function setActiveDiv(id) { activeDiv = id; mapFilter = null; renderMarkers(); renderDivBtns(); }
  /* 목록 조건 그대로 지도에 핀만 남기고, 그 핀이 다 보이게 축소 */
  function showOnMap(o) {
    var list = filterSites(o);
    activeDiv = o.div; mapFilter = { div: o.div, type: o.type || null, crop: o.crop || null, f: o.f || {} };
    renderMarkers(); renderDivBtns(); closeSheet();
    if (!list.length) { toast('지도에 표시할 조사구가 없습니다'); return; }
    fitSites(list);
    var d = divOf(o.div), t = typeOf(o.div, o.type);
    toast((t ? t.name : d ? d.name : '') + (o.crop ? ' ' + o.crop : '') + ' ' + list.length + '곳만 표시 · 분야 버튼을 다시 누르면 전체');
  }
  window.addEventListener('resize', function () { renderDivBtns(); });

  /* ───────── 조사구 목록 (분야 › 유형 › 작물, 시도 › 시군구 › 읍면동 › 리) ───────── */
  function regionKey(s) {
    var r = s.region;
    if (!r || r.status === 'pending') return null;
    if (r.status === 'unknown' || !r.sido) return null;
    return r;
  }
  function buildTree(list) {
    var root = { n: 0, kids: {}, order: [] }, none = [];
    list.forEach(function (s) {
      var r = regionKey(s);
      if (!r) { none.push(s); return; }
      root.n++;
      var path = [r.sido, r.sigungu || '(시군구 없음)', r.emd || '(읍면동 없음)'];
      var node = root;
      path.forEach(function (k) {
        if (!node.kids[k]) { node.kids[k] = { n: 0, kids: {}, sites: [], ri: {} }; node.order = node.order || []; }
        node = node.kids[k]; node.n++;
      });
      if (r.ri) (node.ri[r.ri] = node.ri[r.ri] || []).push(s); else node.sites.push(s);
    });
    return { root: root, none: none };
  }
  /* v3.8 목록 행: 동그라미 = #번호, 제목, 리동 주소, 메모, 수정·삭제 (텐아르 목록처럼) */
  function siteRow(s) {
    var ord = todayOrderOf(s.id), n = noOf(s);
    var sub = addrTail(s) || s.addr || '';
    var extra = s.division === 'agri' && s.type === 'area' ? '' : [s.species, s.farmName, s.kind].filter(Boolean).join(' ');
    var lr = lastResult(s.id), rr = lr && resultOf(lr.result), mm = hasMemo(s);
    var nm = isAreaSite(s) ? '' : (s.division === 'agri' && s.type === 'prod' ? [s.crop, nameOf(s)].filter(Boolean).join(' ') : '');
    return '<div class="plist-item" data-id="' + s.id + '"><span class="num" style="background:' + siteColor(s) + '">' + (n || '·') + '</span>' +
      '<span class="t"><b>' + esc(nm || dispName(s)) + (mm ? ' <span class="chip memo" title="메모 있음">📝</span>' : '') + (ord ? ' <span class="chip today">오늘 ' + ord + '</span>' : '') + (visitedToday(s.id) ? ' <span class="chip done">방문</span>' : '') +
        (rr ? ' <span class="chip vr" style="--c:' + rr[2] + '">' + rr[1] + '</span>' : '') + '</b>' +
      '<span>' + esc(sub) + (extra ? ' · ' + esc(extra) : '') + ((s.changes || []).length ? ' · <em class="chg-t">' + esc(s.changes.join(',')) + '</em>' : '') + '</span>' +
      (s.memo ? '<span class="row-memo">📝 ' + esc(s.memo.slice(0, 60)) + '</span>' : '') + '</span>' +
      '<span class="row-acts"><button type="button" class="ra" data-edit="' + s.id + '">수정</button><button type="button" class="ra del" data-del="' + s.id + '">삭제</button></span></div>';
  }
  function treeHtml(list, openAll) {
    var t = buildTree(list), h = '';
    var sk = Object.keys(t.root.kids).sort();
    var single = openAll || list.length <= 12;   /* 적거나 업무를 고르면 다 펼침 */
    sk.forEach(function (sido) {
      var a = t.root.kids[sido];
      h += '<details class="tr l1"' + (single || sk.length === 1 ? ' open' : '') + '><summary>' + esc(sido) + ' <em>' + a.n + '</em></summary>';
      var gk = Object.keys(a.kids).sort();
      gk.forEach(function (sgg) {
        var b = a.kids[sgg];
        h += '<details class="tr l2"' + (single || gk.length === 1 ? ' open' : '') + '><summary>' + esc(sgg) + ' <em>' + b.n + '</em></summary>';
        Object.keys(b.kids).sort().forEach(function (emd) {
          var c = b.kids[emd];
          h += '<details class="tr l3"' + (single ? ' open' : '') + '><summary>' + esc(emd) + ' <em>' + c.n + '</em></summary>';
          /* 번호 순서대로 (리 구분 없이 읍면동 안 #순번이 가는 순서) */
          var all = c.sites.slice(); Object.keys(c.ri).forEach(function (ri) { all = all.concat(c.ri[ri]); });
          h += sortByNo(all).map(siteRow).join('') + '</details>';
        });
        h += '</details>';
      });
      h += '</details>';
    });
    if (t.none.length) {
      var pend = t.none.filter(function (s) { return s.region && s.region.status === 'pending'; }).length;
      h += '<details class="tr l1"' + (single ? ' open' : '') + '><summary>지역 미확인 <em>' + t.none.length + '</em>' + (pend ? ' <small>(' + pend + '곳 확인 중)</small>' : '') + '</summary>' + t.none.map(siteRow).join('') +
        '<div class="row"><button class="btn sm" id="reRegion">지역 다시 확인</button></div></details>';
    }
    return h;
  }
  function filterSites(o) {
    var f = o.f || {};
    return db.sites.filter(function (s) {
      if (o.div && s.division !== o.div) return false;
      if (o.type && s.type !== o.type) return false;
      if (o.crop && s.crop !== o.crop) return false;
      var r = s.region && s.region.status === 'ok' ? s.region : {};
      if (f.sido && r.sido !== f.sido) return false;
      if (f.sigungu && r.sigungu !== f.sigungu) return false;
      if (f.emd && r.emd !== f.emd) return false;
      if (f.floor && String(s.floor || '') !== f.floor) return false;
      if (f.josaguNo && String(s.josaguNo || '') !== f.josaguNo) return false;
      if (f.kind && s.kind !== f.kind) return false;
      if (o.memo && !hasMemo(s)) return false;
      return true;
    });
  }
  /* 드롭다운: 시도 › 시군구 › 읍면동 + 작물·층·조사구·구분 (값이 있는 것만) */
  /* 드롭다운: 시도 › 시군구 › 읍면동 (트리식 — 위에서 고른 곳 아래만) + 작물·층·조사구·구분 (값이 있는 것만, 위 조건 안에서) */
  function filterBar(o) {
    var f = o.f || {};
    var base = filterSites({ div: o.div, type: o.type, memo: o.memo });
    function uniq(fn, within) { var m = {}; within.forEach(function (s) { var v = fn(s); if (v) m[v] = (m[v] || 0) + 1; }); return Object.keys(m).sort(natCmp).map(function (k) { return [k, m[k]]; }); }
    function reg(s) { return s.region && s.region.status === 'ok' ? s.region : {}; }
    var sidos = uniq(function (s) { return reg(s).sido; }, base);
    var sido = f.sido || (sidos.length === 1 ? sidos[0][0] : '');
    var inSido = base.filter(function (s) { return !sido || reg(s).sido === sido; });
    var sggs = uniq(function (s) { return reg(s).sigungu; }, inSido);
    var sgg = f.sigungu || (sido && sggs.length === 1 ? sggs[0][0] : '');
    var inSgg = inSido.filter(function (s) { return !sgg || reg(s).sigungu === sgg; });
    var inEmd = inSgg.filter(function (s) { return !f.emd || reg(s).emd === f.emd; });
    var inCrop = inEmd.filter(function (s) { return !o.crop || s.crop === o.crop; });
    function sel(key, label, opts, always, dis, cur) {
      if (!always && !opts.length) return '';
      cur = cur != null ? cur : String(f[key] || (key === 'crop' ? o.crop || '' : ''));
      return '<label class="flt' + (dis ? ' dis' : '') + '"><select data-f="' + key + '" aria-label="' + label + '"' + (dis ? ' disabled' : '') + '><option value="">' + (dis ? label + ' (위에서 먼저 선택)' : label + ' 전체') + '</option>' +
        (dis ? '' : opts.map(function (x) { return '<option value="' + esc(x[0]) + '"' + (cur === x[0] ? ' selected' : '') + '>' + esc(x[0]) + ' (' + x[1] + ')</option>'; }).join('')) + '</select></label>';
    }
    var t = typeOf(o.div, o.type);
    return '<div class="flt-bar">' +
      sel('sido', '시도', sidos, true, false, sido) +
      sel('sigungu', '시군구', sggs, true, !sido, sgg) +
      sel('emd', '읍면동', uniq(function (s) { return reg(s).emd; }, inSgg), true, !sgg) +
      (t && t.crops ? sel('crop', '작물', uniq(function (s) { return s.crop; }, inEmd)) : '') +
      sel('floor', '층', uniq(function (s) { return s.floor ? String(s.floor) : ''; }, inCrop)) +
      sel('josaguNo', '조사구', uniq(function (s) { return s.josaguNo ? String(s.josaguNo) : ''; }, inCrop.filter(function (s) { return !f.floor || String(s.floor || '') === f.floor; }))) +
      sel('kind', '구분', uniq(function (s) { return s.kind; }, inCrop)) +
      '</div>';
  }
  function openList(o) {
    o = o || {};
    var d = divOf(o.div);
    if (!d) { openAllList(); return; }
    lastList = { div: o.div, type: o.type || null, crop: o.crop || null, f: o.f || {}, memo: !!o.memo };
    var list = filterSites(o);
    var memoN = filterSites({ div: o.div, type: o.type, crop: o.crop, memo: true }).length;
    var html = '<div class="seg"><button class="seg-b' + (!o.memo ? ' on' : '') + '" data-memo="0">전체</button><button class="seg-b' + (o.memo ? ' on' : '') + '" data-memo="1">📝 메모 ' + memoN + '</button>' +
      '<button class="btn primary sm add-b" id="lsAdd">＋ 추가</button></div>' +
      '<div class="tabs scroll"><button class="tab' + (!o.type ? ' on' : '') + '" data-t="">전체 ' + countBy(d.id) + '</button>' +
      d.types.map(function (t) { var n = countBy(d.id, t.id); return '<button class="tab' + (o.type === t.id ? ' on' : '') + (n ? '' : ' zero') + '" data-t="' + t.id + '">' + esc(t.name) + ' ' + n + '</button>'; }).join('') + '</div>';
    var t = typeOf(d.id, o.type);
    html += '<p class="muted tab-hint">고른 업무 탭을 한 번 더 누르면 그 업무 핀만 지도에 모아 보여 줍니다.</p>';
    html += filterBar(o);
    html += list.length ? treeHtml(list, !!o.type) : '<p class="muted">' + (o.memo ? '메모가 있는 조사구가 없습니다.' : '이 조건의 조사구가 없습니다. 「＋ 추가」로 주소를 넣거나, 지도를 길게 누르거나 검색해서 등록하세요.') + '</p>';
    html += '<div class="row"><button class="btn" id="lsMap" style="flex:1">이 목록 지도에서 보기 (' + list.length + ')</button><button class="btn" id="lsHome">현황</button></div>' +
      '<div class="row"><button class="btn" id="lsShare" style="flex:1">📤 이 업무 자료 공유</button><button class="btn" id="lsXls" style="flex:1">📥 엑셀로 올리기</button></div>' +
      '<div class="row"><button class="btn danger" id="lsDel" style="flex:1">🗑 이 업무 삭제</button><button class="btn danger" id="lsDelPick" style="flex:1">🗑 골라서 삭제</button></div>';
    var title = d.name + (t ? ' › ' + t.name : '') + (o.crop ? ' › ' + o.crop : '');
    var body = openSheet(title, html);
    body.querySelectorAll('[data-t]').forEach(function (b) {
      b.addEventListener('click', function () {
        var nt = b.getAttribute('data-t') || null;
        if (nt === (o.type || null)) { showOnMap(o); return; }   /* 이미 고른 업무를 한 번 더 누르면 지도에서 보기 */
        openList({ div: d.id, type: nt, memo: o.memo });
      });
    });
    body.querySelectorAll('select[data-f]').forEach(function (sl) {
      sl.addEventListener('change', function () {
        var k = sl.getAttribute('data-f'), nf = Object.assign({}, o.f || {}), crop = o.crop;
        if (k === 'crop') crop = sl.value || null; else nf[k] = sl.value || '';
        if (k === 'sido') { nf.sigungu = ''; nf.emd = ''; }
        if (k === 'sigungu') nf.emd = '';
        if (k === 'floor') nf.josaguNo = '';
        var no = { div: d.id, type: o.type, crop: crop, f: nf, memo: o.memo };
        openList(no);
        /* v3.9: 고른 곳의 핀으로 지도 이동 (텐아르처럼) */
        var hit = filterSites(no).filter(function (x) { return isFinite(x.lat); });
        if (hit.length) { if (hit.some(function (x) { return !markers[x.id]; })) { activeDiv = d.id; mapFilter = null; renderMarkers(); renderDivBtns(); } fitSites(hit); }
      });
    });
    body.querySelectorAll('[data-memo]').forEach(function (b) { b.addEventListener('click', function () { openList({ div: d.id, type: o.type, crop: o.crop, f: o.f, memo: b.getAttribute('data-memo') === '1' }); }); });
    body.querySelector('#lsAdd').addEventListener('click', function () { openSiteForm({ division: d.id, type: o.type, crop: o.crop, byAddr: true }, null); });
    bindRows(body);
    body.querySelector('#lsMap').addEventListener('click', function () { showOnMap(o); });
    body.querySelector('#lsHome').addEventListener('click', function () { openHome(d.id); });
    body.querySelector('#lsShare').addEventListener('click', function () { if (window.OdigoFiles) OdigoFiles.openExport({ div: d.id, type: o.type, crop: o.crop }); });
    body.querySelector('#lsDel').addEventListener('click', function () { if (window.OdigoFiles) OdigoFiles.openDelete({ div: d.id, type: o.type, crop: o.crop }); });
    body.querySelector('#lsDelPick').addEventListener('click', function () { if (window.OdigoFiles) OdigoFiles.openDelete({ div: d.id, type: o.type, crop: o.crop, pick: true }); });
    body.querySelector('#lsXls').addEventListener('click', function () { if (window.OdigoFiles) OdigoFiles.openExcel({ div: d.id, type: o.type, crop: o.crop }); });
    var rr = body.querySelector('#reRegion'); if (rr) rr.addEventListener('click', function () { refillRegions(true); toast('지역을 다시 확인합니다'); });
  }
  /* 「내 조사 장소」: 분야별 건수 + 전체 트리 */
  function openAllList() {
    var html = '<div class="tabs"><button class="tab" data-tab="today">오늘 방문 (' + todayPlanned().length + ')</button><button class="tab on">내 조사 장소 (' + db.sites.length + ')</button></div>' +
      '<div class="row home-divs">' + DIVISIONS.map(function (x) { return '<button class="btn sm" data-div="' + x.id + '" style="border-color:' + x.color + '">' + esc(x.name) + ' ' + countBy(x.id) + '</button>'; }).join('') +
      (unassigned().length ? '<button class="btn sm" data-un="1">미분류 ' + unassigned().length + '</button>' : '') + '</div>';
    html += db.sites.length ? treeHtml(db.sites) : '<p class="muted">저장한 조사구가 없습니다. 위 검색창에서 찾거나 지도를 길게 눌러 조사구를 등록하세요.</p>';
    var body = openSheet('내 조사 장소', html);
    body.querySelector('[data-tab="today"]').addEventListener('click', openToday);
    body.querySelectorAll('[data-div]').forEach(function (b) { b.addEventListener('click', function () { openList({ div: b.getAttribute('data-div') }); }); });
    var ub = body.querySelector('[data-un]'); if (ub) ub.addEventListener('click', openUnassigned);
    bindRows(body);
    var rr = body.querySelector('#reRegion'); if (rr) rr.addEventListener('click', function () { refillRegions(true); toast('지역을 다시 확인합니다'); });
  }
  function blinkPin(id) {
    var m = markers[id]; if (!m) return;
    var el = m.getElement(); el.classList.remove('blink'); void el.offsetWidth; el.classList.add('blink');
    el.style.zIndex = 5; setTimeout(function () { el.classList.remove('blink'); el.style.zIndex = ''; }, 2600);
  }
  function bindRows(body) {
    body.querySelectorAll('.plist-item[data-id]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        if (e.target.closest('.row-acts')) return;
        var s = findSite(b.getAttribute('data-id')); if (!s) return;
        /* v3.9: 목록에서는 카드를 열지 않고 위치만 이동(목록 유지) · 핀을 누르면 카드 */
        body.querySelectorAll('.plist-item.sel').forEach(function (x) { x.classList.remove('sel'); });
        b.classList.add('sel');
        if (!markers[s.id] && (activeDiv || mapFilter)) { activeDiv = null; mapFilter = null; renderMarkers(); renderDivBtns(); }
        flyToVisible(s, Math.max(map.getZoom(), 16)); blinkPin(s.id);
      });
    });
    body.querySelectorAll('[data-edit]').forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); var s = findSite(b.getAttribute('data-edit')); if (s) openEditChooser(s); }); });
    body.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation(); var s = findSite(b.getAttribute('data-del')); if (!s) return;
        if (!confirm('「' + dispName(s) + '」을(를) 삭제할까요? 방문 기록도 함께 지워집니다.')) return;
        var row = b.closest('.plist-item'); deleteSite(s.id); if (row) row.remove(); toast('삭제했습니다');
      });
    });
  }
  /* 수정: 지도에서 위치 수정 / 입력창에서 수정 / 취소 */
  function openEditChooser(s) {
    var body = openSheet('수정 · ' + dispName(s), '<div class="sf-btns"><button class="btn" id="edMap">📍 지도에서 위치 수정</button><button class="btn primary" id="edForm">✎ 입력창에서 수정</button><button class="btn cancel" id="edNo">취소</button></div>');
    body.querySelector('#edMap').addEventListener('click', function () { startMoveSite(s); });
    body.querySelector('#edForm').addEventListener('click', function () { openSiteForm({}, s); });
    body.querySelector('#edNo').addEventListener('click', function () { closeSheet(); });
  }
  /* 지도에서 위치 수정: 핀을 끌거나 지도를 눌러 옮기고 저장/취소 */
  var moving = null;
  function startMoveSite(s) {
    closeSheet();
    if (moving) moving.cancel();
    var el = document.createElement('div'); el.className = 'pin-wrap w-circle'; el.innerHTML = '<div class="pin s-circle moving" style="--pc:#1c7ed6"><i>✥</i></div>';
    var mk = new maplibregl.Marker({ element: el, draggable: true, anchor: 'center' }).setLngLat([s.lng, s.lat]).addTo(map);
    if (markers[s.id]) markers[s.id].getElement().style.opacity = '.35';
    map.flyTo({ center: [s.lng, s.lat], zoom: Math.max(map.getZoom(), 17) });
    var bar = $('moveBar'); bar.hidden = false;
    $('moveTitle').textContent = dispName(s) + ' — 핀을 끌거나 지도를 눌러 위치를 옮기세요';
    function onClick(e) { mk.setLngLat(e.lngLat); }
    map.on('click', onClick);
    function end() { map.off('click', onClick); mk.remove(); bar.hidden = true; moving = null; if (markers[s.id]) markers[s.id].getElement().style.opacity = ''; }
    moving = { cancel: end };
    $('moveSave').onclick = function () {
      var ll = mk.getLngLat(); end();
      s.lat = +ll.lat.toFixed(7); s.lng = +ll.lng.toFixed(7); s.region = { status: 'pending' }; touch(s); persist();
      fillRegion(s); toast('위치를 옮겼습니다'); openSite(s.id);
    };
    $('moveCancel').onclick = function () { end(); toast('위치 수정을 취소했습니다'); };
  }
  function openToday() {
    var tl = todayPlanned();
    var html = '<div class="tabs"><button class="tab on">오늘 방문 (' + tl.length + ')</button><button class="tab" data-tab="all">내 조사 장소 (' + db.sites.length + ')</button></div>';
    if (!tl.length) html += '<p class="muted">오늘 방문할 조사구가 없습니다. 조사구 카드에서 「＋ 오늘 방문에 추가」를 누르세요.</p>';
    else html += tl.map(function (v) { return siteRow(findSite(v.siteId)); }).join('');
    if (tl.length > 1) html += '<div class="row"><button class="btn full" id="fitToday">오늘 방문 조사구 한눈에 보기</button></div>';
    var body = openSheet('오늘 방문', html);
    body.querySelector('[data-tab="all"]').addEventListener('click', openAllList);
    bindRows(body);
    var fit = body.querySelector('#fitToday');
    if (fit) fit.addEventListener('click', function () { closeSheet(); fitSites(tl.map(function (v) { return findSite(v.siteId); })); });
  }
  $('btnPlaces').addEventListener('click', function () { openAllList(); });
  $('btnToday').addEventListener('click', function () { openToday(); });

  /* ───────── 미분류 → 분야·유형 지정 (여러 건) ───────── */
  function openUnassigned() {
    var list = unassigned();
    var html = '<p class="muted">업무 분야가 없는 조사구입니다. 골라서 분야·조사 유형을 지정하세요.</p>' +
      (list.length ? '<label class="chk-all"><input type="checkbox" id="unAll"> 모두 선택</label>' + list.map(function (s) {
        return '<label class="un-row"><input type="checkbox" value="' + s.id + '"><span><b>' + esc(s.name) + '</b><small>' + esc(s.addr || '') + '</small></span></label>';
      }).join('') + '<div class="row"><button class="btn primary full" id="unGo" disabled>선택한 0곳 분야·유형 지정</button></div>' : '<p>미분류 조사구가 없습니다.</p>');
    var body = openSheet('미분류 조사구 (' + list.length + ')', html);
    if (!list.length) return;
    var boxes = body.querySelectorAll('.un-row input'), go = body.querySelector('#unGo');
    function upd() { var n = body.querySelectorAll('.un-row input:checked').length; go.disabled = !n; go.textContent = '선택한 ' + n + '곳 분야·유형 지정'; }
    boxes.forEach(function (b) { b.addEventListener('change', upd); });
    body.querySelector('#unAll').addEventListener('change', function (e) { boxes.forEach(function (b) { b.checked = e.target.checked; }); upd(); });
    go.addEventListener('click', function () {
      var ids = Array.prototype.map.call(body.querySelectorAll('.un-row input:checked'), function (b) { return b.value; });
      openClassify(ids);
    });
  }
  function classifyFields(div, type, crop) {
    var d = divOf(div) || divOf(db.profile && db.profile.division) || DIVISIONS[0];
    return '<label class="fld">업무분야</label><select class="inp" id="fDiv">' + DIVISIONS.map(function (x) { return '<option value="' + x.id + '"' + (x.id === d.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select>' +
      '<label class="fld">조사 유형</label><select class="inp" id="fType">' + d.types.map(function (t) { return '<option value="' + t.id + '"' + (t.id === type ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') + '</select>' +
      '<div id="fCropWrap"><label class="fld">작물</label><select class="inp" id="fCrop">' + CROPS.map(function (c) { return '<option' + (c === crop ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></div>';
  }
  function bindClassify(body) {
    var fd = body.querySelector('#fDiv'), ft = body.querySelector('#fType'), cw = body.querySelector('#fCropWrap');
    function cropVis() {
      var t = typeOf(fd.value, ft.value); cw.hidden = !(t && t.crops);
      var lw = body.querySelector('#fLiveW'); if (lw) lw.hidden = !(fd.value === 'agri' && (ft.value === 'livestock' || ft.value === 'livecost'));
    }
    fd.addEventListener('change', function () {
      var d = divOf(fd.value);
      ft.innerHTML = d.types.map(function (t) { return '<option value="' + t.id + '">' + esc(t.name) + '</option>'; }).join('');
      cropVis();
    });
    ft.addEventListener('change', cropVis);
    cropVis();
    return function () {
      var t = typeOf(fd.value, ft.value);
      return { division: fd.value, type: ft.value, crop: t && t.crops ? body.querySelector('#fCrop').value : null };
    };
  }
  function openClassify(ids) {
    var body = openSheet('분야·유형 지정 (' + ids.length + '곳)', classifyFields(null, null, null) + '<div class="row"><button class="btn primary full" id="clSave">지정</button></div>');
    var get = bindClassify(body);
    body.querySelector('#clSave').addEventListener('click', function () {
      var v = get();
      ids.forEach(function (id) { var s = findSite(id); if (s) { s.division = v.division; s.type = v.type; s.crop = v.crop; touch(s); } });
      persist(); toast(ids.length + '곳을 지정했습니다');
      if (unassigned().length) openUnassigned(); else openList({ div: v.division, type: v.type, crop: v.crop });
    });
  }

  /* ───────── 조사구 등록·수정 ───────── */
  var lastPick = {};   /* 분야별 마지막 유형·작물 (이번 접속 동안만) */
  function contactRowHtml(c, i) {
    c = c || {};
    return '<div class="ct-row" data-ci="' + i + '">' + CONTACT_FIELDS.map(function (f) {
      return '<label><span>' + f[1] + '</span><input class="inp" data-c="' + f[0] + '"' + (f[2] === 'tel' ? ' inputmode="tel"' : '') + ' value="' + esc(c[f[0]] || '') + '"></label>';
    }).join('') + (c.addr ? '<input type="hidden" data-c="addr" value="' + esc(c.addr) + '">' : '') + '<button type="button" class="ra del ct-del">이 연락처 지움</button></div>';
  }
  function openSiteForm(o, existing) {
    var s = existing || {};
    var dv = s.division || o.division || activeDiv && activeDiv !== '_none' && activeDiv || (db.profile && db.profile.division);
    var lp = lastPick[dv] || {};
    var r0 = s.region && s.region.status === 'ok' ? s.region : {};
    var noLL = !existing && !isFinite(o.lat);   /* v3.9 ＋추가: 주소로 입력 (위치는 주소 확인으로 찾음) */
    var cts = (s.contacts && s.contacts.length ? s.contacts : [{}]);
    var html =
      (existing ? '<label class="fld">번호 (#순번 = 가는 순서 · 바꾸면 같은 읍면동의 다른 번호가 밀리거나 당겨짐)</label><input class="inp" id="fSeq" inputmode="numeric" value="' + (noOf(s) || '') + '">' : '') +
      classifyFields(dv, s.type || o.type || lp.type, s.crop || o.crop || lp.crop) +
      '<div class="f-grid">' +
        '<label><span>층 <b class="req" data-req>*</b></span><input class="inp" id="fFloor" inputmode="numeric" value="' + esc(s.floor || '') + '" placeholder="예: 7"></label>' +
        '<label><span>조사구 <b class="req" data-req>*</b></span><input class="inp" id="fNo" value="' + esc(s.josaguNo || '') + '" placeholder="예: 8"></label>' +
        '<label><span>카드</span><input class="inp" id="fCard" value="' + esc(s.card || '') + '" placeholder="예: 3"></label>' +
        '<label><span>구분</span><select class="inp" id="fKind"><option value="">선택 안 함</option>' + KINDS.map(function (k) { return '<option' + (s.kind === k ? ' selected' : '') + '>' + k + '</option>'; }).join('') + '</select></label>' +
      '</div>' +
      '<div class="f-grid" id="fLiveW">' +
        '<label><span>축종</span><input class="inp" id="fSpecies" value="' + esc(s.species || '') + '" placeholder="예: 한우, 돼지"></label>' +
        '<label><span>농장명</span><input class="inp" id="fFarm" value="' + esc(s.farmName || '') + '" placeholder="예: 행복농장"></label>' +
      '</div>' +
      '<div id="fNameW"><label class="fld">이름 (응답자·업체·정미소 등) <b class="req">*</b></label><input class="inp" id="fName" value="' + esc(s.name && s.name !== '이름 없는 조사구' ? s.name : (o.kind === '장소' ? o.name : '') || '') + '" placeholder="예: 홍길동, 달성정미소 (없으면 「없음」으로 표시)"></div>' +
      '<label class="fld">' + (noLL ? '주소 (지번까지) ' : '초입주소 ') + '<b class="req">*</b></label>' +
      '<div class="addr-row"><input class="inp" id="fAddr" value="' + esc(s.addr || o.addr || '') + '" placeholder="예: 대구 달성군 논공읍 북리 359"><button type="button" class="btn sm" id="fChk">주소 확인</button></div>' +
      '<div class="muted" id="fChkMsg">' + (noLL ? '주소를 넣고 「주소 확인」을 누르면 그 위치에 핀이 만들어집니다.' : '') + '</div>' +
      '<div class="f-grid three">' +
        '<label><span>시도</span><input class="inp" id="fSido" value="' + esc(r0.sido || '') + '"></label>' +
        '<label><span>시군구</span><input class="inp" id="fSgg" value="' + esc(r0.sigungu || '') + '"></label>' +
        '<label><span>읍면동</span><input class="inp" id="fEmd" value="' + esc(r0.emd || '') + '"></label>' +
      '</div>' +
      '<label class="fld">연락처 (이름·휴대폰·사무실·집·직급·관계)</label><div id="fCts">' + cts.map(contactRowHtml).join('') + '</div>' +
      '<div class="row"><button type="button" class="btn sm" id="fCtAdd">＋ 연락처 추가</button></div>' +
      '<label class="fld">메모</label><textarea id="fMemo" placeholder="현장 메모 (이 기기에 암호화 저장)">' + esc(s.memo || '') + '</textarea>' +
      '<div class="row"><button class="btn cancel" id="fCancel">취소</button><button class="btn primary" id="fSave" style="flex:1">' + (existing ? '저장' : '조사구로 저장') + '</button></div>';
    var body = openSheet(existing ? '조사구 수정 · ' + dispName(s) : '조사구 등록', html);
    var get = bindClassify(body);
    function isArea() { var v = get(); return v.division === 'agri' && v.type === 'area'; }
    function reqVis() {
      var a = isArea();
      body.querySelectorAll('[data-req]').forEach(function (x) { x.hidden = !a; });
      body.querySelector('#fNameW').hidden = a;   /* 작물재배는 이름 대신 층·조사구로 표시 */
    }
    body.querySelector('#fDiv').addEventListener('change', reqVis); body.querySelector('#fType').addEventListener('change', reqVis); reqVis();
    function bindCt() { body.querySelectorAll('.ct-del').forEach(function (b) { b.onclick = function () { var r = b.closest('.ct-row'); if (body.querySelectorAll('.ct-row').length > 1) r.remove(); else r.querySelectorAll('input').forEach(function (x) { x.value = ''; }); }; }); }
    bindCt();
    body.querySelector('#fCtAdd').addEventListener('click', function () { var w = document.createElement('div'); w.innerHTML = contactRowHtml({}, body.querySelectorAll('.ct-row').length); body.querySelector('#fCts').appendChild(w.firstChild); bindCt(); });
    /* 시도·시군구·읍면동이 비어 있으면 핀 위치로 채움 */
    var lat0 = s.lat || o.lat, lng0 = s.lng || o.lng;
    if (!r0.sido && isFinite(lat0)) regionB(lat0, lng0).then(function (r) { if (!r) return; if (!body.querySelector('#fSido').value) body.querySelector('#fSido').value = r.sido; if (!body.querySelector('#fSgg').value) body.querySelector('#fSgg').value = r.sigungu; if (!body.querySelector('#fEmd').value) body.querySelector('#fEmd').value = r.emd; });
    var found = null;
    function checkAddr() {
      var q = body.querySelector('#fAddr').value.trim(), msg = body.querySelector('#fChkMsg');
      if (!q) { msg.textContent = '주소를 넣어 주세요'; return Promise.resolve(null); }
      msg.textContent = '확인 중…';
      return ensureKakao().then(function (ok) {
        if (!ok) { msg.textContent = '주소 확인 서비스에 연결하지 못했습니다'; return null; }
        return new Promise(function (res) {
          new kakao.maps.services.Geocoder().addressSearch(q, function (r, st) {
            if (st !== kakao.maps.services.Status.OK || !r[0]) { found = null; msg.innerHTML = '<span class="warn-t">주소를 찾지 못했습니다. 지번까지 정확히 넣어 주세요.</span>'; res(null); return; }
            var a = r[0].address || r[0].road_address || {};
            found = { lat: +r[0].y, lng: +r[0].x, addr: r[0].address_name };
            body.querySelector('#fSido').value = a.region_1depth_name || ''; body.querySelector('#fSgg').value = a.region_2depth_name || ''; body.querySelector('#fEmd').value = a.region_3depth_name || '';
            msg.innerHTML = '✓ 확인됨: ' + esc(r[0].address_name) + (existing ? ' <small>(저장할 때 핀을 이 주소로 옮길지 묻습니다)</small>' : '');
            if (noLL) map.easeTo({ center: [found.lng, found.lat], zoom: Math.max(map.getZoom(), 16), offset: [0, -Math.round($('sheet').getBoundingClientRect().height / 2)] });
            res(found);
          });
        });
      });
    }
    body.querySelector('#fChk').addEventListener('click', checkAddr);
    body.querySelector('#fAddr').addEventListener('input', function () { found = null; });
    body.querySelector('#fCancel').addEventListener('click', function () { if (existing) openSite(s.id); else if (navStack.length) sheetBack(); else closeSheet(); });
    body.querySelector('#fSave').addEventListener('click', function () {
      var v = get(), name = body.querySelector('#fName').value.trim(), memo = body.querySelector('#fMemo').value, addr = body.querySelector('#fAddr').value.trim();
      var more = { species: body.querySelector('#fSpecies').value.trim(), farmName: body.querySelector('#fFarm').value.trim(), josaguNo: body.querySelector('#fNo').value.trim(), floor: body.querySelector('#fFloor').value.trim(), card: body.querySelector('#fCard').value.trim(), kind: body.querySelector('#fKind').value, addr: addr };
      more.contacts = Array.prototype.map.call(body.querySelectorAll('.ct-row'), function (r) { var c = {}; r.querySelectorAll('[data-c]').forEach(function (x) { var val = x.value.trim(); if (val) c[x.getAttribute('data-c')] = val; }); return c; })
        .filter(function (c) { return Object.keys(c).some(function (k) { return k !== 'addr'; }); });
      var area = isArea();
      if (area && (!more.floor || !more.josaguNo || !addr)) { toast('작물재배는 층·조사구·초입주소가 꼭 필요합니다'); return; }
      if (!area && !addr) { toast('주소를 넣어 주세요'); return; }
      if (!area && !name && !confirm('이름이 비어 있습니다. 핀에 「없음」으로 표시하고 저장할까요?')) return;
      function go() {
        var sido = body.querySelector('#fSido').value.trim(), sgg = body.querySelector('#fSgg').value.trim(), emd = body.querySelector('#fEmd').value.trim();
        var reg = sido && sgg && emd ? { basis: 'manual', sido: sido, sigungu: sgg, emd: emd, ri: (s.region && s.region.ri) || '', status: 'ok', at: nowIso() } : null;
        lastPick[v.division] = { type: v.type, crop: v.crop };
        if (existing) {
          var oldKey = groupKey(s);
          s.division = v.division; s.type = v.type; s.crop = v.crop; s.name = area ? (s.name || '작물재배') : name; s.memo = memo; Object.assign(s, more);
          if (reg) s.region = reg;
          if (found && (Math.abs(found.lat - s.lat) > 1e-5 || Math.abs(found.lng - s.lng) > 1e-5) && confirm('핀 위치도 확인한 주소(' + found.addr + ')로 옮길까요?')) { s.lat = found.lat; s.lng = found.lng; }
          if (groupKey(s) !== oldKey) s.no = nextNo(s);
          var sq = body.querySelector('#fSeq'); if (sq && sq.value && +sq.value !== noOf(s)) renumber(s, +sq.value);
          touch(s); persist(); toast('저장했습니다'); openSite(s.id);
        } else {
          var ll = noLL ? found : { lat: o.lat, lng: o.lng };
          var base = Object.assign({ name: area ? '작물재배' : name, lat: ll.lat, lng: ll.lng, memo: memo, division: v.division, type: v.type, crop: v.crop, region: reg || { status: 'pending' } }, more);
          var ns = addSite(base);
          if (ns.region && ns.region.status === 'ok') { ns.no = nextNo(ns); persist(); }
          clearTemp(); toast('저장했습니다'); openSite(ns.id); flyToVisible(ns, Math.max(map.getZoom(), 16));
        }
      }
      if (noLL && !found) { checkAddr().then(function (f) { if (f) go(); else toast('주소로 위치를 찾지 못해 저장하지 않았습니다'); }); return; }
      go();
    });
  }

  /* ───────── 지역 (법정동 B) ───────── */
  function regionText(s) {
    var r = s.region;
    if (!r || r.status === 'unknown') return '<span class="muted">지역 미확인</span>';
    if (r.status === 'pending') return '<span class="muted">확인 중…</span>';
    return esc([r.sido, r.sigungu, r.emd, r.ri].filter(Boolean).join(' '));
  }
  function regionB(lat, lng) {
    return ensureKakao().then(function (ok) {
      if (!ok) return null;
      return new Promise(function (res) {
        try {
          new kakao.maps.services.Geocoder().coord2RegionCode(lng, lat, function (r, st) {
            if (st !== kakao.maps.services.Status.OK) { res(null); return; }
            var b = r.filter(function (x) { return x.region_type === 'B'; })[0];
            res(b ? { basis: 'B', sido: b.region_1depth_name, sigungu: b.region_2depth_name, emd: b.region_3depth_name, ri: b.region_4depth_name || '', code: b.code, status: 'ok', at: nowIso() } : null);
          });
        } catch (e) { res(null); }
      });
    });
  }
  function fillRegion(s, manual) {
    return regionB(s.lat, s.lng).then(function (r) {
      s.region = r || { status: 'unknown', at: nowIso() };
      if (r && !s.no) s.no = nextNo(s);
      touch(s); persist();
      if (curView === s.id && !$('sheet').hidden) openSite(s.id);
      if (manual) toast(r ? '지역을 확인했습니다' : '지역을 확인하지 못했습니다 (인터넷·배포 주소에서 다시 시도)');
    });
  }
  var refilling = false;
  /* 지역이 없거나 미확인인 조사구를 차례로 확인 (v2.3에서 옮겨 온 장소 포함) */
  function refillRegions(includeUnknown) {
    if (refilling) return;
    var todo = db.sites.filter(function (s) { return !s.region || s.region.status === 'pending' || (includeUnknown && s.region.status === 'unknown'); });
    if (!todo.length) return;
    refilling = true;
    ensureKakao().then(function (ok) {
      if (!ok) { refilling = false; return; }
      var i = 0;
      (function next() {
        if (i >= todo.length) { refilling = false; return; }
        var s = todo[i++];
        regionB(s.lat, s.lng).then(function (r) { s.region = r || { status: 'unknown', at: nowIso() }; touch(s); persist(); setTimeout(next, 120); });
      })();
    });
  }

  /* ───────── 조사구 카드 ───────── */
  var selectedId = null;   /* 마지막으로 연 조사구 — 카카오·네이버 대체 지도에서 강조 */
  /* v3.9 작물재배 변동 사항 · 연락처 · 답례품 */
  var CHANGES = ['합필', '분필', '밭으로', '논으로', '건물건축', '편입증감', '유휴지', '기타'];
  var GIFT_ITEMS = ['답례품', '수첩', '달력'];
  var GIFT_METHODS = ['직접', '우편', '우편함', '기타'];
  var CONTACT_FIELDS = [['name', '이름', 'text'], ['mobile', '휴대폰', 'tel'], ['office', '사무실', 'tel'], ['home', '집', 'tel'], ['rank', '직급', 'text'], ['relation', '관계', 'text']];
  function monthStr(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function isAreaSite(s) { return s.division === 'agri' && s.type === 'area'; }
  function telA(v) { var d = String(v || '').replace(/[^\d+]/g, ''); return d ? '<a href="tel:' + esc(d) + '">' + esc(v) + '</a>' : esc(v || ''); }
  function copyBtn(text) { return text ? '<button type="button" class="cp-btn" data-copy="' + esc(text) + '" title="주소 복사">복사</button>' : ''; }
  function copyText(t) {
    function fallback() { var ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) {} ta.remove(); return ok; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { toast('주소를 복사했습니다'); }, function () { toast(fallback() ? '주소를 복사했습니다' : '복사하지 못했습니다'); });
    else toast(fallback() ? '주소를 복사했습니다' : '복사하지 못했습니다');
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-copy]'); if (!b) return;
    e.preventDefault(); e.stopPropagation(); copyText(b.getAttribute('data-copy'));
  }, true);
  /* 생산량 ↔ 작물재배: 층·조사구가 같으면(시군구가 둘 다 있으면 같은 시군구) 작물재배 카드에 생산량 작물명 */
  function normNo(v) { v = String(v == null ? '' : v).trim(); return /^\d+$/.test(v) ? String(parseInt(v, 10)) : v; }
  function sameJosagu(a, b) {
    if (!a.floor || !a.josaguNo || !b.floor || !b.josaguNo) return false;
    if (normNo(a.floor) !== normNo(b.floor) || normNo(a.josaguNo) !== normNo(b.josaguNo)) return false;
    var ra = a.region && a.region.status === 'ok' ? a.region : null, rb = b.region && b.region.status === 'ok' ? b.region : null;
    return !(ra && rb && ra.sigungu && rb.sigungu && ra.sigungu !== rb.sigungu);
  }
  function prodOfArea(s) { return db.sites.filter(function (x) { return x.division === 'agri' && x.type === 'prod' && sameJosagu(x, s); }); }
  function hasMemo(s) { return !!(String(s.memo || '').trim() || db.visits.some(function (v) { return v.siteId === s.id && (v.events || []).some(function (e) { return String(e.note || '').trim(); }); })); }

  function visitHtml(s) {
    var vs = visitsOf(s.id).filter(function (v) { return v.result || (v.events && v.events.length); }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    if (!vs.length) return '<div class="muted">아직 방문 기록이 없습니다.</div>';
    return vs.map(function (v) {
      var r = resultOf(v.result || (v.events && v.events.length ? 'done' : ''));
      var notes = (v.events || []).slice().sort(function (a, b) { return a.at < b.at ? -1 : 1; });
      return '<div class="visit"><time>' + esc(v.date.replace(/-/g, '.')) + (r ? ' <span class="vr" style="--c:' + r[2] + '">' + r[1] + '</span>' : '') + '</time>' +
        notes.map(function (e) { var er = resultOf(e.status); return '<div class="vn">' + (!e.noTime && e.at ? '<small>' + esc(fmtTime(e.at).split(' ')[1]) + '</small> ' : '') + (er && notes.length > 1 ? '<em>' + er[1] + '</em> ' : '') + esc(e.note || '(메모 없음)') + '</div>'; }).join('') + '</div>';
    }).join('');
  }
  function contactsHtml(s) {
    var cs = (s.contacts || []).filter(function (c) { return CONTACT_FIELDS.some(function (f) { return String(c[f[0]] || '').trim(); }); });
    if (!cs.length) return '';
    return '<label class="fld">연락처</label>' + cs.map(function (c) {
      return '<div class="ct-card"><b>' + esc(c.name || '(이름 없음)') + '</b>' + (c.rank ? ' <small>' + esc(c.rank) + '</small>' : '') + (c.relation ? ' <span class="chip">' + esc(c.relation) + '</span>' : '') +
        '<div class="ct-tels">' + [c.mobile ? '📱 ' + telA(c.mobile) : '', c.office ? '🏢 ' + telA(c.office) : '', c.home ? '🏠 ' + telA(c.home) : ''].filter(Boolean).join(' · ') + '</div>' +
        (c.addr ? '<div class="muted">' + esc(c.addr) + ' ' + copyBtn(c.addr) + '</div>' : '') + '</div>';
    }).join('');
  }
  function changesHtml(s) {
    if (!isAreaSite(s)) return '';
    var ch = s.changes || [];
    return '<label class="fld">변동 사항 <small>(누르면 바로 저장 · 여러 개)</small></label><div class="chg-box">' + CHANGES.map(function (c) {
      return '<label class="chg"><input type="checkbox" data-chg="' + c + '"' + (ch.indexOf(c) >= 0 ? ' checked' : '') + '><span>' + c + '</span></label>';
    }).join('') + '</div>' + (s.changesAt ? '<div class="muted">마지막 변경 ' + esc(fmtTime(s.changesAt)) + '</div>' : '') +
      '<label class="fld">필지(지번) <small>— 지도에서 찍으면 지번이 지도에 표시됩니다</small></label>' +
      ((s.jibuns || []).length ? s.jibuns.map(function (j, k) {
        return '<div class="jb-row"><b>' + esc(j.jibun) + '</b> <small class="muted">' + esc(j.addr || '') + '</small><div class="chg-box sm">' + CHANGES.map(function (c) {
          return '<label class="chg"><input type="checkbox" data-jchg="' + k + '" value="' + c + '"' + ((j.changes || []).indexOf(c) >= 0 ? ' checked' : '') + '><span>' + c + '</span></label>';
        }).join('') + '<button type="button" class="ra del" data-jdel="' + k + '">지움</button></div></div>';
      }).join('') : '<div class="muted">찍은 필지가 없습니다.</div>') +
      '<div class="row"><button class="btn" data-act="jibun" style="flex:1">📍 지도에서 필지 찍기 (지번 표시)</button></div>';
  }
  function giftsHtml(s, mon) {
    var g = (s.gifts || {})[mon] || {};
    return '<label class="fld">🎁 답례품·수첩·달력 <input type="month" class="gm" id="giftMon" value="' + mon + '"> <small>(바꾸면 바로 저장)</small></label>' +
      GIFT_ITEMS.map(function (it) {
        var x = g[it] || {};
        return '<div class="gift-row" data-gift="' + it + '"><label class="gchk"><input type="checkbox" data-g="given"' + (x.given ? ' checked' : '') + '> <b>' + it + '</b></label>' +
          '<input type="date" class="inp sm" data-g="date" value="' + esc(x.date || '') + '">' +
          '<select class="inp sm" data-g="method"><option value="">방법</option>' + GIFT_METHODS.map(function (m) { return '<option' + (x.method === m ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select>' +
          '<input class="inp sm" data-g="receiver" placeholder="수령자" value="' + esc(x.receiver || '') + '"></div>';
      }).join('');
  }
  var giftMonth = null;
  function openSite(id, opt) {
    var s = findSite(id); if (!s) return;
    selectedId = id;
    var ord = todayOrderOf(s.id);
    var mon = giftMonth || monthStr();
    var prods = isAreaSite(s) ? prodOfArea(s) : [];
    var addrTxt = s.addr || (s.lat.toFixed(5) + ', ' + s.lng.toFixed(5));
    var html =
      '<div class="site-cls" style="--c:' + siteColor(s) + '">' + esc(siteLabel(s)) + (s.division ? '' : ' <button class="btn sm" data-act="cls">분야 지정</button>') + '</div>' +
      (!isAreaSite(s) ? '<div class="site-name">' + esc(nameOf(s)) + '</div>' : '') +
      '<div class="addr">' + esc(addrTxt) + ' ' + copyBtn(s.addr) + '</div>' + mapAppBtns(dispName(s), s.lat, s.lng) +
      '<div class="reg-line">' + regionText(s) + (s.region && s.region.status === 'ok' ? ' <small class="muted">(법정동)</small>' : '') + '</div>' +
      (floorJosagu(s) || s.card || s.kind || s.species || s.farmName ? '<div class="site-extra">' + [floorJosagu(s) ? '<b>' + esc(floorJosagu(s)) + '</b>' : '', s.card ? '카드 <b>' + esc(s.card) + '</b>' : '', s.species ? '축종 <b>' + esc(s.species) + '</b>' : '', s.farmName ? '농장 <b>' + esc(s.farmName) + '</b>' : '', s.kind ? '구분 <b>' + esc(s.kind) + '</b>' : ''].filter(Boolean).join(' · ') + '</div>' : '') +
      (prods.length ? '<div class="prod-link">🌾 생산량: ' + prods.map(function (p) { return '<button type="button" class="chip prod" data-prod="' + p.id + '">' + esc(p.crop || '생산량') + (nameOf(p) !== '없음' ? ' · ' + esc(nameOf(p)) : '') + '</button>'; }).join(' ') + '</div>' : '') +
      '<div>' + (ord ? '<span class="chip today">오늘 방문 ' + ord + '번</span>' : '') + (visitedToday(s.id) ? '<span class="chip done">오늘 방문함</span>' : '') + '</div>' +
      contactsHtml(s) +
      '<div class="row">' +
        '<button class="btn primary" data-act="nav">🚗 길찾기</button>' +
        '<button class="btn" data-act="today">' + (ord ? '오늘 방문 빼기' : '＋ 오늘 방문에 추가') + '</button>' +
        '<button class="btn" data-act="visit">✔ 방문 기록(메모)</button>' +
      '</div>' +
      '<div class="row"><button class="btn" style="flex:1" data-act="park">🅿 주변 주차장</button><button class="btn" style="flex:1" data-act="crime">🛡 이 지역 범죄 통계</button></div>' +
      '<div class="row"><button class="btn sf-go full" data-act="safe">🚨 이 핀 위치 보내기 (나 조사하러 간다)</button></div>' +
      (s.memo ? '<label class="fld">메모</label><div class="memo">' + esc(s.memo) + '</div>' : '') +
      changesHtml(s) +
      '<label class="fld">방문 기록(메모)</label>' + visitHtml(s) +
      '<div class="gift-box">' + giftsHtml(s, mon) + '</div>' +
      '<div class="row" style="margin-top:16px"><button class="btn" data-act="edit">✎ 수정</button><button class="btn" data-act="move">📍 위치 수정</button><button class="btn" data-act="center">지도에서 보기</button><button class="btn danger" data-act="del">삭제</button></div>';
    var keepTop = opt && opt.refresh && curView === s.id ? $('sheetBody').scrollTop : 0;
    var body = openSheet(dispName(s), html, { view: s.id });
    curView = s.id;
    if (keepTop) $('sheetBody').scrollTop = keepTop;
    function on(act, fn) { var b = body.querySelector('[data-act="' + act + '"]'); if (b) b.addEventListener('click', fn); }
    on('nav', function () { openNav(nameOf(s) === '없음' ? dispName(s) : s.name, s.lat, s.lng); });
    on('today', function () { setToday(s.id, !ord); openSite(s.id, { refresh: true }); });
    on('visit', function () { openVisitForm(s); });
    on('cls', function () { openClassify([s.id]); });
    on('safe', function () { openSafety({ name: dispName(s), addr: s.addr, lat: s.lat, lng: s.lng }); });
    on('edit', function () { openSiteForm({}, s); });
    on('move', function () { startMoveSite(s); });
    on('crime', function () { try { window.OdigoNearby.crimeSheet(s.lat, s.lng, dispName(s), s.addr); } catch (e) { toast('범죄 통계를 불러오지 못했습니다'); } });
    on('park', function () { try { window.OdigoNearby.parkingNear(s.lat, s.lng, dispName(s), 'place'); } catch (e) { toast('주차장 정보를 불러오지 못했습니다'); } });
    on('center', function () { flyToVisible(s, Math.max(map.getZoom(), 16)); });
    on('jibun', function () { startPickJibun(s); });
    on('del', function () {
      if (!confirm('「' + dispName(s) + '」을(를) 삭제할까요? 방문 기록도 함께 지워집니다.')) return;
      deleteSite(s.id); closeSheet(); toast('삭제했습니다');
    });
    body.querySelectorAll('[data-prod]').forEach(function (b) { b.addEventListener('click', function () { var p = findSite(b.getAttribute('data-prod')); if (p) { openSite(p.id); flyToVisible(p); } }); });
    /* 변동 사항: 누르면 바로 저장 */
    body.querySelectorAll('[data-chg]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        s.changes = Array.prototype.filter.call(body.querySelectorAll('[data-chg]'), function (x) { return x.checked; }).map(function (x) { return x.getAttribute('data-chg'); });
        s.changesAt = nowIso(); touch(s); persist(); toast('변동 사항을 저장했습니다');
      });
    });
    body.querySelectorAll('[data-jchg]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var k = +cb.getAttribute('data-jchg'), j = s.jibuns[k]; if (!j) return;
        j.changes = Array.prototype.filter.call(body.querySelectorAll('[data-jchg="' + k + '"]'), function (x) { return x.checked; }).map(function (x) { return x.value; });
        j.at = nowIso(); touch(s); persist(); toast(j.jibun + ' 변동 사항을 저장했습니다');
      });
    });
    body.querySelectorAll('[data-jdel]').forEach(function (b) {
      b.addEventListener('click', function () { var k = +b.getAttribute('data-jdel'); if (!confirm((s.jibuns[k] || {}).jibun + ' 필지를 지울까요?')) return; s.jibuns.splice(k, 1); touch(s); persist(); openSite(s.id, { refresh: true }); });
    });
    bindGifts(body, s);
  }
  function bindGifts(body, s) {
    var gm = body.querySelector('#giftMon');
    if (gm) gm.addEventListener('change', function () { if (!gm.value) return; giftMonth = gm.value; body.querySelector('.gift-box').innerHTML = giftsHtml(s, gm.value); bindGifts(body, s); });
    body.querySelectorAll('.gift-row').forEach(function (row) {
      var it = row.getAttribute('data-gift');
      function save() {
        var mon = (body.querySelector('#giftMon') || {}).value || monthStr();
        s.gifts = s.gifts || {}; var g = s.gifts[mon] = s.gifts[mon] || {};
        var x = { given: row.querySelector('[data-g=given]').checked, date: row.querySelector('[data-g=date]').value, method: row.querySelector('[data-g=method]').value, receiver: row.querySelector('[data-g=receiver]').value.trim(), at: nowIso() };
        if (x.given && !x.date) { x.date = todayStr(); row.querySelector('[data-g=date]').value = x.date; }
        if (!x.given && !x.date && !x.method && !x.receiver) delete g[it]; else g[it] = x;
        if (!Object.keys(g).length) delete s.gifts[mon];
        touch(s); persist(); toast(it + ' 기록을 저장했습니다');
      }
      row.querySelectorAll('[data-g]').forEach(function (x) { x.addEventListener('change', save); });
    });
  }
  /* 작물재배: 지도에서 필지를 눌러 지번을 찍음 */
  function startPickJibun(s) {
    setSheetMin(true);
    var bar = $('moveBar'); bar.hidden = false;
    $('moveTitle').textContent = dispName(s) + ' — 지도에서 필지를 누르세요 (여러 번 가능)';
    $('moveSave').textContent = '끝내기'; $('moveCancel').hidden = true;
    var busy = false;
    function onClick(e) {
      if (busy) return; busy = true;
      var la = +e.lngLat.lat.toFixed(7), lo = +e.lngLat.lng.toFixed(7);
      jibunAt(la, lo).then(function (r) {
        busy = false;
        if (!r) { toast('이 위치의 지번을 찾지 못했습니다'); return; }
        s.jibuns = s.jibuns || [];
        if (s.jibuns.some(function (j) { return j.jibun === r.jibun && j.addr === r.addr; })) { toast(r.jibun + '은(는) 이미 찍었습니다'); return; }
        s.jibuns.push({ jibun: r.jibun, addr: r.addr, lat: la, lng: lo, changes: [], at: nowIso() });
        touch(s); persist(); toast(r.jibun + ' 필지를 표시했습니다');
      });
    }
    map.on('click', onClick);
    function end() { map.off('click', onClick); bar.hidden = true; $('moveSave').textContent = '이 위치로 저장'; $('moveCancel').hidden = false; moving = null; }
    if (moving) moving.cancel();
    moving = { cancel: end };
    $('moveSave').onclick = function () { end(); openSite(s.id, { refresh: true }); };
  }
  function jibunAt(lat, lng) {
    return ensureKakao().then(function (ok) {
      if (!ok) return null;
      return new Promise(function (res) {
        try {
          new kakao.maps.services.Geocoder().coord2Address(lng, lat, function (r, st) {
            if (st !== kakao.maps.services.Status.OK || !r.length || !r[0].address) { res(null); return; }
            var a = r[0].address, j = (a.mountain_yn === 'Y' ? '산' : '') + a.main_address_no + (a.sub_address_no && a.sub_address_no !== '0' ? '-' + a.sub_address_no : '');
            res({ jibun: j, addr: a.address_name });
          });
        } catch (e) { res(null); }
      });
    });
  }
  function openVisitForm(s) {
    var body = openSheet('방문 기록(메모) · ' + dispName(s),
      '<label class="fld">방문 날짜</label><input type="date" class="inp" id="visitDate" value="' + todayStr() + '" max="' + todayStr() + '">' +
      '<label class="fld">결과</label><div class="vr-pick">' + VISIT_RESULTS.map(function (r, i) {
        return '<label class="vr-opt" style="--c:' + r[2] + '"><input type="radio" name="vres" value="' + r[0] + '"' + (i === 0 ? ' checked' : '') + '><span>' + r[1] + '</span></label>';
      }).join('') + '</div>' +
      '<label class="fld">메모 (선택)</label><textarea id="visitNote" placeholder="예: 현장 확인 완료, 다음 주 재방문"></textarea>' +
      '<div class="row"><button class="btn primary full" id="visitSave">방문 기록 저장</button></div>');
    body.querySelector('#visitSave').addEventListener('click', function () {
      var d = body.querySelector('#visitDate').value || todayStr(), r = (body.querySelector('input[name=vres]:checked') || {}).value || 'done';
      addVisitEvent(s.id, body.querySelector('#visitNote').value.trim(), d, r);
      toast('방문 기록을 저장했습니다'); openSite(s.id);
    });
  }

  /* ───────── v3.9 답례품·수첩·달력 월별 조회 ───────── */
  function openGifts(o) {
    o = o || {};
    var mon = o.mon || giftMonth || monthStr(), item = o.item || '', dsel = o.div != null ? o.div : '_mine', only = o.only || '';
    var md = myDivs();
    var list = db.sites.filter(function (s) {
      if (dsel === '_mine') return !md.length || md.indexOf(s.division) >= 0;
      if (dsel) return s.division === dsel;
      return true;
    });
    var items = item ? [item] : GIFT_ITEMS;
    function rec(s, it) { return ((s.gifts || {})[mon] || {})[it] || null; }
    if (only === 'given') list = list.filter(function (s) { return items.some(function (it) { var r = rec(s, it); return r && r.given; }); });
    if (only === 'not') list = list.filter(function (s) { return items.some(function (it) { var r = rec(s, it); return !(r && r.given); }); });
    var cnt = {}; GIFT_ITEMS.forEach(function (it) { cnt[it] = list.filter(function (s) { var r = rec(s, it); return r && r.given; }).length; });
    var groups = {}, gk = [];
    sortByNo(list).forEach(function (s) { var k = siteLabel(s); if (!groups[k]) { groups[k] = []; gk.push(k); } groups[k].push(s); });
    gk.sort(natCmp);
    var html = '<div class="gift-flt"><input type="month" class="inp" id="gfMon" value="' + mon + '">' +
      '<select class="inp" id="gfItem"><option value="">답례품·수첩·달력 모두</option>' + GIFT_ITEMS.map(function (it) { return '<option' + (it === item ? ' selected' : '') + '>' + it + '</option>'; }).join('') + '</select>' +
      '<select class="inp" id="gfDiv"><option value="_mine"' + (dsel === '_mine' ? ' selected' : '') + '>내 주요업무분야</option><option value=""' + (dsel === '' ? ' selected' : '') + '>모든 분야</option>' + DIVISIONS.map(function (d) { return '<option value="' + d.id + '"' + (dsel === d.id ? ' selected' : '') + '>' + esc(d.name) + '</option>'; }).join('') + '</select>' +
      '<select class="inp" id="gfOnly"><option value="">전체 조사구</option><option value="given"' + (only === 'given' ? ' selected' : '') + '>지급한 곳만</option><option value="not"' + (only === 'not' ? ' selected' : '') + '>아직 안 준 곳만</option></select></div>' +
      '<div class="gift-sum">' + mon.replace('-', '년 ') + '월 · 조사구 ' + list.length + '곳 · ' + GIFT_ITEMS.map(function (it) { return it + ' <b>' + cnt[it] + '</b>'; }).join(' · ') + '</div>';
    if (!list.length) html += '<p class="muted">조건에 맞는 조사구가 없습니다.</p>';
    gk.forEach(function (k) {
      html += '<details class="tr l1" open><summary>' + esc(k) + ' <em>' + groups[k].length + '</em></summary><table class="gift-tb"><tr><th>조사구</th>' + items.map(function (it) { return '<th>' + it + '</th>'; }).join('') + '</tr>' +
        groups[k].map(function (s) {
          return '<tr data-gs="' + s.id + '"><td><b>' + esc(isAreaSite(s) ? floorJosagu(s) + (noOf(s) ? ' #' + noOf(s) : '') : nameOf(s)) + '</b><small>' + esc(emdOf(s)) + '</small></td>' + items.map(function (it) {
            var r = rec(s, it);
            return r && r.given ? '<td class="ok">✓ ' + esc((r.date || '').slice(5).replace('-', '.')) + '<small>' + esc([r.method, r.receiver].filter(Boolean).join(' · ')) + '</small></td>' : '<td class="no">–</td>';
          }).join('') + '</tr>';
        }).join('') + '</table></details>';
    });
    html += '<p class="muted">조사구를 누르면 그 위치로 이동합니다. 지급 기록은 조사구 카드 아래 「🎁 답례품·수첩·달력」에서 넣습니다.</p>';
    var body = openSheet('🎁 답례품·수첩·달력', html);
    function re() { openGifts({ mon: body.querySelector('#gfMon').value || mon, item: body.querySelector('#gfItem').value, div: body.querySelector('#gfDiv').value, only: body.querySelector('#gfOnly').value }); }
    ['#gfMon', '#gfItem', '#gfDiv', '#gfOnly'].forEach(function (q) { body.querySelector(q).addEventListener('change', re); });
    body.querySelectorAll('[data-gs]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        var s = findSite(tr.getAttribute('data-gs')); if (!s) return;
        giftMonth = body.querySelector('#gfMon').value || mon;
        if (!markers[s.id]) { activeDiv = null; mapFilter = null; renderMarkers(); renderDivBtns(); }
        flyToVisible(s, Math.max(map.getZoom(), 16)); blinkPin(s.id);
        body.querySelectorAll('tr.sel').forEach(function (x) { x.classList.remove('sel'); }); tr.classList.add('sel');
      });
      tr.addEventListener('dblclick', function () { var s = findSite(tr.getAttribute('data-gs')); if (s) openSite(s.id); });
    });
  }
  $('btnGift').addEventListener('click', function () { if (!db.profile) { openProfile(true); return; } openGifts(); });

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

  /* ───────── 카카오 SDK (장소·주소 검색, 좌표→주소·지역) ───────── */
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
    }).then(function (ok) { if (!ok) kakaoP = null; return ok; });
    return kakaoP;
  }
  function kakaoSearch(q) {
    return ensureKakao().then(function (ok) {
      if (!ok) return null;
      var c = map.getCenter();
      var pl = new Promise(function (res) {
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
      return Promise.all([addrs, pl]).then(function (a) { return a[0].concat(a[1]); });
    });
  }
  /* 좌표 → 행정동(H) 1·2단계 (범죄 통계 시군구 연결용 — 조사구 분류는 법정동 B를 씀) */
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

  /* ───────── 검색 (내 조사구 먼저) ───────── */
  var tempMarker = null, tempPopup = null, tempTarget = null;
  function clearTemp() {
    tempTarget = null;
    if (tempPopup) { var p = tempPopup; tempPopup = null; p.remove(); }
    if (tempMarker) { tempMarker.remove(); tempMarker = null; }
  }
  function hideResults() { $('searchResults').hidden = true; document.body.classList.remove('sr-open'); }
  function localSearch(q) {
    var k = q.toLowerCase();
    return db.sites.filter(function (s) {
      return (s.name + ' ' + s.addr + ' ' + (s.memo || '') + ' ' + siteLabel(s) + ' ' + (s.josaguNo || '') + ' ' + (s.kind || '') + ' ' + (s.region ? [s.region.sigungu, s.region.emd, s.region.ri].join(' ') : '')).toLowerCase().indexOf(k) >= 0;
    }).slice(0, 8);
  }
  $('searchForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = $('searchInput').value.trim();
    if (!q) return;
    $('searchInput').blur();
    var box = $('searchResults');
    box.hidden = false; document.body.classList.add('sr-open');
    var mine = localSearch(q);
    var mineHtml = mine.map(function (s) {
      return '<button class="sr-item" data-sid="' + s.id + '"><b><span class="sr-kind" style="background:' + siteColor(s) + '">내 조사구</span>' + esc(s.name) + '</b><span>' + esc(siteLabel(s)) + ' · ' + esc(s.addr) + '</span></button>';
    }).join('');
    box.innerHTML = mineHtml + '<div class="sr-empty">카카오 검색 중…</div>';
    function bindMine() {
      box.querySelectorAll('[data-sid]').forEach(function (b) {
        b.addEventListener('click', function () { hideResults(); var s = findSite(b.getAttribute('data-sid')); if (!s) return; map.flyTo({ center: [s.lng, s.lat], zoom: Math.max(map.getZoom(), 16) }); openSite(s.id); });
      });
    }
    bindMine();
    kakaoSearch(q).then(function (list) {
      var h = mineHtml;
      if (list === null) h += '<div class="sr-empty">검색 서비스에 연결하지 못했습니다. 인터넷 연결을 확인하거나 지도를 길게 눌러 위치를 직접 저장하세요.</div>';
      else if (!list.length) h += mine.length ? '' : '<div class="sr-empty">「' + esc(q) + '」 검색 결과가 없습니다.</div>';
      else h += list.slice(0, 15).map(function (r, i) {
        return '<button class="sr-item" data-i="' + i + '"><b><span class="sr-kind">' + r.kind + '</span>' + esc(r.name) + '</b><span>' + esc(r.addr) + '</span></button>';
      }).join('');
      box.innerHTML = h;
      bindMine();
      box.querySelectorAll('[data-i]').forEach(function (b) {
        b.addEventListener('click', function () { hideResults(); showCandidate(list[+b.getAttribute('data-i')]); });
      });
    });
  });
  map.on('click', function () { hideResults(); });
  map.on('touchstart', function () { hideResults(); });

  /* 검색 결과·지도에서 고른 위치를 임시 핀으로 보여 주고 등록 버튼 제공 */
  function showCandidate(r, noFly) {
    clearTemp();
    var el = document.createElement('div'); el.className = 'pin-wrap'; el.innerHTML = '<div class="pin temp"><i>+</i></div>';
    tempMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([r.lng, r.lat]).addTo(map);
    if (!noFly) map.flyTo({ center: [r.lng, r.lat], zoom: Math.max(map.getZoom(), 16) });
    var wrap = document.createElement('div');
    wrap.innerHTML = '<b>' + esc(r.name) + '</b> <span class="cpw">' + copyBtn(r.addr) + '</span><div class="pop-addr">' + esc(r.addr || (r.lat.toFixed(5) + ', ' + r.lng.toFixed(5) + ' · 주소 확인 중…')) + '</div>' + mapAppBtns(r.name, r.lat, r.lng) +
      '<button class="btn primary full" data-s>조사구로 등록</button>' +
      '<button class="btn sf-go full" data-sf style="margin-top:6px">🚨 이 위치 보내기</button>';
    var pop = new maplibregl.Popup({ offset: 40, closeButton: true, closeOnClick: false, maxWidth: '280px' })
      .setLngLat([r.lng, r.lat]).setDOMContent(wrap).addTo(map);
    tempPopup = pop;
    pop.on('close', function () { if (tempPopup === pop) { tempPopup = null; clearTemp(); } });
    wrap.querySelector('[data-s]').addEventListener('click', function () {
      if (!db.profile) { openProfile(true); return; }
      openSiteForm(r, null);
    });
    wrap.querySelector('[data-sf]').addEventListener('click', function () {
      if (!db.profile) { openProfile(true); return; }
      openSafety({ name: r.kind === '장소' ? r.name : '지도에서 선택한 위치', addr: r.addr, lat: r.lat, lng: r.lng });
    });
    tempTarget = r;
    return wrap;
  }

  /* 지도 길게 누르기(모바일) / 오른쪽 클릭(PC) → 이 위치 등록 */
  var pressTimer = null, pressPt = null;
  function startPress(e) {
    if (e.originalEvent && e.originalEvent.touches && e.originalEvent.touches.length > 1) return;
    pressPt = e.point; clearTimeout(pressTimer);
    pressTimer = setTimeout(function () { pickPoint(e.lngLat); }, 600);
  }
  function cancelPress(e) {
    if (!pressPt) return;
    if (e && e.point && Math.hypot(e.point.x - pressPt.x, e.point.y - pressPt.y) < 8) return;
    clearTimeout(pressTimer); pressPt = null;
  }
  map.on('touchstart', startPress);
  map.on('touchmove', cancelPress);
  map.on('touchend', function () { clearTimeout(pressTimer); pressPt = null; });
  map.on('dragstart', function () { clearTimeout(pressTimer); pressPt = null; });
  map.on('contextmenu', function (e) { pickPoint(e.lngLat); });
  var lastPickAt = 0;
  function pickPoint(ll) {
    if (Date.now() - lastPickAt < 1000) return;
    lastPickAt = Date.now();
    hideResults();
    var r = { kind: '위치', name: '선택한 위치', addr: '', lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6) };
    var wrap = showCandidate(r, true);
    reverseGeocode(r.lat, r.lng).then(function (a) {
      if (tempMarker == null) return;
      var b = wrap.querySelector('b'), ad = wrap.querySelector('.pop-addr');
      if (!a) { if (ad) ad.textContent = r.lat.toFixed(5) + ', ' + r.lng.toFixed(5); return; }
      r.addr = a; r.name = a;
      if (b) b.textContent = a;
      var cw = wrap.querySelector('.cpw'); if (cw) cw.innerHTML = copyBtn(a);
      if (ad) ad.textContent = '';
    });
  }

  /* ───────── 내 위치 ───────── */
  /* ───────── 내 위치 — 텐아르 TLoc(map_libre v195)과 같은 방식 ─────────
     ① 현재 위치: 위치 추적 시작, 첫 위치에서 확대·북쪽 정렬, 4m 이상 움직이면 따라감. 방향 부채꼴은 폰 방향대로 돎(지도는 북쪽 고정)
     ② 방향 추적: 지도가 진행 방향(폰 방향)으로 회전 (8° 넘게 바뀔 때만, 부드럽게)
     ③ 해제: 추적 끄고 핀 지우고 북쪽 정렬
     손으로 지도를 끌면 따라가기만 멈춤(핀·방향 표시는 유지, 버튼 다시 누르면 ①부터) */
  var locMode = 'off', locWatch = null, orientOn = false, meMarker = null, meEl = null, accEl = null;
  var lastPos = null, heading = null, pendingCenter = false, lastFixTs = 0, progMove = false;
  var targetBearing = null, bearingRAF = null, oPending = null, oTimer = null, oLast = 0, mapBearTarget = null;
  var HEAD_TH = 2, MAP_ROT_DB = 8, FOCUS_ZOOM = 17;
  function distM(a1, o1, a2, o2) { var R = 6371000, dA = (a2 - a1) * Math.PI / 180, dO = (o2 - o1) * Math.PI / 180, x = Math.sin(dA / 2) * Math.sin(dA / 2) + Math.cos(a1 * Math.PI / 180) * Math.cos(a2 * Math.PI / 180) * Math.sin(dO / 2) * Math.sin(dO / 2); return 2 * R * Math.asin(Math.min(1, Math.sqrt(x))); }
  function ensureMe() {
    if (meMarker) return;
    meEl = document.createElement('div'); meEl.className = 'tloc-marker';
    meEl.innerHTML = '<div class="tloc-acc"></div><div class="tloc-fan"></div><div class="tloc-arrow"></div><div class="tloc-dot"></div>';
    accEl = meEl.querySelector('.tloc-acc');
    meMarker = new maplibregl.Marker({ element: meEl, rotationAlignment: 'map', pitchAlignment: 'map', anchor: 'center' });
  }
  function updateAcc() {
    if (!accEl || !lastPos) return;
    var acc = isFinite(lastPos.acc) ? lastPos.acc : 0;
    if (acc <= 0) { accEl.style.width = accEl.style.height = '0px'; return; }
    var mpp = 156543.03392 * Math.cos(lastPos.lat * Math.PI / 180) / Math.pow(2, map.getZoom() + 1);   /* MapLibre 512px 타일 기준 */
    var r = Math.max(14, Math.min(300, acc / mpp));
    accEl.style.width = accEl.style.height = (r * 2) + 'px';
  }
  map.on('zoom', updateAcc);
  function applyHeading() {
    if (!meMarker) return;
    if (heading == null) { meEl.classList.remove('has-heading'); meMarker.setRotation(0); return; }
    meEl.classList.add('has-heading'); meMarker.setRotation(heading);   /* 지도가 돌아도 실제 방향 유지 */
  }
  function animateBearing() {
    if (targetBearing == null) { bearingRAF = null; return; }
    var cur = map.getBearing(), d = ((targetBearing - cur + 540) % 360) - 180;
    if (Math.abs(d) < 0.5) { setBear(targetBearing); bearingRAF = null; return; }
    setBear(cur + d * 0.25);
    bearingRAF = requestAnimationFrame(animateBearing);
  }
  function setBear(b) { progMove = true; try { map.setBearing(b); } catch (e) {} progMove = false; }
  function rotateTo(h) { targetBearing = h; if (!bearingRAF) bearingRAF = requestAnimationFrame(animateBearing); }
  function ensureNorth() { if (Math.abs(map.getBearing()) > 0.1) rotateTo(0); }
  function recenter() {
    if (!lastPos) return;
    progMove = true;
    try { map.easeTo({ center: [lastPos.lng, lastPos.lat], duration: 350, essential: true }); } catch (e) {}
    setTimeout(function () { progMove = false; }, 460);
  }
  function gpsBadge() {
    var el = $('gpsStatus'); if (!el) return;
    if (locMode === 'off' && !meMarker) { el.hidden = true; return; }
    var stale = !lastFixTs || Date.now() - lastFixTs > 12000, acc = lastPos && isFinite(lastPos.acc) ? Math.round(lastPos.acc) : null;
    var t = !lastPos || stale || acc == null ? ['GPS 검색 중…', '#6b7280'] : acc <= 15 ? ['GPS 양호 · ±' + acc + 'm', '#16a34a'] : acc <= 40 ? ['GPS 보통 · ±' + acc + 'm', '#ca8a04'] : ['GPS 약함 · ±' + acc + 'm', '#ea580c'];
    el.textContent = '📡 ' + t[0]; el.style.background = t[1]; el.hidden = false;
  }
  setInterval(function () { if (locMode !== 'off') gpsBadge(); }, 5000);
  function onPos(pos) {
    var c = pos.coords, prev = lastPos, la = c.latitude, lo = c.longitude, ac = c.accuracy;
    lastFixTs = Date.now();
    /* 명백히 나쁜 위치(정확도 50m↑이고 직전의 3배↑, 6초 안에 좋은 값 있음)는 한 번 건너뜀 */
    if (prev && isFinite(ac) && isFinite(prev.acc) && ac > 50 && ac > prev.acc * 3 && Date.now() - prev.ts < 6000) { la = prev.lat; lo = prev.lng; ac = prev.acc; }
    lastPos = { lat: la, lng: lo, acc: ac, ts: pos.timestamp || Date.now() };
    ensureMe(); meMarker.setLngLat([lo, la]); if (!meMarker._map) meMarker.addTo(map);
    applyHeading(); updateAcc();
    if (pendingCenter) {
      pendingCenter = false; progMove = true;
      try { map.easeTo({ center: [lo, la], zoom: Math.max(map.getZoom(), FOCUS_ZOOM), bearing: 0, duration: 500, essential: true }); } catch (e) {}
      setTimeout(function () { progMove = false; }, 560);
    } else if (locMode !== 'off') {
      if (!prev || distM(prev.lat, prev.lng, la, lo) > 4) recenter();   /* GPS 흔들림으로 계속 움직이지 않게 */
    }
    gpsBadge();
  }
  function onPosErr(err) {
    if (err && err.code === 1) {
      toast('위치 권한이 꺼져 있습니다. 휴대폰 설정에서 이 브라우저의 위치 권한을 허용해 주세요.');
      stopAll(); return;
    }
    gpsBadge();   /* 신호 약함·시간 초과는 끄지 않고 계속 시도 */
  }
  function startWatch() { if (locWatch == null) locWatch = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }); }
  function stopWatch() { if (locWatch != null) { try { navigator.geolocation.clearWatch(locWatch); } catch (e) {} locWatch = null; } }
  function applyOrient() {
    oTimer = null; oLast = Date.now();
    var h = oPending; if (h == null) return;
    if (heading == null || Math.abs(((h - heading + 540) % 360) - 180) >= HEAD_TH) {
      heading = h; applyHeading();
      if (locMode === 'track' && (mapBearTarget == null || Math.abs(((heading - mapBearTarget + 540) % 360) - 180) >= MAP_ROT_DB)) { mapBearTarget = heading; rotateTo(heading); }
    }
  }
  function onOrient(e) {
    var h = null;
    if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) h = e.webkitCompassHeading;   /* 아이폰 */
    else if (typeof e.alpha === 'number' && e.alpha != null && e.absolute) h = (360 - e.alpha) % 360;                /* 안드로이드 */
    if (h == null || isNaN(h)) return;
    oPending = (h + 360) % 360;
    if (oTimer) return;
    oTimer = setTimeout(applyOrient, Math.max(0, 100 - (Date.now() - oLast)));   /* 최대 약 10회/초 */
  }
  function startOrient() { if (orientOn) return; orientOn = true; window.addEventListener('deviceorientationabsolute', onOrient, true); window.addEventListener('deviceorientation', onOrient, true); }
  function stopOrient() {
    if (!orientOn) return; orientOn = false;
    if (oTimer) { clearTimeout(oTimer); oTimer = null; }
    oPending = null; mapBearTarget = null;
    window.removeEventListener('deviceorientationabsolute', onOrient, true); window.removeEventListener('deviceorientation', onOrient, true);
  }
  function orientPerm() {
    try { if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') return DeviceOrientationEvent.requestPermission().then(function (p) { return p === 'granted'; }, function () { return false; }); } catch (e) {}
    return Promise.resolve(('DeviceOrientationEvent' in window) || ('ondeviceorientationabsolute' in window));
  }
  function setLocMode(m) {
    locMode = m;
    var b = $('btnLocate');
    b.classList.toggle('on', m !== 'off'); b.classList.toggle('heading', m === 'track');
    b.querySelector('span').textContent = m === 'track' ? '🧭' : '📍';
    b.querySelector('small').textContent = m === 'off' ? '내 위치' : m === 'current' ? '현재 위치' : '방향 추적';
    if (meEl) meEl.classList.toggle('acc-on', m !== 'off');
    if (m === 'current') ensureNorth();
    else if (m === 'track') { if (heading != null) rotateTo(heading); }
    else targetBearing = null;
    updateAcc(); gpsBadge();
  }
  function stopAll() {
    stopWatch(); stopOrient(); setLocMode('off');
    if (meMarker) { meMarker.remove(); meMarker = null; meEl = null; accEl = null; }
    lastPos = null; heading = null;
    ensureNorth(); gpsBadge();
  }
  $('btnLocate').addEventListener('click', function () {
    if (!navigator.geolocation) { toast('이 기기에서는 위치를 확인할 수 없습니다'); return; }
    if (locMode === 'off') {
      toast('현재 위치를 확인하고 있습니다 · 한 번 더 누르면 방향 추적');
      setLocMode('current'); pendingCenter = !lastPos || !meMarker || !meMarker._map;
      if (!pendingCenter) recenter();
      startWatch();
      orientPerm().then(function (ok) { if (ok) startOrient(); });   /* 방향 부채꼴 표시용 */
    } else if (locMode === 'current') {
      orientPerm().then(function (ok) {
        if (ok) { startOrient(); setLocMode('track'); recenter(); if (heading != null) rotateTo(heading); toast('방향 추적 · 한 번 더 누르면 해제'); }
        else toast('방향 센서를 쓸 수 없어 현재 위치만 표시합니다');
      });
    } else { stopAll(); toast('위치 추적을 껐습니다'); }
  });
  /* 손으로 지도를 끌면 따라가기만 멈춤 */
  map.on('dragstart', function () { if (!progMove && locMode !== 'off') { targetBearing = null; setLocMode('off'); } });

  /* ───────── 주변정보 패널 (nearby.js) ───────── */
  $('btnNearby').addEventListener('click', function () {
    var body = openSheet('🧭 주변정보', '');
    try { window.OdigoNearby.render(body); }
    catch (e) { body.innerHTML = '<p class="muted">주변정보를 불러오지 못했습니다. 조사구·방문 기록은 그대로 사용할 수 있습니다.</p>'; }
  });

  /* ───────── 정보 · 백업 ───────── */
  function storeNotice() {
    if (storeStatus === 'nocrypto') return '<p class="warn">이 브라우저는 암호화 저장을 쓸 수 없어 <b>저장하지 않습니다</b> (사생활 보호 모드·오래된 브라우저). 일반 모드의 Safari·Chrome에서 열어 주세요.</p>';
    if (storeStatus === 'keylost') return '<p class="warn">이 기기의 암호 열쇠가 없어져 저장된 자료를 열 수 없습니다(브라우저 데이터 정리 등). 열 수 없는 자료는 지우지 않고 보관 중입니다. <b>백업 파일 불러오기</b>로 되살리거나 새로 시작하세요.</p><div class="row"><button class="btn" id="stOver">새로 시작 (열 수 없는 자료는 보관)</button></div>';
    if (storeStatus === 'migratefail') return '<p class="warn">v2.3 자료를 새 형식으로 옮기지 못했습니다. 기존 자료는 그대로 있습니다. 지금은 보기만 되고 저장되지 않습니다. 새로 고침해 다시 시도해 주세요.</p>';
    return '<p class="muted">조사구·메모·방문 기록·내 설정은 <b>이 기기 브라우저에만 암호화해서</b> 저장되며 서버로 보내지 않습니다. 브라우저 데이터를 지우면 함께 지워지니 백업 파일을 저장해 두세요.</p>';
  }
  $('btnInfo').addEventListener('click', function () {
    var body = openSheet('ⓘ 어디고 정보',
      '<p><b>어디고 ' + APP_VERSION + '</b> · 위치 현장조사지원' + (db.profile ? ' · ' + esc(db.profile.nickname) + ' (' + esc(divOf(db.profile.division).name) + ')' : '') + '</p>' +
      storeNotice() +
      '<div class="row"><button class="btn" id="goSet">⚙ 내 설정</button><button class="btn" id="goHome">나의 조사구 현황</button><button class="btn" id="goGift">🎁 답례품·수첩·달력</button></div>' +
      '<label class="fld">자료 파일 (암호화)</label>' +
      '<div class="row"><button class="btn" id="goShare" style="flex:1">📤 업무별 자료 공유</button><label class="btn" style="flex:1;text-align:center">📂 자료 파일 가져오기<input id="bkLoad" type="file" accept="application/json,.json,.odigo" hidden></label></div>' +
      '<div class="row"><button class="btn" id="bkSave" style="flex:1">💾 전체 백업 저장</button></div>' +
      '<label class="fld">텐아르</label>' +
      '<div class="row"><button class="btn" id="goTenarFile" style="flex:1">📂 텐아르 파일 가져오기 (앱→앱)</button><button class="btn" id="goTenar" style="flex:1">📍 이 브라우저의 텐아르 핀</button></div>' +
      '<p class="muted">텐아르 앱 › 조사구목록 「🗄 전체 백업」·「📤 전체 공유」 또는 즐겨찾기 「공유」로 만든 파일을 고르고, 텐아르에서 정한 암호를 넣으세요.</p>' +
      '<label class="fld">삭제</label>' +
      '<div class="row"><button class="btn danger" id="goDel" style="flex:1">🗑 조사구 삭제 (전체·업무별·선택)</button></div>' +
      '<label class="fld">엑셀</label>' +
      '<div class="row"><button class="btn" id="goXls" style="flex:1">📥 엑셀로 조사구 올리기</button><button class="btn" id="goTpl" style="flex:1">📄 엑셀 양식 받기</button></div>' +
      '<p class="muted">백업 파일 암호는 모든 어디고 사용자가 같은 <b>' + (window.OdigoStore ? OdigoStore.FILE_PASSWORD : '2026') + '</b>입니다. 파일을 받은 사람은 누구나 열 수 있으니 받을 사람만 있는 곳에 보내 주세요. 예전(v2.3) 백업 파일도 불러올 수 있습니다.</p>' +
      '<p class="muted">배경지도 © VWorld(국토교통부) · 검색 © Kakao · 주변정보는 각 화면에 출처 표시</p>' +
      '<p class="muted">최초 빌드 2026.11.5 · by <b>Mr. Hyun</b> · <a href="https://ubaldos00-ship-it.github.io/" target="_blank" rel="noopener">텐두어 바로가기</a></p>');
    var so = body.querySelector('#stOver');
    if (so) so.addEventListener('click', function () {
      if (!confirm('새로 시작할까요? 열 수 없는 자료는 지우지 않고 따로 보관합니다.')) return;
      OdigoStore.startOver().then(function (d) { db = d; storeStatus = 'new'; closeSheet(); persist(); openProfile(true); }, function () { toast('새로 시작하지 못했습니다'); });
    });
    body.querySelector('#goSet').addEventListener('click', function () { openProfile(!db.profile); });
    body.querySelector('#goHome').addEventListener('click', function () { if (db.profile) openHome(); else openProfile(true); });
    body.querySelector('#bkSave').addEventListener('click', exportBackup);
    body.querySelector('#goGift').addEventListener('click', function () { if (db.profile) openGifts(); else openProfile(true); });
    body.querySelector('#goShare').addEventListener('click', function () { if (window.OdigoFiles) OdigoFiles.openExport({ div: db.profile && db.profile.division }); });
    body.querySelector('#goXls').addEventListener('click', function () { if (window.OdigoFiles) OdigoFiles.openExcel({ div: db.profile && db.profile.division }); });
    body.querySelector('#goTenar').addEventListener('click', function () { if (window.OdigoFiles) OdigoFiles.openTenarImport(); });
    body.querySelector('#goTenarFile').addEventListener('click', function () { if (window.OdigoFiles) OdigoFiles.openTenarFile(); });
    body.querySelector('#goDel').addEventListener('click', function () { if (window.OdigoFiles) OdigoFiles.openDelete({ div: '' }); });
    body.querySelector('#goTpl').addEventListener('click', function () { if (window.OdigoFiles) OdigoFiles.template(); });
    body.querySelector('#bkLoad').addEventListener('change', function (e) { var f = e.target.files && e.target.files[0]; if (f) importBackup(f); });
  });
  function download(obj, name) {
    var blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function exportBackup() {
    if (!window.OdigoStore || !OdigoStore.CRYPTO_OK) { toast('이 브라우저에서는 암호화 파일을 만들 수 없습니다'); return; }
    if (!confirm('전체 백업 파일을 만듭니다.\n조사구 ' + db.sites.length + '곳 · 방문 기록 ' + db.visits.length + '건\n암호: ' + OdigoStore.FILE_PASSWORD + ' (모든 사용자 공통)')) return;
    OdigoStore.exportFile({ sites: db.sites, visits: db.visits, profile: db.profile }, { division: 'all', sites: db.sites.length, visits: db.visits.length }, APP_VERSION).then(function (o) {
      download(o, 'odigo_backup_' + todayStr() + '.json'); toast('백업 파일을 저장했습니다');
    }, function () { toast('백업 파일을 만들지 못했습니다'); });
  }
  function importBackup(file) {
    var rd = new FileReader();
    rd.onload = function () {
      var text = rd.result;
      var body = openSheet('자료 파일 가져오기', '<label class="fld">파일 암호</label><input class="inp" id="ipw" value="' + (window.OdigoStore ? OdigoStore.FILE_PASSWORD : '2026') + '" autocomplete="off">' +
        '<div class="row"><button class="btn primary full" id="ipGo">열기</button></div><p class="muted">예전(v2.3) 평문 백업은 암호 없이 열립니다.</p>');
      body.querySelector('#ipGo').addEventListener('click', function () {
        OdigoStore.importFile(text, body.querySelector('#ipw').value).then(function (r) {
          var inc = r.kind === 'legacy' ? OdigoStore.fromLegacy(r.places, todayStr()) : { sites: r.data.sites || [], visits: r.data.visits || [], profile: r.data.profile || null };
          previewMerge(inc, r.scope);
        }, function (e) {
          toast(e && e.code === 'badpw' ? '암호가 맞지 않거나 파일이 손상되었습니다. 기존 자료는 그대로입니다.' : '어디고 백업 파일이 아닙니다. 기존 자료는 그대로입니다.');
        });
      });
    };
    rd.readAsText(file);
  }
  function previewMerge(inc, scope) {
    var have = {}; db.sites.forEach(function (s) { have[s.id] = s; });
    var add = 0, newer = 0, same = 0, fill = 0;
    /* v3.9: 이미 있는 조사구라도 비어 있는 연락처·층·조사구·작물은 채움 (텐아르에서 새로 가져온 경작자 정보 등) */
    function blanks(h, s) {
      var f = {};
      if ((!h.contacts || !h.contacts.length) && s.contacts && s.contacts.length) f.contacts = s.contacts;
      ['floor', 'josaguNo', 'crop', 'farmName', 'species'].forEach(function (k) { if (!h[k] && s[k]) f[k] = s[k]; });
      if ((!h.name || h.name === '이름 없는 조사구' || /^생산량 핀$/.test(h.name)) && s.name) f.name = s.name;
      return Object.keys(f).length ? f : null;
    }
    inc.sites.forEach(function (s) { if (!s || !s.id || !isFinite(s.lat)) return; var h = have[s.id]; if (!h) add++; else if ((s.updatedAt || '') > (h.updatedAt || '')) newer++; else { same++; if (blanks(h, s)) fill++; } });
    var vh = {}; db.visits.forEach(function (v) { vh[v.id] = 1; });
    var vadd = inc.visits.filter(function (v) { return v && v.id && !vh[v.id]; }).length;
    var sc = scope && scope.title ? '<p class="x-sum"><b>' + esc(scope.title) + '</b>' + (scope.from ? ' · 보낸 사람 ' + esc(scope.from) : '') + ' · 조사구 ' + (scope.sites || 0) + '곳</p>' : (scope && scope.division === 'all' ? '<p class="x-sum">전체 백업 파일</p>' : '');
    var body = openSheet('불러올 내용 확인', sc +
      '<table class="kv"><tr><th>새 조사구</th><td>' + add + '곳</td></tr><tr><th>더 최신으로 바뀜</th><td>' + newer + '곳</td></tr><tr><th>이미 있음(그대로)</th><td>' + same + '곳' + (fill ? ' <small>(그중 ' + fill + '곳은 빈 연락처·층·조사구를 채움)</small>' : '') + '</td></tr><tr><th>새 방문 기록</th><td>' + vadd + '건</td></tr></table>' +
      '<div class="row"><button class="btn primary" id="mgGo" style="flex:1">합치기</button><button class="btn cancel" id="mgNo">취소</button></div>');
    body.querySelector('#mgNo').addEventListener('click', function () { closeSheet(); toast('취소했습니다. 기존 자료는 그대로입니다.'); });
    body.querySelector('#mgGo').addEventListener('click', function () {
      /* 열쇠를 잃은 상태에서 백업으로 되살릴 때: 열 수 없는 자료는 보관하고 새 금고에 합침 */
      if (storeStatus === 'keylost' && OdigoStore.isBlocked()) {
        OdigoStore.startOver().then(function (d) { db = d; storeStatus = 'ok'; have = {}; vh = {}; merge(); }, function () { toast('저장 공간을 준비하지 못했습니다'); });
        return;
      }
      merge();
    });
    function merge() {
      inc.sites.forEach(function (s) {
        if (!s || !s.id || !isFinite(s.lat)) return;
        var h = have[s.id];
        if (!h) db.sites.push(s);
        else if ((s.updatedAt || '') > (h.updatedAt || '')) {
          /* 내가 어디고에서 넣은 변동 사항·필지·답례품·연락처는 남김 */
          ['changes', 'jibuns', 'gifts', 'changesAt'].forEach(function (k) { if (h[k] && s[k] == null) s[k] = h[k]; });
          if ((!s.contacts || !s.contacts.length) && h.contacts && h.contacts.length) s.contacts = h.contacts;
          db.sites[db.sites.indexOf(h)] = s;
        } else { var f = blanks(h, s); if (f) { Object.assign(h, f); h.updatedAt = nowIso(); } }
      });
      inc.visits.forEach(function (v) { if (v && v.id && !vh[v.id]) db.visits.push(v); });
      if (!db.profile && inc.profile) db.profile = inc.profile;
      persist(); closeSheet(); toast('불러왔습니다 · 새 조사구 ' + add + '곳');
      refillRegions(false);
      if (!db.profile) openProfile(true);
    }
  }

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

  /* ───────── 나 조사하러 간다 (safety.js) ───────── */
  function openSafety(target) {
    if (!db.profile) { openProfile(true); return; }
    if (!window.OdigoSafety) { toast('안전 연락 기능을 불러오지 못했습니다'); return; }
    OdigoSafety.open(target);
  }
  /* 아래 버튼: 열려 있는 조사구 카드 → 지도에 찍은 임시 핀 → 없으면 현재 위치만 */
  $('btnSafety').addEventListener('click', function () {
    var s = curView && !$('sheet').hidden ? findSite(curView) : null;
    if (s) { openSafety({ name: s.name, addr: s.addr, lat: s.lat, lng: s.lng }); return; }
    if (tempTarget && tempMarker) { var r = tempTarget; openSafety({ name: r.kind === '장소' ? r.name : '지도에서 선택한 위치', addr: r.addr, lat: r.lat, lng: r.lng }); return; }
    openSafety(null);
  });
  /* 카톡으로 받은 어디고 ?pin= 링크를 열었을 때 그 위치를 보여 줌 */
  var sharedMarker = null;
  function showSharedPin(o) {
    if (sharedMarker) sharedMarker.remove();
    var el = document.createElement('div'); el.className = 'pin-wrap'; el.innerHTML = '<div class="pin shared"><i>!</i></div>';
    sharedMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([o.lng, o.lat]).addTo(map);
    function show() {
      map.jumpTo({ center: [o.lng, o.lat], zoom: 16 });
      var wrap = document.createElement('div');
      wrap.innerHTML = '<span class="pub-tag">공유받은 위치</span><br><b>' + esc(o.name) + '</b><div class="pop-addr">' + o.lat.toFixed(5) + ', ' + o.lng.toFixed(5) + '</div>' +
        '<a class="btn full" href="' + esc(o.kakao) + '" target="_blank" rel="noopener" style="display:block;text-align:center;text-decoration:none;margin-bottom:6px">카카오맵에서 열기</a>' +
        (o.naver ? '<a class="btn full" href="' + esc(o.naver) + '" target="_blank" rel="noopener" style="display:block;text-align:center;text-decoration:none;margin-bottom:6px">네이버지도에서 열기</a>' : '') +
        '<button class="btn primary full" data-n>🚗 길찾기</button>';
      new maplibregl.Popup({ offset: 40, closeOnClick: false, maxWidth: '260px' }).setLngLat([o.lng, o.lat]).setDOMContent(wrap).addTo(map);
      wrap.querySelector('[data-n]').addEventListener('click', function () { openNav(o.name, o.lat, o.lng); });
    }
    if (map.loaded()) show(); else map.once('load', show);
  }

  /* 주변정보·레이어·안전 연락 모듈이 쓰는 공용 기능 */
  window.OdigoApp = { map: map, openNav: openNav, openSheet: openSheet, closeSheet: closeSheet, toast: toast, regionOf: regionOf,
    ensureKakao: ensureKakao, reverseGeocode: reverseGeocode, showSharedPin: showSharedPin,
    setPinLabels: setPinLabels, mapAppBtns: mapAppBtns, copyBtn: copyBtn, pinVars: pinVars, openPinSettings: function () { if (db.profile) openPinSettings(); else openProfile(true); },
    getProfile: function () { return db.profile; },
    fitSites: fitSites, previewMerge: previewMerge, exportBackup: function () { exportBackup(); },
    /* files.js(공유·엑셀)용 자료 창구 */
    data: {
      APP_VERSION: APP_VERSION, DIVISIONS: DIVISIONS, CROPS: CROPS, KINDS: KINDS, divOf: divOf, typeOf: typeOf,
      profile: function () { return db.profile; }, sites: function () { return db.sites; }, visits: function () { return db.visits; },
      filterSites: filterSites,
      deleteMany: function (ids) {
        var m = {}; ids.forEach(function (id) { m[id] = 1; });
        db.sites = db.sites.filter(function (s) { return !m[s.id]; });
        db.visits = db.visits.filter(function (v) { return !m[v.siteId]; });
        if (selectedId && m[selectedId]) selectedId = null;
        persist();
      },
      addMany: function (items) {
        var now = nowIso();
        items.forEach(function (x) {
          db.sites.push({ id: uid(), name: x.name || '', addr: x.addr || '', lat: +x.lat, lng: +x.lng, memo: x.memo || '',
            josaguNo: x.josaguNo || '', floor: x.floor || '', card: x.card || '', kind: x.kind || '', species: x.species || '', farmName: x.farmName || '',
            contacts: x.contacts || [], changes: [], jibuns: [], gifts: {},
            division: x.division || null, type: x.type || null, crop: x.crop || null, region: x.region || null, createdAt: now, updatedAt: now });
        });
        persist(); refillRegions(false);
      }
    },
    setSafety: function (o) { if (!db.profile) return; db.profile.safety = Object.assign({}, db.profile.safety || {}, o); db.profile.updatedAt = nowIso(); persist(); },
    pinsForAlt: function () {
      return visibleSites().filter(function (s) { return isFinite(s.lat) && isFinite(s.lng); }).map(function (s) {
        return { id: s.id, name: s.name, lat: s.lat, lng: s.lng, order: todayOrderOf(s.id), sel: s.id === selectedId,
          top: topText(s), bottom: bottomText(s), color: siteColor(s), seq: noOf(s) || '', titles: document.body.classList.contains('pin-labels') };
      });
    } };

  /* ───────── 시작: 암호화 저장소 열기 ───────── */
  function start() {
    if (!window.OdigoStore) { storeStatus = 'nocrypto'; ready = true; toast('저장 모듈을 불러오지 못했습니다'); return; }
    OdigoStore.open(todayStr()).then(function (r) {
      db = r.data; storeStatus = r.status; ready = true;
      renderMarkers(); updateCounts(); renderDivBtns();
      if (r.status === 'migrated') toast('v2.3 자료 ' + r.count + '곳을 암호화 저장으로 옮겼습니다');
      if (r.status === 'nocrypto' || r.status === 'keylost' || r.status === 'migratefail') { $('btnInfo').click(); return; }
      if (!db.profile && !OPENED_BY_PIN) openProfile(true);
      refillRegions(false);
    });
  }
  start();
})();
