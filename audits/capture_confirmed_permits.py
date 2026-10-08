"""Capture official STR GIS records and retain issued, unexpired regular permits.

Original CompassKC snapshots stay unchanged. Run with --as-of YYYY-MM-DD.
GIS records are deduplicated by permit ID and number, never by proximity.
"""
import argparse, collections, csv, datetime, gzip, json
from pathlib import Path
from zoneinfo import ZoneInfo
import requests
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://mapd.kcmo.org/kcgis/rest/services/DataLayers/MapServer/34'

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--as-of', default=datetime.datetime.now(ZoneInfo('America/Chicago')).date().isoformat())
    parser.add_argument('--saved-capture', action='store_true')
    args = parser.parse_args()
    now = datetime.datetime.now(ZoneInfo('America/Chicago'))
    snapshot = now if now.date().isoformat() == args.as_of else datetime.datetime.fromisoformat(args.as_of).replace(tzinfo=ZoneInfo('America/Chicago'))
    cutoff = snapshot.timestamp()*1000
    capture = ROOT/'audits/portal_str_layer_capture.json'
    ids_path = ROOT/'audits/portal_str_layer_object_ids.json'
    if args.saved_capture:
        raw = json.loads(capture.read_text(encoding='utf-8'))
        ids = json.loads(ids_path.read_text(encoding='utf-8'))
    else:
        session = requests.Session()
        def query(**params):
            response = session.get(URL+'/query', params={'f':'json', **params}, timeout=60)
            response.raise_for_status()
            value = response.json()
            if 'error' in value: raise RuntimeError(value['error'])
            return value
        ids = query(where='1=1', returnIdsOnly='true')
        features = []
        for start in range(0, len(ids['objectIds']), 150):
            batch = query(objectIds=','.join(map(str, ids['objectIds'][start:start+150])), outFields='*', returnGeometry='true', outSR='4326')
            assert not batch.get('exceededTransferLimit'), 'Truncated GIS batch'
            features.extend(batch['features'])
        raw = {'features':features}
        capture.write_text(json.dumps(raw), encoding='utf-8')
        ids_path.write_text(json.dumps(ids), encoding='utf-8')
    assert {f['attributes']['OBJECTID'] for f in raw['features']} == set(ids['objectIds'])
    saved = json.loads((ROOT/'data/permits.json').read_text(encoding='utf-8'))
    saved_by_id = {p['id'].lower():p for p in saved}
    grouped = collections.defaultdict(list)
    excluded = []
    for feature in raw['features']:
        a = feature['attributes']
        original = saved_by_id.get(a['PMPERMITID'].lower(), {})
        event = '-STRMAJ-' in a['PERMITNUMBER'].upper() or any(word in original.get('type','').lower() for word in ('event','temporary'))
        reason = 'temporary_event' if event else 'nonissued' if a['PERMITSTATUS'] not in ('Issued','Issued - Subject To Conditions') else 'missing_expiration' if not a.get('EXPIREDATE') else 'expired' if a['EXPIREDATE'] <= cutoff else 'not_yet_issued' if not a.get('ISSUEDATE') or a['ISSUEDATE'] > cutoff else ''
        if reason: excluded.append({'permit_number':a['PERMITNUMBER'], 'object_id':a['OBJECTID'], 'reason':reason})
        else: grouped[(a['PMPERMITID'].lower(),a['PERMITNUMBER'])].append(feature)
    permits = []
    def iso(ms): return datetime.datetime.fromtimestamp(ms/1000, ZoneInfo('America/Chicago')).isoformat()
    for (pid,number), features in sorted(grouped.items(), key=lambda item:item[0][1]):
        a = features[0]['attributes']
        p = dict(saved_by_id.get(pid, {}))
        parcels = sorted({str(f['attributes']['PARCELNUMBER']) for f in features if f['attributes'].get('PARCELNUMBER')})
        geometry = features[0].get('geometry')
        point = [geometry['x'],geometry['y']] if geometry else None
        p.update(id=pid, permit_number=number, match_key=number, source_permit_field=number,
                 address=a['ADDRESS'], parcel=parcels[0] if parcels else '', parcels=parcels,
                 owner=p.get('owner',''), type=p.get('type','Regular STR registration; residency unconfirmed'),
                 source_status=a['PERMITSTATUS'], status='current', issued=iso(a['ISSUEDATE']),
                 expiration=iso(a['EXPIREDATE']), point=point,
                 source_url=f'https://compasskc.kcmo.org/EnerGov_Prod/SelfService#/permit/{pid}',
                 portal_confirmed=True, portal_layer=URL, portal_as_of=args.as_of,
                 portal_object_ids=[f['attributes']['OBJECTID'] for f in features])
        permits.append(p)
    out = ROOT/'data/confirmed_permits'
    out.mkdir(exist_ok=True)
    (out/'permits.json').write_text(json.dumps(permits,separators=(',',':')), encoding='utf-8')
    index=json.load(gzip.open(ROOT/'data/gis_parcels/search_index.json.gz','rt',encoding='utf-8'))
    normalize=lambda value: ''.join(c for c in str(value or '') if c.isalnum()).upper()
    by_parcel={r[0]:r for r in index['records']}
    parcel_ids={normalize(parcel) for p in permits for parcel in p['parcels']}
    geometries=collections.defaultdict(list)
    for chunk in sorted({by_parcel[pid][6] for pid in parcel_ids if pid in by_parcel}):
        for f in json.load(gzip.open(ROOT/f'data/gis_parcels/raw/{chunk:04d}.geojson.gz','rt',encoding='utf-8'))['features']:
            pid=normalize(f['properties'].get('KIVAPIN'))
            if pid in parcel_ids and f.get('geometry'): geometries[pid].append(shape(f['geometry']))
    features=[]
    for pid,parts in sorted(geometries.items()):
        row=by_parcel[pid]
        features.append({'type':'Feature','geometry':mapping(unary_union(parts)),
                         'properties':{'parcel':pid,'address':row[2],'owner':row[3],
                                       'current_permit':True,'point':row[5], 'permit_status':'current'}})
    (out/'permit_parcels.geojson').write_text(json.dumps({'type':'FeatureCollection','features':features},separators=(',',':')),encoding='utf-8')
    fields=['permit_number','source_status','expiration','issued','address','parcel','type','source_url','portal_layer','portal_as_of']
    with (out/'permits.csv').open('w', newline='', encoding='utf-8') as handle:
        writer=csv.DictWriter(handle,fieldnames=fields,extrasaction='ignore');writer.writeheader();writer.writerows(permits)
    old_current={p['permit_number'] for p in saved if p['status']=='current'}
    numbers={p['permit_number'] for p in permits}
    report={'as_of':args.as_of,'cutoff':snapshot.isoformat(),'cutoff_timezone':'America/Chicago','source':URL,
            'captured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'gis_features':len(raw['features']),'confirmed_current_regular_permits':len(permits),
            'saved_current_permits':len(old_current),'saved_current_not_confirmed':sorted(old_current-numbers),
            'confirmed_not_saved_current':sorted(numbers-old_current),
            'excluded_features_by_reason':dict(collections.Counter(r['reason'] for r in excluded)),
            'temporary_event_records_in_saved_inventory':sum('event' in p['type'].lower() or '-STRMAJ-' in p['permit_number'] for p in saved),
            'selection':'Issued or issued subject to conditions; issue date on/before snapshot; expiration strictly after snapshot; no temporary/event permits. Missing GIS records remain unconfirmed, not proven invalid.'}
    (out/'validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report,indent=2))

if __name__=='__main__': main()
