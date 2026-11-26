/* 어디고 v5.1 — 조사표 (핀 → 조사기간 → 조사표 열기·작성·임시저장·완료)
   · 저장: OdigoStore.surveyPut (IndexedDB odigo_db › surveys, 기록별 암호화). id = 핀|업무|기간 → 같은 기간은 언제나 한 건
   · 상태: 미작성(기록 없음) / 작성 중(draft) / 완료(done). 방문 기록의 「완료」와 따로 표시
   · 양식 정의(FORMS)와 입력값을 분리하고, 기록마다 formId·formVer 를 저장 → 양식이 바뀌어도 예전 기록은 그때 양식으로 열림
   · 운영 일정(SCHEDULE): 가축동향 3·9월(어디고 운영 기준, 2026-11 요청서), 축비·농비·농가경제 매월, 생산량 연 1회(작물별 월 추후), 그 밖 미확정
   · v5.1 양식: 2026년 가축동향조사표 3종(돼지 표본·닭 전수·오리 전수) — 원문: 0.pdf센터/R2_업로드_가축동향.zip › gachuk/2026/2026_livestock_trend_form.pdf
     항목 이름·합계 규칙은 두당 gachuk.html(v116) 설정과 같은 키를 씀(나중에 두당 자료 가져오기 1:1)
     축비(일계부·원부)·생산량(청취·실측)·농비는 다음 단계, 농가경제는 양식 미확보 → 「양식 준비 중」 표시
   · 저장하지 않고 닫으면 입력은 drafts 에 암호화 보관 → 다시 열면 이어서 */
