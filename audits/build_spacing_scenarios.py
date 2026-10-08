from scenario_inputs import scenario_output, scenario_permits
"""Precompute 100-ft scenario steps and chunk new parcel geometries below 8 MiB."""
from pathlib import Path
import json,gzip,math
from collections import defaultdict
import numpy as np
from scipy.spatial import cKDTree
from pyproj import Transformer,Geod
ROOT=Path(__file__).resolve().parents[1];OUT=scenario_output(ROOT);OUT.mkdir(exist_ok=True)
idx=json.load(gzip.open(ROOT/'data/gis_parcels/search_index.json.gz','rt',encoding='utf-8'));rows=[r for r in idx['records'] if r[13]>=0];byid={r[0]:r for r in rows};base=json.load(open(OUT/'points.json',encoding='utf-8'));baseids={f['properties']['parcel'] for f in base['features']};licensed={f['properties']['parcel'] for f in base['features'] if f['properties']['current']};anchors=[byid[f['properties']['parcel']] for f in base['features'] if f['properties']['nonresident']]
candidates=[r for r in rows if r[4] in {1111,1122} and r[0] not in licensed];trans=Transformer.from_crs(4326,26915,always_xy=True)
def xy(rr):
 points=np.array([r[5] for r in rr]);x,y=trans.transform(points[:,0],points[:,1]);return np.column_stack([x,y])
pos=xy(candidates);anchorxy=xy(anchors);tree=cKDTree(anchorxy);distances=tree.query(pos)[0];patterns={};union=set();geod=Geod(ellps='GRS80')
for feet in range(400,1601,100):
 meters=feet*.3048;guard=meters*1.001;available=np.flatnonzero(distances>=guard);local=pos[available]
 if feet==1000:selected=[f['properties']['parcel'] for f in base['features'] if f['properties']['spacing']]
 else:
  degree=cKDTree(local).query_ball_point(local,guard,return_length=True,workers=-1);order=np.argsort(degree+np.random.default_rng(feet).random(len(degree)));buckets=defaultdict(list);chosen=[]
  for j in order:
   pt=local[j];cell=tuple(np.floor(pt/guard).astype(int));okay=True
   for dx in (-1,0,1):
    for dy in (-1,0,1):
     if any(np.sum((pt-local[k])**2)<guard**2 for k in buckets[(cell[0]+dx,cell[1]+dy)]):okay=False;break
    if not okay:break
   if okay:chosen.append(int(j));buckets[cell].append(int(j))
  selected=[candidates[int(available[j])][0] for j in chosen]
 points=xy([byid[id] for id in selected]);pack=cKDTree(points)
 for a,b in pack.query_pairs(meters*1.002):assert geod.inv(*byid[selected[a]][5],*byid[selected[b]][5])[2]>=meters
 for id,point in zip(selected,points):
  for j in tree.query_ball_point(point,meters*1.002):assert geod.inv(*byid[id][5],*anchors[j][5])[2]>=meters
 if feet!=1000:assert np.all(np.minimum(tree.query(pos)[0],pack.query(pos)[0])<guard+1e-6)
 patterns[str(feet)]=selected;union.update(selected);print(f'{feet} ft: {len(selected):,} feasible additions; geodesic spacing validated',flush=True)
extra=union-baseids;features=[]
for id in sorted(extra):
 r=byid[id];features.append(dict(type='Feature',geometry=dict(type='Point',coordinates=r[5]),properties=dict(parcel=id,address=r[2],neighborhood=r[12].get('neighborhood',''),current=False,nonresident=False,residential=True,spacing=False,cap=False,cap_rank=0,mixed_rank=0)))
props={f['properties']['parcel']:f['properties'] for f in features};polygons=[]
norm=lambda x:''.join(c for c in str(x or '') if c.isalnum()).upper()
for chunk in sorted({byid[id][6] for id in extra}):
 raw=json.load(gzip.open(ROOT/f'data/gis_parcels/raw/{chunk:04d}.geojson.gz','rt',encoding='utf-8'))
 for f in raw['features']:
  id=norm(f['properties']['KIVAPIN'])
  if id in extra:polygons.append(dict(type='Feature',geometry=f['geometry'],properties=props[id]))
assert {f['properties']['parcel'] for f in polygons}==extra
(OUT/'spacing_patterns.json').write_text(json.dumps(dict(step_ft=100,min_ft=400,max_ft=1600,method='Deterministic greedy maximal feasible patterns. 1,000-ft pattern retains the best of the original twelve runs; other distances use one sparse-first run. None is a proven maximum.',patterns=patterns),separators=(',',':')),encoding='utf-8')
(OUT/'spacing_extra_points.json').write_text(json.dumps(dict(type='FeatureCollection',features=features),separators=(',',':')),encoding='utf-8')
chunks=[];batch=[];size=0
for f in polygons:
 encoded=json.dumps(f,separators=(',',':'));cost=len(encoded.encode('utf-8'))+1
 if batch and size+cost>8*1024**2:
  name=f'spacing_extra_plots_{len(chunks):02d}.json';(OUT/name).write_text('{"type":"FeatureCollection","features":['+','.join(batch)+']}',encoding='utf-8');chunks.append(name);batch=[];size=0
 batch.append(encoded);size+=cost
if batch:
 name=f'spacing_extra_plots_{len(chunks):02d}.json';(OUT/name).write_text('{"type":"FeatureCollection","features":['+','.join(batch)+']}',encoding='utf-8');chunks.append(name)
(OUT/'spacing_geometry_manifest.json').write_text(json.dumps(dict(chunks=chunks,extra_parcels=len(extra))),encoding='utf-8');print('Completed',len(extra),'extra original parcels in',len(chunks),'geometry chunks',flush=True)
