#!/usr/bin/env python3
"""어디고 공공데이터 자동 갱신 — 주차장 · CCTV 설치 위치

GitHub Actions(매주)와 PC에서 똑같이 쓰는 스크립트.
  키:  환경변수 DATAGOKR_KEY (GitHub Secrets)  →  없으면 ../키보관/datagokr_key.txt
  결과: <odigo 폴더>/data/parking/  (0.5° 격자,  meta.json)
        <odigo 폴더>/data/cctv/     (0.05° 격자, meta.json)

실행 예:
  python3 odigo_data.py odigo                 # 둘 다
  python3 odigo_data.py odigo --only cctv     # CCTV만
키 값은 어떤 경우에도 출력하지 않는다.
"""
import argparse
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
KEY_FILE = os.path.join(HERE, '..', '키보관', 'datagokr_key.txt')
UA = {'User-Agent': 'odigo-data'}


# ───────── 공통 ─────────
def load_key():
    key = os.environ.get('DATAGOKR_KEY', '').strip()
    if not key and os.path.exists(KEY_FILE):
        key = open(KEY_FILE, encoding='utf-8').read().strip()
    if not key:
        sys.exit('인증키가 없습니다 (환경변수 DATAGOKR_KEY 또는 키보관/datagokr_key.txt).')
    return key if '%' in key else urllib.parse.quote(key, safe='')


def get_json(url, tries=5):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', 'replace')
            if 'LIMITED_NUMBER_OF_SERVICE_REQUESTS' in body or 'SERVICE_KEY' in body:
                sys.exit('API 거부: ' + body[:200])          # 한도 초과·키 오류는 재시도해도 소용없음
            err = 'HTTP %d' % e.code
        except Exception as e:
            err = type(e).__name__
        time.sleep(2 + i * 4)
    raise RuntimeError('요청 실패(%s): %s' % (err, url.split('serviceKey=')[0]))


def s(v):
    return v.strip() if isinstance(v, str) else ('' if v is None else str(v))


def num(v):
    try:
        return float(s(v))
    except ValueError:
        return None


def in_korea(lat, lng):
    return lat is not None and lng is not None and 33.0 <= lat <= 38.7 and 124.5 <= lng <= 132.0


