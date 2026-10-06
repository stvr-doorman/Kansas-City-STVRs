"""Recover missing permit location points from the existing city parcel tiles."""
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent


def load(path):
    return json.loads(path.read_text(encoding='utf8'))


permits = load(root / 'data/permits.json')
existing = {str(f['properties']['parcel']) for f in load(root / 'data/permit_parcels.geojson')['features']}
missing = {str(parcel) for permit in permits
           for parcel in [*(permit.get('parcels') or []), permit.get('parcel')]
           if parcel and str(parcel) not in existing}
recovered = {}
for tile in sorted((root / 'data/parcels').glob('-*.json')):
    for feature in load(tile)['features']:
        parcel = str(feature['properties']['parcel'])
        if parcel in missing:
            recovered[parcel] = feature
destination = root / 'data/permit_location_points.json'
destination.write_text(json.dumps({'type': 'FeatureCollection', 'features': list(recovered.values())},
                                 ensure_ascii=False, separators=(',', ':')), encoding='utf8')
print(f'Recovered {len(recovered)} existing city parcel points: {destination}')
