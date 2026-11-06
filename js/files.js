/* 어디고 v3.0 — 자료 파일 (v3.1: 텐아르 핀 가져오기) (설계: 설계/v2.4 11장 + 2026-11-07 엑셀 업로드 요청)
   · 업무별 공유 파일: 범위(업무 전체·조사 유형·작물·고른 조사구) → 건수 미리보기 → 암호화 파일(암호 2026)
     → 휴대폰 공유 메뉴(카톡·문자 등) / 지원 안 되면 파일 저장 + 공유 문구 복사
   · 가져오기는 odigo.js의 「자료 파일 가져오기」(미리보기 후 합치기)를 그대로 씀
   · 엑셀 올리기: 양식(.xlsx) 받기 / 업무별 여러 건 올리기. 텐아르 조사구 양식 열 이름도 인식
     위도·경도가 있으면 그대로, 없으면 주소·지번으로 카카오 위치 찾기. 못 찾은 줄은 올리지 않고 목록으로 보여 줌(가짜 위치 없음)
   · 엑셀 라이브러리: SheetJS 0.20.3 (0.18.x의 알려진 파일 처리 취약점 수정판), 쓸 때만 불러옴 */
(function () {
  'use strict';

  var XLSX_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
  var XLSX_SRI = 'sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT';
  var MAX_ROWS = 3000;

  function A() { return window.OdigoApp; }
  function D() { return A().data; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function safeName(s) { return String(s || '').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40); }

  /* ───────── 범위 고르기 ───────── */
  function scopeFields(o) {
    var T = D(), d = T.divOf(o.div) || T.divOf((T.profile() || {}).division) || T.DIVISIONS[0];
    return '<label class="fld">업무분야</label><select class="inp" id="xDiv">' + T.DIVISIONS.map(function (x) { return '<option value="' + x.id + '"' + (x.id === d.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select>' +
      '<label class="fld">조사 유형</label><select class="inp" id="xType"></select>' +
      '<div id="xCropW"><label class="fld">작물</label><select class="inp" id="xCrop"></select></div>';
  }
  function bindScope(body, o, allowAll, onChange) {
    var ready = false, T = D(), fd = body.querySelector('#xDiv'), ft = body.querySelector('#xType'), fc = body.querySelector('#xCrop'), cw = body.querySelector('#xCropW');
    function types() {
      var d = T.divOf(fd.value);
      ft.innerHTML = (allowAll ? '<option value="">업무 전체</option>' : '') + d.types.map(function (t) { return '<option value="' + t.id + '">' + esc(t.name) + '</option>'; }).join('');
      if (o.type && d.types.some(function (t) { return t.id === o.type; })) ft.value = o.type;
      crops();
    }
    function crops() {
      var t = T.typeOf(fd.value, ft.value);
      cw.hidden = !(t && t.crops);
      if (t && t.crops) {
        fc.innerHTML = (allowAll ? '<option value="">작물 전체</option>' : '') + t.crops.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
        if (o.crop) fc.value = o.crop;
      }
      if (ready && onChange) onChange();
    }
    fd.addEventListener('change', function () { o = {}; types(); });
    ft.addEventListener('change', function () { o.crop = null; crops(); });
    fc.addEventListener('change', function () { if (onChange) onChange(); });
    types();
    ready = true;
    return function () {
      var t = T.typeOf(fd.value, ft.value);
      return { div: fd.value, type: ft.value || null, crop: t && t.crops && fc.value ? fc.value : null };
    };
  }
  function scopeTitle(sc) {
    var T = D(), d = T.divOf(sc.div), t = T.typeOf(sc.div, sc.type);
    return (d ? d.name : '') + (t ? ' › ' + t.name : '') + (sc.crop ? ' › ' + sc.crop : '');
  }

  /* ───────── 업무별 공유 파일 ───────── */
  function openExport(o) {
    var T = D();
    o = o || {};
    if (!T.profile()) { A().toast('먼저 내 설정을 해 주세요'); return; }
    var body = A().openSheet('📤 업무별 자료 공유',
      '<p class="muted">고른 범위의 조사구·메모·방문 기록을 암호화 파일로 만들어 보냅니다. 받은 사람은 어디고 ⓘ › 「자료 파일 가져오기」로 엽니다.</p>' +
      scopeFields(o) +
      '<label class="chk-all"><input type="checkbox" id="xPick"> 조사구를 하나씩 고르기</label><div id="xList"></div>' +
      '<div class="x-sum" id="xSum"></div>' +
      '<p class="warn">파일 암호는 모든 어디고 사용자가 같은 <b>' + window.OdigoStore.FILE_PASSWORD + '</b>입니다. 받은 사람은 누구나 열 수 있으니 받을 사람만 있는 방에 보내 주세요.</p>' +
      '<div class="sf-btns"><button class="btn primary" id="xShare">📤 공유하기 (카톡·문자 등)</button><button class="btn" id="xSave">💾 파일로 저장</button><button class="btn" id="xCopy">📋 공유 문구 복사</button></div>');
    var pickEl = body.querySelector('#xPick'), listEl = body.querySelector('#xList'), sumEl = body.querySelector('#xSum');
    var chosen = null;
    var get = bindScope(body, o, true, refresh);
    function inScope() { var sc = get(); return T.filterSites({ div: sc.div, type: sc.type, crop: sc.crop }); }
    function picked() {
      var list = inScope();
      if (!pickEl.checked) return list;
      return list.filter(function (s) { return chosen && chosen[s.id]; });
    }
    function refresh() {
      var list = inScope();
      if (pickEl.checked) {
        if (!chosen) { chosen = {}; list.forEach(function (s) { chosen[s.id] = true; }); }
        listEl.innerHTML = list.length ? list.map(function (s) {
          return '<label class="un-row"><input type="checkbox" data-sid="' + s.id + '"' + (chosen[s.id] ? ' checked' : '') + '><span><b>' + esc(s.name) + '</b><small>' + esc([s.josaguNo ? '조사구 ' + s.josaguNo : '', s.addr].filter(Boolean).join(' · ')) + '</small></span></label>';
        }).join('') : '<p class="muted">이 범위에 조사구가 없습니다.</p>';
        listEl.querySelectorAll('[data-sid]').forEach(function (c) { c.addEventListener('change', function () { chosen[c.getAttribute('data-sid')] = c.checked; summary(); }); });
      } else listEl.innerHTML = '';
      summary();
    }
    function summary() {
      var p = picked(), ids = {}; p.forEach(function (s) { ids[s.id] = 1; });
      var v = T.visits().filter(function (x) { return ids[x.siteId]; }).length;
      sumEl.innerHTML = '<b>' + esc(scopeTitle(get())) + '</b> · 조사구 <b>' + p.length + '</b>곳 · 방문 기록 ' + v + '건';
      ['#xShare', '#xSave', '#xCopy'].forEach(function (q) { body.querySelector(q).disabled = !p.length; });
    }
    pickEl.addEventListener('change', function () { chosen = null; refresh(); });
    refresh();
    function build() {
      var sc = get(), p = picked(), ids = {}; p.forEach(function (s) { ids[s.id] = 1; });
      var visits = T.visits().filter(function (x) { return ids[x.siteId]; });
      var nick = (T.profile() || {}).nickname || '';
      var scope = { division: sc.div, type: sc.type, crop: sc.crop, title: scopeTitle(sc), sites: p.length, visits: visits.length, from: nick, picked: !!pickEl.checked };
      return window.OdigoStore.exportFile({ sites: p, visits: visits }, scope, T.APP_VERSION).then(function (obj) {
        var name = 'odigo_' + safeName(scope.title.replace(/ › /g, '_')) + '_' + p.length + '건_' + today() + '.json';
        var text = '[어디고 자료] ' + nick + ' · ' + scope.title + ' ' + p.length + '건\n파일 암호 ' + window.OdigoStore.FILE_PASSWORD + ' · 어디고 ⓘ › 자료 파일 가져오기로 여세요\nhttps://ubaldos00-ship-it.github.io/odigo/';
        return { obj: obj, name: name, text: text };
      });
    }
    body.querySelector('#xSave').addEventListener('click', function () { build().then(function (r) { download(r.obj, r.name); A().toast('파일을 저장했습니다'); }, fail); });
    body.querySelector('#xCopy').addEventListener('click', function () { build().then(function (r) { copy(r.text); A().toast('공유 문구를 복사했습니다'); }, fail); });
    body.querySelector('#xShare').addEventListener('click', function () {
      build().then(function (r) {
        var file = null;
        try { file = new File([JSON.stringify(r.obj)], r.name, { type: 'application/json' }); } catch (e) {}
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: '어디고 자료', text: r.text }).then(function () { A().toast('공유 화면을 열었습니다'); }, function (e) {
            if (e && e.name === 'AbortError') return;
            fallback(r);
          });
        } else fallback(r);
      }, fail);
    });
    function fallback(r) {
      download(r.obj, r.name); copy(r.text);
      A().toast('이 기기에서는 파일 공유가 안 되어 파일을 저장하고 문구를 복사했습니다. 카톡에서 파일을 첨부해 보내세요.');
    }
    function fail() { A().toast('파일을 만들지 못했습니다'); }
  }
  function download(obj, name) {
    var blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).catch(function () {}); return; }
    try { var t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); } catch (e) {}
  }

  /* ───────── 엑셀 ───────── */
  var xP = null;
  function ensureXlsx() {
    if (window.XLSX) return Promise.resolve(true);
    if (xP) return xP;
    xP = new Promise(function (res) {
      var s = document.createElement('script');
      s.src = XLSX_URL; s.integrity = XLSX_SRI; s.crossOrigin = 'anonymous';
      var to = setTimeout(function () { res(false); }, 15000);
      s.onload = function () { clearTimeout(to); res(!!window.XLSX); };
      s.onerror = function () { clearTimeout(to); res(false); };
      document.head.appendChild(s);
    }).then(function (ok) { if (!ok) xP = null; return ok; });
    return xP;
  }
  var HEAD = ['업무분야', '조사유형', '작물', '조사구명', '조사구번호', '층', '카드', '구분', '시도', '시군구', '읍면동', '리', '본지번', '부지번', '주소', '위도', '경도', '메모'];
  /* 열 이름 → 항목 (텐아르 조사구 양식 이름 포함) */
  var ALIAS = {
    division: ['업무분야', '분야', '업무', '과'],
    type: ['조사유형', '유형', '조사명', '조사종류'],
    crop: ['작물', '작물명', '품목'],
    name: ['조사구명', '조사구 이름', '조사구이름', '이름', '장소명', '명칭', '상호', '대상'],
    josaguNo: ['조사구번호', '조사구 번호', '조사구'],
    floor: ['층'], card: ['카드'], kind: ['구분', '지목'],
    sido: ['시도'], sigungu: ['시군구'], emd: ['읍면동'], ri: ['리', '동리'],
    bon: ['본지번', '본번'], bu: ['부지번', '부번'],
    addr: ['주소', '초입주소', '소재지', '지번주소', '도로명주소'],
    lat: ['위도', 'lat', 'latitude'], lng: ['경도', 'lng', 'lon', 'longitude'],
    memo: ['메모'], note: ['비고']
  };
  function norm(h) { return String(h || '').replace(/\s+/g, '').toLowerCase(); }
  function mapHeader(row) {
    var m = {}, used = 0;
    row.forEach(function (h, i) {
      var n = norm(h);
      Object.keys(ALIAS).forEach(function (k) {
        if (m[k] != null) return;
        if (ALIAS[k].some(function (a) { return norm(a) === n; })) { m[k] = i; used++; }
      });
    });
    return used >= 3 ? m : null;
  }
  function templateFile() {
    ensureXlsx().then(function (ok) {
      if (!ok) { A().toast('엑셀 기능을 불러오지 못했습니다 (인터넷 확인)'); return; }
      var T = D();
      var wb = XLSX.utils.book_new();
      var ex = [HEAD,
        ['농어업과', '생산량', '양파', '다산 101 조사구', '101', '2', '3', '밭', '경상북도', '고령군', '다산면', '호촌리', '123', '4', '', '', '', '대문 왼쪽 창고'],
        ['농어업과', '재배면적', '', '대가야 7', '7', '', '', '논', '', '', '', '', '', '', '경북 고령군 대가야읍 지산리 188-1', '', '', ''],
        ['경제과', '물가', '', '고령시장 1', '', '', '', '응답자집', '', '', '', '', '', '', '', '35.72720', '128.26310', '']];
      var ws = XLSX.utils.aoa_to_sheet(ex);
      ws['!cols'] = HEAD.map(function (h) { return { wch: h === '주소' ? 34 : h === '조사구명' || h === '메모' ? 18 : 10 }; });
      XLSX.utils.book_append_sheet(wb, ws, '조사구');
      var guide = [['어디고 조사구 엑셀 양식 안내'], [''],
        ['· 한 줄 = 조사구 하나. 첫 줄(제목 줄)은 그대로 두세요. 예시 3줄은 지우고 쓰세요.'],
        ['· 위치: 위도·경도가 있으면 그대로 씁니다. 없으면 「주소」, 그것도 없으면 시도·시군구·읍면동·리·본지번·부지번으로 찾습니다.'],
        ['· 위치를 찾지 못한 줄은 올리지 않고 줄 번호를 알려 줍니다(임의 위치에 찍지 않음).'],
        ['· 업무분야·조사유형·작물이 비어 있으면 올릴 때 화면에서 고른 값으로 넣습니다.'],
        ['· 본지번 0359 / 부지번 0000 처럼 0이 붙어 있어도 됩니다(→ 359).'],
        ['· 텐아르 조사구 양식(번호·시도·시군구·읍면동·리·본지번·부지번·층·조사구·초입주소·위도·경도·비고·메모)도 그대로 올릴 수 있습니다.'], [''],
        ['업무분야', '조사유형 (쓸 수 있는 값)']].concat(T.DIVISIONS.map(function (d) { return [d.name, d.types.map(function (t) { return t.name; }).join(', ')]; }))
        .concat([[''], ['작물 (생산량)', T.CROPS.join(', ')], ['구분', T.KINDS.join(', ')]]);
      var wg = XLSX.utils.aoa_to_sheet(guide); wg['!cols'] = [{ wch: 18 }, { wch: 90 }];
      XLSX.utils.book_append_sheet(wb, wg, '안내');
      XLSX.writeFile(wb, '어디고_조사구_양식.xlsx');
      A().toast('엑셀 양식을 저장했습니다');
    });
  }
  function openExcel(o) {
    var T = D();
    o = o || {};
    if (!T.profile()) { A().toast('먼저 내 설정을 해 주세요'); return; }
    var body = A().openSheet('📥 엑셀로 조사구 올리기',
      '<p class="muted">엑셀(.xlsx·.xls·.csv) 한 줄이 조사구 하나입니다. 업무분야·조사유형·작물 칸이 비어 있으면 아래에서 고른 값으로 넣습니다.</p>' +
      scopeFields(o) +
      '<div class="row"><button class="btn" id="xTpl">📄 엑셀 양식 받기</button><label class="btn primary" style="flex:1;text-align:center">📂 엑셀 파일 고르기<input type="file" id="xFile" accept=".xlsx,.xls,.csv" hidden></label></div>' +
      '<p class="muted">텐아르 조사구 양식도 그대로 올릴 수 있습니다. 위도·경도가 없으면 주소·지번으로 위치를 찾습니다(배포 주소에서 동작).</p>');
    var get = bindScope(body, o, false);
    body.querySelector('#xTpl').addEventListener('click', templateFile);
    body.querySelector('#xFile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      var def = get();
      A().toast('엑셀을 읽는 중…');
      ensureXlsx().then(function (ok) {
        if (!ok) { A().toast('엑셀 기능을 불러오지 못했습니다 (인터넷 확인)'); return; }
        var rd = new FileReader();
        rd.onload = function () {
          var rows;
          try {
            var wb = XLSX.read(new Uint8Array(rd.result), { type: 'array' });
            rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
          } catch (er) { A().toast('엑셀 파일을 읽지 못했습니다'); return; }
          parseRows(rows, def);
        };
        rd.readAsArrayBuffer(f);
      });
    });
  }
  function cell(r, m, k) { return m[k] == null ? '' : String(r[m[k]] == null ? '' : r[m[k]]).trim(); }
  function stripNum(v) { v = String(v || '').trim(); return /^\d+$/.test(v) ? String(parseInt(v, 10)) : v; }
  function findDiv(v) {
    var T = D(), n = norm(v); if (!n) return null;
    for (var i = 0; i < T.DIVISIONS.length; i++) { var d = T.DIVISIONS[i]; if (norm(d.name) === n || norm(d.short) === n || norm(d.name).indexOf(n) === 0) return d; }
    return null;
  }
  function findType(d, v) { var n = norm(v); if (!d || !n) return null; for (var i = 0; i < d.types.length; i++) if (norm(d.types[i].name) === n) return d.types[i]; return null; }
  function parseRows(rows, def) {
    var T = D(), hi = -1, m = null;
    for (var i = 0; i < Math.min(rows.length, 8); i++) { m = mapHeader(rows[i] || []); if (m) { hi = i; break; } }
    if (!m) { A().toast('제목 줄(시도·주소·위도 등)을 찾지 못했습니다. 엑셀 양식을 받아 써 주세요.'); return; }
    var data = rows.slice(hi + 1).filter(function (r) { return r && r.some(function (c) { return String(c).trim() !== ''; }); });
    if (data.length > MAX_ROWS) { A().toast('한 번에 ' + MAX_ROWS + '줄까지 올릴 수 있습니다 (지금 ' + data.length + '줄)'); return; }
    var items = data.map(function (r, idx) {
      var dv = findDiv(cell(r, m, 'division')) || T.divOf(def.div);
      var tp = findType(dv, cell(r, m, 'type')) || (dv.id === def.div ? T.typeOf(dv.id, def.type) : null) || dv.types[0];
      var crop = cell(r, m, 'crop');
      if (tp.crops) { if (T.CROPS.indexOf(crop) < 0) crop = dv.id === def.div && tp.id === def.type ? def.crop : null; } else crop = null;
      var lat = parseFloat(cell(r, m, 'lat')), lng = parseFloat(cell(r, m, 'lng'));
      var okLL = isFinite(lat) && isFinite(lng) && lat > 32 && lat < 39.5 && lng > 124 && lng < 132;
      var sido = cell(r, m, 'sido'), sgg = cell(r, m, 'sigungu'), emd = cell(r, m, 'emd'), ri = cell(r, m, 'ri');
      var bon = stripNum(cell(r, m, 'bon')), bu = stripNum(cell(r, m, 'bu'));
      var jibun = bon && bon !== '0' ? bon + (bu && bu !== '0' ? '-' + bu : '') : '';
      var addr = cell(r, m, 'addr') || [sido, sgg, emd, ri, jibun].filter(Boolean).join(' ');
      var no = stripNum(cell(r, m, 'josaguNo'));
      var name = cell(r, m, 'name') || [tp.name, no ? no : '', !no ? addr.split(' ').slice(-2).join(' ') : ''].filter(Boolean).join(' ');
      var kind = cell(r, m, 'kind');
      var memo = [cell(r, m, 'memo'), cell(r, m, 'note')].filter(Boolean).join(' / ');
      return { row: hi + idx + 2, division: dv.id, type: tp.id, crop: crop, name: name, josaguNo: no, floor: stripNum(cell(r, m, 'floor')), card: stripNum(cell(r, m, 'card')),
        kind: T.KINDS.indexOf(kind) >= 0 ? kind : (kind ? '기타' : ''), addr: addr, memo: memo,
        lat: okLL ? lat : null, lng: okLL ? lng : null,
        region: sido && sgg && emd ? { basis: 'file', sido: sido, sigungu: sgg, emd: emd, ri: ri, status: 'ok', at: new Date().toISOString() } : null,
        hasAddr: !!(cell(r, m, 'addr') || (emd && jibun) || (sgg && emd)) };
    });
    previewExcel(items);
  }
  function isDup(it) {
    return D().sites().some(function (s) {
      if (s.division !== it.division || s.type !== it.type || (s.crop || null) !== (it.crop || null)) return false;
      if (it.josaguNo && s.josaguNo === it.josaguNo && s.name === it.name) return true;
      return it.lat != null && Math.abs(s.lat - it.lat) < 1e-5 && Math.abs(s.lng - it.lng) < 1e-5 && s.name === it.name;
    });
  }
  function previewExcel(items) {
    var T = D();
    var withLL = items.filter(function (x) { return x.lat != null; }), need = items.filter(function (x) { return x.lat == null && x.hasAddr; }), bad = items.filter(function (x) { return x.lat == null && !x.hasAddr; });
    var dup = items.filter(isDup);
    var by = {};
    items.forEach(function (x) { var k = scopeTitle({ div: x.division, type: x.type, crop: x.crop }); by[k] = (by[k] || 0) + 1; });
    var body = A().openSheet('엑셀 미리보기 (' + items.length + '줄)',
      '<table class="kv"><tr><th>위도·경도 있음</th><td>' + withLL.length + '줄</td></tr><tr><th>주소로 위치 찾기</th><td>' + need.length + '줄</td></tr>' +
      '<tr><th>위치 정보 없음(제외)</th><td>' + bad.length + '줄' + (bad.length ? ' <small>(' + bad.slice(0, 8).map(function (x) { return x.row + '행'; }).join(', ') + (bad.length > 8 ? '…' : '') + ')</small>' : '') + '</td></tr>' +
      '<tr><th>이미 있는 조사구(건너뜀)</th><td>' + dup.length + '줄</td></tr></table>' +
      '<label class="fld">업무별</label><div class="x-by">' + Object.keys(by).map(function (k) { return '<span>' + esc(k) + ' <b>' + by[k] + '</b></span>'; }).join('') + '</div>' +
      '<label class="fld">처음 5줄</label>' + items.slice(0, 5).map(function (x) { return '<div class="x-row"><b>' + esc(x.name) + '</b> <small>' + esc([x.josaguNo ? '조사구 ' + x.josaguNo : '', x.addr || (x.lat != null ? x.lat.toFixed(5) + ', ' + x.lng.toFixed(5) : '')].filter(Boolean).join(' · ')) + '</small></div>'; }).join('') +
      '<div class="x-prog" id="xProg" hidden><div><span id="xBar"></span></div><small id="xMsg"></small></div>' +
      '<div class="row"><button class="btn primary" id="xGo" style="flex:1">' + (need.length ? '위치 찾고 ' : '') + '올리기</button><button class="btn" id="xNo">취소</button></div>');
    body.querySelector('#xNo').addEventListener('click', function () { A().closeSheet(); A().toast('취소했습니다'); });
    body.querySelector('#xGo').addEventListener('click', function () {
      var go = body.querySelector('#xGo'); go.disabled = true; body.querySelector('#xNo').disabled = true;
      var todo = items.filter(function (x) { return !isDup(x) && (x.lat != null || x.hasAddr); });
      geocodeAll(todo, body).then(function (res) {
        var ok = res.filter(function (x) { return x.lat != null; }), fail = res.filter(function (x) { return x.lat == null; });
        T.addMany(ok);
        var msg = ok.length + '곳을 올렸습니다' + (fail.length ? ' · 위치 못 찾음 ' + fail.length + '줄' : '');
        if (fail.length) {
          var b2 = A().openSheet('엑셀 올리기 결과', '<p><b>' + esc(msg) + '</b></p><p class="muted">아래 줄은 주소로 위치를 찾지 못해 올리지 않았습니다. 엑셀에 위도·경도나 정확한 주소를 넣어 다시 올려 주세요.</p>' +
            fail.map(function (x) { return '<div class="x-row"><b>' + x.row + '행</b> ' + esc(x.name) + ' <small>' + esc(x.addr) + '</small></div>'; }).join('') +
            '<div class="row"><button class="btn" id="xCopyFail">실패 목록 복사</button><button class="btn primary" id="xDone" style="flex:1">확인</button></div>');
          b2.querySelector('#xCopyFail').addEventListener('click', function () { copy(fail.map(function (x) { return x.row + '행\t' + x.name + '\t' + x.addr; }).join('\n')); A().toast('복사했습니다'); });
          b2.querySelector('#xDone').addEventListener('click', function () { A().closeSheet(); });
        } else { A().closeSheet(); }
        A().toast(msg);
        if (ok.length) A().fitSites(ok);
      });
    });
  }
  /* 주소 → 위치 (카카오 주소 검색, 차례로 · 초당 약 8건) */
  function geocodeAll(list, body) {
    var need = list.filter(function (x) { return x.lat == null; });
    if (!need.length) return Promise.resolve(list);
    var prog = body.querySelector('#xProg'), bar = body.querySelector('#xBar'), msg = body.querySelector('#xMsg');
    prog.hidden = false;
    return A().ensureKakao().then(function (ok) {
      if (!ok) { msg.textContent = '카카오 주소 검색에 연결하지 못해 주소로 위치를 찾지 못했습니다'; return list; }
      var gc = new kakao.maps.services.Geocoder(), i = 0;
      return new Promise(function (done) {
        (function next() {
          if (i >= need.length) { done(list); return; }
          var x = need[i++];
          bar.style.width = Math.round(i / need.length * 100) + '%';
          msg.textContent = '위치 찾는 중 ' + i + ' / ' + need.length;
          gc.addressSearch(x.addr, function (r, st) {
            if (st === kakao.maps.services.Status.OK && r[0]) { x.lat = +r[0].y; x.lng = +r[0].x; if (!x.addr) x.addr = r[0].address_name; }
            setTimeout(next, 120);
          });
        })();
      });
    });
  }


  /* ───────── 텐아르 핀 가져오기 (같은 휴대폰·같은 브라우저) ─────────
     텐아르(/home)와 어디고(/odigo)는 같은 사이트 주소라 브라우저 저장소를 함께 씀.
     텐아르는 자료를 기기키(__tenar_secure_device_key_v1)로 AES-GCM 암호화해 두므로 그 키로 풀어 읽기만 함(텐아르 자료는 바꾸지 않음).
     전화번호·담당자 연락처는 가져오지 않음. */
  var TENAR_KEY = '__tenar_secure_device_key_v1';
  var TENAR_TYPES = [
    { store: 'tenarAreaSurveyPlotsEncrypted', label: '작물재배 조사구', type: 'area' },
    { store: 'tenarAreaPlots_livestock_enc', label: '가축', type: 'livestock', kindLabel: '축종' },
    { store: 'tenarAreaPlots_livecost_enc', label: '축비', type: 'livecost', kindLabel: '축종' },
    { store: 'tenarAreaPlots_farmcost_enc', label: '농비', type: 'farmcost', kindLabel: '지목' },
    { store: 'tenarAreaPlots_riceprice_enc', label: '쌀값', type: 'rice' },
    { store: 'tenarAreaPlots_farmsale_enc', label: '농판', type: 'farmsale' },
    { store: 'tenarAreaPlots_etc_enc', label: '기타조사', type: 'etc' },
    { store: 'tenar_map_favs_v1', label: '생산량 핀(즐겨찾기)', type: 'prod', fav: true }
  ];
  function b64u8(b) { var bin = atob(b), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  var tkeyP = null;
  function tenarKey() {
    if (tkeyP) return tkeyP;
    var raw = null; try { raw = localStorage.getItem(TENAR_KEY); } catch (e) {}
    tkeyP = raw ? crypto.subtle.importKey('raw', b64u8(raw), { name: 'AES-GCM' }, false, ['decrypt']).catch(function () { return null; }) : Promise.resolve(null);
    return tkeyP;
  }
  function readTenar(store) {
    var raw = null; try { raw = localStorage.getItem(store); } catch (e) {}
    if (!raw) return Promise.resolve(null);
    var o; try { o = JSON.parse(raw); } catch (e) { return Promise.resolve(null); }
    if (Array.isArray(o)) return Promise.resolve(o);   /* 암호화 전(평문) 자료 */
    if (!o || o.tenarSecure !== true || o.secureType !== 'device-cache') return Promise.resolve(null);
    return tenarKey().then(function (k) {
      if (!k) return { err: 'nokey' };
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64u8(o.iv) }, k, b64u8(o.ciphertext)).then(function (pt) {
        var a = JSON.parse(new TextDecoder().decode(pt)); return Array.isArray(a) ? a : null;
      }, function () { return { err: 'decrypt' }; });
    });
  }
  /* 텐아르 시각("2026-10-12 00:02" 등)을 비교 가능한 형태로 — 어디고에서 고친 뒤면 어디고 쪽이 남음 */
  function tTime(t) { t = String(t || '').trim(); return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.replace(' ', 'T') : ''; }
  function okLL(la, lo) { return isFinite(la) && isFinite(lo) && la > 32 && la < 40 && lo > 124 && lo < 132; }
  function tenarToSite(cfg, r) {
    var T = D(), now = new Date().toISOString();
    var la = Number(r.latitude != null ? r.latitude : r.lat), lo = Number(r.longitude != null ? r.longitude : r.lng);
    if (!okLL(la, lo)) return null;
    var base = { id: 'tenar:' + cfg.type + ':' + (r.id || (la.toFixed(6) + ',' + lo.toFixed(6))), lat: la, lng: lo, division: 'agri', type: cfg.type,
      createdAt: tTime(r.createdAt) || now, updatedAt: tTime(r.updatedAt) || tTime(r.createdAt) || '2000-01-01T00:00', source: 'tenar' };
    if (cfg.fav) {
      var crop = String(r.crop || '').trim();
      return Object.assign(base, { name: r.name || r.label || r.jibunAddress || '생산량 핀', addr: r.jibunAddress || r.addr || r.roadAddress || '', memo: r.memo || '',
        crop: T.CROPS.indexOf(crop) >= 0 ? crop : null, josaguNo: '', floor: '', card: '', kind: '', region: null });
    }
    var no = String(r.josagu || '').replace(/^0+(?=\d)/, ''), fl = String(r.floor || '').replace(/^0+(?=\d)/, '');
    var kind = String(r.kind || '').trim(), memoParts = [];
    var kindOk = T.KINDS.indexOf(kind) >= 0;
    if (kind && !kindOk) memoParts.push((cfg.kindLabel || '구분') + ' ' + kind);
    if (r.farmName) memoParts.push('농장 ' + r.farmName);
    if (r.note) memoParts.push(r.note);
    if (r.memo) memoParts.push(r.memo);
    var name = cfg.type === 'area' ? ['작물재배', no ? no + '조사구' : '', r.number ? '#' + r.number : ''].filter(Boolean).join(' ') : (r.name || cfg.label + (r.number ? ' ' + r.number : ''));
    return Object.assign(base, { name: name, addr: r.address1 || '', memo: memoParts.join(' / '), crop: null, josaguNo: no, floor: fl, card: '', kind: kindOk ? kind : '',
      region: r.sido && r.sigungu && r.eupmyeondong ? { basis: 'tenar', sido: r.sido, sigungu: r.sigungu, emd: r.eupmyeondong, ri: '', status: 'ok', at: now } : null });
  }
  function openTenarImport() {
    var T = D();
    if (!T.profile()) { A().toast('먼저 내 설정을 해 주세요'); return; }
    var body = A().openSheet('📍 텐아르 핀 가져오기', '<p class="muted">이 휴대폰(이 브라우저)에 저장된 텐아르 자료를 찾는 중…</p>');
    Promise.all(TENAR_TYPES.map(function (c) { return readTenar(c.store); })).then(function (res) {
      var found = [], lockErr = false;
      res.forEach(function (a, i) {
        if (a && a.err) { lockErr = true; return; }
        if (!a || !a.length) return;
        var sites = a.map(function (r) { return tenarToSite(TENAR_TYPES[i], r); }).filter(Boolean);
        found.push({ cfg: TENAR_TYPES[i], total: a.length, sites: sites });
      });
      if (!found.length) {
        body.innerHTML = '<p>이 브라우저에서 텐아르 핀을 찾지 못했습니다.</p>' +
          (lockErr ? '<p class="warn">텐아르 자료는 있는데 열쇠로 열리지 않았습니다. 텐아르를 한 번 열었다 닫은 뒤 다시 시도해 주세요.</p>' : '') +
          '<p class="muted">텐아르를 쓰는 <b>같은 휴대폰·같은 브라우저</b>(예: 둘 다 Safari)에서 어디고를 열어야 보입니다. 다른 기기라면 텐아르 조사구를 엑셀로 내보내 「📥 엑셀로 조사구 올리기」로 올려 주세요.</p>';
        return;
      }
      var have = {}; T.sites().forEach(function (s) { have[s.id] = 1; });
      body.innerHTML = '<p class="muted">텐아르 자료는 읽기만 하고 바꾸지 않습니다. 전화번호·담당자 연락처는 가져오지 않습니다. 모두 <b>농어업과</b>의 해당 업무로 들어갑니다.</p>' +
        found.map(function (f, i) {
          var t = T.typeOf('agri', f.cfg.type), nw = f.sites.filter(function (s) { return !have[s.id]; }).length;
          return '<label class="un-row"><input type="checkbox" data-i="' + i + '" checked><span><b>' + esc(f.cfg.label) + ' → ' + esc(t ? t.name : '') + '</b><small>' + f.sites.length + '곳' +
            (f.total > f.sites.length ? ' (위치 없는 ' + (f.total - f.sites.length) + '곳 제외)' : '') + ' · 처음 가져옴 ' + nw + '곳</small></span></label>';
        }).join('') +
        '<div class="row"><button class="btn primary full" id="tnGo">가져오기 미리보기</button></div>' +
        '<p class="muted">다시 가져와도 같은 핀은 겹치지 않습니다. 텐아르와 어디고 중 더 나중에 고친 쪽 내용이 남습니다.</p>';
      body.querySelector('#tnGo').addEventListener('click', function () {
        var sites = [];
        body.querySelectorAll('[data-i]:checked').forEach(function (c) { sites = sites.concat(found[+c.getAttribute('data-i')].sites); });
        if (!sites.length) { A().toast('가져올 항목을 골라 주세요'); return; }
        A().previewMerge({ sites: sites, visits: [] }, { title: '텐아르 핀 → 농어업과', from: '텐아르(이 기기)', sites: sites.length });
      });
    });
  }

  window.OdigoFiles = { openExport: openExport, openExcel: openExcel, template: templateFile, openTenarImport: openTenarImport };
})();
