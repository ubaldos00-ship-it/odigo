/* 어디고 v2.8 — 「나 조사하러 간다」 현장 안전 연락 (설계: 설계/v2.4 10장)
   · 누를 때 GPS를 한 번만 조회 → 미리보기(현재 위치·GPS 시각·정확도·조사 목적지, 각각 지도 링크)
   · 보내기: 카카오톡 공유(공식 JS SDK, 사용자가 방을 고름) · 문자 작성 화면(기본 번호) · 문구 복사
     실제 전송은 카톡·문자 앱에서 사용자가 누름. 어디고는 위치를 서버로 보내지 않음
   · 지도 링크: 문자·복사 = 카카오맵 링크(map.kakao.com, 사용자 결정)
                카카오톡 공유 = 카카오가 등록 도메인 링크만 허용 → 어디고 ?pin= 링크(받는 사람이 누르면 그 위치 핀 + 카카오맵 열기)
   · GPS 거부·시간 초과·정확도 낮음을 각각 안내, 목적지만 보내기 / 지도에서 핀 찍어 보내기 / 마지막 확인 위치 제공 */
(function () {
  'use strict';

  var KAKAO_JS_KEY = 'd714e9625ae9e816526288f6cde536a9';   /* odigo.js와 같은 공개 키(도메인 제한) */
  var KAKAO_SDK = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js';
  var KAKAO_SDK_SRI = 'sha384-DKYJZ8NLiK8MN4/C5P2dtSmLQ4KwPaoqAfyA/DfmEc1VDxu4yyC7wy6K1Hs90nka';
  var ODIGO_URL = 'https://ubaldos00-ship-it.github.io/odigo/';
  var LOW_ACC_M = 100;          /* 이보다 크면 「정확도 낮음」 안내 */
  var GPS_TIMEOUT = 15000;

  function A() { return window.OdigoApp; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hm(t) { var d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function clean(s) { return String(s || '').replace(/[,\n\r]/g, ' ').trim(); }

  /* 받침에 따라 「로/으로」 (ㄹ 받침은 「로」) */
  function ro(w) {
    var c = w.charCodeAt(w.length - 1);
    if (c >= 0xAC00 && c <= 0xD7A3) { var j = (c - 0xAC00) % 28; return j === 0 || j === 8 ? '로' : '으로'; }
    return /[0-9]$/.test(w) ? (/[036]$/.test(w) ? '으로' : '로') : '(으)로';
  }
  function kakaoMapLink(name, lat, lng) { return 'https://map.kakao.com/link/map/' + encodeURIComponent(clean(name) || '위치') + ',' + lat.toFixed(5) + ',' + lng.toFixed(5); }
  function odigoPinLink(name, lat, lng) { return ODIGO_URL + '?pin=' + lat.toFixed(6) + ',' + lng.toFixed(6) + '&n=' + encodeURIComponent(clean(name).slice(0, 40)); }

  var lastFix = null;   /* 마지막으로 확인한 내 위치 (이 화면을 연 동안만, 저장하지 않음) */

  function getFix() {
    return new Promise(function (res) {
      if (!navigator.geolocation) { res({ err: 'nogps' }); return; }
      navigator.geolocation.getCurrentPosition(function (p) {
        res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, at: p.timestamp || Date.now() });
      }, function (e) {
        res({ err: e && e.code === 1 ? 'denied' : e && e.code === 3 ? 'timeout' : 'fail' });
      }, { enableHighAccuracy: true, timeout: GPS_TIMEOUT, maximumAge: 0 });
    });
  }

  /* ───────── 문구 ───────── */
  function compose(st, forKakao) {
    var prof = A().getProfile() || {}, t = st.target, me = st.me;
    var L = ['[어디고 현장조사 알림]', '보낸 사람 · ' + (prof.nickname || '어디고 사용자')];
    if (t) L.push(clean(t.name) + ro(clean(t.name)) + ' 조사하러 갑니다.');
    else L.push('현장 조사 중입니다. 현재 위치를 알립니다.');
    if (me) {
      L.push('현재 내 위치' + (me.last ? '(마지막 확인 위치)' : '') + (forKakao ? '' : ' · ' + kakaoMapLink('내 위치', me.lat, me.lng)));
      L.push('GPS 확인 · ' + hm(me.at) + ' / 정확도 약 ±' + Math.round(me.acc) + 'm');
    } else if (st.meNote) L.push('현재 내 위치 · ' + st.meNote);
    if (t) L.push('조사 목적지 · ' + clean(t.name) + (forKakao ? '' : ' ' + kakaoMapLink(t.name, t.lat, t.lng)));
    return L.join('\n');
  }

  /* ───────── 화면 ───────── */
  var cur = null;   /* { target, me, meNote, meAddr, text, edited } */
  function open(target) {
    if (!A().getProfile()) { A().toast('먼저 내 설정에서 닉네임을 정해 주세요'); return; }
    cur = { target: target || null, me: null, meNote: '', meAddr: '', edited: false };
    render('locating');
    locate();
  }
  function locate() {
    var c = cur;
    render('locating');
    getFix().then(function (f) {
      if (c !== cur) return;
      if (f.err) { c.me = null; c.gpsErr = f.err; render('ready'); return; }
      c.gpsErr = f.acc > LOW_ACC_M ? 'lowacc' : '';
      c.me = f; lastFix = f; c.meAddr = '';
      render('ready');
      A().reverseGeocode(f.lat, f.lng).then(function (a) { if (c === cur && c.me === f) { c.meAddr = a || ''; render('ready', true); } });
    });
  }
  var GPS_MSG = {
    denied: '위치 권한이 꺼져 있습니다. 휴대폰 설정 › Safari(또는 Chrome) › 위치에서 「허용」으로 바꾼 뒤 다시 조회하세요.',
    timeout: '위치를 확인하지 못했습니다(시간 초과). 하늘이 트인 곳에서 다시 조회하세요.',
    fail: '위치를 확인하지 못했습니다.',
    nogps: '이 기기에서는 위치를 확인할 수 없습니다.',
    lowacc: ''
  };
  function render(phase, keepText) {
    var c = cur, prof = A().getProfile() || {}, sf = prof.safety || {};
    if (!keepText || !c.edited) c.text = compose(c, false);
    var meHtml;
    if (phase === 'locating') meHtml = '<p class="muted">현재 위치(GPS)를 한 번 확인하는 중…</p>';
    else if (c.me) {
      meHtml = '<div class="sf-loc"><b>' + esc(c.meAddr || (c.me.lat.toFixed(5) + ', ' + c.me.lng.toFixed(5))) + '</b>' +
        '<small>GPS ' + hm(c.me.at) + ' · 정확도 약 ±' + Math.round(c.me.acc) + 'm' + (c.me.last ? ' · 마지막 확인 위치' : '') + '</small>' +
        '<a href="' + kakaoMapLink('내 위치', c.me.lat, c.me.lng) + '" target="_blank" rel="noopener">지도 링크 열어 보기</a></div>' +
        (c.gpsErr === 'lowacc' ? '<p class="warn">정확도가 약 ±' + Math.round(c.me.acc) + 'm로 낮습니다. 그대로 보내거나 다시 조회하세요.</p>' : '');
    } else {
      meHtml = '<p class="warn">' + esc(GPS_MSG[c.gpsErr] || GPS_MSG.fail) + '</p>' +
        '<div class="row">' + (c.target ? '<button class="btn sm" data-a="destonly">목적지만 보내기</button>' : '') +
        '<button class="btn sm" data-a="pickmap">지도에서 핀 찍어 보내기</button>' +
        (lastFix ? '<button class="btn sm" data-a="uselast">마지막 확인 위치(' + hm(lastFix.at) + ') 쓰기</button>' : '') + '</div>';
    }
    var t = c.target;
    var html =
      '<label class="fld">현재 내 위치 <button class="btn sm" data-a="relocate">다시 조회</button></label>' + meHtml +
      '<label class="fld">조사 목적지</label>' +
      (t ? '<div class="sf-loc"><b>' + esc(t.name) + '</b><small>' + esc(t.addr || (t.lat.toFixed(5) + ', ' + t.lng.toFixed(5))) + '</small>' +
        '<a href="' + kakaoMapLink(t.name, t.lat, t.lng) + '" target="_blank" rel="noopener">지도 링크 열어 보기</a></div>'
        : '<p class="muted">선택한 조사구가 없어 현재 위치만 보냅니다. <button class="btn sm" data-a="pickdest">조사구 고르기</button></p>') +
      '<label class="fld">보낼 문구 (고칠 수 있음)</label><textarea id="sfText" rows="7">' + esc(c.text) + '</textarea>' +
      (sf.kakaoRoom ? '<p class="sf-room">카카오톡에서 「<b>' + esc(sf.kakaoRoom) + '</b>」 방을 골라 주세요</p>' : '<p class="muted">내 설정에서 안전 연락방 이름을 정해 두면 여기에 안내합니다.</p>') +
      '<div class="sf-btns">' +
        '<button class="btn sf-kakao" data-a="kakao"' + (phase === 'locating' ? ' disabled' : '') + '>💬 내 위치 카톡 보내기</button>' +
        '<div class="sf-sms"><button class="btn primary" data-a="sms"' + (phase === 'locating' ? ' disabled' : '') + '>✉ 위치 문자 보내기</button>' +
        '<input class="inp" id="sfTo" inputmode="tel" placeholder="받는 번호" value="' + esc(sf.smsTo || '') + '"></div>' +
        '<button class="btn" data-a="copy"' + (phase === 'locating' ? ' disabled' : '') + '>📋 문구 복사</button>' +
      '</div>' +
      '<p class="muted">위치는 어디고 서버로 보내지 않습니다. 카톡·문자 앱에서 내용을 확인하고 직접 전송하세요.</p>';
    var body = A().openSheet('🚨 나 조사하러 간다', html);
    var ta = body.querySelector('#sfText');
    ta.addEventListener('input', function () { c.text = ta.value; c.edited = true; });
    function on(a, fn) { var b = body.querySelector('[data-a="' + a + '"]'); if (b) b.addEventListener('click', fn); }
    on('relocate', function () { c.edited = false; locate(); });
    on('destonly', function () { c.meNote = '확인 못 함(GPS)'; c.edited = false; render('ready'); });
    on('uselast', function () { c.me = { lat: lastFix.lat, lng: lastFix.lng, acc: lastFix.acc, at: lastFix.at, last: true }; c.gpsErr = ''; c.edited = false; render('ready'); });
    on('pickmap', function () { A().closeSheet(); A().toast('지도를 길게 눌러 핀을 찍고 「🚨 이 위치 보내기」를 누르세요'); });
    on('pickdest', function () { A().closeSheet(); A().toast('조사구 카드나 지도 핀에서 「🚨 이 위치 보내기」를 누르세요'); });
    on('kakao', function () { shareKakao(c); });
    on('sms', function () { sendSms(c, body.querySelector('#sfTo').value); });
    on('copy', function () { copy(c.text).then(function (ok) { A().toast(ok ? '문구를 복사했습니다' : '복사하지 못했습니다 · 문구를 길게 눌러 복사하세요'); }); });
  }

  /* ───────── 보내기 ───────── */
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function () { return true; }, fallback);
    return Promise.resolve(fallback());
    function fallback() {
      try {
        var t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
        document.body.appendChild(t); t.select(); t.setSelectionRange(0, text.length);
        var ok = document.execCommand('copy'); t.remove(); return ok;
      } catch (e) { return false; }
    }
  }
  function sendSms(c, to) {
    var num = String(to || '').replace(/[^\d+]/g, '');
    if (!num) { A().toast('받는 번호를 넣어 주세요'); return; }
    /* 본문이 안 채워지는 기기를 대비해 먼저 복사해 둠 */
    copy(c.text).then(function () {
      var ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      var url = 'sms:' + num + (ios ? '&' : '?') + 'body=' + encodeURIComponent(c.text);
      location.href = url;
      A().toast('문자 작성 화면을 열었습니다 · 본문이 비어 있으면 붙여넣기 하세요');
    });
  }
  var sdkP = null;
  function ensureKakaoShare() {
    if (window.Kakao && Kakao.Share) { if (!Kakao.isInitialized()) Kakao.init(KAKAO_JS_KEY); return Promise.resolve(true); }
    if (sdkP) return sdkP;
    sdkP = new Promise(function (res) {
      var s = document.createElement('script');
      s.src = KAKAO_SDK; s.integrity = KAKAO_SDK_SRI; s.crossOrigin = 'anonymous';
      var to = setTimeout(function () { res(false); }, 8000);
      s.onload = function () { clearTimeout(to); try { if (!Kakao.isInitialized()) Kakao.init(KAKAO_JS_KEY); res(!!Kakao.Share); } catch (e) { res(false); } };
      s.onerror = function () { clearTimeout(to); res(false); };
      document.head.appendChild(s);
    }).then(function (ok) { if (!ok) sdkP = null; return ok; });
    return sdkP;
  }
  function shareKakao(c) {
    var prof = A().getProfile() || {}, room = (prof.safety || {}).kakaoRoom;
    ensureKakaoShare().then(function (ok) {
      if (!ok) { kakaoFail(); return; }
      /* 카카오 text 템플릿은 본문 200자 제한·링크는 등록 도메인만 → 본문은 링크 없이, 지도는 버튼 2개(어디고 ?pin 링크) */
      var text = c.edited ? c.text : compose(c, true);
      text = text.replace(/https?:\/\/\S+/g, '').replace(/[ \t]+\n/g, '\n');
      if (text.length > 200) text = text.slice(0, 197) + '…';
      var buttons = [];
      if (c.me) { var u1 = odigoPinLink('내 위치 ' + hm(c.me.at), c.me.lat, c.me.lng); buttons.push({ title: '현재 내 위치', link: { mobileWebUrl: u1, webUrl: u1 } }); }
      if (c.target) { var u2 = odigoPinLink(c.target.name, c.target.lat, c.target.lng); buttons.push({ title: '조사 목적지', link: { mobileWebUrl: u2, webUrl: u2 } }); }
      var main = buttons[0] ? buttons[0].link : { mobileWebUrl: ODIGO_URL, webUrl: ODIGO_URL };
      try {
        Kakao.Share.sendDefault({ objectType: 'text', text: text, link: main, buttons: buttons.length ? buttons : undefined });
        A().toast(room ? '카카오톡에서 「' + room + '」 방을 골라 보내세요' : '카카오톡 공유 화면을 열었습니다');
      } catch (e) { kakaoFail(); }
    });
  }
  function kakaoFail() { A().toast('카카오톡을 열지 못했습니다 · 문자 보내기나 문구 복사를 이용하세요'); }

  /* ───────── 받은 링크 열기: ?pin=위도,경도&n=이름 ───────── */
  function handlePinLink() {
    var q = new URLSearchParams(location.search), pin = q.get('pin');
    if (!pin) return;
    var m = pin.split(','), lat = parseFloat(m[0]), lng = parseFloat(m[1]);
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    var name = (q.get('n') || '공유된 위치').slice(0, 40);
    A().showSharedPin({ name: name, lat: lat, lng: lng, kakao: kakaoMapLink(name, lat, lng) });
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
  }

  window.OdigoSafety = { open: open };
  (function wait() { if (A() && A().showSharedPin) handlePinLink(); else setTimeout(wait, 50); })();
})();