def write_cells(out_dir, cells, meta, count_key='count'):
    # 안전장치: 새 자료가 지난번보다 20% 넘게 줄었으면 API 일시 장애로 보고 덮어쓰지 않음
    old = os.path.join(out_dir, 'meta.json')
    if os.path.exists(old):
        try:
            prev = json.load(open(old, encoding='utf-8')).get(count_key) or 0
            if prev and meta.get(count_key, 0) < prev * 0.8:
                sys.exit('자료가 지난번(%d)보다 크게 줄어(%d) 저장하지 않습니다.' % (prev, meta.get(count_key, 0)))
        except ValueError:
            pass
    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        if f.endswith('.json'):
            os.remove(os.path.join(out_dir, f))
    for cid, lst in cells.items():
        with open(os.path.join(out_dir, cid + '.json'), 'w', encoding='utf-8') as f:
            json.dump(lst, f, ensure_ascii=False, separators=(',', ':'))
    meta['cells'] = sorted(cells.keys())
    with open(os.path.join(out_dir, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    size = sum(os.path.getsize(os.path.join(out_dir, f)) for f in os.listdir(out_dir))
    return size


def cell_id(lat, lng, cell):
    return '%d_%d' % (math.floor(lat / cell), math.floor(lng / cell))


# ───────── 주차장 (전국주차장정보표준데이터) ─────────
PARK_URL = 'https://api.data.go.kr/openapi/tn_pubr_prkplce_info_api'
PARK_CELL = 0.5


def park_page(key, page, rows):
    j = get_json(PARK_URL + '?serviceKey=' + key + '&' + urllib.parse.urlencode({'pageNo': page, 'numOfRows': rows, 'type': 'json'}))
    body = (j.get('response') or j)['body']
    items = body.get('items') or []
    if isinstance(items, dict):
        items = items.get('item') or []
    if isinstance(items, dict):
        items = [items]
    return int(body['totalCount']), items


def build_parking(key, odigo_dir):
    total, first = park_page(key, 1, 1000)
    raw = list(first)
    for p in range(2, math.ceil(total / 1000) + 1):
        raw.extend(park_page(key, p, 1000)[1])
        time.sleep(0.2)
    cells, seen, dropped, refs, dis, fee = defaultdict(list), set(), 0, Counter(), Counter(), Counter()
    for r in raw:
        lat, lng = num(r.get('latitude')), num(r.get('longitude'))
        if not in_korea(lat, lng):
            dropped += 1
            continue
        cnt = num(r.get('prkcmprt'))
        c = {
            'n': s(r.get('prkplceNm')) or '이름 없는 주차장', 'se': s(r.get('prkplceSe')), 'ty': s(r.get('prkplceType')),
            'a': s(r.get('rdnmadr')) or s(r.get('lnmadr')), 'la': round(lat, 6), 'lo': round(lng, 6),
            'c': int(cnt) if cnt and cnt > 0 else None, 'od': s(r.get('operDay')),
            'wk': [s(r.get('weekdayOperOpenHhmm')), s(r.get('weekdayOperColseHhmm'))],
            'sa': [s(r.get('satOperOperOpenHhmm')), s(r.get('satOperCloseHhmm'))],
            'ho': [s(r.get('holidayOperOpenHhmm')), s(r.get('holidayCloseOpenHhmm'))],
            'fee': s(r.get('parkingchrgeInfo')), 'bt': s(r.get('basicTime')), 'bc': s(r.get('basicCharge')),
            'ut': s(r.get('addUnitTime')), 'uc': s(r.get('addUnitCharge')), 'dt': s(r.get('dayCmmtkt')), 'mt': s(r.get('monthCmmtkt')),
            'pay': s(r.get('metpay')), 'sp': s(r.get('spcmnt')), 'org': s(r.get('institutionNm')), 'tel': s(r.get('phoneNumber')),
            'dis': s(r.get('pwdbsPpkZoneYn')).upper(), 'ref': s(r.get('referenceDate')),
        }
        k = (c['n'], c['la'], c['lo'])
        if k in seen:
            continue
        seen.add(k)
        refs[c['ref']] += 1
        dis[c['dis'] or '빈칸'] += 1
        fee[c['fee'] or '빈칸'] += 1
        cells[cell_id(c['la'], c['lo'], PARK_CELL)].append(c)
    kept = sum(len(v) for v in cells.values())
    meta = {'source': '공공데이터포털 전국주차장정보표준데이터 (각 지자체)', 'built': date.today().isoformat(),
            'referenceDate': refs.most_common(1)[0][0] if refs else '', 'referenceDates': dict(refs.most_common(5)),
            'count': kept, 'dropped': dropped, 'cell': PARK_CELL, 'disabledZone': dict(dis), 'fee': dict(fee)}
    size = write_cells(os.path.join(odigo_dir, 'data', 'parking'), cells, meta)
    print('[주차장] 원자료 %d · 저장 %d곳 · 격자 %d개 · %.1fMB' % (len(raw), kept, len(cells), size / 1e6))


# ───────── CCTV (행정안전부 CCTV정보 조회서비스) ─────────
CCTV_URL = 'https://apis.data.go.kr/1741000/cctv_info/info'
CCTV_ROWS = 100      # 이 API의 한 번 최대치
CCTV_CELL = 0.05     # 도심은 촘촘해서 주차장보다 작은 격자


def cctv_page(key, page):
    j = get_json(CCTV_URL + '?serviceKey=' + key + '&' + urllib.parse.urlencode({'pageNo': page, 'numOfRows': CCTV_ROWS, 'returnType': 'json'}))
    body = (j.get('response') or j).get('body') or {}
    items = body.get('items') or []
    if isinstance(items, dict):
        items = items.get('item') or []
    if isinstance(items, dict):
        items = [items]
    return int(body.get('totalCount') or 0), items


def build_cctv(key, odigo_dir, cache_dir=None, workers=4):
    total, first = cctv_page(key, 1)
    pages = math.ceil(total / CCTV_ROWS)
    print('[CCTV] 전체 %d행 · %d번 요청' % (total, pages), flush=True)

    def one(p):
        if cache_dir:   # PC에서 중간에 끊겨도 이어받기
            fp = os.path.join(cache_dir, 'p%05d.json' % p)
            if os.path.exists(fp):
                return json.load(open(fp, encoding='utf-8'))
        items = first if p == 1 else cctv_page(key, p)[1]
        if cache_dir:
            with open(fp, 'w', encoding='utf-8') as f:
                json.dump(items, f, ensure_ascii=False)
        return items

    if cache_dir:
        os.makedirs(cache_dir, exist_ok=True)
    raw, done = [], 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for items in ex.map(one, range(1, pages + 1)):
            raw.extend(items)
            done += 1
            if done % 200 == 0:
                print('  %d/%d' % (done, pages), flush=True)

    purposes, groups, dropped, upd, refs = [], {}, 0, Counter(), Counter()
    pidx = {}
    for r in raw:
        upd[s(r.get('DAT_UPDT_SE')) or '빈칸'] += 1
        if s(r.get('DAT_UPDT_SE')) == 'D':      # 삭제 표시 행 제외
            continue
        lat, lng = num(r.get('WGS84_LAT')), num(r.get('WGS84_LOT'))
        if not in_korea(lat, lng):
            dropped += 1
            continue
        pu = s(r.get('INSTL_PRPS_SE_NM')) or '정보 없음'
        if pu not in pidx:
            pidx[pu] = len(purposes)
            purposes.append(pu)
        k = (round(lat, 5), round(lng, 5))
        g = groups.get(k)
        if not g:
            g = groups[k] = {'la': k[0], 'lo': k[1], 'n': 0, 'p': Counter(),
                             'a': s(r.get('LCTN_ROAD_NM_ADDR')) or s(r.get('LCTN_LOTNO_ADDR')),
                             'o': s(r.get('MNG_INST_NM')), 't': s(r.get('MNG_INST_TELNO')),
                             'g': s(r.get('SHT_ANGLE_INFO')), 'r': s(r.get('DAT_CRTR_YMD'))}
        cams = num(r.get('CAM_CNTOM'))
        g['n'] += int(cams) if cams and cams > 0 else 1
        g['p'][pidx[pu]] += 1
        if s(r.get('DAT_CRTR_YMD')) > g['r']:
            g['r'] = s(r.get('DAT_CRTR_YMD'))
        refs[s(r.get('DAT_CRTR_YMD'))] += 1

    cells = defaultdict(list)
    for g in groups.values():
        # [위도, 경도, 대수, [설치목적 번호…], 주소, 관리기관, 전화, 촬영방면, 기준일]
        cells[cell_id(g['la'], g['lo'], CCTV_CELL)].append(
            [g['la'], g['lo'], g['n'], [p for p, _ in g['p'].most_common()], g['a'], g['o'], g['t'], g['g'], g['r']])
    meta = {'source': '행정안전부 CCTV정보 조회서비스 (공공데이터포털)', 'built': date.today().isoformat(),
            'referenceDate': refs.most_common(1)[0][0] if refs else '', 'referenceDates': dict(refs.most_common(5)),
            'rows': len(raw), 'places': len(groups), 'cameras': sum(g['n'] for g in groups.values()),
            'dropped': dropped, 'updateTypes': dict(upd), 'cell': CCTV_CELL, 'purposes': purposes}
    size = write_cells(os.path.join(odigo_dir, 'data', 'cctv'), cells, meta, 'places')
    print('[CCTV] 원자료 %d행 · 위치 %d곳 · 카메라 %d대 · 좌표오류 %d · 격자 %d개 · %.1fMB'
          % (len(raw), len(groups), meta['cameras'], dropped, len(cells), size / 1e6))
    print('       변경구분', dict(upd), '· 설치목적', purposes)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('odigo_dir', help='어디고 폴더 (저장소의 odigo, 또는 어디고/vX.Y)')
    ap.add_argument('--only', choices=['parking', 'cctv'])
    ap.add_argument('--cache', help='CCTV 이어받기용 임시 폴더 (PC에서만)')
    a = ap.parse_args()
    key = load_key()
    if a.only in (None, 'parking'):
        build_parking(key, a.odigo_dir)
    if a.only in (None, 'cctv'):
        build_cctv(key, a.odigo_dir, a.cache)


if __name__ == '__main__':
    main()
