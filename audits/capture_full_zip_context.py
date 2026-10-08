"""Refresh full City GIS ZIP polygons for the neighborhood context overlay."""
import json
from datetime import datetime, timezone
from pathlib import Path

import requests
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'https://mapd.kcmo.org/kcgis/rest/services/AGOL/MapServer/15'


def main():
    response = requests.get(SOURCE + '/query', params={
        'f': 'geojson', 'where': '1=1', 'outFields': '*', 'outSR': 4326,
    }, timeout=90)
    response.raise_for_status()
    raw = response.json()
    if raw.get('error') or raw.get('exceededTransferLimit'):
        raise RuntimeError('ZIP capture was incomplete')
    (ROOT / 'audits/full_zip_capture.geojson').write_text(json.dumps(raw), encoding='utf-8')
    features = []
    for feature in raw['features']:
        point = shape(feature['geometry']).representative_point()
        features.append({**feature, 'properties': {
            'name': str(feature['properties']['ZIP']), 'anchor': [point.x, point.y],
        }})
    output = {
        'type': 'FeatureCollection', 'features': features, 'source': SOURCE,
        'captured_at': datetime.now(timezone.utc).isoformat(),
        'note': 'Full source ZIP polygons. Outside-city rental and tax data are not assessed.',
    }
    target = ROOT / 'residential_neighborhood_impact/data/zip_context.geojson'
    target.write_text(json.dumps(output), encoding='utf-8')
    print(f'Saved {len(features)} full ZIP polygons to {target}')


if __name__ == '__main__':
    main()
