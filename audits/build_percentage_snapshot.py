"""Precalculate all area percentages using saved local inputs, without APIs.

Run after refreshing listings, confirmed permits, GIS counts or boundaries.
Zooms share these exact ratios; only the zoom presentation changes.
"""
import json
import re
from collections import Counter
from pathlib import Path

from shapely.geometry import mapping, shape

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'residential_neighborhood_impact/data'


def read(name):
    return json.loads((DATA / name).read_text(encoding='utf-8'))


def normalize(value):
    return re.sub('[^a-z0-9]', '', str(value or '').lower()).upper()


def main():
    boundaries = read('area_boundaries.json')
    gis = read('gis_parcels/area_counts.json')
    mix = read('gis_parcels/area_mix.json')['totals']['0']
    council = read('council_members.json')['districts']
    listings = read('listings.json')
    overrides = read('listing_address_overrides.json')['records']
    for listing in listings:
        record = overrides.get(str(listing['listing_id']))
        if record:
            listing.update(point=record['point'], boundary_distance_m=record['boundary_distance_m'])
            boundaries['points'][str(listing['listing_id'])] = record['point']
            for key, layer in boundaries['layers'].items():
                layer['assignments'].pop(str(listing['listing_id']), None)
                if record['areas'].get(key):
                    layer['assignments'][str(listing['listing_id'])] = record['areas'][key]
    scoped = {str(l['listing_id']): l for l in listings if l.get('point') and not l.get('low_priority')
              and isinstance(l.get('boundary_distance_m'), (float, int)) and l['boundary_distance_m'] >= 0}
    permits = read('confirmed_permits/permits.json')
    current = {normalize(value) for permit in permits if permit['status'] == 'current'
               for value in [permit.get('parcel'), *(permit.get('parcels') or [])] if value}
    records = {r['parcel']: r for r in gis['permit_parcel_records']}
    plots = [records[p] for p in current if p in records and records[p]['boundary_distance_m'] >= 0]
    palette = ['#2563eb', '#7c3aed', '#0891b2', '#db2777', '#059669', '#d97706', '#4f46e5', '#c2410c']
    layers = {}
    for key, layer in boundaries['layers'].items():
        counts = {f['properties']['area_id']: Counter() for f in layer['features']}
        for listing_id, listing in scoped.items():
            original = boundaries['points'].get(listing_id)
            area = layer['assignments'].get(listing_id) if original == listing['point'] else None
            if area not in counts:
                continue
            tally = counts[area]
            tally['total'] += 1
            hotel = bool(listing.get('likely_hotel'))
            tally['hotels'] += hotel
            tally['count'] += not hotel
            tally['homes'] += not hotel and bool(re.match(r'Entire\b', listing.get('rental_type') or '', re.I))
        licensed = Counter(p['areas'].get(key) for p in plots)
        features = []
        for feature in layer['features']:
            area = feature['properties']['area_id']
            denominator = gis['totals']['0'][key].get(area, {})
            total_plots = denominator.get('plots', 0)
            if not total_plots:
                continue
            tally = {field: counts[area][field] for field in ['total', 'hotels', 'count', 'homes']}
            residential = denominator['residential']
            classified_mix = mix.get(area)
            primary = classified_mix['single_family'] + classified_mix['duplex'] if classified_mix else 0
            unknown_share = 100 * denominator['unknown'] / total_plots
            mixed = 100 * residential / total_plots < 70 or unknown_share > 15
            hash_value = 0
            for character in area:
                hash_value = (hash_value * 31 + ord(character)) % 2**32
            district = re.search(r'\d+', str(feature['properties']['name'])) if key == 'council' else None
            member = council.get(district.group()) if district else None
            properties = {**feature['properties'], **tally,
                          'licensed_plots': licensed[area], 'housing': residential, 'total_plots': total_plots,
                          'single_family_plots': denominator['single_family'], 'unknown_landuse_plots': denominator['unknown'],
                          'percent': 100 * tally['homes'] / total_plots,
                          'licensed_percent': 100 * licensed[area] / total_plots,
                          'hotel_percent': 100 * tally['hotels'] / total_plots,
                          'boundary_type': key, 'boundary_title': layer['title'],
                          'color': palette[hash_value % len(palette)],
                          'members': f'{member["in_district"]} · {member["at_large"]} (at large)' if member else '',
                          'mix': classified_mix,
                          'primary_all': 100 * primary / total_plots,
                          'primary_residential': 100 * primary / residential if residential else None,
                          'unknown_share': unknown_share, 'unreliable': mixed,
                          'unreliable_reason': f'{residential} classified residential of {total_plots} total plots; '
                                               f'{denominator["unknown"]} unclassified. The all-plot ratio is not a percentage of homes.'}
            features.append({'type': 'Feature', 'geometry': mapping(shape(feature['geometry']).simplify(.00003, preserve_topology=True)),
                             'properties': properties})
        layers[key] = {**{field: layer[field] for field in ['title', 'source', 'note', 'type']},
                       'features': features, 'assignments': {}}
    entire = sum(not l.get('likely_hotel') and bool(re.match(r'Entire\b', l.get('rental_type') or '', re.I)) for l in scoped.values())
    denominator = gis['scope_totals']['0']['plots']
    hotel_count = sum(bool(l.get('likely_hotel')) for l in scoped.values())
    output = {'downloaded_at': boundaries['downloaded_at'], 'layers': layers,
              'overallText': f'Overall Airbnb / all GIS plots: {100*entire/denominator:.3f}%. '
                             f'{entire:,} non-hotel entire-place listings ÷ {denominator:,} total GIS plots × 100. '
                             f'Licensed plots: {len(plots):,}. Likely hotel listings: {hotel_count:,}. '
                             'Saved local snapshot; parcels are not dwelling units.',
              'overall': {'type': 'FeatureCollection', 'features': [{'type': 'Feature',
                          'geometry': {'type': 'Point', 'coordinates': [-94.58, 39.1]},
                          'properties': {'label': f'{100*entire/denominator:.1f}%'}}]},
              'validation': {'entire_place_listings': entire, 'all_gis_plots': denominator,
                             'licensed_plots': len(plots), 'missing_permit_parcels': len(current-records.keys()),
                             'zoom_aggregate_threshold': 9.5, 'external_requests': 0}}
    target = DATA / 'percentage_snapshot.json'
    target.write_text(json.dumps(output, separators=(',', ':')), encoding='utf-8')
    print(output['validation'])


if __name__ == '__main__':
    main()
