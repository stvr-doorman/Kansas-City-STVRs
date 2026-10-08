from scenario_inputs import scenario_output, scenario_permits
from pathlib import Path
import json,gzip
from collections import defaultdict
import shapely
from shapely.geometry import shape,mapping
from pyproj import Transformer
root=Path(__file__).resolve().parents[1];out=scenario_output(root);load=lambda n:json.loads((out/(n+'.json')).read_text())
points=[]
for n in ['points','spacing_extra_points','measurement_extra_points']:points+=load(n)['features']
known={f['properties']['parcel']:f['properties'] for f in points};licensed={pid for pid,p in known.items() if p['current']};idx=json.load(gzip.open(root/'data/gis_parcels/search_index.json.gz','rt'));groups=defaultdict(list)
for r in idx['records']:
 if r[13]>=0 and r[4] in {1111,1122} and r[0] not in licensed and r[12].get('neighborhood'):groups[r[12]['neighborhood']].append(r)
# Include all eligible candidates so size filtering can refill the cap rather than exhaust a truncated pool.
ranks={};extra=[]
for area,rows in groups.items():
 rows.sort(key=lambda r:(0 if known.get(r[0],{}).get('cap_rank',0)>0 else 1,known.get(r[0],{}).get('cap_rank',0),r[0]))
 for rank,r in enumerate(rows,1):
  ranks[r[0]]=rank
  if r[0] not in known:extra.append(dict(type='Feature',geometry=dict(type='Point',coordinates=r[5]),properties=dict(parcel=r[0],address=r[2],neighborhood=area,current=False,nonresident=False,residential=True,spacing=False,cap=False,cap_rank=rank,mixed_rank=0)))
props={f['properties']['parcel']:f['properties'] for f in extra};centroids=load('parcel_centroids');forward=Transformer.from_crs(4326,26915,always_xy=True);inverse=Transformer.from_crs(26915,4326,always_xy=True);chunks=[];batch=[];size=0
for chunk in sorted((root/'data/gis_parcels/raw').glob('*.geojson.gz')):
 for f in json.load(gzip.open(chunk,'rt'))['features']:
  pid=''.join(c for c in str(f['properties'].get('KIVAPIN') or '') if c.isalnum()).upper()
  if pid not in props or not f.get('geometry'):continue
  g=shape(f['geometry']);g=shapely.make_valid(g) if not g.is_valid else g;center=shapely.centroid(shapely.transform(g,forward.transform,interleaved=False));centroids[pid]=list(inverse.transform(center.x,center.y));encoded=json.dumps(dict(type='Feature',geometry=mapping(g),properties=props[pid]),separators=(',',':'));cost=len(encoded)+1
  if batch and size+cost>8*1024**2:
   name=f'cap_extra_plots_{len(chunks):02d}.json';(out/name).write_text('{"type":"FeatureCollection","features":['+','.join(batch)+']}');chunks.append(name);batch=[];size=0
  batch.append(encoded);size+=cost
if batch:
 name=f'cap_extra_plots_{len(chunks):02d}.json';(out/name).write_text('{"type":"FeatureCollection","features":['+','.join(batch)+']}');chunks.append(name)
for name,data in [('cap_extension',dict(ranks=ranks,points=dict(type='FeatureCollection',features=extra),chunks=chunks)),('parcel_centroids',centroids)]: (out/(name+'.json')).write_text(json.dumps(data,separators=(',',':')))
print('Extended cap pool',len(ranks),'extra points',len(extra),'geometry chunks',len(chunks),flush=True)
