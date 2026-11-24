# -*- coding: utf-8 -*-
"""GIS 3조 최종 웹앱(mju-housing-map)용 정적 JSON/GeoJSON 패키지 생성 스크립트.

원본 소스 E:\\jae\\gis\\gis_project_final (읽기 전용)에서
GitHub Pages용 경량 정적 데이터 폴더 E:\\jae\\gis\\mju-housing-map\\data\\ 를 생성한다.
"""

import json
import math
import os
import shutil
import sys
from osgeo import gdal, ogr, osr

sys.stdout.reconfigure(encoding='utf-8')
gdal.UseExceptions()
ogr.UseExceptions()

SRC_ROOT = r'E:\jae\gis\gis_project_final'
SRC_WEB = os.path.join(SRC_ROOT, 'web_data')
SRC_VEC = os.path.join(SRC_ROOT, 'vector')

OUT_ROOT = r'E:\jae\gis\mju-housing-map'
OUT_DATA = os.path.join(OUT_ROOT, 'data')

# 명지대학교 자연캠퍼스 정문 (WGS84 lon, lat)
MJU_GATE_LON = 127.18804
MJU_GATE_LAT = 37.22677


def haversine_m(lon1, lat1, lon2, lat2):
    r = 6371000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2.0) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2.0) ** 2
    return int(round(2.0 * r * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))))


def round_coords(obj, prec=5):
    if isinstance(obj, list):
        if len(obj) >= 2 and isinstance(obj[0], (int, float)) and isinstance(obj[1], (int, float)):
            return [round(float(obj[0]), prec), round(float(obj[1]), prec)]
        return [round_coords(x, prec) for x in obj]
    return obj


def extract_outer_rings(geom_dict, prec=5):
    gtype = geom_dict.get('type')
    coords = geom_dict.get('coordinates', [])
    rings = []
    if gtype == 'Polygon':
        if coords:
            rings.append(round_coords(coords[0], prec))
    elif gtype == 'MultiPolygon':
        for poly in coords:
            if poly:
                rings.append(round_coords(poly[0], prec))
    return rings


def transform_geom_to_wgs84(geom, ct, simplify_m=0.0):
    g = geom.Clone()
    if simplify_m > 0:
        g = g.SimplifyPreserveTopology(simplify_m)
    g.Transform(ct)
    return json.loads(g.ExportToJson())


def write_json(path, obj):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))


def build_buildings(weights_presets):
    with open(os.path.join(SRC_WEB, 'buildings_resid.geojson'), encoding='utf-8') as f:
        pts_fc = json.load(f)
    with open(os.path.join(SRC_WEB, 'buildings_resid_poly.geojson'), encoding='utf-8') as f:
        poly_fc = json.load(f)

    poly_by_id = {}
    for ft in poly_fc['features']:
        pid = ft['properties']['id']
        poly_by_id[pid] = extract_outer_rings(ft['geometry'], prec=5)

    w_tot = weights_presets['presets']['total']['w']
    w_male = weights_presets['presets']['male']['w']
    w_fem = weights_presets['presets']['female']['w']

    records = []
    max_err = 0.0
    for ft in pts_fc['features']:
        prp = ft['properties']
        bid = prp['id']
        lon, lat = ft['geometry']['coordinates']
        lon = round(float(lon), 5)
        lat = round(float(lat), 5)
        assert 127.15 <= lon <= 127.25, f'Unexpected lon: {lon}'
        assert 37.20 <= lat <= 37.27, f'Unexpected lat: {lat}'

        scores = [float(v) for v in prp['s']]
        assert len(scores) == 7, f'Unexpected factor count for {bid}'

        for stored, wvec in ((prp['st'], w_tot), (prp['sm'], w_male), (prp['sf'], w_fem)):
            recalc = sum(a * b for a, b in zip(scores, wvec))
            err = abs(recalc - float(stored))
            if err > max_err:
                max_err = err
            assert err < 0.001, f'Score parity mismatch for {bid}: {recalc} vs {stored}'

        rings = poly_by_id.get(bid, [])
        assert len(rings) >= 1, f'Missing polygon ring for {bid}'

        dist_m = haversine_m(lon, lat, MJU_GATE_LON, MJU_GATE_LAT)

        nm_val = (prp.get('nm') or '').strip()
        cat_val = prp['cat']
        fl_val = prp.get('fl') or 0
        pr_val = prp.get('pr')
        ps_val = prp.get('ps') or ''
        pc_val = prp.get('pc') or 0

        # 고층 단지형 아파트가 빌라/다세대로 분류된 경우 보정
        if cat_val != '오피스텔' and (
            'ROYALDUKE' in nm_val.upper()
            or '삼라마이다스빌' in nm_val
            or fl_val >= 15
        ):
            cat_val = '아파트'

        # 아파트는 자취 전월세 실거래 수집 대상이 아니므로(실측 2건 제외)
        # 인접 원룸·오피스텔 도로 평균 역투영값으로 오인되지 않도록 미수집 처리
        if cat_val == '아파트' and ps_val != '실측':
            pr_val = None
            ps_val = '미수집'
            pc_val = 0

        records.append({
            'id': bid,
            'nm': nm_val,
            'd': prp['d'],
            'z': prp['z'],
            'zn': prp['zn'],
            'cat': cat_val,
            'yr': prp.get('yr'),
            'age': prp.get('age'),
            'fl': fl_val,
            'elv': prp.get('elv'),
            'slp': prp.get('slp'),
            'pr': pr_val,
            'ps': ps_val,
            'pc': pc_val,
            'rd': prp.get('rd') or '',
            's': scores,
            'c': [lon, lat],
            'dist': dist_m,
            'p': rings,
        })

    assert len(records) == 1910, f'Expected 1910 residential buildings, got {len(records)}'
    out_path = os.path.join(OUT_DATA, 'buildings.json')
    write_json(out_path, records)
    print(f'[1/3] buildings.json 생성 완료: {len(records)}동, 가중점수 최대오차={max_err:.6f}')


