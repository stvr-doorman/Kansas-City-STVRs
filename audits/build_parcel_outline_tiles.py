"""Build geometry-only viewport tiles from the original saved city parcels."""
import gzip
import json
import math
import re
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/gis_parcels/outlines'
ZOOM = 14

def tile(lon, lat):
    n = 2 ** ZOOM
    return int((lon + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)

def coordinates(value):
    if isinstance(value[0], (int, float)):
        yield value
    else:
        for child in value:
            yield from coordinates(child)

def main():
    tiles = defaultdict(dict)
    with gzip.open(ROOT/'data/gis_parcels/search_index.json.gz','rt',encoding='utf-8') as source:
        address_records={r[7]:(r[2],r[5]) for r in json.load(source)['records']}
    border_index=ROOT/'data/border_parcels/search_index.json.gz'
    if border_index.exists():
        with gzip.open(border_index,'rt',encoding='utf-8') as source:
            address_records.update({r[0]:(r[2],r[5]) for r in json.load(source)['records']})
    paths=sorted((ROOT / 'data/gis_parcels/raw').glob('*.geojson.gz'))
    border=ROOT/'data/border_parcels/features.json.gz'
    if border.exists():paths.append(border)
    for path in paths:
        with gzip.open(path, 'rt', encoding='utf-8') as source:
            for feature in json.load(source)['features']:
                geometry = feature.get('geometry')
                if not geometry:
                    continue
                points = list(coordinates(geometry['coordinates']))
                west, east = min(p[0] for p in points), max(p[0] for p in points)
                south, north = min(p[1] for p in points), max(p[1] for p in points)
                x0, y0 = tile(west, north)
                x1, y1 = tile(east, south)
                oid = feature['properties'].get('border_id') or feature['properties']['OBJECTID']
                address,point=address_records.get(oid,('',None))
                number=re.match(r'^\s*(\d+[A-Za-z]?(?:-\d+)?)\b',address or '')
                reduced = dict(type='Feature', geometry=geometry, properties=dict(objectid=oid,address_number=number.group(1) if number else '',address_point=point))
                for x in range(x0, x1 + 1):
                    for y in range(y0, y1 + 1):
                        tiles[f'{x}-{y}'][oid] = reduced
    OUT.mkdir(parents=True, exist_ok=True)
    for key, features in tiles.items():
        with gzip.open(OUT / f'{key}.json.gz', 'wt', encoding='utf-8') as target:
            json.dump(dict(type='FeatureCollection', features=list(features.values())), target, separators=(',', ':'))
    (OUT / 'manifest.json').write_text(json.dumps(dict(zoom=ZOOM, tiles={k:len(v) for k,v in tiles.items()})), encoding='utf-8')
    print(f'Built {len(tiles)} geometry-only parcel tiles.')

if __name__ == '__main__':
    main()
