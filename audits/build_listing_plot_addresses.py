"""Record parcels containing saved listing points; never verify listing addresses."""
import gzip
import json
from pathlib import Path
from shapely.geometry import Point, shape
from shapely import make_valid
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]

def main():
    listings = [l for l in json.loads((ROOT/'data/listings.json').read_text(encoding='utf-8')) if l.get('point')]
    points = [Point(l['point']) for l in listings]
    tree = STRtree(points)
    matches = {str(l['listing_id']):dict(point=l['point'],parcels=[]) for l in listings}
    for path in sorted((ROOT/'data/gis_parcels/raw').glob('*.geojson.gz')):
        with gzip.open(path, 'rt', encoding='utf-8') as source:
            for feature in json.load(source)['features']:
                if not feature.get('geometry'):
                    continue
                polygon = make_valid(shape(feature['geometry']))
                for i in tree.query(polygon):
                    if polygon.covers(points[int(i)]):
                        a = feature['properties']
                        record = dict(parcel=str(a.get('KIVAPIN') or ''),address=a.get('ADDRESS') or '')
                        found = matches[str(listings[int(i)]['listing_id'])]['parcels']
                        if record not in found:
                            found.append(record)
    output = dict(source='https://mapd.kcmo.org/kcgis/rest/services/AGOL/MapServer/6',records=matches)
    (ROOT/'data/listing_plot_addresses.json').write_text(json.dumps(output,separators=(',',':')),encoding='utf-8')
    print(f'{sum(bool(r["parcels"]) for r in matches.values())} listing points overlap original GIS parcels.')
    for l in listings:
        if 'Melrose Grove' in l.get('title',''):
            print(l['listing_id'],matches[str(l['listing_id'])])

if __name__ == '__main__':
    main()
