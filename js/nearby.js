/* 어디고 v1.7 — 「주변정보」 모듈 (0단계: 패널 틀만)
   · 설계: 설계/v1.1/어디고맵_주변정보_설계_v1.1.md
   · 실제 API·자료가 연결되기 전에는 스위치를 켤 수 없고 「준비 중」으로만 표시한다.
     임의의 핀·영상·교통색·위험도를 실제 자료처럼 그리지 않는다.
   · 이 모듈이 실패해도 장소 저장·방문 기록(odigo.js)은 계속 동작하도록 분리. */
(function () {
  'use strict';

  /* status: 'wait' = 연결 전(스위치 비활성) / 'live' = 실제 자료 연결됨 */
  var LAYERS = [
    { id: 'parking', ico: 'P', color: '#1971c2', name: '주차장', stage: '1차',
      provider: '공공데이터포털 · 전국주차장정보표준데이터 (각 지자체)',
      basis: '데이터 기준일 표시 예정 (반기 갱신)', status: 'wait' },
    { id: 'cctvLoc', ico: '◉', color: '#495057', name: 'CCTV 설치 위치', stage: '1차',
      provider: '행정안전부 · CCTV정보 조회서비스',
      basis: '데이터 기준일 표시 예정 (일간, 2일 전 기준)', status: 'wait',
      note: '설치 위치 안내만 합니다. 작동 여부·촬영 범위는 알 수 없습니다.' },
    { id: 'traffic', ico: '≋', color: '#2f9e44', name: '교통상황', stage: '2차',
      provider: '국가교통정보센터(ITS) · 교통소통정보',
      basis: '관측시각 표시 예정 (원활·서행·정체·정보 없음)', status: 'wait' },
    { id: 'cctvVideo', ico: '▶', color: '#1c7ed6', name: '교통 CCTV 영상', stage: '2차',
      provider: '국가교통정보센터(ITS) · CCTV 정보',
      basis: '재생을 누를 때만 영상을 불러옵니다', status: 'wait' },
    { id: 'safety', ico: '!', color: '#7048e8', name: '치안·안전정보', stage: '3차',
      provider: '생활안전지도(행정안전부) · 경찰청 통계',
      basis: '집계 단위·대상 기간 표시 예정', status: 'wait',
      note: '통계를 지도에 표시한 것이며 개별 사건 발생 장소가 아닙니다.' }
  ];

  var state = {};   /* id → 켜짐 여부 (0단계에서는 항상 false) */

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function render(body) {
    var html = '<div class="nb-intro">필요한 정보만 켜서 겹쳐 봅니다. 처음에는 모두 꺼져 있습니다.<br>' +
      '<b>현재는 공공데이터 API 연결 전</b>이라 실제 자료를 표시하지 않습니다. 인증키 발급·응답 확인 후 단계별로 열립니다.</div>';
    LAYERS.forEach(function (L) {
      var wait = L.status !== 'live';
      html += '<div class="nb-item">' +
        '<div class="nb-ico" style="background:' + L.color + '">' + esc(L.ico) + '</div>' +
        '<div class="nb-main"><b>' + esc(L.name) + '</b>' + (wait ? '<span class="badge-wait">준비 중 · ' + esc(L.stage) + '</span>' : '') +
        '<div class="nb-meta">' + esc(L.provider) + '<br>' + esc(L.basis) + (L.note ? '<br>' + esc(L.note) : '') + '</div></div>' +
        '<label class="switch" title="' + (wait ? '아직 연결되지 않았습니다' : '켜기/끄기') + '">' +
        '<input type="checkbox" data-nb="' + L.id + '"' + (state[L.id] ? ' checked' : '') + (wait ? ' disabled' : '') + '><span></span></label>' +
        '</div>';
    });
    html += '<div class="row"><button class="btn full" id="nbAllOff">주변정보 모두 끄기</button></div>' +
      '<p class="muted">※ 실제 API가 연결되지 않은 항목은 예시 위치·영상·교통 상태를 보여 주지 않습니다.</p>';
    body.innerHTML = html;

    body.querySelectorAll('input[data-nb]').forEach(function (inp) {
      inp.addEventListener('change', function () { state[inp.getAttribute('data-nb')] = inp.checked; });
    });
    body.querySelector('#nbAllOff').addEventListener('click', function () {
      allOff();
      body.querySelectorAll('input[data-nb]').forEach(function (inp) { inp.checked = false; });
      if (window.OdigoToast) window.OdigoToast('주변정보를 모두 껐습니다');
    });
  }

  function allOff() { Object.keys(state).forEach(function (k) { state[k] = false; }); }
  function anyOn() { return Object.keys(state).some(function (k) { return state[k]; }); }

  window.OdigoNearby = { render: render, allOff: allOff, anyOn: anyOn, layers: LAYERS };
})();
