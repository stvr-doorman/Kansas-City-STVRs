"""Capture every publicly queryable layer/table using verified object-ID batches."""
from pathlib import Path
import json,gzip,time,requests
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[1];DATA=ROOT/'data';DATA.mkdir(exist_ok=True)
URL='https://services5.arcgis.com/CEpuXecVrKGiDoOH/ArcGIS/rest/services/STR_Map_and_Parcel_WFL1/FeatureServer'
def get(url,params):
 for attempt in range(4):
  try:
   r=requests.get(url,params=params,timeout=90);r.raise_for_status();d=r.json()
   if 'error' in d:raise ValueError(d['error'])
   return d
  except Exception:
   if attempt==3:raise
   time.sleep(1+attempt)
def save(path,data):path.write_text(json.dumps(data,separators=(',',':')),encoding='utf-8')
service=get(URL,{'f':'json'});item=get('https://www.arcgis.com/sharing/rest/content/items/'+service['serviceItemId'],{'f':'json'});config=get('https://www.arcgis.com/sharing/rest/content/items/'+service['serviceItemId']+'/data',{'f':'json'});save(DATA/'service.json',service);save(DATA/'item.json',item);save(DATA/'item_data.json',config)
def capture(entry):
 id=entry['id'];folder=DATA/str(id);folder.mkdir(exist_ok=True);meta=get(URL+'/'+str(id),{'f':'json'});save(folder/'metadata.json',meta);ids=get(URL+'/'+str(id)+'/query',{'f':'json','where':'1=1','returnIdsOnly':'true'});wanted=sorted(ids['objectIds']);field=ids['objectIdFieldName'];save(folder/'object_ids.json',ids);allfeatures=[]
 for start in range(0,len(wanted),100):
  batch=wanted[start:start+100];path=folder/f'raw_{start//100:04d}.json'
  if path.exists():d=json.loads(path.read_text())
  else:d=get(URL+'/'+str(id)+'/query',{'f':'json','objectIds':','.join(map(str,batch)),'outFields':'*','returnGeometry':'true','outSR':4326,'returnZ':'false','returnM':'false'});save(path,d)
  returned=[f['attributes'][field] for f in d.get('features',[])];assert set(returned)==set(batch) and len(returned)==len(batch),(id,start,'incomplete batch');allfeatures+=d['features']
  if start%5000==0:print(entry['name'],min(start+100,len(wanted)),'/',len(wanted),flush=True)
 assert len(allfeatures)==len(wanted) and len(set(f['attributes'][field] for f in allfeatures))==len(wanted)
 def geom(g):
  if not g:return None
  if 'x' in g:return dict(type='Point',coordinates=[g['x'],g['y']])
  if 'paths' in g:return dict(type='MultiLineString',coordinates=g['paths'])
  if 'rings' in g:
   from shapely.geometry import Polygon,mapping,MultiPolygon
   rings=g['rings'];outers=[];holes=[]
   for ring in rings:
    area=sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(ring,ring[1:]));(outers if area<0 else holes).append(ring)
   if not outers:outers,holes=rings,[]
   polygons=[Polygon(o,[h for h in holes if Polygon(o).covers(Polygon(h).representative_point())]) for o in outers]
   return mapping(polygons[0] if len(polygons)==1 else MultiPolygon(polygons))
  raise ValueError('Unsupported geometry '+str(g.keys()))
 features=[dict(type='Feature',geometry=geom(f.get('geometry')),properties=f['attributes']) for f in allfeatures];chunks=[];batch=[];size=0
 for f in features:
  encoded=json.dumps(f,separators=(',',':'));cost=len(encoded.encode())+1
  if batch and size+cost>8*1024**2:
   name=f'features_{len(chunks):03d}.json.gz'
   with gzip.open(folder/name,'wt',encoding='utf-8') as out:out.write('{"type":"FeatureCollection","features":['+','.join(batch)+']}')
   chunks.append(str(id)+'/'+name);batch=[];size=0
  batch.append(encoded);size+=cost
 if batch:
  name=f'features_{len(chunks):03d}.json.gz'
  with gzip.open(folder/name,'wt',encoding='utf-8') as out:out.write('{"type":"FeatureCollection","features":['+','.join(batch)+']}')
  chunks.append(str(id)+'/'+name)
 print('VALIDATED',id,entry['name'],len(features),flush=True)
 return dict(id=id,name=entry['name'],count=len(features),table='geometryType' not in entry,visible=entry.get('defaultVisibility',True),chunks=chunks,metadata=str(id)+'/metadata.json',object_id=field)
with ThreadPoolExecutor(max_workers=3) as pool:layers=list(pool.map(capture,service['layers']+service['tables']))
save(DATA/'manifest.json',dict(source=URL,source_viewer='https://www.arcgis.com/apps/mapviewer/index.html?url='+URL+'&source=sd',captured_at=datetime.now(timezone.utc).isoformat(),title=item['title'],extent=item['extent'],layers=layers,validation='Every returned object ID matched the complete public ID inventory; no missing or duplicate records.'))
print('COMPLETE',sum(l['count'] for l in layers),'records',flush=True)
