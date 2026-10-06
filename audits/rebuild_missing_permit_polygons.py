"""Restore permit display boundaries from KCMO's official parcel service by KIVAPIN."""
import json
from datetime import datetime, timezone
from pathlib import Path
import requests
import re
from concurrent.futures import ThreadPoolExecutor
from shapely.geometry import shape

root = Path(__file__).resolve().parent.parent
load = lambda name: json.loads((root / 'data' / name).read_text(encoding='utf8'))
permits = load('permits.json')
existing = {str(f['properties']['parcel']) for f in load('permit_parcels.geojson')['features']}
points = {str(f['properties']['parcel']): f['properties'].get('point')
          for f in load('permit_location_points.json')['features']}
by_parcel = {}
for permit in permits:
    for parcel in set([*(permit.get('parcels') or []), permit.get('parcel')]):
        if parcel:
            by_parcel.setdefault(str(parcel), []).append(permit)
missing = sorted(set(by_parcel) - existing)
url = 'https://mapd.kcmo.org/kcgis/rest/services/AGOL/MapServer/6/query'
features = []
retrieved_at = datetime.now(timezone.utc).isoformat()
for start in range(0, len(missing), 100):
    ids = missing[start:start + 100]
    assert all(parcel.isdigit() for parcel in ids)
    where = 'KIVAPIN IN (' + ','.join("'" + parcel + "'" for parcel in ids) + ')'
    response = requests.get(url, params={'where': where, 'outFields': 'KIVAPIN,ADDRESS,OWN_NAME',
        'outSR': '4326', 'returnGeometry': 'true', 'f': 'geojson'}, timeout=45)
    response.raise_for_status()
    data = response.json()
    if 'error' in data or data.get('exceededTransferLimit'):
        raise RuntimeError(data)
    for feature in data.get('features', []):
        raw = feature['properties']
        parcel = str(raw['KIVAPIN'])
        assert parcel in ids
        if feature['geometry']['type'] not in ['Polygon', 'MultiPolygon']:
            continue
        statuses = {permit['status'] for permit in by_parcel[parcel]}
        status = next((s for s in ['current', 'revoked', 'suspended', 'expired'] if s in statuses),
                      sorted(statuses)[0])
        centroid = shape(feature['geometry']).representative_point()
        feature['properties'] = {'parcel': parcel, 'address': raw.get('ADDRESS', ''),
            'owner': raw.get('OWN_NAME', ''), 'point': points.get(parcel) or [centroid.x, centroid.y],
            'permit_status': status, 'current_permit': status == 'current',
            'source_url': url, 'retrieved_at': retrieved_at}
        features.append(feature)
    print(f'Checked {min(start + 100, len(missing))}/{len(missing)} missing parcel IDs', flush=True)
unresolved = set(missing) - {f['properties']['parcel'] for f in features}

def recover_address(parcel):
    addresses = {re.split(r'Kansas City|\bUnit\b|\bAPT\b|\bSTE\b|#', p['address'], flags=re.I)[0].strip()
                 for p in by_parcel[parcel]}
    recovered = []
    for address in addresses:
        response = requests.get(url, params={'where': "ADDRESS='" + address.replace("'", "''") + "'",
            'outFields': 'KIVAPIN,ADDRESS,OWN_NAME', 'outSR': '4326', 'returnGeometry': 'true', 'f': 'geojson'}, timeout=45)
        response.raise_for_status()
        data = response.json()
        if data.get('error'):
            raise RuntimeError(data)
        recovered.extend(data.get('features', []))
    # An exact street-address lookup is provisional when the original parcel ID is retired.
    unique = {str(f['properties']['KIVAPIN']): f for f in recovered}
    if len(unique) != 1:
        return None
    feature = next(iter(unique.values()))
    raw = feature['properties']
    centroid = shape(feature['geometry']).representative_point()
    statuses = {p['status'] for p in by_parcel[parcel]}
    status = next((s for s in ['current', 'revoked', 'suspended', 'expired'] if s in statuses), sorted(statuses)[0])
    feature['properties'] = {'parcel': parcel, 'source_parcel': str(raw['KIVAPIN']),
        'address': raw['ADDRESS'], 'owner': raw.get('OWN_NAME', ''), 'point': [centroid.x, centroid.y],
        'permit_status': status, 'current_permit': status == 'current', 'match_basis': 'exact_saved_permit_address',
        'source_url': url, 'retrieved_at': retrieved_at}
    return feature

with ThreadPoolExecutor(max_workers=4) as pool:
    recovered = [f for f in pool.map(recover_address, sorted(unresolved)) if f]
features.extend(recovered)
print(f'Recovered {len(recovered)} additional polygons by unique exact saved street address (parcel IDs differ).')
destination = root / 'data/permit_property_parcels.geojson'
destination.write_text(json.dumps({'type': 'FeatureCollection', 'features': features},
    ensure_ascii=False, separators=(',', ':')), encoding='utf8')
print(f'Restored {len(features)} official parcel boundaries; {len(missing)-len({f["properties"]["parcel"] for f in features})} IDs unavailable.')
