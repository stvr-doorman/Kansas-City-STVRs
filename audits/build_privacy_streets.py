"""Intersect actual saved privacy radii with official street centerlines.

Uses street-side city codes and ZIPs, not parcel owners' mailing addresses.
Zero/unknown radii never use the map's display fallback or screening leeway.
"""
import json,gzip,time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone
import requests
from shapely.geometry import shape,Point
from shapely.ops import transform
from shapely.strtree import STRtree
from pyproj import Transformer

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'data/privacy_streets'
SOURCE='https://mapd.kcmo.org/kcgis/rest/services/AGOL/MapServer/27'
PLACES='https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4'

def query(url,params):
    for attempt in range(4):
        try:
            r=requests.post(url+'/query',data=params,timeout=90);r.raise_for_status();d=r.json()
            if d.get('error'):raise RuntimeError(str(d['error']))
            return d
        except Exception:
            if attempt==3:raise
            time.sleep(2)

def main():
    OUT.mkdir(exist_ok=True)
    ids=sorted(query(SOURCE,dict(f='json',where='1=1',returnIdsOnly='true'))['objectIds'])
    def fetch(batch):
        path=OUT/f'streets_{batch[0]}.json.gz'
        if path.exists():return json.load(gzip.open(path,'rt',encoding='utf-8'))['features']
        d=query(SOURCE,dict(f='geojson',objectIds=','.join(map(str,batch)),outFields='OBJECTID,PRETYPE,PREFIX,STREETNAME,STREETTYPE,SUFFIX,LZIP,RZIP,L_PLA_CODE,R_PLA_CODE,STATE_LT,STATE_RT',outSR=4326,returnGeometry='true'))
        if len(d.get('features',[]))!=len(batch) or d.get('exceededTransferLimit'):raise RuntimeError('Incomplete street batch')
        with gzip.open(path,'wt',encoding='utf-8') as target:json.dump(d,target,separators=(',',':'))
        return d['features']
    with ThreadPoolExecutor(max_workers=4) as pool:
        features=[f for group in pool.map(fetch,[ids[i:i+1000] for i in range(0,len(ids),1000)]) for f in group if f.get('geometry')]
    print('Captured streets',len(features),flush=True)
    places={}
    for state in ['20','29']:
        offset=0
        while True:
            d=query(PLACES,dict(f='json',where=f"STATE='{state}'",outFields='*',returnGeometry='false',resultOffset=offset,resultRecordCount=1000,orderByFields='OBJECTID'))
            for f in d['features']:
                a=f['attributes'];name=a.get('BASENAME') or a['NAME'].removesuffix(' city').removesuffix(' village')
                places[(state,str(a['PLACE']).zfill(5))]=name
            if not d.get('exceededTransferLimit'):break
            offset+=len(d['features'])
    project=Transformer.from_crs(4326,26915,always_xy=True).transform
    geometries=[transform(project,shape(f['geometry'])) for f in features];tree=STRtree(geometries)
    result={}
    listings=json.loads((ROOT/'data/listings.json').read_text(encoding='utf-8'))
    for l in listings:
        if not l.get('point'):continue
        radius=l.get('privacy_radius_meters');point=transform(project,Point(l['point']))
        rows=set()
        if isinstance(radius,(float,int)) and radius>=0:
            search=point.buffer(radius) if radius>0 else point
            for i in tree.query(search):
                if geometries[int(i)].distance(point)>radius+1e-6:continue
                a=features[int(i)]['properties'];name=' '.join(str(a.get(k) or '').strip() for k in ['PRETYPE','PREFIX','STREETNAME','STREETTYPE','SUFFIX']).strip();name=' '.join(name.split())
                if not a.get('STREETNAME'):continue
                for side,prefix in [('LT','L'),('RT','R')]:
                    state=str(a.get('STATE_'+side) or '').zfill(2);code=str(a.get(prefix+'_PLA_CODE') or '').zfill(5)
                    city=places.get((state,code),'City unavailable');zip_value=a.get(prefix+'ZIP');zipcode=str(int(zip_value)).zfill(5) if zip_value and int(zip_value)>0 else 'ZIP unavailable'
                    rows.add((name,city+({'20':' KS','29':' MO'}.get(state,'')),zipcode))
        result[str(l['listing_id'])]=dict(point=l['point'],radius=radius,streets=sorted(rows))
    report=dict(source=SOURCE,city_source=PLACES,captured_at=datetime.now(timezone.utc).isoformat(),street_count=len(features),records=result,method='Street centerline distance <= supplied privacy radius in EPSG:26915; cities and ZIPs from intersecting street segment side attributes. No display fallback, leeway or parcel tolerance. Coverage limited to official city street service; missing city/ZIP fields shown explicitly.')
    (OUT/'listing_streets.json').write_text(json.dumps(report,separators=(',',':')),encoding='utf-8')
    print('Listings with street results',sum(bool(r['streets']) for r in result.values()),flush=True)

if __name__=='__main__':main()
