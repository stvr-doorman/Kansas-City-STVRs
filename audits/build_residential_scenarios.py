from scenario_inputs import scenario_output, scenario_permits, scenario_provenance
"""Reproducible scenario examples; not an exact optimum or licensing eligibility decision."""
from pathlib import Path
import json,gzip,math,csv
from collections import defaultdict
import numpy as np
from scipy.spatial import cKDTree
from pyproj import Transformer,Geod
ROOT=Path(__file__).resolve().parents[1];OUT=scenario_output(ROOT);OUT.mkdir(exist_ok=True)
index=json.load(gzip.open(ROOT/'data/gis_parcels/search_index.json.gz','rt',encoding='utf-8'))
rows=[r for r in index['records'] if r[13]>=0];byid={r[0]:r for r in rows};permits=scenario_permits(ROOT)
current=[p for p in permits if p['status']=='current'];norm=lambda x:''.join(c for c in str(x or '') if c.isalnum()).upper()
licensed=set(norm(x) for p in current for x in [p['parcel'],*p.get('parcels',[])])
nonresident=set(norm(x) for p in current if 'Non-Resident' in p['type'] for x in [p['parcel'],*p.get('parcels',[])])
existing=sorted(licensed&byid.keys());anchors=sorted(nonresident&byid.keys());res={1111,1112,1121,1122,1123,1124,1125,1126}
candidates=[r for r in rows if r[4] in {1111,1122} and r[0] not in licensed]
transform=Transformer.from_crs(4326,26915,always_xy=True)
def xy(records):
 points=np.array([r[5] for r in records]);x,y=transform.transform(points[:,0],points[:,1]);return np.column_stack([x,y])
positions=xy(candidates);anchor_xy=xy([byid[x] for x in anchors]);tree=cKDTree(anchor_xy)
available=np.flatnonzero(tree.query(positions)[0]>=305)
local=positions[available];degree=cKDTree(local).query_ball_point(local,305,return_length=True,workers=-1)
best=[];trials=[]
for seed in range(12):
 rng=np.random.default_rng(seed);order=np.argsort(degree+rng.random(len(degree))*(1 if seed<6 else 50)) if seed<10 else rng.permutation(len(local));buckets=defaultdict(list);chosen=[]
 for j in order:
  pt=local[j];cell=tuple(np.floor(pt/305).astype(int));okay=True
  for dx in (-1,0,1):
   for dy in (-1,0,1):
    if any(np.sum((pt-local[k])**2)<305**2 for k in buckets[(cell[0]+dx,cell[1]+dy)]):okay=False;break
   if not okay:break
  if okay:chosen.append(int(j));buckets[cell].append(int(j))
 chosen=[int(available[j]) for j in chosen];trials.append(len(chosen));print(f'Spacing trial {seed+1}: {len(chosen)} additions',flush=True)
 if len(chosen)>len(best):best=chosen
# Original current plots are preserved; only proposed points must obey spacing.
selected=positions[best];spacing_tree=cKDTree(selected);pairs=spacing_tree.query_pairs(306);geod=Geod(ellps='GRS80')
for a,b in pairs:
 p=candidates[best[a]][5];q=candidates[best[b]][5];assert geod.inv(*p,*q)[2]>=304.8
for i in best:
 for j in tree.query_ball_point(positions[i],306):assert geod.inv(*candidates[i][5],*byid[anchors[j]][5])[2]>=304.8
# Maximality of the example: every unused candidate is blocked by an anchor or selection.
assert np.all(np.minimum(tree.query(positions)[0],spacing_tree.query(positions)[0])<305+1e-6)
area=json.load(open(ROOT/'data/area_boundaries.json',encoding='utf-8'));totals=json.load(open(ROOT/'data/gis_parcels/area_counts.json',encoding='utf-8'))['totals']['0']['neighborhood'];counts=defaultdict(lambda:dict(current=0,current_residential=0,spacing_added=0,cap_added=0,candidates=0))
for id in existing:
 r=byid[id];n=r[12].get('neighborhood')
 if n:counts[n]['current']+=1;counts[n]['current_residential']+=int(r[4] in res)
for r in candidates:
 n=r[12].get('neighborhood')
 if n:counts[n]['candidates']+=1
for i in best:
 n=candidates[i][12].get('neighborhood')
 if n:counts[n]['spacing_added']+=1
cap=[];cap_pool=[];cap_ranks={};mixed_ranks={};byarea=defaultdict(list)
for i,r in enumerate(candidates):
 if r[12].get('neighborhood'):byarea[r[12]['neighborhood']].append(i)
