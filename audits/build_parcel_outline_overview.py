from pathlib import Path
import json,gzip
from shapely.geometry import shape,mapping
root=Path(__file__).resolve().parents[1]/'data/gis_parcels/outlines';seen=set();features=[]
for p in root.glob('*.json.gz'):
 if p.name=='overview.json.gz':continue
 for f in json.load(gzip.open(p,'rt'))['features']:
  id=f['properties']['objectid']
  if id in seen:continue
  seen.add(id);g=shape(f['geometry']).simplify(.00001,preserve_topology=True);features.append(dict(type='Feature',properties=dict(objectid=id,landuse=f['properties'].get('landuse'),nonresidential=f['properties'].get('nonresidential',False)),geometry=mapping(g)))
with gzip.open(root/'overview.json.gz','wt',encoding='utf-8',compresslevel=9) as out:json.dump(dict(type='FeatureCollection',features=features),out,separators=(',',':'))
print(len(features),'parcels;', (root/'overview.json.gz').stat().st_size,'compressed bytes')
