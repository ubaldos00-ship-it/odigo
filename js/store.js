/* 어디고 v5.0 — 저장소를 IndexedDB 하나(odigo_db)로 옮김 (2026-11-26 사용자 요청 「문제점 보완해서 indexdb로 변경」)
   ─ 왜 바꾸나 (v4.7까지의 문제)
     ① 키는 IndexedDB(odigo_secure), 자료는 localStorage(odigo_vault_v2) → IndexedDB만 지워지면 자료를 못 엶
     ② localStorage 약 5MB를 텐아르·두당·어디고가 나눠 씀(같은 주소) → 조사표가 쌓이면 저장 실패
     ③ 저장할 때마다 전체를 다시 암호화해서 통째로 씀 · 열 때 전체 복호화
     ④ 탭 두 개면 나중 탭이 앞 탭 변경을 조용히 덮어씀
     ⑤ 브라우저 저장소 보호 요청(navigator.storage.persist) 없음 · 백업 알림 없음
   ─ v5.0 구조
     · IndexedDB odigo_db (version 1)
         meta    : key → 값   'key' = 기기 키(AES-GCM 256, 꺼낼 수 없음) · 'state' = 옮기기 결과 · 'backup' = 마지막 백업 시각
         kv      : { id, rev, at, iv, ct }            id = 'profile'
         sites   : { id, ord, rev, at, iv, ct }            조사구(핀) 한 곳 = 한 기록 (ord = 화면 순서 번호)
         visits  : { id, siteId, ord, rev, at, iv, ct }    방문 한 건 = 한 기록 (siteId 색인 — ID라 개인정보 아님)
         orphans : 열 수 없게 된 기록 보관(지우지 않음)
     · 기록마다 따로 암호화(저장마다 새 iv). 화면은 지금처럼 메모리의 db{profile,sites,visits}를 쓰고,
       저장할 때 바뀐 기록만 골라(JSON 비교) 그 기록만 암호화해서 한 트랜잭션으로 씀. 지운 기록은 지움.
     · rev(수정 번호): 다른 탭이 먼저 바꾼 기록은 덮어쓰지 않고 「충돌」로 알림 → 그 기록을 다시 읽어 화면에 반영
     · 다른 탭 변경 알림: BroadcastChannel('odigo_db') (없으면 localStorage 'odigo_db_ping' 이벤트)
     · 키와 자료가 같은 DB → 「자료는 있는데 키만 없는」 상태가 생기지 않음
   ─ 옮기기 (처음 한 번)
     localStorage odigo_vault_v2 를 예전 키(odigo_secure)로 풀기 → 같은 키를 새 DB로 복사 → 기록 쓰기 →
     다시 읽어 모든 기록 JSON 대조 → 맞을 때만 state 기록 후 새 DB 사용.
     실패하면 새 DB 기록을 지우고 예전 방식(localStorage)으로 계속 씀(자료 보존, 다음 실행 때 다시 시도).
     예전 자료(odigo_vault_v2)는 30일 보관 후 지움(그동안 예전 버전으로 열어도 자료가 보임).
   ─ 백업 파일: PBKDF2(SHA-256, 210,000회) + AES-GCM, 사용자가 정한 암호. 공통 암호 2026은 예전 파일 열기용으로만 남김
   · 텐아르(__tenar_secure_*·tenar_*)·두당 키와 섞이지 않게 이름은 odigo_ 로 시작 */
