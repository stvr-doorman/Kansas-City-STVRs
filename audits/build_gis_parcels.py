"""Resumable full KCMO parcel capture, search index and area plot denominators.

Run after build_area_boundaries.py and build_area_housing.py. Requires requests,
shapely, pyproj. Raw city GeoJSON and metadata are retained, without changing
any original permit/listing input. Never derive dwelling units from parcel count.
"""
import gzip
import json
import time
from pathlib import Path
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import Counter
import requests
from shapely.geometry import shape
from shapely.ops import unary_union, transform
from shapely.strtree import STRtree
from shapely import make_valid
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/gis_parcels'
SOURCE = 'https://mapd.kcmo.org/kcgis/rest/services/AGOL/MapServer/6'
RESIDENTIAL = {1111,1112,1121,1122,1123,1124,1125,1126}
SINGLE_FAMILY = {1111,1121}

def get_json(url, **params):
    for attempt in range(4):
        try:
            # Large object-ID batches exceed URL limits; use ArcGIS POST queries.
            response = requests.post(url, data={'f':'json', **params}, timeout=120) if 'objectIds' in params else requests.get(url, params={'f':'json', **params}, timeout=120)
            response.raise_for_status()
            result = response.json()
            if result.get('error') or result.get('exceededTransferLimit'):
                raise RuntimeError(f'Incomplete GIS response: {result.get("error", "transfer limit")}')
            return result
        except RuntimeError:
            raise
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))

def save_json(path, value):
    path.write_text(json.dumps(value, separators=(',', ':')), encoding='utf-8')

