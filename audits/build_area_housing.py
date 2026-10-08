"""Add Census 2020 housing denominators to area_boundaries.json.

Uses Census block internal points to assign housing units to custom boundaries.
Run after build_area_boundaries.py. Source inputs remain unchanged.
"""
import json
from datetime import datetime, timezone
from pathlib import Path
import requests
from shapely.geometry import shape, Point
from shapely.ops import unary_union, transform
from shapely.strtree import STRtree
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'https://tigerweb.geo.census.gov/arcgis/rest/services/Census2020/tigerWMS_Census2020/MapServer/10'

def main():
    path = ROOT / 'data/area_boundaries.json'
    data = json.loads(path.read_text(encoding='utf-8'))
    spatial = json.loads((ROOT / 'data/spatial.json').read_text(encoding='utf-8'))
    city = unary_union([shape(f['geometry']) for f in spatial['boundary']['features']])
    project = Transformer.from_crs(4326, 26915, always_xy=True).transform
    reverse = Transformer.from_crs(26915, 4326, always_xy=True).transform
    projected_city = transform(project, city)
    extent = transform(reverse, projected_city.buffer(550))
    cache = ROOT / 'data/census_2020_housing_blocks.json'
    params = dict(f='json', where='1=1', geometry=','.join(map(str, extent.bounds)), geometryType='esriGeometryEnvelope', inSR=4326, spatialRel='esriSpatialRelIntersects')
    def request(**extra):
        response = requests.get(SOURCE + '/query', params={**params, **extra}, timeout=120)
        response.raise_for_status()
        result = response.json()
        if 'error' in result or result.get('exceededTransferLimit'):
            raise RuntimeError(f'Incomplete Census response: {result.get("error", "transfer limit")}')
        return result
    if cache.exists():
        capture = json.loads(cache.read_text(encoding='utf-8'))
        if capture['query_bounds'] != list(extent.bounds):
            raise RuntimeError('Housing cache bounds changed; retain a backup and refresh the cache.')
    else:
        expected = request(returnCountOnly='true')['count']
        features = request(outFields='GEOID,HU100,INTPTLON,INTPTLAT', returnGeometry='false', orderByFields='GEOID')['features']
        records = [f['attributes'] for f in features]
        if len(records) != expected or len({r['GEOID'] for r in records}) != expected:
            raise RuntimeError(f'Census count mismatch: expected {expected}, received {len(records)}')
        capture = dict(source=SOURCE, downloaded_at=datetime.now(timezone.utc).isoformat(), query_bounds=list(extent.bounds), queried_block_count=expected, records=records)
        cache.write_text(json.dumps(capture, separators=(',', ':')), encoding='utf-8')
    blocks = []
    for record in capture['records']:
        units = int(record['HU100'])
        if units < 0:
            raise RuntimeError('Negative housing count')
        point = Point(float(record['INTPTLON']), float(record['INTPTLAT']))
        if units == 0 or not extent.covers(point):
            continue
        projected_point = transform(project, point)
        distance = projected_city.boundary.distance(projected_point)
        if not projected_city.covers(projected_point):
            distance = -distance
        blocks.append(dict(id=record['GEOID'], units=units, point=[point.x, point.y], boundary_distance_m=distance, areas={}))
    plots_by_id = {}
    for name in ['permit_parcels', 'permit_property_parcels']:
        for feature in json.loads((ROOT / f'data/{name}.geojson').read_text(encoding='utf-8'))['features']:
            parcel = ''.join(c for c in str(feature['properties']['parcel']).upper() if c.isalnum())
            plots_by_id.setdefault(parcel, feature)
    plots = []
    for parcel, feature in plots_by_id.items():
        point = shape(feature['geometry']).representative_point()
        projected_point = transform(project, point)
        distance = projected_city.boundary.distance(projected_point)
        if not projected_city.covers(projected_point):
            distance = -distance
        plots.append(dict(parcel=parcel, point=[point.x, point.y], source_point=feature['properties'].get('point'), boundary_distance_m=distance, areas={}))
    for key, layer in data['layers'].items():
        geometries = [shape(f['geometry']) for f in layer['features']]
        tree = STRtree(geometries)
        assigned = ambiguous = 0
        for block in blocks:
            point = Point(block['point'])
            matches = [int(i) for i in tree.query(point) if geometries[int(i)].covers(point)]
            if len(matches) == 1:
                block['areas'][key] = layer['features'][matches[0]]['properties']['area_id']
                assigned += block['units']
            elif len(matches) > 1:
                ambiguous += block['units']
        print(f'{layer["title"]}: {assigned:,} housing units assigned; {ambiguous:,} overlapping/unassigned', flush=True)
        for plot in plots:
            point = Point(plot['point'])
            matches = [int(i) for i in tree.query(point) if geometries[int(i)].covers(point)]
            if len(matches) == 1:
                plot['areas'][key] = layer['features'][matches[0]]['properties']['area_id']
    data['housing'] = dict(source=SOURCE, year=2020, downloaded_at=capture['downloaded_at'], method='2020 Census HU100 block housing units assigned by block internal point. Custom-area and city-edge totals are geographic estimates, not exact counts; no area weighting.', records=blocks, queried_block_count=capture['queried_block_count'], units_in_city=sum(b['units'] for b in blocks if b['boundary_distance_m'] >= 0))
    data['plots'] = dict(source='Local original city parcel polygons joined to current CompassKC permits by exact parcel ID.', method='Unique original parcel IDs, assigned by a point inside each parcel polygon. Listing filters do not affect licensed plot counts; the analysis-area setting does.', records=plots)
    path.write_text(json.dumps(data, separators=(',', ':')), encoding='utf-8')
    print(f'{len(blocks):,} housing blocks in city plus 550 m; {data["housing"]["units_in_city"]:,} housing units in city.', flush=True)

if __name__ == '__main__':
    main()