(function () {
  'use strict';

  var DB2 = 'odigo_db', DB2_VER = 1;
  var STORES = ['sites', 'visits', 'kv'];
  var VAULT_KEY = 'odigo_vault_v2';                    /* v2.7~v4.7 자료 (localStorage) */
  var LEGACY_KEY = 'odigo_places_v1';                  /* v2.3 평문 */
  var BAK_KEY = 'odigo_places_v1_bak', BAK_AT_KEY = 'odigo_places_v1_bak_at';
  var OLD_DB = 'odigo_secure', OLD_STORE = 'keys', OLD_KEY_ID = 'device_v1';
  var FILE_PASSWORD = '2026';
  var KEEP_BAK_DAYS = 7, KEEP_VAULT_DAYS = 30;
  var PING_KEY = 'odigo_db_ping';

  var CRYPTO_OK = !!(window.crypto && crypto.subtle && window.TextEncoder && window.indexedDB);
  var enc = window.TextEncoder ? new TextEncoder() : null, dec = window.TextDecoder ? new TextDecoder() : null;

  function b64(buf) { var b = new Uint8Array(buf), s = '', CH = 0x8000; for (var i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH)); return btoa(s); }
  function unb64(s) { var bin = atob(s), b = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; }
  function kstNow() { return new Date(Date.now() + 9 * 3600000).toISOString().replace('Z', '+09:00'); }
  function rawGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function rawSet(k, v) { localStorage.setItem(k, v); }
  function rawDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function err(c) { var e = new Error(c); e.code = c; return e; }
  function rq(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
  function txDone(tx) { return new Promise(function (res, rej) { tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; tx.onabort = function () { rej(tx.error || err('abort')); }; }); }

  /* ───────── IndexedDB 열기 ───────── */
  var dbP = null;
  function openDB2() {
    if (dbP) return dbP;
    dbP = new Promise(function (res, rej) {
      var r;
      try { r = indexedDB.open(DB2, DB2_VER); } catch (e) { rej(e); return; }
      r.onupgradeneeded = function () {
        var d = r.result;
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('sites')) d.createObjectStore('sites', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('visits')) d.createObjectStore('visits', { keyPath: 'id' }).createIndex('siteId', 'siteId', { unique: false });
        if (!d.objectStoreNames.contains('orphans')) d.createObjectStore('orphans', { autoIncrement: true });
      };
      r.onsuccess = function () {
        var d = r.result;
        d.onversionchange = function () { try { d.close(); } catch (e) {} dbP = null; };   /* 다른 탭이 새 버전을 열면 닫아 줌 */
        res(d);
      };
      r.onerror = function () { rej(r.error); };
      r.onblocked = function () { rej(err('blocked')); };
    });
    dbP.catch(function () { dbP = null; });
    return dbP;
  }
  function metaGet(k) { return openDB2().then(function (d) { return rq(d.transaction('meta', 'readonly').objectStore('meta').get(k)); }); }
  function metaPut(k, v) { return openDB2().then(function (d) { var tx = d.transaction('meta', 'readwrite'); tx.objectStore('meta').put(v, k); return txDone(tx); }); }

  /* ───────── 예전 키 (odigo_secure) ───────── */
  function oldKey() {
    return new Promise(function (res) {
      var r;
      try { r = indexedDB.open(OLD_DB, 1); } catch (e) { res(null); return; }
      r.onupgradeneeded = function () { r.result.createObjectStore(OLD_STORE); };
      r.onsuccess = function () {
        var d = r.result;
        try { var g = d.transaction(OLD_STORE, 'readonly').objectStore(OLD_STORE).get(OLD_KEY_ID); g.onsuccess = function () { d.close(); res(g.result || null); }; g.onerror = function () { d.close(); res(null); }; }
        catch (e) { d.close(); res(null); }
      };
      r.onerror = function () { res(null); };
    });
  }

  /* ───────── 암호화 (기록 한 건씩) ───────── */
  var KEY = null;
  function encOne(obj) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, KEY, enc.encode(JSON.stringify(obj))).then(function (ct) { return { iv: b64(iv.buffer), ct: b64(ct) }; });
  }
  function decOne(rec) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv) }, KEY, unb64(rec.ct)).then(function (pt) { return JSON.parse(dec.decode(pt)); });
  }
  function decryptVault(wrap, key) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(wrap.iv) }, key, unb64(wrap.ciphertext)).then(function (pt) { return JSON.parse(dec.decode(pt)); });
  }
  function encryptVault(obj, key) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(JSON.stringify(obj))).then(function (ct) {
      return { odigoSecure: true, secureType: 'device-vault', version: 1, savedAt: kstNow(), algorithm: 'AES-GCM', iv: b64(iv.buffer), ciphertext: b64(ct) };
    });
  }

  /* ───────── 자료 모양 ───────── */
  function emptyData() { return { v: 2, profile: null, sites: [], visits: [] }; }
  function normalize(d) {
    d = d && typeof d === 'object' ? d : emptyData();
    if (!Array.isArray(d.sites)) d.sites = [];
    if (!Array.isArray(d.visits)) d.visits = [];
    if (d.profile === undefined) d.profile = null;
    d.v = 2;
    return d;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function localDate(iso) { var t = new Date(iso); return isNaN(t) ? '' : t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  /* v2.3 장소 배열 → v2 구조 (ID·좌표·주소·메모·방문 기록 보존, 업무는 미분류) */
  function fromLegacy(places, todayStr) {
    var d = emptyData(), now = new Date().toISOString();
    (places || []).forEach(function (p) {
      if (!p || !p.id || !isFinite(p.lat) || !isFinite(p.lng)) return;
      d.sites.push({ id: String(p.id), name: p.name || '이름 없는 장소', addr: p.addr || '', lat: +p.lat, lng: +p.lng, memo: p.memo || '',
        division: null, type: null, crop: null, region: null, createdAt: p.createdAt || now, updatedAt: now });
      var byDate = {};
      (p.visits || []).forEach(function (v) {
        if (!v || !v.at) return;
        var dt = localDate(v.at); if (!dt) return;
        (byDate[dt] = byDate[dt] || []).push({ at: v.at, status: 'done', note: v.note || '' });
      });
      Object.keys(byDate).forEach(function (dt) {
        d.visits.push({ id: uid(), siteId: String(p.id), date: dt, planned: dt === todayStr && p.today === todayStr, order: dt === todayStr ? (p.todayOrder || 0) : 0,
          status: 'done', events: byDate[dt], createdAt: now, updatedAt: now });
      });
      if (p.today === todayStr && !byDate[todayStr]) {
        d.visits.push({ id: uid(), siteId: String(p.id), date: todayStr, planned: true, order: p.todayOrder || 0, status: 'todo', events: [], createdAt: now, updatedAt: now });
      }
    });
    return d;
  }

  /* 메모리 자료 → 저장소별 { id: 객체 } */
  function split(data) {
    var o = { sites: {}, visits: {}, kv: {} };
    (data.sites || []).forEach(function (s) { if (s && s.id != null) o.sites[String(s.id)] = s; });
    (data.visits || []).forEach(function (v) { if (v && v.id != null) o.visits[String(v.id)] = v; });
    if (data.profile) o.kv.profile = data.profile;
    return o;
  }

  /* ───────── 상태 ───────── */
  var MODE = 'idb';            /* 'idb' | 'legacy'(옮기기 실패 시 예전 방식) */
  var blocked = false;
  var last = { sites: {}, visits: {}, kv: {} };    /* 마지막으로 저장(또는 읽은) JSON */
  var revs = { sites: {}, visits: {}, kv: {} };    /* 내가 알고 있는 rev */
  var bad = { sites: {}, visits: {}, kv: {} };     /* 열 수 없는 기록 — 절대 지우지 않음 */
  var ords = { sites: {}, visits: {}, kv: {} }, nextOrd = { sites: 0, visits: 0, kv: 0 };   /* 화면 순서 (배열은 push·filter만 하므로 늘어나는 번호로 충분) */
  function setOrd(st, id, o) { if (o == null) return; ords[st][id] = o; if (o >= nextOrd[st]) nextOrd[st] = o + 1; }
  var legacyKey = null;
  var api;

  /* ───────── 저장 (바뀐 기록만, 순서대로) ───────── */
  var chain = Promise.resolve(), pending = null, timer = null;
  function save(data) {
    pending = data;
    clearTimeout(timer);
    timer = setTimeout(flush, 120);
  }
  function flush() {
    clearTimeout(timer);
    if (!pending) return chain;
    var d = pending; pending = null;
    chain = chain.then(function () { return MODE === 'legacy' ? writeLegacy(d) : writeChanges(d); }).catch(report);
    return chain;
  }
  function report(e) { try { if (api.onError) api.onError(e); } catch (x) {} }
  window.addEventListener('pagehide', function () { if (pending) flush(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden && pending) flush(); });

  function writeLegacy(d) {
    if (blocked) return Promise.reject(err('blocked'));
    return encryptVault(d, legacyKey).then(function (w) { rawSet(VAULT_KEY, JSON.stringify(w)); });
  }

  function writeChanges(data) {
    if (blocked) return Promise.reject(err('blocked'));
    var cur = split(data), ch = [], del = [];
    STORES.forEach(function (st) {
      Object.keys(cur[st]).forEach(function (id) {
        var j = JSON.stringify(cur[st][id]);
        if (last[st][id] !== j) ch.push({ st: st, id: id, obj: cur[st][id], json: j });
      });
      Object.keys(last[st]).forEach(function (id) { if (!cur[st].hasOwnProperty(id) && !bad[st][id]) del.push({ st: st, id: id }); });
    });
    if (!ch.length && !del.length) return Promise.resolve();
    return Promise.all(ch.map(function (c) { return encOne(c.obj).then(function (e) { c.e = e; }); })).then(function () {
      return openDB2();
    }).then(function (db2) {
      var tx = db2.transaction(STORES, 'readwrite'), conflicts = [], done = [];
      var now = Date.now();
      ch.forEach(function (c) {
        var os = tx.objectStore(c.st), g = os.get(c.id);
        g.onsuccess = function () {
          var ex = g.result, mine = revs[c.st][c.id] || 0, theirs = ex ? (ex.rev || 0) : 0;
          if (theirs !== mine) { conflicts.push({ st: c.st, id: c.id }); return; }   /* 다른 탭이 먼저 바꿈 → 덮어쓰지 않음 */
          var o = ords[c.st][c.id]; if (o == null) { o = nextOrd[c.st]++; ords[c.st][c.id] = o; }
          var rec = { id: c.id, ord: o, rev: mine + 1, at: now, iv: c.e.iv, ct: c.e.ct };
          if (c.st === 'visits') rec.siteId = String(c.obj.siteId || '');
          os.put(rec); done.push({ st: c.st, id: c.id, rev: rec.rev, json: c.json });
        };
      });
      del.forEach(function (x) {
        var os = tx.objectStore(x.st), g = os.get(x.id);
        g.onsuccess = function () {
          var ex = g.result;
          if (ex && (ex.rev || 0) !== (revs[x.st][x.id] || 0)) { conflicts.push({ st: x.st, id: x.id }); return; }
          if (ex) os.delete(x.id);
          done.push({ st: x.st, id: x.id, rev: null });
        };
      });
      return txDone(tx).then(function () {
        var changed = { sites: [], visits: [], kv: [] };
        done.forEach(function (x) {
          if (x.rev == null) { delete last[x.st][x.id]; delete revs[x.st][x.id]; }
          else { last[x.st][x.id] = x.json; revs[x.st][x.id] = x.rev; }
          changed[x.st].push(x.id);
        });
        if (done.length) ping(changed);
        if (conflicts.length) { reloadIds(conflicts, true); }
      });
    });
  }

  /* ───────── 다른 탭과 맞추기 ───────── */
  var TAB = uid(), bc = null;
  try { bc = new BroadcastChannel('odigo_db'); bc.onmessage = function (e) { onPing(e.data); }; } catch (e) { bc = null; }
  window.addEventListener('storage', function (e) { if (e.key === PING_KEY && e.newValue && !bc) { try { onPing(JSON.parse(e.newValue)); } catch (x) {} } });
  function ping(changed) {
    var m = { tab: TAB, at: Date.now(), changed: changed };
    if (bc) { try { bc.postMessage(m); } catch (e) {} }
    else { try { rawSet(PING_KEY, JSON.stringify(m)); } catch (e) {} }
  }
  function onPing(m) {
    if (!m || m.tab === TAB || MODE !== 'idb' || !KEY) return;
    var list = [];
    STORES.forEach(function (st) { ((m.changed || {})[st] || []).forEach(function (id) { list.push({ st: st, id: id }); }); });
    if (!list.length) return;
    /* 이 탭에 저장 안 한 변경이 있으면 먼저 저장(충돌이면 그 기록만 다시 읽음) */
    flush().then(function () { reloadIds(list, false); });
  }
  /* 기록들을 DB에서 다시 읽어 last·revs를 맞추고 화면에 알림 (값 null = 지워짐) */
  function reloadIds(list, conflict) {
    return openDB2().then(function (db2) {
      var tx = db2.transaction(STORES, 'readonly'), got = [];
      list.forEach(function (x) { var g = tx.objectStore(x.st).get(x.id); g.onsuccess = function () { got.push({ st: x.st, id: x.id, rec: g.result || null }); }; });
      return txDone(tx).then(function () { return got; });
    }).then(function (got) {
      return Promise.all(got.map(function (x) {
        if (!x.rec) { delete last[x.st][x.id]; delete revs[x.st][x.id]; return { store: x.st, id: x.id, value: null }; }
        return decOne(x.rec).then(function (v) {
          last[x.st][x.id] = JSON.stringify(v); revs[x.st][x.id] = x.rec.rev || 0; setOrd(x.st, x.id, x.rec.ord); delete bad[x.st][x.id];
          return { store: x.st, id: x.id, value: v };
        }, function () { bad[x.st][x.id] = 1; revs[x.st][x.id] = x.rec.rev || 0; return null; });
      }));
    }).then(function (res) {
      res = res.filter(Boolean);
      if (res.length && api.onRemote) { try { api.onRemote(res, !!conflict); } catch (e) {} }
    }).catch(report);
  }

  /* ───────── 열기 ─────────
     결과 status: 'ok' | 'new' | 'migrated'(v4.7 자료 → 새 DB) | 'migrated23'(v2.3 평문 → 새 DB) |
                  'nocrypto' | 'keylost' | 'migratefail'(옮기기 실패 → 예전 방식으로 계속, 자료 보존) | 'legacyfail'(v2.3 옮기기 실패, 보기만)
     keylost·nocrypto 이면 저장을 막아(blocked) 남아 있는 자료를 덮어쓰지 않는다 */
  function open(todayStr) {
    if (!CRYPTO_OK) { blocked = true; return Promise.resolve({ status: 'nocrypto', data: emptyData() }); }
    askPersist();
    return metaGet('state').then(function (state) {
      if (state && state.schema === 1) return loadIDB();
      return firstRun(todayStr);
    }, function () {
      /* IndexedDB를 못 열면(사생활 보호 모드 등) 예전 방식 시도 */
      return legacyOpen(todayStr, 'idbopen');
    });
  }

  function loadIDB() {
    return metaGet('key').then(function (k) {
      return openDB2().then(function (db2) {
        var tx = db2.transaction(STORES, 'readonly'), all = {};
        STORES.forEach(function (st) { var g = tx.objectStore(st).getAll(); g.onsuccess = function () { all[st] = g.result || []; }; });
        return txDone(tx).then(function () { return all; });
      }).then(function (all) {
        var n = all.sites.length + all.visits.length + all.kv.length;
        if (!k) {
          if (n) { blocked = true; return { status: 'keylost', data: emptyData() }; }
          return newKey().then(function () { return { status: 'new', data: emptyData() }; });
        }
        KEY = k;
        var data = emptyData(), fails = 0;
        return Promise.all(STORES.map(function (st) {
          return Promise.all(all[st].map(function (rec) {
            setOrd(st, rec.id, rec.ord);
            return decOne(rec).then(function (v) {
              last[st][rec.id] = JSON.stringify(v); revs[st][rec.id] = rec.rev || 0;
              if (st === 'sites') data.sites.push(v); else if (st === 'visits') data.visits.push(v); else if (rec.id === 'profile') data.profile = v;
            }, function () { fails++; bad[st][rec.id] = 1; revs[st][rec.id] = rec.rev || 0; });
          }));
        })).then(function () {
          if (n && fails === n) { blocked = true; return { status: 'keylost', data: emptyData() }; }
          sortLike(data);
          cleanupOld();
          return { status: 'ok', data: data, unreadable: fails };
        });
      });
    });
  }
  /* DB는 id 순으로 돌려주므로 저장한 ord(화면 순서)로 다시 정렬 */
  function sortLike(d) {
    function by(st) { return function (a, b) { var x = ords[st][String(a.id)], y = ords[st][String(b.id)]; x = x == null ? 1e12 : x; y = y == null ? 1e12 : y; return x - y; }; }
    d.sites.sort(by('sites')); d.visits.sort(by('visits'));
  }
  function newKey() {
    return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']).then(function (nk) {
      return metaPut('key', nk).then(function () { return metaGet('key'); });   /* 실제로 저장됐는지 다시 읽어 확인 */
    }).then(function (k) {
      if (!k) throw err('nokey');
      KEY = k;
      return metaPut('state', { schema: 1, createdAt: kstNow(), from: 'new' });
    });
  }

  /* 처음 실행: 예전 자료가 있으면 옮기고, 없으면 새로 */
  function firstRun(todayStr) {
    var raw = rawGet(VAULT_KEY);
    if (raw) {
      var w; try { w = JSON.parse(raw); } catch (e) { w = null; }
      if (!w || !w.odigoSecure) { blocked = true; return Promise.resolve({ status: 'keylost', data: emptyData() }); }
      return oldKey().then(function (k) {
        if (!k) { blocked = true; return { status: 'keylost', data: emptyData() }; }
        return decryptVault(w, k).then(function (d) {
          d = normalize(d);
          return migrate(d, k, 'vault_v2').then(function (back) {
            return { status: 'migrated', data: back, count: back.sites.length, visits: back.visits.length };
          }, function (e) {
            /* 옮기기 실패: 새 DB는 비우고, 예전 방식으로 계속 (자료 그대로) */
            MODE = 'legacy'; legacyKey = k;
            return clearDB2().then(function () { return { status: 'migratefail', data: d, reason: String(e && e.message || e) }; });
          });
        }, function () { blocked = true; return { status: 'keylost', data: emptyData() }; });
      });
    }
    var legacyRaw = rawGet(LEGACY_KEY), legacy = null;
    try { legacy = JSON.parse(legacyRaw); } catch (e) { legacy = null; }
    if (Array.isArray(legacy) && legacy.length) {
      var d0 = fromLegacy(legacy, todayStr);
      return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']).then(function (nk) {
        return migrate(d0, nk, 'places_v1');
      }).then(function (back) {
        rawSet(BAK_KEY, legacyRaw); rawSet(BAK_AT_KEY, String(Date.now())); rawDel(LEGACY_KEY);
        return { status: 'migrated23', data: back, count: back.sites.length };
      }, function () {
        blocked = true;
        return clearDB2().then(function () { return { status: 'legacyfail', data: d0 }; });
      });
    }
    return newKey().then(function () { return { status: 'new', data: emptyData() }; }, function () {
      return legacyOpen(todayStr, 'nokey');
    });
  }

  /* 새 DB로 옮기기: 키 복사 → 기록 쓰기(한 트랜잭션) → 다시 읽어 전부 대조 → state 기록 */
  function migrate(d, key, from) {
    KEY = key;
    var parts = split(d), recs = { sites: [], visits: [], kv: [] }, now = Date.now(), idx = { sites: {}, visits: {}, kv: { profile: 0 } };
    d.sites.forEach(function (x, i) { idx.sites[String(x.id)] = i; });
    d.visits.forEach(function (x, i) { idx.visits[String(x.id)] = i; });
    var dupe = {}, dupeId = null;
    d.sites.forEach(function (s) { var id = String(s.id); if (dupe[id]) dupeId = id; dupe[id] = 1; });
    if (dupeId) return Promise.reject(err('dupe-site:' + dupeId));   /* 같은 ID 두 곳 → 옮기지 않음(예전 방식 유지) */
    if (Object.keys(parts.visits).length !== d.visits.filter(function (v) { return v && v.id != null; }).length) return Promise.reject(err('dupe-visit'));
    if (Object.keys(parts.sites).length !== d.sites.length || Object.keys(parts.visits).length !== d.visits.length) return Promise.reject(err('noid'));   /* ID 없는 기록 → 옮기지 않음 */
    return Promise.all(STORES.map(function (st) {
      return Promise.all(Object.keys(parts[st]).map(function (id) {
        return encOne(parts[st][id]).then(function (e) {
          var r = { id: id, ord: idx[st][id] || 0, rev: 1, at: now, iv: e.iv, ct: e.ct };
          if (st === 'visits') r.siteId = String(parts[st][id].siteId || '');
          recs[st].push(r);
        });
      }));
    })).then(function () {
      return openDB2();
    }).then(function (db2) {
      var tx = db2.transaction(['meta'].concat(STORES), 'readwrite');
      STORES.forEach(function (st) { var os = tx.objectStore(st); os.clear(); recs[st].forEach(function (r) { os.put(r); }); });
      tx.objectStore('meta').put(key, 'key');
      return txDone(tx);
    }).then(function () {
      /* 대조: 키를 DB에서 다시 꺼내 모든 기록을 풀어 원본 JSON과 비교 */
      return metaGet('key');
    }).then(function (k2) {
      if (!k2) throw err('verify-key');
      KEY = k2;
      return openDB2().then(function (db2) {
        var tx = db2.transaction(STORES, 'readonly'), all = {};
        STORES.forEach(function (st) { var g = tx.objectStore(st).getAll(); g.onsuccess = function () { all[st] = g.result || []; }; });
        return txDone(tx).then(function () { return all; });
      });
    }).then(function (all) {
      var back = emptyData(), cnt = 0;
      return Promise.all(STORES.map(function (st) {
        if (all[st].length !== Object.keys(parts[st]).length) throw err('verify-count:' + st);
        return Promise.all(all[st].map(function (rec) {
          return decOne(rec).then(function (v) {
            if (JSON.stringify(v) !== JSON.stringify(parts[st][rec.id])) throw err('verify-value:' + st + ':' + rec.id);
            last[st][rec.id] = JSON.stringify(v); revs[st][rec.id] = rec.rev; setOrd(st, rec.id, rec.ord); cnt++;
            if (st === 'sites') back.sites.push(v); else if (st === 'visits') back.visits.push(v); else if (rec.id === 'profile') back.profile = v;
          });
        }));
      })).then(function () {
        /* 화면 순서는 원본 순서 그대로 */
        back.sites = d.sites.map(function (s) { return back.sites.filter(function (x) { return String(x.id) === String(s.id); })[0]; });
        back.visits = d.visits.map(function (v) { return back.visits.filter(function (x) { return String(x.id) === String(v.id); })[0]; });
        return metaPut('state', { schema: 1, from: from, migratedAt: kstNow(), sites: back.sites.length, visits: back.visits.length, checked: cnt });
      }).then(function () {
        if (from === 'vault_v2') return metaPut('oldVault', { keepUntil: Date.now() + KEEP_VAULT_DAYS * 86400000 });
      }).then(function () { return back; });
    }).catch(function (e) {
      last = { sites: {}, visits: {}, kv: {} }; revs = { sites: {}, visits: {}, kv: {} };
      ords = { sites: {}, visits: {}, kv: {} }; nextOrd = { sites: 0, visits: 0, kv: 0 };
      throw e;
    });
  }
  function clearDB2() {
    return openDB2().then(function (db2) {
      var tx = db2.transaction(['meta'].concat(STORES), 'readwrite');
      STORES.forEach(function (st) { tx.objectStore(st).clear(); });
      tx.objectStore('meta').delete('state'); tx.objectStore('meta').delete('key');
      return txDone(tx);
    }).catch(function () {});
  }

  /* IndexedDB를 못 쓸 때: 예전 방식(localStorage + odigo_secure 키) */
  function legacyOpen(todayStr, why) {
    MODE = 'legacy';
    var raw = rawGet(VAULT_KEY);
    return oldKey().then(function (k) {
      if (raw) {
        var w; try { w = JSON.parse(raw); } catch (e) { w = null; }
        if (!w || !k) { blocked = true; return { status: 'keylost', data: emptyData() }; }
        return decryptVault(w, k).then(function (d) { legacyKey = k; return { status: 'migratefail', data: normalize(d), reason: why }; },
          function () { blocked = true; return { status: 'keylost', data: emptyData() }; });
      }
      blocked = true;
      return { status: 'nocrypto', data: emptyData() };
    });
  }

  /* 예전 자료 정리: v2.3 백업 7일, v4.7 저장본 30일 후 지움 (그 전엔 예전 버전으로 열어도 보임) */
  function cleanupOld() {
    var at = Number(rawGet(BAK_AT_KEY) || 0);
    if (at && Date.now() - at > KEEP_BAK_DAYS * 86400000) { rawDel(BAK_KEY); rawDel(BAK_AT_KEY); }
    metaGet('oldVault').then(function (o) { if (o && o.keepUntil && Date.now() > o.keepUntil) { rawDel(VAULT_KEY); metaPut('oldVault', { removedAt: Date.now() }); } }).catch(function () {});
  }

  /* 브라우저가 저장소를 함부로 지우지 않게 요청 (결과는 브라우저가 정함) */
  var persisted = null;
  function askPersist() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persisted().then(function (p) { if (p) return true; return navigator.storage.persist(); }).then(function (p) { persisted = !!p; }, function () { persisted = false; });
      }
    } catch (e) {}
  }
  function storageInfo() {
    var o = { mode: MODE, persisted: persisted };
    if (!(navigator.storage && navigator.storage.estimate)) return Promise.resolve(o);
    return navigator.storage.estimate().then(function (e) { o.usage = e.usage; o.quota = e.quota; return o; }, function () { return o; });
  }

  /* 열쇠를 잃었을 때 「새로 시작」: 열 수 없는 기록은 지우지 않고 orphans 로 옮겨 보관 */
  function startOver() {
    if (MODE === 'legacy') {
      var raw = rawGet(VAULT_KEY);
      if (raw) { try { rawSet(VAULT_KEY + '_unreadable_' + Date.now(), raw); } catch (e) { return Promise.reject(e); } rawDel(VAULT_KEY); }
      MODE = 'idb';
    }
    return openDB2().then(function (db2) {
      var tx = db2.transaction(['meta', 'orphans'].concat(STORES), 'readwrite'), stamp = kstNow();
      STORES.forEach(function (st) {
        var os = tx.objectStore(st), g = os.getAll();
        g.onsuccess = function () { (g.result || []).forEach(function (r) { tx.objectStore('orphans').add({ store: st, at: stamp, rec: r }); }); os.clear(); };
      });
      tx.objectStore('meta').delete('key'); tx.objectStore('meta').delete('state');
      return txDone(tx);
    }).then(function () {
      last = { sites: {}, visits: {}, kv: {} }; revs = { sites: {}, visits: {}, kv: {} }; bad = { sites: {}, visits: {}, kv: {} };
      ords = { sites: {}, visits: {}, kv: {} }; nextOrd = { sites: 0, visits: 0, kv: 0 };
      return newKey();
    }).then(function () { blocked = false; return emptyData(); });
  }

  /* 백업 알림용 */
  function markBackup() { return metaPut('backup', { at: Date.now() }).catch(function () {}); }
  function backupInfo() { return metaGet('backup').then(function (b) { return b || null; }, function () { return null; }); }

  /* ───────── 백업 파일 ───────── */
  function deriveFileKey(pw, salt, iter) {
    return crypto.subtle.importKey('raw', enc.encode(String(pw)), { name: 'PBKDF2' }, false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  /* v4.0: 암호는 사용자가 정함(pw). 비어 있으면 만들지 않음 — 공통 암호 2026은 예전 파일 열기용으로만 남김 */
  function exportFile(payload, scope, appVersion, pw) {
    if (!pw || String(pw).length < 4) return Promise.reject(err('nopw'));
    var salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), iter = 210000;
    return deriveFileKey(pw, salt, iter).then(function (k) {
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, enc.encode(JSON.stringify(payload)));
    }).then(function (ct) {
      return { odigoSecure: true, secureType: 'password-file', version: 1, app: 'odigo', appVersion: appVersion, encryptedAt: kstNow(), scope: scope,
        algorithm: 'AES-GCM', kdf: 'PBKDF2', hash: 'SHA-256', iterations: iter, salt: b64(salt.buffer), iv: b64(iv.buffer), ciphertext: b64(ct) };
    });
  }
  /* 반환: { kind:'secure', data } | { kind:'legacy', data } — 실패하면 code: 'badpw' | 'notodigo' */
  function importFile(text, pw) {
    var o; try { o = JSON.parse(text); } catch (e) { return Promise.reject(err('notodigo')); }
    if (o && o.app === 'odigo' && Array.isArray(o.places)) return Promise.resolve({ kind: 'legacy', places: o.places });
    if (!o || !o.odigoSecure || o.secureType !== 'password-file') return Promise.reject(err('notodigo'));
    return deriveFileKey(pw, unb64(o.salt), o.iterations || 210000).then(function (k) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, k, unb64(o.ciphertext));
    }).then(function (pt) { return { kind: 'secure', data: JSON.parse(dec.decode(pt)), scope: o.scope }; }, function () { throw err('badpw'); });
  }

  api = window.OdigoStore = {
    CRYPTO_OK: CRYPTO_OK, FILE_PASSWORD: FILE_PASSWORD,
    open: open, save: save, flush: flush, startOver: startOver,
    isBlocked: function () { return blocked; },
    mode: function () { return MODE; },
    storageInfo: storageInfo, markBackup: markBackup, backupInfo: backupInfo,
    fromLegacy: fromLegacy, exportFile: exportFile, importFile: importFile, uid: uid
    /* onError(e), onRemote([{store,id,value}], conflict) 는 화면(odigo.js)에서 붙임 */
  };
})();
