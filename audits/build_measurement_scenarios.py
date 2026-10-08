from scenario_inputs import scenario_output, scenario_permits
"""True centroids and polygon-edge spacing, with all/nonresident existing blockers."""
from pathlib import Path
import json,gzip
from collections import defaultdict,Counter
import numpy as np
import shapely
from shapely.geometry import shape,mapping
from scipy.spatial import cKDTree
from pyproj import Transformer,Geod
ROOT=Path(__file__).resolve().parents[1];OUT=scenario_output(ROOT)
load=lambda n:json.loads((OUT/(n+'.json')).read_text(encoding='utf-8'))
idx=json.load(gzip.open(ROOT/'data/gis_parcels/search_index.json.gz','rt',encoding='utf-8'));rows=[r for r in idx['records'] if r[13]>=0];byid={r[0]:r for r in rows};base=load('points')['features'];oldextra=load('spacing_extra_points')['features'];known={f['properties']['parcel']:f['properties'] for f in base+oldextra};licensed={f['properties']['parcel'] for f in base if f['properties']['current']};nonresident={f['properties']['parcel'] for f in base if f['properties']['nonresident']};candidateids=[r[0] for r in rows if r[4] in {1111,1122} and r[0] not in licensed];needed=set(candidateids)|licensed
norm=lambda v:''.join(c for c in str(v or '') if c.isalnum()).upper();parts=defaultdict(list);rawgeometry={}
for chunk in sorted((ROOT/'data/gis_parcels/raw').glob('*.geojson.gz')):
 data=json.load(gzip.open(chunk,'rt',encoding='utf-8'))
 for f in data['features']:
  id=norm(f['properties']['KIVAPIN'])
  if id in needed and f.get('geometry'):parts[id].append(shape(f['geometry']))
print('Loaded original parcel polygons',len(parts),flush=True)
ids=list(parts);geoms=np.array([shapely.union_all(parts[id]) if len(parts[id])>1 else parts[id][0] for id in ids],dtype=object);parts.clear();bad=~shapely.is_valid(geoms);geoms[bad]=shapely.make_valid(geoms[bad]);forward=Transformer.from_crs(4326,26915,always_xy=True);inverse=Transformer.from_crs(26915,4326,always_xy=True);metric=shapely.transform(geoms,forward.transform,interleaved=False);centers=shapely.centroid(metric);coords=shapely.get_coordinates(centers);lookup={id:i for i,id in enumerate(ids)}
assert all(id in lookup for id in needed)
ci=np.array([lookup[id] for id in candidateids]);cg=metric[ci];cp=coords[ci];geomtree=shapely.STRtree(cg);pointtree=cKDTree(cp);all_patterns={};union=set();validation={};geod=Geod(ellps='GRS80')
for blockers,anchorids in [('all',sorted(licensed)),('nonresident',sorted(nonresident))]:
 ai=np.array([lookup[id] for id in anchorids]);ag=metric[ai];ap=coords[ai];anchor_geotree=shapely.STRtree(ag);anchor_pointtree=cKDTree(ap)
 for mode in ['centroid','border']:
  key=mode+'_'+blockers;patterns={};report={}
  for feet in range(400,1601,100):
   meters=feet*.3048;guard=meters*1.001;blocked=np.zeros(len(ci),dtype=bool)
   if mode=='centroid':blocked=anchor_pointtree.query(cp)[0]<guard
   else:
    for start in range(0,len(cg),5000):
     pairs=anchor_geotree.query(cg[start:start+5000],predicate='dwithin',distance=guard)
     if pairs.size:blocked[start+pairs[0]]=True
   degree=pointtree.query_ball_point(cp,guard,return_length=True,workers=-1);order=np.argsort(degree+np.random.default_rng(feet).random(len(cp)));chosen=[]
   for j in order:
    if blocked[j]:continue
    chosen.append(int(j))
    neighbors=pointtree.query_ball_point(cp[j],guard) if mode=='centroid' else geomtree.query(cg[j],predicate='dwithin',distance=guard)
    blocked[neighbors]=True
   assert np.all(blocked),'Packing must be maximal for eligible candidates'
   selected=[candidateids[j] for j in chosen];patterns[str(feet)]=selected;union.update(selected)
   if mode=='border':
    selectedg=cg[chosen];sel_tree=shapely.STRtree(selectedg);pairs=sel_tree.query(selectedg,predicate='dwithin',distance=meters)
    assert not np.any(pairs[0]!=pairs[1]);assert anchor_geotree.query(selectedg,predicate='dwithin',distance=meters).size==0
    nearest=sel_tree.query_nearest(selectedg,exclusive=True,return_distance=True)[1];minimum_pair=float(nearest.min()) if len(nearest) else None
    minimum_anchor=float(anchor_geotree.query_nearest(selectedg,return_distance=True)[1].min())
   else:
    sc=cp[chosen];minimum_pair=float(cKDTree(sc).query(sc,k=2)[0][:,1].min());minimum_anchor=float(anchor_pointtree.query(sc)[0].min());assert minimum_pair>=meters and minimum_anchor>=meters
    pairs=cKDTree(sc).query_pairs(meters*1.002)
    for a,b in pairs:
     x1,y1=inverse.transform(*sc[a]);x2,y2=inverse.transform(*sc[b]);assert geod.inv(x1,y1,x2,y2)[2]>=meters
   report[str(feet)]=dict(additions=len(selected),minimum_new_to_new_ft=minimum_pair/.3048 if minimum_pair else None,minimum_new_to_existing_ft=minimum_anchor/.3048,blocking_existing_parcels=len(anchorids))
   print(key,feet,'ft:',len(selected),'additions; nearest existing:',round(minimum_anchor/.3048,1),'ft',flush=True)
  all_patterns[key]=patterns;validation[key]=report
  (OUT/('spacing_patterns_'+key+'.json')).write_text(json.dumps(dict(mode=mode,blockers=blockers,method='Deterministic sparse-first greedy maximal packing; not a proven maximum. True projected polygon centroids or shortest polygon-to-polygon distance, with a 0.1% projection guard.',patterns=patterns),separators=(',',':')),encoding='utf-8')
