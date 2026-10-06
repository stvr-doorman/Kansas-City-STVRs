"""Build nickname lookup and locally available parcel candidates; no ownership inference."""
import csv
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
names = root / 'nicknames-master/nicknames-master/names.csv'
links = {}
with names.open(encoding='utf-8-sig', newline='') as source:
    for row in csv.DictReader(source):
        if row['relationship'] != 'has_nickname':
            continue
        first, second = row['name1'].lower(), row['name2'].lower()
        links.setdefault(first, set()).add(second)
        links.setdefault(second, set()).add(first)
(root / 'data/nicknames.json').write_text(json.dumps({name: sorted(values) for name, values in links.items()},
    separators=(',', ':')), encoding='utf8')
parcels = {}
for tile in sorted((root / 'data/parcels').glob('-*.json')):
    for feature in json.loads(tile.read_text(encoding='utf8'))['features']:
        parcels[str(feature['properties']['parcel'])] = feature
for filename in ['permit_parcels.geojson', 'permit_property_parcels.geojson']:
    for feature in json.loads((root / 'data' / filename).read_text(encoding='utf8'))['features']:
        parcels[str(feature['properties']['parcel'])] = feature
(root / 'data/parcel_matching_candidates.geojson').write_text(
    json.dumps({'type': 'FeatureCollection', 'features': list(parcels.values())},
               ensure_ascii=False, separators=(',', ':')), encoding='utf8')
print(f'Built {len(links)} nickname names and {len(parcels)} local parcel candidates. Coverage is limited to the saved city parcel data.')
