from pathlib import Path
import json,gzip
root=Path(__file__).resolve().parents[1];codes={};res={1111,1112,1121,1122,1123,1124,1125,1126}
for name in ['data/gis_parcels/search_index.json.gz','data/border_parcels/search_index.json.gz']:
 p=root/name
 if not p.exists():continue
 data=json.load(gzip.open(p,'rt'))
 for r in data['records']:codes[r[7] if 'gis_parcels/' in name else r[0]]=r[4]
count=0
for p in (root/'data/gis_parcels/outlines').glob('*.json.gz'):
 data=json.load(gzip.open(p,'rt'))
 for f in data['features']:
  code=codes.get(f['properties']['objectid']);f['properties']['landuse']=code;f['properties']['nonresidential']=code is not None and int(code)>0 and int(code) not in res
  count+=1
 with gzip.open(p,'wt',encoding='utf-8',compresslevel=6) as out:json.dump(data,out,separators=(',',':'))
print('Classified tiled and overview parcel features:',count)