rng=np.random.default_rng(20261006);preferred=set(best)
for n,indices in byarea.items():
 limit=totals.get(n,{}).get('residential',0)//20;room=max(0,limit-counts[n]['current_residential']);order=sorted(indices,key=lambda i:(i not in preferred,rng.random()));chosen=order[:room];cap.extend(chosen);counts[n]['cap_added']=len(chosen)
 room_max=max(0,totals.get(n,{}).get('residential',0)//10-counts[n]['current_residential']);pool=order[:room_max];cap_pool.extend(pool)
 for rank,i in enumerate(pool,1):cap_ranks[candidates[i][0]]=rank
 for rank,i in enumerate([i for i in best if candidates[i][12].get('neighborhood')==n],1):mixed_ranks[candidates[i][0]]=rank
upper={}
for n,indices in byarea.items():
 valid=indices
 pts=positions[valid];cellsize=304/math.sqrt(2)
 # Disjoint squares form a clique cover: at most one new point per square.
 upper[n]=min(len(set(map(tuple,np.floor((pts+offset)/cellsize).astype(int)))) for offset in [0,cellsize/2]) if len(pts) else 0
features=[]
for f in area['layers']['neighborhood']['features']:
 n=f['properties']['area_id'];c=counts[n];housing=totals.get(n,{}).get('residential',0);limit=housing//20
 c.update(residential=housing,cap_limit=limit,cap_over_existing=max(0,c['current_residential']-limit),spacing_total=c['current_residential']+c['spacing_added'],cap_total=c['current_residential']+c['cap_added'],spacing_upper_added=upper.get(n,0))
 c['spacing_percent']=100*c['spacing_total']/housing if housing else None;c['cap_percent']=100*c['cap_total']/housing if housing else None
 assert c['cap_added']==0 or c['cap_total']<=limit
 features.append(dict(type='Feature',geometry=f['geometry'],properties={**f['properties'],**c}))
spacing_ids={candidates[i][0] for i in best};cap_ids={candidates[i][0] for i in cap};selected_ids=set(existing)|spacing_ids|{candidates[i][0] for i in cap_pool}
points=[]
for id in sorted(selected_ids):
 r=byid[id];points.append(dict(type='Feature',geometry=dict(type='Point',coordinates=r[5]),properties=dict(parcel=id,address=r[2],neighborhood=r[12].get('neighborhood',''),current=id in licensed,nonresident=id in nonresident,residential=r[4] in res,spacing=id in spacing_ids,cap=id in cap_ids,cap_rank=cap_ranks.get(id,0),mixed_rank=mixed_ranks.get(id,0))))
point_properties={f["properties"]["parcel"]:f["properties"] for f in points}
polygons=[]
for chunk in sorted({byid[id][6] for id in selected_ids}):
 data=json.load(gzip.open(ROOT/f'data/gis_parcels/raw/{chunk:04d}.geojson.gz','rt',encoding='utf-8'))
 for f in data['features']:
  id=norm(f['properties']['KIVAPIN'])
  if id in selected_ids:polygons.append(dict(type='Feature',geometry=f['geometry'],properties=point_properties[id]))
meta=dict(built_at='2026-10-06',source=index['source'],gis_snapshot=index['downloaded_at'],distance_ft=1000,distance_m=304.8,projection='EPSG:26915',packing_guard_m=305,trials=trials,method='Best of 12 deterministic greedy maximal independent sets; feasible example, not a certified maximum.',candidates=len(candidates),current_plots=len(existing),nonresident_anchors=len(anchors),unlocated_current_plots=len(licensed-set(existing)),unlocated_nonresident_plots=len(nonresident-set(anchors)),current_residential_plots=sum(byid[id][4] in res for id in existing),residential=sum(r[4] in res for r in rows),spacing_additions=len(best),cap_additions=len(cap),unassigned_spacing=sum(not candidates[i][12].get('neighborhood') for i in best),unassigned_candidates=sum(not r[12].get('neighborhood') for r in candidates))
meta.update(scenario_provenance(ROOT));meta['max_cap_percent']=10;meta['mixed_method']='Retain a capped subset of the selected spacing pattern; no re-packing after removing over-cap points. Feasible example, not optimized maximum.'
meta['spacing_percent']=100*(meta['current_residential_plots']+len(best))/meta['residential'];meta['cap_percent']=100*(meta['current_residential_plots']+len(cap))/meta['residential']
for name,obj in [('city_boundary',json.load(open(ROOT/'data/spatial.json',encoding='utf-8'))['boundary']),('summary',meta),('neighborhoods',dict(type='FeatureCollection',features=features)),('points',dict(type='FeatureCollection',features=points)),('plots',dict(type='FeatureCollection',features=polygons))]:
 (OUT/(name+'.json')).write_text(json.dumps(obj,separators=(',',':')),encoding='utf-8')
with open(OUT/'neighborhood_comparison.csv','w',newline='',encoding='utf-8') as file:
 fields=['name',*counts[next(iter(counts))].keys()];w=csv.DictWriter(file,fieldnames=fields,extrasaction='ignore');w.writeheader();w.writerows(f['properties'] for f in features)
print(json.dumps(meta),flush=True)
