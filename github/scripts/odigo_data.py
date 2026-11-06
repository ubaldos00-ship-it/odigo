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




def cctv_page(key, page, cond=None):
    params = {'pageNo': page, 'numOfRows': CCTV_ROWS, 'returnType': 'json'}
    q = urllib.parse.urlencode(params) + ''.join('&' + urllib.parse.quote(a, safe='') + '=' + urllib.parse.quote(b, safe='') for a, b in (cond or []))
    for i in range(5):
        j = get_json(CCTV_URL + '?serviceKey=' + key + '&' + q)
        resp = j.get('response')
        if resp and 'body' in resp:           # 정상 응답
            body = resp['body'] or {}
            items = body.get('items') or []
            if isinstance(items, dict):
                items = items.get('item') or []
            if isinstance(items, dict):
                items = [items]
            return int(body.get('totalCount') or 0), items
        time.sleep(3 + i * 5)                 # {"OpenAPI_ServiceResponse": … HTTP_ERROR} 등 → 다시 시도
    raise RuntimeError('CCTV %d쪽을 받지 못했습니다: %s' % (page, json.dumps(j, ensure_ascii=False)[:150]))


# 개방자치단체코드 목록 (2026-11-06 실측: 이 227개로 전체 381,409행 중 380,095행 = 99.66퍼센트)
# 쪽번호가 깊어지면 API가 느려지다 오류를 내므로(약 1,500쪽~), 자치단체별로 나눠 받는다(가장 큰 곳도 약 16,000행).
CCTV_CODES = [
    '3000000', '3010000', '3020000', '3040000', '3050000', '3060000', '3070000', '3080000', '3090000', '3100000',
    '3110000', '3120000', '3130000', '3140000', '3150000', '3160000', '3170000', '3180000', '3190000', '3200000',
    '3210000', '3220000', '3230000', '3240000', '3250000', '3260000', '3270000', '3280000', '3290000', '3300000',
    '3310000', '3320000', '3330000', '3340000', '3350000', '3360000', '3370000', '3380000', '3390000', '3400000',
    '3410000', '3420000', '3430000', '3440000', '3450000', '3460000', '3470000', '3480000', '3491000', '3501000',
    '3510500', '3520000', '3530000', '3540000', '3550000', '3561000', '3565000', '3570000', '3580000', '3640000',
    '3650000', '3660000', '3670000', '3680000', '3690000', '3700000', '3710000', '3720000', '3740000', '3780000',
    '3820000', '3830000', '3860000', '3900000', '3910000', '3920000', '3930000', '3940000', '3970000', '3980000',
    '3990000', '4000000', '4010000', '4020000', '4030000', '4040000', '4050000', '4060000', '4070000', '4080000',
    '4090000', '4140000', '4160000', '4170000', '4181000', '4191000', '4201000', '4211000', '4221000', '4231000',
    '4241000', '4251000', '4261000', '4271000', '4281000', '4291000', '4301000', '4311000', '4321000', '4331000',
    '4341000', '4351000', '4390000', '4400000', '4420000', '4430000', '4440000', '4450000', '4460000', '4470000',
    '4480000', '4490000', '4500000', '4510000', '4520000', '4530000', '4540000', '4550000', '4570000', '4580000',
    '4590000', '4600000', '4610000', '4620000', '4641000', '4671000', '4681000', '4691000', '4701000', '4711000',
    '4721000', '4731000', '4741000', '4751000', '4761000', '4771000', '4781000', '4791000', '5020000', '5050000',
    '5060000', '5070000', '5080000', '5090000', '5100000', '5110000', '5120000', '5130000', '5141000', '5150000',
    '5160000', '5170000', '5180000', '5190000', '5200000', '5210000', '5220000', '5230000', '5240000', '5250000',
    '5260000', '5310000', '5330000', '5340000', '5350000', '5360000', '5370000', '5380000', '5390000', '5400000',
    '5410000', '5420000', '5430000', '5440000', '5450000', '5460000', '5470000', '5480000', '5540000', '5570000',
    '5580000', '5590000', '5600000', '5670000', '5680000', '5690000', '5700000', '5710000', '5780000', '5785000',
    '5790000', '5795000', '5800000', '5805000', '5810000', '5815000', '5820000', '5825000', '5830000', '5835000',
    '5840000', '5845000', '5850000', '5855000', '5860000', '5865000', '5870000', '5875000', '5880000', '5885000',
    '5890000', '5895000', '5900000', '5905000', '5910000', '6510000', '6520000',
]


def cctv_parts(key):
    """자치단체코드별로 나눠 [(행 수, 조건)] 를 돌려준다. 행이 없는 코드는 뺀다."""
    out = []
    for c in CCTV_CODES:
        cond = [('cond[OPN_ATMY_GRP_CD::EQ]', c)]
        n = cctv_page(key, 1, cond)[0]
        if n:
            out.append((n, cond))
    return out


def build_cctv(key, odigo_dir, cache_dir=None, workers=4):
    parts = cctv_parts(key)
    total = cctv_page(key, 1)[0]
    covered = sum(n for n, _ in parts)
    if covered < total * 0.99:      # 새 자치단체코드가 생겨 1% 넘게 빠지면 목록 갱신이 필요하다는 뜻
        sys.exit('CCTV 자치단체별 합계(%d)가 전체(%d)의 99%%보다 적습니다. CCTV_CODES 목록을 갱신하세요.' % (covered, total))
    total = covered
    jobs = [(pi, p, c) for pi, (n, c) in enumerate(parts) for p in range(1, math.ceil(n / CCTV_ROWS) + 1)]
    print('[CCTV] 전체 %d행 · %d부분 · %d번 요청' % (total, len(parts), len(jobs)), flush=True)

    def one(job):
        pi, p, c = job
        if cache_dir:   # PC에서 중간에 끊겨도 이어받기
            tag = '_'.join(v for _, v in c) or 'all'                       # 나누는 기준이 바뀌어도 섞이지 않게
            fp = os.path.join(cache_dir, 'q%s_%05d.json' % (tag, p))
            if os.path.exists(fp):
                return json.load(open(fp, encoding='utf-8'))
        items = cctv_page(key, p, c)[1]
        if cache_dir:
            with open(fp, 'w', encoding='utf-8') as f:
                json.dump(items, f, ensure_ascii=False)
        return items

    if cache_dir:
        os.makedirs(cache_dir, exist_ok=True)
    raw, done = [], 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for items in ex.map(one, jobs):
            raw.extend(items)
            done += 1
            if done % 200 == 0:
                print('  %d/%d' % (done, len(jobs)), flush=True)
    # 안전장치: 받은 행 수가 전체와 맞아야 저장 (1% 이내 차이는 받는 사이 갱신으로 허용)
    if abs(len(raw) - total) > total * 0.01:
        sys.exit('CCTV 받은 행(%d)이 전체(%d)와 맞지 않아 저장하지 않습니다.' % (len(raw), total))

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
