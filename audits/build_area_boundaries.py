"""Refresh official area polygons and approximate listing assignments.

Run from the project root with Python (requests, shapely, pyproj).
Original listings and permits are never modified.
"""
import json
from pathlib import Path
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
import requests
from shapely.geometry import shape, mapping, Point
from shapely.ops import transform, unary_union
from shapely import make_valid
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
CITY = 'https://mapd.kcmo.org/kcgis/rest/services/AGOL/MapServer/'
CENSUS = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2025/MapServer/'
SPECS = [
    ('neighborhood', 'Neighborhoods', CITY + '4', 'NBHNAME', 'City census-neighborhood boundaries; neighborhood associations may differ.'),
    ('zip', 'ZIP codes', CITY + '15', 'ZIP', 'City GIS ZIP-area polygons; postal delivery routes and mailing ZIPs may differ.'),
    ('council', 'Council districts', CITY + '14', 'DISTRICT', 'City council boundaries from the city GIS Council Districts - 2021 layer.'),
    ('plan', 'Area plans', CITY + '3', 'NAME', 'City land-use planning areas.'),
    ('county', 'Counties', CITY + '23', 'COUNTYNAME', 'County boundaries from city GIS.'),
    ('tract', 'Census tracts', CENSUS + '8', 'GEOID', 'Census TIGERweb ACS 2025 tract boundaries; GEOID uniquely identifies each tract.'),
]

def query(url, **params):
    response = requests.get(url + '/query', params=dict(f='geojson', where='1=1', outFields='*', outSR=4326, **params), timeout=90)
    response.raise_for_status()
    data = response.json()
    if 'error' in data or data.get('exceededTransferLimit'):
        raise RuntimeError(f'Incomplete response from {url}: {data.get("error", "transfer limit")}')
    return data

def main():
    spatial = json.loads((ROOT / 'data/spatial.json').read_text(encoding='utf-8'))
    boundary = spatial['boundary']
    city = unary_union([shape(f['geometry']) for f in boundary['features']]) if boundary['type'] == 'FeatureCollection' else shape(boundary['geometry'])
    forward = Transformer.from_crs(4326, 26915, always_xy=True).transform
    reverse = Transformer.from_crs(26915, 4326, always_xy=True).transform
    extent = transform(reverse, transform(forward, city).buffer(550))
    envelope = ','.join(str(v) for v in extent.bounds)
    listings = json.loads((ROOT / 'data/listings.json').read_text(encoding='utf-8'))
    mapped = [(str(l['listing_id']), Point(l['point'])) for l in listings if l.get('point')]
    def build(spec):
        key, title, url, field, note = spec
        raw = query(url, geometry=envelope, geometryType='esriGeometryEnvelope', inSR=4326, spatialRel='esriSpatialRelIntersects')
        groups = {}
        for f in raw['features']:
            value = f['properties'].get(field)
            # Missing city names must not merge disconnected areas into "None".
            name = str(value) if value is not None and str(value).strip() else f'Unnamed city area (source {f["properties"]["OBJECTID"]})'
            groups.setdefault(name, []).append(make_valid(shape(f['geometry'])))
        features, geometries = [], []
        for name, parts in sorted(groups.items()):
            original = unary_union(parts)
            clipped = original.intersection(extent)
            if clipped.is_empty or clipped.area < 1e-10:
                continue
            polygons = [clipped] if clipped.geom_type in ('Polygon', 'MultiPolygon') else [g for g in clipped.geoms if g.geom_type in ('Polygon', 'MultiPolygon')]
            clipped = unary_union(polygons)
            if clipped.is_empty:
                continue
            area_id = f'{key}:{name}'
            label = 'District ' + name if key == 'council' else 'Tract ' + name if key == 'tract' else name
            anchor = clipped.representative_point()
            geometries.append((area_id, original))
            features.append(dict(type='Feature', geometry=mapping(clipped), properties=dict(area_id=area_id, name=label, anchor=[anchor.x, anchor.y])))
        assignments, ambiguous = {}, []
        for listing_id, point in mapped:
            matches = [area_id for area_id, polygon in geometries if polygon.covers(point)]
            if len(matches) == 1:
                assignments[listing_id] = matches[0]
            elif len(matches) > 1:
                ambiguous.append(listing_id)
        result = dict(title=title, source=url, note=note, type='FeatureCollection', features=features, assignments=assignments, ambiguous=ambiguous)
        print(f'{title}: {len(features)} areas, {len(assignments)} assigned, {len(ambiguous)} ambiguous', flush=True)
        return key, result
    layers = dict(ThreadPoolExecutor(max_workers=6).map(build, SPECS))
    output = dict(downloaded_at=datetime.now(timezone.utc).isoformat(), points={listing_id: [point.x, point.y] for listing_id, point in mapped}, display_clip='Kansas City boundary plus 550 m, supporting the existing edge buffer.', count_method='Unique listing IDs assigned by approximate marker point; overlaps remain unassigned. Counts are listings, not properties or verified STRs.', layers=layers)
    (ROOT / 'data/area_boundaries.json').write_text(json.dumps(output, separators=(',', ':')), encoding='utf-8')

if __name__ == '__main__':
    main()