(function () {
  'use strict';
  function A() { return window.OdigoApp; }
  function S() { return window.OdigoStore; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ym(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  /* ───────── 운영 일정 ───────── */
  var SCHEDULE = {
    'agri/livestock': { kind: 'month', months: [3, 9], note: '3월·9월 (어디고 운영 기준). 양식에는 3·6·9·12월 칸이 있음' },
    'agri/livecost': { kind: 'month', months: 'all', note: '매월' },
    'agri/farmcost': { kind: 'month', months: 'all', note: '매월' },
    'agri/farmecon': { kind: 'month', months: 'all', note: '매월' },
    'agri/prod': { kind: 'year', note: '작물별 지정 월에 연 1회 (작물별 조사월 미설정)' }
  };
  /* 업무별 연결 양식 (없으면 「양식 준비 중」) */
  var TASK_FORM = { 'agri/livestock': 'gachuk' };
  var PENDING_NOTE = {
    'agri/livecost': '축산물생산비 일계부·원부 — 다음 단계에서 연결 (2024년 양식 확인됨)',
    'agri/farmcost': '농작물생산비 — 축비 다음 순서로 연결 (2024년 양식 확인됨)',
    'agri/farmecon': '농가경제 — 양식 미확보. 조사월·저장 구조만 준비',
    'agri/prod': '생산량 청취·실측 — 다음 단계에서 연결 (2025년 양식 확인됨)'
  };
  function taskOf(s) { return s && s.division && s.type ? s.division + '/' + s.type : null; }
  function schedOf(task) {
    var p = A().getProfile && A().getProfile(), o = p && p.schedules && p.schedules[task];
    return o || SCHEDULE[task] || null;
  }
  function monthsOf(sc) { return sc.months === 'all' ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : (sc.months || []); }
  /* 기본 기간: 월별 = 지금 달이 조사월이면 그 달, 아니면 지난 가장 가까운 조사월(보완용) / 연간 = 올해 */
  function defaultPeriod(sc) {
    var d = new Date(), y = d.getFullYear(), m = d.getMonth() + 1;
    if (sc.kind === 'year') return String(y);
    var ms = monthsOf(sc); if (!ms.length) return null;
    var cy = y, cm = m;
    for (var i = 0; i < 24; i++) { if (ms.indexOf(cm) >= 0) return cy + '-' + pad(cm); cm--; if (!cm) { cm = 12; cy--; } }
    return null;
  }
  function nextPeriod(sc) {
    var d = new Date(), cy = d.getFullYear(), cm = d.getMonth() + 2; if (cm > 12) { cm = 1; cy++; }
    var ms = monthsOf(sc);
    for (var i = 0; i < 24; i++) { if (ms.indexOf(cm) >= 0) return cy + '-' + pad(cm); cm++; if (cm > 12) { cm = 1; cy++; } }
    return null;
  }
  function periodLabel(p) { return /^\d{4}$/.test(p) ? p + '년' : p.slice(0, 4) + '년 ' + (+p.slice(5)) + '월'; }
  /* 기간 고르기 목록: 이 핀의 기존 기록 + 올해·작년 조사월 */
  function periodOptions(sc, have) {
    var o = {}, y = new Date().getFullYear();
    (have || []).forEach(function (m) { o[m.period] = 1; });
    if (sc.kind === 'year') { o[String(y)] = 1; o[String(y - 1)] = 1; }
    else monthsOf(sc).forEach(function (m) { o[y + '-' + pad(m)] = 1; o[(y - 1) + '-' + pad(m)] = 1; });
    return Object.keys(o).sort().reverse();
  }
  var STATUS = { none: ['미작성', '#868e96'], draft: ['작성 중', '#e67700'], done: ['완료', '#2b8a3e'] };
  function chip(st) { var x = STATUS[st] || STATUS.none; return '<span class="sv-st" style="--c:' + x[1] + '">' + x[0] + '</span>'; }

  /* ───────── 양식: 2026년 가축동향조사표 ───────── */
  var METHOD = [['01', '면접(01)'], ['03', '전화(03)'], ['04', 'E-mail(04)'], ['05', 'FAX(05)'], ['06', '기타(06)'], ['07', 'SASI(07)']];
  var CHANGE_PIG = [['01', '유축(01)'], ['05', '휴업(05)'], ['06', '전출(06)'], ['07', '폐업(07)'], ['08', '기타(08)'], ['09', '합산조사(09)']];
  var CHANGE_FOWL = [['03', '전수(03)'], ['04', '규모(04)'], ['05', '휴업(05)'], ['06', '전출(06)'], ['07', '폐업(07)'], ['08', '기타(08)']];
  var BREEDUSE = [['01', '육용종계(01)'], ['02', '육용원종계(02)'], ['03', '산란종계(03)'], ['04', '산란원종계(04)'], ['05', '토종닭종계(05)'], ['06', '토종닭원종계(06)']];
  /* 변동사항이 이것이면 마릿수 칸은 비어 있어도 완료 가능 */
  var NOHEAD = { '05': 1, '06': 1, '07': 1 };
  var GACHUK = {
    id: 'gachuk', ver: '2026', title: '2026년 가축동향조사표',
    source: '2026_livestock_trend_form.pdf (통계청 승인번호 제920019호) · 조사시점 = 조사월 1일 00시',
    species: {
      pig: { label: '돼지 (표본)', unit: '두', change: CHANGE_PIG,
        tables: [
          { id: 'head', title: '사육마릿수 (월령·성별)', total: true,
            cols: [['u2', '2개월 미만 (포유+이유자돈)', 1], ['g24', '2~4개월 미만 (육성돈)', 1], ['b46', '4~6개월 미만 (비육돈)', 1], ['m68', '6~8개월 미만 수컷', 1], ['f68', '6~8개월 미만 암컷', 1],
              ['cand', '그 중 모돈용 (후보돈) — 6~8개월 암컷 중, 합계 제외', 0], ['boar', '8개월 이상 수컷 (종돈)', 1], ['sow', '8개월 이상 암컷 (모돈)', 1]],
            note: '합계 = 2개월미만 + 2~4 + 4~6 + 6~8(수+암) + 8개월 이상(수+암). 「그 중 모돈용」은 6~8개월 암컷의 일부라 합계에 더하지 않음' },
          { id: 'prod', title: '과거 3개월간 생산·폐사 / 분만·임신 모돈',
            cols: [['prod', '생산 (과거 3개월 태어난 새끼)', 0], ['dead', '폐사 (과거 3개월)', 0], ['farrow', '분만한 모돈 (과거 3개월)', 0], ['preg1', '임신한 모돈 — 1개월 전', 0], ['preg2', '임신한 모돈 — 2개월 전', 0], ['preg3', '임신한 모돈 — 3개월 전', 0]],
            auto: [['pregTot', '임신한 모돈 계', ['preg1', 'preg2', 'preg3']]],
            note: '과거 3개월: 3월 조사 = 전년 12·1·2월, 6월 = 3·4·5월, 9월 = 6·7·8월, 12월 = 9·10·11월. 낳자마자 죽은 것은 생산에 포함, 죽어서 나온 새끼는 제외' }
        ] },
      chicken: { label: '닭 (전수)', unit: '수', change: CHANGE_FOWL, base: [['breedUse', '종계 용도', BREEDUSE]],
        tables: [
          { id: 'head', title: '사육마릿수', total: true,
            cols: [['c1u', '육계 1개월(30일) 미만', 1], ['c1o', '육계 1개월 이상', 1], ['s1u', '삼계 1개월 미만', 1], ['s1o', '삼계 1개월 이상', 1], ['t70u', '토종닭 70일 미만', 1], ['t70o', '토종닭 70일 이상', 1],
              ['l3u', '산란계 3개월(12주령) 미만', 1], ['l36', '산란계 3~6개월 미만', 1], ['l6o', '산란계 6개월(24주령) 이상', 1],
              ['eggProd', '1일 평균 식용 계란 생산량 (개) — 합계 제외', 0], ['eggRate', '계란 생산가담율 (%) — 합계 제외', 0, 'pct']],
            note: '합계 = 종계 + 산란계 + 육용계(육계·삼계·토종닭). 산란계·육계를 함께 키우면 많은 쪽만 조사. 가담율 = 3~6개월 중 산란한 마리 ÷ 3~6개월 전체 × 100' },
          { id: 'breed', title: '종계 (암♀ / 수♂)',
            cols: [['bf3u', '종계 암컷 3개월 미만', 1], ['bf36', '종계 암컷 3~6개월 미만', 1], ['bf6o', '종계 암컷 6개월 이상', 1], ['bm3u', '종계 수컷 3개월 미만', 1], ['bm36', '종계 수컷 3~6개월 미만', 1], ['bm6o', '종계 수컷 6개월 이상', 1]],
            note: '종계 마릿수는 합계에 포함. 종계 용도는 위에서 고름' }
        ] },
      duck: { label: '오리 (전수)', unit: '수', change: CHANGE_FOWL,
        tables: [
          { id: 'head', title: '사육마릿수', total: true,
            cols: [['dm45u', '육용오리 45일 미만', 1], ['dm45o', '육용오리 45일 이상', 1], ['db6u', '종오리 6개월(24주령) 미만', 1], ['db6o', '종오리 6개월 이상', 1]],
            note: '합계 = 육용오리 + 종오리. 함께 키우면 많은 쪽만 조사. 6개월 미만이라도 산란율 50% 이상이면 6개월 이상에 기입' }
        ] }
    }
  };
  var FORMS = { 'gachuk@2026': GACHUK };
  function formFor(task, period) { var id = TASK_FORM[task]; if (!id) return null; return FORMS[id + '@2026'] || null; }   /* 연도별 양식이 생기면 period 로 고름 */
  function formOf(formId, ver) { return FORMS[formId + '@' + ver] || null; }

  /* 축종 추정: 핀의 「축종」 칸에 돼지·닭·오리가 있으면 그것, 없으면 고르게 함 */
  function guessSpecies(s) {
    var t = (s.species || '') + ' ' + (s.kind || '');
    if (/돼지|돈/.test(t)) return 'pig';
    if (/오리/.test(t)) return 'duck';
    if (/닭|산란|육계|계/.test(t)) return 'chicken';
    return '';
  }

  /* ───────── 핀 카드의 「📋 조사표」 상자 ───────── */
  var cardSel = {};   /* 핀별로 마지막에 고른 기간 */
  function mountCard(el, s) {
    if (!el) return;
    var task = taskOf(s), sc = task && schedOf(task);
    if (!task || !sc) { el.innerHTML = task ? '<div class="sv-box"><b>📋 조사표</b> <small class="muted">이 업무는 조사 일정이 아직 정해지지 않았습니다. 방문 기록으로 관리하세요.</small></div>' : ''; return; }
    var form = formFor(task);
    if (!S() || !S().surveyList) { el.innerHTML = ''; return; }
    S().surveyList(s.id).then(function (list) { draw(list); }, function (e) {
      el.innerHTML = '<div class="sv-box"><b>📋 조사표</b> <small class="muted">' + (e && e.code === 'nosurvey' ? '저장소가 예전 방식이라 조사표를 쓸 수 없습니다 (ⓘ 확인)' : '조사표 목록을 읽지 못했습니다') + '</small></div>';
    });
    function draw(list) {
      list = list.filter(function (m) { return m.task === task; });
      var by = {}; list.forEach(function (m) { by[m.period] = m; });
      var per = cardSel[s.id] || defaultPeriod(sc) || (list[0] && list[0].period);
      var opts = periodOptions(sc, list);
      if (per && opts.indexOf(per) < 0) opts.unshift(per);
      var nx = sc.kind === 'month' ? nextPeriod(sc) : null;
      var cur = per && by[per];
      el.innerHTML = '<div class="sv-box">' +
        '<div class="sv-head"><b>📋 조사표</b> <small class="muted">' + esc(sc.note || '') + '</small></div>' +
        '<div class="sv-row"><select class="inp sm" id="svPer">' + opts.map(function (p) { return '<option value="' + p + '"' + (p === per ? ' selected' : '') + '>' + periodLabel(p) + (by[p] ? ' · ' + STATUS[by[p].status][0] : '') + '</option>'; }).join('') + '</select>' +
        chip(cur ? cur.status : 'none') + '</div>' +
        (form ? '<div class="row" style="margin:6px 0 0"><button class="btn primary full" id="svOpen">📋 조사표 ' + (cur ? '열기' : '작성 시작') + ' · ' + esc(per ? periodLabel(per) : '') + '</button></div>'
          : '<p class="muted" style="margin:6px 0 0">' + esc(PENDING_NOTE[task] || '양식 준비 중') + '</p>') +
        (list.length ? '<div class="sv-hist">' + list.sort(function (a, b) { return a.period < b.period ? 1 : -1; }).map(function (m) { return '<button type="button" class="sv-h" data-p="' + m.period + '">' + periodLabel(m.period) + ' ' + chip(m.status) + '</button>'; }).join('') + '</div>' : '') +
        (nx ? '<small class="muted">다음 조사월: ' + periodLabel(nx) + '</small>' : '') +
        '</div>';
      var ps = el.querySelector('#svPer');
      ps.addEventListener('change', function () { cardSel[s.id] = ps.value; draw(list); });
      el.querySelectorAll('[data-p]').forEach(function (b) { b.addEventListener('click', function () { cardSel[s.id] = b.getAttribute('data-p'); if (form) openEditor(s, task, cardSel[s.id]); else draw(list); }); });
      var ob = el.querySelector('#svOpen'); if (ob) ob.addEventListener('click', function () { openEditor(s, task, ps.value); });
    }
  }

  /* ───────── 조사표 화면 ───────── */
  function num(v) { if (v === '' || v == null) return null; var n = Number(String(v).replace(/,/g, '')); return isFinite(n) ? n : NaN; }
  function openEditor(s, task, period) {
    var id = S().surveyId(s.id, task, period);
    Promise.all([S().surveyGet(id), S().draftGet(id)]).then(function (r) {
      var have = r[0], dr = r[1];
      var form = have ? formOf(have.meta.formId, have.meta.formVer) : formFor(task, period);
      if (!form) { A().toast('이 기록의 양식(' + (have ? have.meta.formId + ' ' + have.meta.formVer : '') + ')을 찾지 못했습니다'); return; }
      var body = have ? JSON.parse(JSON.stringify(have.body)) : blank(form, s, period);
      var rev = have ? have.meta.rev : 0, status = have ? have.meta.status : 'none';
      if (dr && dr.at > (have ? have.meta.at : 0) && confirm('저장하지 않고 닫은 입력이 있습니다 (' + new Date(dr.at).toLocaleString('ko-KR') + '). 이어서 쓸까요?\n[취소] = 저장된 내용으로 열기')) body = dr.body;
      render(s, task, period, form, body, rev, status);
    }, function (e) { A().toast(e && e.code === 'nosurvey' ? '저장소가 예전 방식이라 조사표를 쓸 수 없습니다' : '조사표를 열지 못했습니다'); });
  }
  function blank(form, s, period) {
    return { species: guessSpecies(s), base: { farmName: s.farmName || (s.name && s.name !== '없음' ? s.name : '') }, row: {}, method: '', change: '', note: '', surveyDate: '', period: period };
  }
  function render(s, task, period, form, body, rev, status) {
    var dirty = false, id = S().surveyId(s.id, task, period);
    var html = '<div class="sv-ed">' +
      '<div class="sv-top"><b>' + esc(form.title) + '</b> · ' + esc(periodLabel(period)) + ' ' + chip(status) +
      '<div class="muted sm">' + esc(A().dispName(s)) + ' · ' + esc(s.addr || '') + '</div>' +
      '<div class="muted sm">조사 대상 기간: ' + esc(periodLabel(period)) + ' 1일 00시 기준 · 양식 ' + esc(form.id + ' ' + form.ver) + '</div></div>' +
      '<label class="fld">축종 (양식)</label><div class="sv-seg">' + Object.keys(form.species).map(function (k) { return '<label><input type="radio" name="svSp" value="' + k + '"' + (body.species === k ? ' checked' : '') + '> ' + esc(form.species[k].label) + '</label>'; }).join('') + '</div>' +
      '<div id="svBody"></div>' +
      '<div class="sv-bar"><button class="btn" id="svTmp">임시저장</button><button class="btn primary" id="svDone">완료 저장</button><button class="btn cancel" id="svClose">닫기</button></div>' +
      '<div id="svMsg" class="sv-msg"></div></div>';
    var root = A().openSheet('📋 ' + periodLabel(period) + ' 조사표', html, { view: 'sv:' + id });
    var box = root.querySelector('#svBody');
    function sp() { return form.species[body.species]; }
    function drawBody() {
      var c = sp();
      if (!c) { box.innerHTML = '<p class="muted">축종을 먼저 고르세요.</p>'; return; }
      var h = '';
      (c.base || []).forEach(function (b) { h += '<label class="fld">' + esc(b[1]) + '</label><select class="inp" data-base="' + b[0] + '"><option value="">선택</option>' + b[2].map(function (o) { return '<option value="' + o[0] + '"' + ((body.base || {})[b[0]] === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>'; });
      h += '<div class="sv-2"><div><label class="fld">조사방법 *</label><select class="inp" id="svMethod"><option value="">선택</option>' + METHOD.map(function (o) { return '<option value="' + o[0] + '"' + (body.method === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
        '<div><label class="fld">변동사항</label><select class="inp" id="svChange"><option value="">없음</option>' + c.change.map(function (o) { return '<option value="' + o[0] + '"' + (body.change === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div></div>' +
        '<div class="sv-2"><div><label class="fld">실제 조사일</label><input class="inp" type="date" id="svDate" value="' + esc(body.surveyDate || '') + '"></div><div><label class="fld">농장명</label><input class="inp" id="svFarm" value="' + esc((body.base || {}).farmName || '') + '"></div></div>';
      c.tables.forEach(function (t) {
        h += '<div class="sv-t"><div class="sv-tt">' + esc(t.title) + ' <small>(' + c.unit + ')</small></div>';
        if (t.total) h += '<div class="sv-f tot"><span>합계 (자동)</span><b id="svTot_' + t.id + '"></b></div>';
        t.cols.forEach(function (col) {
          var v = (body.row || {})[col[0]];
          h += '<div class="sv-f"><span>' + esc(col[1]) + '</span><input class="inp sm" inputmode="' + (col[3] === 'pct' ? 'decimal' : 'numeric') + '" data-k="' + col[0] + '" value="' + (v == null ? '' : esc(v)) + '" placeholder="빈칸"></div>';
        });
        (t.auto || []).forEach(function (a) { h += '<div class="sv-f tot"><span>' + esc(a[1]) + ' (자동)</span><b id="svAuto_' + a[0] + '"></b></div>'; });
        h += '<p class="muted sm">' + esc(t.note) + '</p></div>';
      });
      h += '<label class="fld">비고 <small class="muted">(변동사항 기타(08)는 구체적으로)</small></label><textarea class="inp" id="svNote" rows="2">' + esc(body.note || '') + '</textarea>' +
        '<p class="muted sm">빈칸 = 응답 없음, 0 = 0마리. 완료 저장 때 숫자·필수값을 확인합니다. 원문: ' + esc(form.source) + '</p>';
      box.innerHTML = h;
      recalc();
      box.querySelectorAll('[data-k]').forEach(function (i) { i.addEventListener('input', function () { body.row = body.row || {}; var v = i.value.trim(); body.row[i.getAttribute('data-k')] = v === '' ? null : v; touch(); recalc(); }); });
      box.querySelectorAll('[data-base]').forEach(function (i) { i.addEventListener('change', function () { body.base = body.base || {}; body.base[i.getAttribute('data-base')] = i.value; touch(); }); });
      box.querySelector('#svMethod').addEventListener('change', function (e) { body.method = e.target.value; touch(); });
      box.querySelector('#svChange').addEventListener('change', function (e) { body.change = e.target.value; touch(); });
      box.querySelector('#svDate').addEventListener('change', function (e) { body.surveyDate = e.target.value; touch(); });
      box.querySelector('#svFarm').addEventListener('input', function (e) { body.base = body.base || {}; body.base.farmName = e.target.value; touch(); });
      box.querySelector('#svNote').addEventListener('input', function (e) { body.note = e.target.value; touch(); });
    }
    function recalc() {
      var c = sp(); if (!c) return;
      c.tables.forEach(function (t) {
        if (t.total) {
          var sum = 0, any = false;
          c.tables.forEach(function (t2) { t2.cols.forEach(function (col) { if (col[2]) { var v = num((body.row || {})[col[0]]); if (v != null && !isNaN(v)) { sum += v; any = true; } } }); });
          var el = root.querySelector('#svTot_' + t.id); if (el) el.textContent = any ? sum.toLocaleString() : '–';
        }
        (t.auto || []).forEach(function (a) {
          var s2 = 0, any2 = false; a[2].forEach(function (k) { var v = num((body.row || {})[k]); if (v != null && !isNaN(v)) { s2 += v; any2 = true; } });
          var el2 = root.querySelector('#svAuto_' + a[0]); if (el2) el2.textContent = any2 ? s2.toLocaleString() : '–';
        });
      });
    }
    var dT = null;
    function touch() { dirty = true; clearTimeout(dT); dT = setTimeout(function () { S().draftPut(id, body).catch(function () {}); }, 600); }   /* 저장 안 한 입력 보관 */
    root.querySelectorAll('input[name="svSp"]').forEach(function (r) { r.addEventListener('change', function () { body.species = r.value; touch(); drawBody(); }); });
    drawBody();
    /* 검증: 0·빈칸 구분, 음수·소수·문자 거부, 「그 중」 ≤ 전체, 가담율 0~100 */
    function validate() {
      var e = [], c = sp();
      if (!c) { e.push('축종을 고르세요'); return e; }
      if (!body.method) e.push('조사방법을 고르세요');
      var anyHead = false;
      c.tables.forEach(function (t) { t.cols.forEach(function (col) {
        var v = num((body.row || {})[col[0]]); if (v == null) return;
        if (isNaN(v)) { e.push(col[1] + ': 숫자가 아닙니다'); return; }
        if (v < 0) e.push(col[1] + ': 0 이상이어야 합니다');
        if (col[3] === 'pct') { if (v > 100) e.push(col[1] + ': 0~100 사이여야 합니다'); }
        else if (Math.floor(v) !== v) e.push(col[1] + ': 정수로 넣으세요');
        if (col[2]) anyHead = true;
      }); });
      var r = body.row || {};
      if (body.species === 'pig' && num(r.cand) != null && num(r.f68) != null && num(r.cand) > num(r.f68)) e.push('그 중 모돈용이 6~8개월 암컷보다 많습니다');
      if (!anyHead && !NOHEAD[body.change]) e.push('사육마릿수를 하나 이상 넣으세요 (0마리면 0). 휴업·전출·폐업이면 변동사항을 고르세요');
      if (body.change === '08' && !(body.note || '').trim()) e.push('변동사항 기타(08)는 비고에 구체적으로 적으세요');
      if (body.species === 'chicken' && ['bf3u', 'bf36', 'bf6o', 'bm3u', 'bm36', 'bm6o'].some(function (k) { return num(r[k]) > 0; }) && !(body.base || {}).breedUse) e.push('종계가 있으면 종계 용도를 고르세요');
      return e;
    }
    function save(st) {
      var msg = root.querySelector('#svMsg');
      if (st === 'done') { var er = validate(); if (er.length) { msg.innerHTML = '<b>완료 전에 확인하세요</b><ul>' + er.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'; msg.scrollIntoView({ block: 'nearest' }); return; } }
      /* 실제 조사일은 사용자가 넣은 값만 저장 (자동으로 오늘 날짜를 넣지 않음 — 9월 조사를 11월에 정리하는 경우 등) */
      msg.innerHTML = '';
      var meta = { siteId: s.id, task: task, period: period, formId: form.id, formVer: form.ver, status: st };
      body.savedAt = new Date().toISOString();
      S().surveyPut(meta, body, rev).then(function (m) {
        rev = m.rev; status = m.status; dirty = false; clearTimeout(dT);
        A().toast(st === 'done' ? '완료로 저장했습니다' : '임시저장했습니다');
        if (st === 'done') back(); else { var t = root.querySelector('.sv-top .sv-st'); if (t) t.outerHTML = chip('draft'); }
      }, function (e) {
        if (e && e.code === 'conflict') { msg.innerHTML = '<b>다른 창에서 이 조사표가 먼저 바뀌었습니다.</b> 지금 입력은 「저장 안 한 입력」으로 보관했습니다. 닫고 다시 열어 확인하세요.'; S().draftPut(id, body).catch(function () {}); }
        else { msg.innerHTML = '<b>저장하지 못했습니다.</b> 입력은 보관했습니다. 저장공간을 확인하고 다시 누르세요.'; S().draftPut(id, body).catch(function () {}); }
      });
    }
    function back() { A().openSite(s.id); }   /* 저장·닫기 후 같은 핀으로 */
    root.querySelector('#svTmp').addEventListener('click', function () { save('draft'); });
    root.querySelector('#svDone').addEventListener('click', function () { save('done'); });
    root.querySelector('#svClose').addEventListener('click', function () {
      if (dirty) { S().draftPut(id, body).then(function () { A().toast('저장하지 않은 입력은 보관했습니다 (다시 열면 이어서)'); }, function () {}); }
      back();
    });
  }

  /* 다른 탭에서 조사표가 바뀌면 열려 있는 카드 상자를 다시 그림 */
  function refreshOpenCard() { var el = document.getElementById('svCard'); if (el && el.__site) mountCard(el, el.__site); }

  window.OdigoSurvey = {
    mountCard: function (el, s) { if (el) el.__site = s; mountCard(el, s); },
    refreshOpenCard: refreshOpenCard, SCHEDULE: SCHEDULE, FORMS: FORMS, schedOf: schedOf, periodLabel: periodLabel, taskOf: taskOf
  };
  if (S()) S().onSurveyRemote = function () { refreshOpenCard(); };
})();