def build_context():
    with open(os.path.join(SRC_WEB, 'admin_boundary.geojson'), encoding='utf-8') as f:
        admin_fc = json.load(f)
    with open(os.path.join(SRC_WEB, 'rail_and_landmarks.geojson'), encoding='utf-8') as f:
        rail_lm_fc = json.load(f)

    sr5186 = osr.SpatialReference()
    sr5186.ImportFromEPSG(5186)
    sr5186.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)

    sr4326 = osr.SpatialReference()
    sr4326.ImportFromEPSG(4326)
    sr4326.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)

    ct = osr.CoordinateTransformation(sr5186, sr4326)

    def check_xy(lon, lat):
        assert 127.15 <= lon <= 127.26 and 37.19 <= lat <= 37.28, f'Out of Yongin bounds: {(lon, lat)}'

    # 수계 폴리곤
    water_rings = []
    ds_w = ogr.Open(os.path.join(SRC_VEC, 'water_area_2dong.shp'))
    for ft in ds_w.GetLayer(0):
        g = ft.GetGeometryRef()
        if g is None or g.IsEmpty():
            continue
        gj = transform_geom_to_wgs84(g, ct, simplify_m=4.0)
        for ring in extract_outer_rings(gj, prec=5):
            if len(ring) >= 3:
                check_xy(ring[0][0], ring[0][1])
                water_rings.append(ring)
    ds_w = None

    # 도로 중심선 (25m 이상만 추출하여 백지도 윤곽 유지 + 용량 경량화)
    road_lines = []
    ds_r = ogr.Open(os.path.join(SRC_VEC, 'roads_centerline_2dong.shp'))
    for ft in ds_r.GetLayer(0):
        g = ft.GetGeometryRef()
        if g is None or g.IsEmpty() or g.Length() < 25.0:
            continue
        gj = transform_geom_to_wgs84(g, ct, simplify_m=6.0)
        gtype = gj.get('type')
        coords = gj.get('coordinates', [])
        if gtype == 'LineString' and len(coords) >= 2:
            rc = round_coords(coords, 5)
            check_xy(rc[0][0], rc[0][1])
            road_lines.append(rc)
        elif gtype == 'MultiLineString':
            for seg in coords:
                if len(seg) >= 2:
                    rc = round_coords(seg, 5)
                    check_xy(rc[0][0], rc[0][1])
                    road_lines.append(rc)
    ds_r = None

    # 비주거·캠퍼스·상업 등 배경 건물 윤곽 (IS_RESID == 0, 100m² 이상)
    bg_rings = []
    ds_b = ogr.Open(os.path.join(SRC_VEC, 'buildings_integrated.shp'))
    for ft in ds_b.GetLayer(0):
        if int(ft.GetField('IS_RESID') or 0) != 0:
            continue
        g = ft.GetGeometryRef()
        if g is None or g.IsEmpty() or g.GetArea() < 100.0:
            continue
        gj = transform_geom_to_wgs84(g, ct, simplify_m=2.5)
        for ring in extract_outer_rings(gj, prec=5):
            if len(ring) >= 3:
                check_xy(ring[0][0], ring[0][1])
                bg_rings.append(ring)
    ds_b = None

    ctx = {
        'admin': admin_fc,
        'rail_and_landmarks': rail_lm_fc,
        'water': water_rings,
        'roads': road_lines,
        'bg_buildings': bg_rings,
    }
    out_path = os.path.join(OUT_DATA, 'context.json')
    write_json(out_path, ctx)
    print(
        f'[2/3] context.json 생성 완료: 수계={len(water_rings)}, '
        f'도로={len(road_lines)}, 배경건물={len(bg_rings)}'
    )


def copy_static_files():
    for fname in ('micro_zones.geojson', 'roads_rent.geojson', 'weights_presets.json', 'manifest.json'):
        shutil.copy2(os.path.join(SRC_WEB, fname), os.path.join(OUT_DATA, fname))
    print('[3/3] micro_zones / roads_rent / weights_presets / manifest 복사 완료')


def main():
    os.makedirs(OUT_DATA, exist_ok=True)
    with open(os.path.join(SRC_WEB, 'weights_presets.json'), encoding='utf-8') as f:
        weights_presets = json.load(f)

    build_buildings(weights_presets)
    build_context()
    copy_static_files()

    total_bytes = 0
    print('\n=== 생성된 data/ 파일 용량 ===')
    for fn in sorted(os.listdir(OUT_DATA)):
        fp = os.path.join(OUT_DATA, fn)
        if os.path.isfile(fp):
            sz = os.path.getsize(fp)
            total_bytes += sz
            print(f'  {fn:24s} {sz / 1024:8.1f} KB')
    print(f'  {"TOTAL":24s} {total_bytes / (1024 * 1024):8.2f} MB')


if __name__ == '__main__':
    main()
