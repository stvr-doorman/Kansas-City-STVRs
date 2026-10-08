"""Capture public county parcels intersecting the outside 550 m city band.

Keep source namespaces and original boundaries. These are search/display data,
not additions to city residential denominators or proof of Airbnb addresses.
"""
import json, gzip, time
from pathlib import Path
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
import requests
from shapely.geometry import shape, mapping
from shapely.geometry.polygon import orient
from shapely.ops import transform, unary_union
from shapely import make_valid
from pyproj import Transformer

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'data/border_parcels'
SOURCES={
 'BE':('Cass County, MO (Belton public source)','https://services6.arcgis.com/ZxotJxQo35Sx0jNg/arcgis/rest/services/Belton_Parcels/FeatureServer/49'),
 'WY':('Wyandotte County, KS','https://gisweb.wycokck.org/arcgis/rest/services/GISPUB/UGMAPS_4_V02/MapServer/0'),
 'CL':('Clay County, MO','https://services7.arcgis.com/3c8lLdmDNevrTlaV/ArcGIS/rest/services/ClayCountyParcelService/FeatureServer/0'),
 'JA':('Jackson County, MO','https://jcgis.jacksongov.org/arcgis/rest/services/ParcelViewer/ParcelsAscendRelate/MapServer/1'),
 'PL':('Platte County, MO (Parkville public source)','https://services.arcgis.com/KP64F8Xif9MkUwD4/arcgis/rest/services/Current_Parcels/FeatureServer/0'),
}

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
    project=Transformer.from_crs(4326,26915,always_xy=True).transform
    inverse=Transformer.from_crs(26915,4326,always_xy=True).transform
    spatial=json.loads((ROOT/'data/spatial.json').read_text(encoding='utf-8'))
    city=transform(project,unary_union([shape(f['geometry']) for f in spatial['boundary']['features']]))
    band=city.buffer(550).difference(city)
    geo=transform(inverse,band.simplify(2))
    rings=[]
    for polygon in ([geo] if geo.geom_type=='Polygon' else geo.geoms):
        polygon=orient(polygon,sign=-1)
        rings.append(list(polygon.exterior.coords));rings.extend(list(r.coords) for r in polygon.interiors)
    records=[];features=[];report={}
    for key,(name,url) in SOURCES.items():
        print('Capturing',name,flush=True)
        meta=requests.get(url,params={'f':'json'},timeout=30).json()
        (OUT/f'{key}_metadata.json').write_text(json.dumps(meta),encoding='utf-8')
        ids=sorted(query(url,dict(f='json',where='1=1',returnIdsOnly='true',geometry=json.dumps(dict(rings=rings,spatialReference=dict(wkid=4326))),geometryType='esriGeometryPolygon',inSR=4326,spatialRel='esriSpatialRelIntersects'))['objectIds'] or [])
        def fetch(batch):
            path=OUT/f'{key}_{batch[0]}.json.gz'
            if path.exists():return json.load(gzip.open(path,'rt',encoding='utf-8'))
            d=query(url,dict(f='geojson',objectIds=','.join(map(str,batch)),outFields='*',outSR=4326,returnGeometry='true'))
            if d.get('exceededTransferLimit') or len(d.get('features',[]))!=len(batch):raise RuntimeError('Incomplete county batch')
            with gzip.open(path,'wt',encoding='utf-8') as target:json.dump(d,target,separators=(',',':'))
            return d
        kept=0
        with ThreadPoolExecutor(max_workers=4) as pool:
            for d in pool.map(fetch,[ids[i:i+500] for i in range(0,len(ids),500)]):
                for f in d['features']:
                    if not f.get('geometry'):continue
                    g=make_valid(shape(f['geometry']));gp=transform(project,g)
                    if not gp.intersects(band) or city.covers(gp.representative_point()):continue
                    a=f['properties'];pid=str(a.get('PARCELID') or a.get('PARCEL_NBR') or a.get('parcel_id') or a.get('PARCELNUM') or a.get('PropertyID') or a.get('PARCEL') or a.get('FID'))
                    if key=='WY':address=' '.join(str(a.get(n) or '').strip() for n in ['NUMB','ADDR_EXT','DIR','ST_NAME','SUFX']).strip()
                    else:address=a.get('situs_display') or a.get('ADDRESS') or a.get('Address') or ''
                    owner=a.get('OWNER_NAME') or a.get('current_owner') or a.get('DeedHold') or ''
                    point=g.representative_point();oid=f'{key}:{pid}'
                    f['properties']={**a,'border_id':oid,'border_address':address,'border_county':name,'border_source':url,'border_parcel':pid}
                    features.append(f);records.append([oid,pid,address,owner,None,[point.x,point.y],None,oid,'','','',a.get('legal_desc') or a.get('LEGALDSCR') or '',{},-gp.distance(city)])
                    kept+=1
        report[key]=dict(count=kept,source=url,queried_ids=len(ids));print(name,kept,flush=True)
    grouped={}
    for f in features:grouped.setdefault(f['properties']['border_id'],[]).append(f)
    features=[dict(type='Feature',properties=group[0]['properties'],geometry=mapping(unary_union([make_valid(shape(f['geometry'])) for f in group]))) for group in grouped.values()]
    unique_records={r[0]:r for r in records}
    for f in features:
        point=shape(f['geometry']).representative_point();unique_records[f['properties']['border_id']][5]=[point.x,point.y]
    records=list(unique_records.values())
    with gzip.open(OUT/'features.json.gz','wt',encoding='utf-8') as target:json.dump(dict(type='FeatureCollection',features=features),target,separators=(',',':'))
    with gzip.open(OUT/'search_index.json.gz','wt',encoding='utf-8') as target:json.dump(dict(records=records),target,separators=(',',':'))
    from collections import Counter
    for key,count in Counter(f['properties']['border_id'].split(':')[0] for f in features).items():report[key]['unique_parcels']=count
    report['unique_parcels']=len(features)
    report['captured_at']=datetime.now(timezone.utc).isoformat();report['coverage_note']='Public sources only; Johnson County requires a GIS token and is not included. Platte source covers Parkville; completeness countywide is not established. Cass coverage uses Belton public parcels. Only parcels intersecting the outside 550 m band, with representative points outside city, retained. Full original boundaries displayed.'
    (OUT/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')

if __name__=='__main__':main()
