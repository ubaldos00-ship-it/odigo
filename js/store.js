/* 어디고 v2.7 — 암호화 저장소 (설계: 설계/v2.4 4·11장, 2026-11-07 사용자 결정 「금고형」)
   · 기기 키: IndexedDB odigo_secure › keys › device_v1 에 「꺼낼 수 없는」 AES-GCM 256 CryptoKey(extractable:false)
   · 자료: localStorage odigo_vault_v2 = { odigoSecure, secureType:'device-vault', iv, ciphertext } (AES-GCM, 저장마다 새 iv)
   · 평문 저장 금지: 암호화를 못 쓰면 저장하지 않고 알림
   · v2.3 평문(odigo_places_v1) → 새 구조로 옮긴 뒤 다시 읽어 대조, 일치하면 odigo_places_v1_bak 으로 이름만 바꿔 7일 보관 후 삭제
   · 백업 파일: PBKDF2(SHA-256, 210,000회) + AES-GCM, 암호 2026 (사용자 결정 · 모든 사용자 공통 암호)
   · 텐아르(__tenar_secure_*)·두당 키와 섞이지 않게 이름을 odigo_ 로 시작 */
(function () {
  'use strict';

  var VAULT_KEY = 'odigo_vault_v2';
  var LEGACY_KEY = 'odigo_places_v1';
  var BAK_KEY = 'odigo_places_v1_bak';
  var BAK_AT_KEY = 'odigo_places_v1_bak_at';
  var DB_NAME = 'odigo_secure', DB_STORE = 'keys', KEY_ID = 'device_v1';
  var FILE_PASSWORD = '2026';
  var KEEP_BAK_DAYS = 7;

  var CRYPTO_OK = !!(window.crypto && crypto.subtle && window.TextEncoder && window.indexedDB);
  var enc = window.TextEncoder ? new TextEncoder() : null, dec = window.TextDecoder ? new TextDecoder() : null;

  function b64(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
  function unb64(s) { var bin = atob(s), b = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; }
  function kstNow() { return new Date(Date.now() + 9 * 3600000).toISOString().replace('Z', '+09:00'); }
  function rawGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function rawSet(k, v) { localStorage.setItem(k, v); }   /* 실패는 호출한 쪽에서 처리 */
  function rawDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  /* ───────── 기기 키 (IndexedDB 금고) ───────── */
  function idb() {
    return new Promise(function (res, rej) {
      var rq;
      try { rq = indexedDB.open(DB_NAME, 1); } catch (e) { rej(e); return; }
      rq.onupgradeneeded = function () { rq.result.createObjectStore(DB_STORE); };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
      rq.onblocked = function () { rej(new Error('blocked')); };
    });
  }
  function idbGet(db) {
    return new Promise(function (res, rej) {
      var t = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(KEY_ID);
      t.onsuccess = function () { res(t.result || null); }; t.onerror = function () { rej(t.error); };
    });
  }
  function idbPut(db, key) {
    return new Promise(function (res, rej) {
      var tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(key, KEY_ID);
      tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); };
    });
  }
  var keyP = null;
  /* create=false 이면 키가 없을 때 null (자료가 있는데 키가 없는 경우를 구분하려고) */
  function deviceKey(create) {
    if (keyP) return keyP;
    var p = idb().then(function (db) {
      return idbGet(db).then(function (k) {
        if (k) return k;
        if (!create) return null;
        return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']).then(function (nk) {
          return idbPut(db, nk).then(function () { return idbGet(db); });   /* 실제로 저장됐는지 다시 읽어 확인 */
        });
      });
    });
    p = p.then(function (k) { if (k) keyP = Promise.resolve(k); return k; });
    return p;
  }

  function encryptVault(obj) {
    return deviceKey(true).then(function (key) {
      if (!key) throw new Error('nokey');
      var iv = crypto.getRandomValues(new Uint8Array(12));
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(JSON.stringify(obj))).then(function (ct) {
        return { odigoSecure: true, secureType: 'device-vault', version: 1, savedAt: kstNow(), algorithm: 'AES-GCM', iv: b64(iv.buffer), ciphertext: b64(ct) };
      });
    });
  }
  function decryptVault(wrap) {
    return deviceKey(false).then(function (key) {
      if (!key) { var e = new Error('keylost'); e.code = 'keylost'; throw e; }
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(wrap.iv) }, key, unb64(wrap.ciphertext)).then(function (pt) {
        return JSON.parse(dec.decode(pt));
      }, function () { var e = new Error('badkey'); e.code = 'keylost'; throw e; });
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
  function sameMigration(a, b) {
    if (a.sites.length !== b.sites.length || a.visits.length !== b.visits.length) return false;
    for (var i = 0; i < a.sites.length; i++) {
      var x = a.sites[i], y = b.sites[i];
      if (x.id !== y.id || x.lat !== y.lat || x.lng !== y.lng || x.memo !== y.memo) return false;
    }
    var ea = a.visits.reduce(function (n, v) { return n + v.events.length; }, 0), eb = b.visits.reduce(function (n, v) { return n + v.events.length; }, 0);
    return ea === eb;
  }

  /* ───────── 저장 (순서대로, 잦은 저장은 묶음) ───────── */
  var chain = Promise.resolve(), pending = null, timer = null, blocked = false;
  function writeNow(data) {
    if (blocked) return Promise.reject(new Error('blocked'));
    return encryptVault(data).then(function (w) { rawSet(VAULT_KEY, JSON.stringify(w)); });
  }
  /* 실패는 OdigoStore.onError(e)로 알림 (화면에서 토스트) */
  function report(e) { try { if (window.OdigoStore.onError) window.OdigoStore.onError(e); } catch (x) {} }
  function save(data) {
    pending = data;
    clearTimeout(timer);
    timer = setTimeout(flush, 250);
  }
  function flush() {
    clearTimeout(timer);
    if (!pending) return chain;
    var d = pending; pending = null;
    chain = chain.then(function () { return writeNow(d); }).catch(report);
    return chain;
  }
  window.addEventListener('pagehide', function () { if (pending) flush(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden && pending) flush(); });

  /* ───────── 열기 ─────────
     결과 status: 'ok' | 'new' | 'migrated' | 'nocrypto' | 'keylost' | 'migratefail'
     keylost·nocrypto 이면 저장을 막아(blocked) 남아 있는 암호 자료를 덮어쓰지 않는다 */
  function open(todayStr) {
    if (!CRYPTO_OK) { blocked = true; return Promise.resolve({ status: 'nocrypto', data: emptyData() }); }
    var raw = rawGet(VAULT_KEY);
    if (raw) {
      var w; try { w = JSON.parse(raw); } catch (e) { w = null; }
      if (!w || !w.odigoSecure) { blocked = true; return Promise.resolve({ status: 'keylost', data: emptyData() }); }
      return decryptVault(w).then(function (d) {
        cleanupBak();
        return { status: 'ok', data: normalize(d) };
      }, function () { blocked = true; return { status: 'keylost', data: emptyData() }; });
    }
    var legacyRaw = rawGet(LEGACY_KEY), legacy = null;
    try { legacy = JSON.parse(legacyRaw); } catch (e) { legacy = null; }
    if (!Array.isArray(legacy) || !legacy.length) {
      /* 새 사용자: 키부터 만들어 둠(실패하면 저장 불가) */
      return deviceKey(true).then(function (k) {
        if (!k) throw new Error('nokey');
        return { status: 'new', data: emptyData() };
      }).catch(function () { blocked = true; return { status: 'nocrypto', data: emptyData() }; });
    }
    /* v2.3 자료 옮기기 */
    var d = fromLegacy(legacy, todayStr);
    return encryptVault(d).then(function (w) {
      rawSet(VAULT_KEY, JSON.stringify(w));
      return decryptVault(JSON.parse(rawGet(VAULT_KEY)));
    }).then(function (back) {
      back = normalize(back);
      if (!sameMigration(d, back)) throw new Error('verify');
      rawSet(BAK_KEY, legacyRaw);
      rawSet(BAK_AT_KEY, String(Date.now()));
      rawDel(LEGACY_KEY);
      return { status: 'migrated', data: back, count: back.sites.length };
    }).catch(function () {
      rawDel(VAULT_KEY);   /* 검증 안 된 새 저장본은 버리고 v2.3 자료는 그대로 둠 */
      blocked = true;
      return { status: 'migratefail', data: d };
    });
  }
  function cleanupBak() {
    var at = Number(rawGet(BAK_AT_KEY) || 0);
    if (at && Date.now() - at > KEEP_BAK_DAYS * 86400000) { rawDel(BAK_KEY); rawDel(BAK_AT_KEY); }
  }
  /* 열쇠를 잃었을 때 사용자가 「새로 시작」을 고르면: 열 수 없는 자료는 지우지 않고 이름을 바꿔 보관 */
  function startOver() {
    var raw = rawGet(VAULT_KEY);
    if (raw) { try { rawSet(VAULT_KEY + '_unreadable_' + Date.now(), raw); } catch (e) { return Promise.reject(e); } rawDel(VAULT_KEY); }
    keyP = null;
    return deviceKey(true).then(function (k) { if (!k) throw new Error('nokey'); blocked = false; return emptyData(); });
  }

  /* ───────── 백업 파일 (암호 2026) ───────── */
  function deriveFileKey(pw, salt, iter) {
    return crypto.subtle.importKey('raw', enc.encode(String(pw)), { name: 'PBKDF2' }, false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  function exportFile(payload, scope, appVersion) {
    var salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), iter = 210000;
    return deriveFileKey(FILE_PASSWORD, salt, iter).then(function (k) {
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
  function err(c) { var e = new Error(c); e.code = c; return e; }

  window.OdigoStore = {
    CRYPTO_OK: CRYPTO_OK, FILE_PASSWORD: FILE_PASSWORD,
    open: open, save: save, flush: flush, startOver: startOver,
    isBlocked: function () { return blocked; },
    fromLegacy: fromLegacy, exportFile: exportFile, importFile: importFile, uid: uid
  };
})();