# Geometry additions supplement old captures; all points receive genuine centroid coordinates.
extra=union-set(known);features=[]
for id in sorted(extra):
 r=byid[id];features.append(dict(type='Feature',geometry=dict(type='Point',coordinates=r[5]),properties=dict(parcel=id,address=r[2],neighborhood=r[12].get('neighborhood',''),current=False,nonresident=False,residential=True,spacing=False,cap=False,cap_rank=0,mixed_rank=0)))
centroids={id:list(inverse.transform(*coords[lookup[id]])) for id in set(known)|extra};(OUT/'parcel_centroids.json').write_text(json.dumps(centroids,separators=(',',':')),encoding='utf-8')
(OUT/'measurement_extra_points.json').write_text(json.dumps(dict(type='FeatureCollection',features=features),separators=(',',':')),encoding='utf-8');props={f['properties']['parcel']:f['properties'] for f in features}
chunks=[];batch=[];size=0
for id in sorted(extra):
 encoded=json.dumps(dict(type='Feature',geometry=mapping(geoms[lookup[id]]),properties=props[id]),separators=(',',':'));cost=len(encoded.encode('utf-8'))+1
 if batch and size+cost>8*1024**2:
  name=f'measurement_extra_plots_{len(chunks):02d}.json';(OUT/name).write_text('{"type":"FeatureCollection","features":['+','.join(batch)+']}',encoding='utf-8');chunks.append(name);batch=[];size=0
 batch.append(encoded);size+=cost
if batch:
 name=f'measurement_extra_plots_{len(chunks):02d}.json';(OUT/name).write_text('{"type":"FeatureCollection","features":['+','.join(batch)+']}',encoding='utf-8');chunks.append(name)
(OUT/'measurement_geometry_manifest.json').write_text(json.dumps(dict(chunks=chunks,extra_parcels=len(extra))),encoding='utf-8')
(OUT/'spacing_measurement_validation.json').write_text(json.dumps(dict(projection='EPSG:26915',projection_guard=1.001,repaired_geometries=int(bad.sum()),patterns=validation),indent=2),encoding='utf-8')
# Outcome tables reuse the existing cap allocation; only spacing and mixed change.
properties={**known,**{f['properties']['parcel']:f['properties'] for f in features}};original=load('scenario_outcomes');base_current=load('summary')['current_residential_plots'];denom=load('summary')['residential'];nb={f['properties']['area_id']:f['properties'] for f in load('neighborhoods')['features']};nids=original['neighborhood_ids']
def outcomes(added):
 totals=[nb[id]['current_residential']+n for id,n in zip(nids,added)];percent=[100*n/nb[id]['residential'] if nb[id]['residential'] else None for id,n in zip(nids,totals)];city=base_current+sum(added);return dict(added=added,total=totals,percent=percent,city_total=city,city_percent=100*city/denom)
for key,patterns in all_patterns.items():
 result=dict(neighborhood_ids=nids,cap_steps=original['cap_steps'],distance_steps=original['distance_steps'],spacing={},caps=original['caps'],mixed={})
 for feet,pattern in patterns.items():
  counts=Counter(properties[id]['neighborhood'] for id in pattern);spacing=[counts[id] for id in nids];result['spacing'][feet]=outcomes(spacing);result['mixed'][feet]={}
  for cap,c in original['caps'].items():result['mixed'][feet][cap]=outcomes([min(n,max(0,limit-nb[id]['current_residential'])) for id,n,limit in zip(nids,spacing,c['limit'])])
 (OUT/('scenario_outcomes_'+key+'.json')).write_text(json.dumps(result,separators=(',',':')),encoding='utf-8')
print('Completed four measurement/blocker models;',len(extra),'additional parcel shapes in',len(chunks),'chunks',flush=True)