def main():
    OUT.mkdir(exist_ok=True)
    raw = OUT / 'raw'
    raw.mkdir(exist_ok=True)
    capture_path = OUT / 'capture.json'
    if capture_path.exists():
        capture = json.loads(capture_path.read_text(encoding='utf-8'))
    else:
        metadata = get_json(SOURCE)
        expected = get_json(SOURCE + '/query', where='1=1', returnCountOnly='true')['count']
        ids = sorted(get_json(SOURCE + '/query', where='1=1', returnIdsOnly='true')['objectIds'])
        if len(ids) != expected or len(set(ids)) != expected:
            raise RuntimeError('Source count / object ID inventory mismatch')
        save_json(OUT / 'layer_metadata.json', metadata)
        capture = dict(source=SOURCE, downloaded_at=datetime.now(timezone.utc).isoformat(), expected_count=expected, object_ids=ids, chunk_size=4000)
        save_json(capture_path, capture)
    batches = [capture['object_ids'][i:i+capture['chunk_size']] for i in range(0,len(capture['object_ids']),capture['chunk_size'])]
    def fetch_features(ids):
        try:
            return get_json(SOURCE + '/query', f='geojson', objectIds=','.join(map(str, ids)), outFields='*', outSR=4326, returnGeometry='true')['features']
        except RuntimeError as error:
            if len(ids) > 1:
                midpoint = len(ids) // 2
                return fetch_features(ids[:midpoint]) + fetch_features(ids[midpoint:])
            # Retain any source record whose geometry the public service cannot export.
            records = get_json(SOURCE + '/query', objectIds=str(ids[0]), outFields='*', returnGeometry='false')['features']
            return [dict(type='Feature',geometry=None,properties=f['attributes'],geometry_unavailable=str(error)) for f in records]
    def fetch_batch(item):
        index, ids = item
        path = raw / f'{index:04d}.geojson.gz'
        if path.exists():
            with gzip.open(path, 'rt', encoding='utf-8') as source:
                result = json.load(source)
        else:
            result = dict(type='FeatureCollection', features=fetch_features(ids))
            with gzip.open(path, 'wt', encoding='utf-8') as target:
                json.dump(result, target, separators=(',', ':'))
        actual = [int(f['properties']['OBJECTID']) for f in result.get('features', [])]
        if set(actual) != set(ids) or len(actual) != len(ids):
            raise RuntimeError(f'Chunk {index}: object ID mismatch')
        return index, len(actual)
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(fetch_batch, item) for item in enumerate(batches)]
        for future in as_completed(futures):
            index, count = future.result()
            print(f'Validated parcel chunk {index + 1}/{len(batches)}: {count:,} original records', flush=True)
    print('Building deduplicated parcel counts and search index...', flush=True)
    areas = json.loads((ROOT / 'data/area_boundaries.json').read_text(encoding='utf-8'))
    spatial = json.loads((ROOT / 'data/spatial.json').read_text(encoding='utf-8'))
    project = Transformer.from_crs(4326, 26915, always_xy=True).transform
    city = transform(project, unary_union([shape(f['geometry']) for f in spatial['boundary']['features']]))
    trees = {}
    for key, layer in areas['layers'].items():
        geometries = [shape(f['geometry']) for f in layer['features']]
        trees[key] = (STRtree(geometries), geometries, layer['features'])
    original = {}
    records_without_id = 0
    for index in range(len(batches)):
        with gzip.open(raw / f'{index:04d}.geojson.gz', 'rt', encoding='utf-8') as source:
            for feature in json.load(source)['features']:
                parcel = ''.join(c for c in str(feature['properties'].get('KIVAPIN') or '').upper() if c.isalnum())
                if not parcel:
                    records_without_id += 1
                    continue
                original.setdefault(parcel, []).append((index, feature))
    totals = {str(buffer): {key: {} for key in trees} for buffer in range(-550,551,50)}
    scope_totals = {str(buffer): dict(plots=0,residential=0,unknown=0) for buffer in range(-550,551,50)}
    index_records = []
    permits = json.loads((ROOT / 'data/permits.json').read_text(encoding='utf-8'))
    permit_ids = {''.join(c for c in str(value or '').upper() if c.isalnum()) for permit in permits for value in [permit.get('parcel'), *permit.get('parcels', [])] if value}
    permit_parcel_records = []
    landuses = Counter()
    missing_geometry = 0
    conflicting_landuse = 0
    for number, (parcel, features) in enumerate(original.items()):
        chunk, first = features[0]
        attrs = first['properties']
        codes = {int(f['properties']['LANDUSECODE']) for _,f in features if f['properties'].get('LANDUSECODE') is not None}
        landuse = next(iter(codes)) if len(codes) == 1 else None
        if len(codes) > 1:
            conflicting_landuse += 1
        landuses[str(landuse)] += 1
        geometries = [make_valid(shape(f['geometry'])) for _,f in features if f.get('geometry')]
        if not geometries:
            missing_geometry += 1
            continue
        geometry = unary_union(geometries)
        point = geometry.representative_point()
        projected = transform(project, point)
        distance = city.boundary.distance(projected)
        if not city.covers(projected):
            distance = -distance
        assignments = {}
        for key, (tree, polygons, area_features) in trees.items():
            candidates = [int(i) for i in tree.query(point) if polygons[int(i)].covers(point)]
            if len(candidates) == 1:
                assignments[key] = area_features[candidates[0]]['properties']['area_id']
        for buffer in range(-550,551,50):
            if distance < -buffer:
                continue
            scope_totals[str(buffer)]['plots'] += 1
            scope_totals[str(buffer)]['residential'] += int(landuse in RESIDENTIAL)
            scope_totals[str(buffer)]['unknown'] += int(landuse is None)
            for key, area_id in assignments.items():
                count = totals[str(buffer)][key].setdefault(area_id, dict(plots=0,residential=0,single_family=0,other=0,unknown=0))
                count['plots'] += 1
                count['residential'] += int(landuse in RESIDENTIAL)
                count['single_family'] += int(landuse in SINGLE_FAMILY)
                count['other'] += int(landuse is not None and landuse not in RESIDENTIAL)
                count['unknown'] += int(landuse is None)
        if parcel in permit_ids:
            permit_parcel_records.append(dict(parcel=parcel,areas=assignments,boundary_distance_m=distance))
        # Compact offline address / APN / owner / plat / lot / block / legal search.
        index_records.append([parcel, attrs.get('APN') or '', attrs.get('ADDRESS') or '', attrs.get('OWN_NAME') or '', landuse, [point.x,point.y], chunk, attrs['OBJECTID'], attrs.get('PLATNAME') or '', attrs.get('LOT') or '', attrs.get('BLOCK') or '', attrs.get('LEGAL') or '', assignments, round(distance,3)])
        if number and number % 25000 == 0:
            print(f'Indexed {number:,}/{len(original):,} unique parcels', flush=True)
    metadata = json.loads((OUT / 'layer_metadata.json').read_text(encoding='utf-8'))
    field = next(f for f in metadata['fields'] if f['name'] == 'LANDUSECODE')
    domains = {str(v['code']):v['name'] for v in field['domain']['codedValues']}
    report = dict(source=SOURCE, downloaded_at=capture['downloaded_at'], source_record_count=capture['expected_count'], unique_parcels=len(original), searchable_parcels=len(index_records), missing_parcel_id_records=records_without_id, missing_geometry_parcels=missing_geometry, conflicting_landuse_parcels=conflicting_landuse, landuse_counts=landuses, residential_codes=sorted(RESIDENTIAL), single_family_codes=sorted(SINGLE_FAMILY), method='Count unique original KIVAPIN parcel IDs, assigned by a point inside the original parcel boundary. Residential land-use codes 1111,1112,1121-1126; vacant residential and common areas excluded. Parcels are not dwelling units. No housing-unit field is supplied by this GIS layer.', totals=totals, scope_totals=scope_totals, landuse_labels=domains,permit_parcel_records=permit_parcel_records)
    save_json(OUT / 'area_counts.json', report)
    with gzip.open(OUT / 'search_index.json.gz', 'wt', encoding='utf-8') as target:
        json.dump(dict(source=SOURCE, downloaded_at=capture['downloaded_at'], fields=['parcel','apn','address','owner','landuse','point','chunk','objectid','plat','lot','block','legal','areas','boundary_distance_m'], landuse_labels=domains, records=index_records), target, separators=(',', ':'))
    print(f'Complete: {len(index_records):,} searchable parcels from {capture["expected_count"]:,} original GIS records.', flush=True)

if __name__ == '__main__':
    main()
