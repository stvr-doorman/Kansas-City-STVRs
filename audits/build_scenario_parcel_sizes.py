from scenario_inputs import scenario_output, scenario_permits
from pathlib import Path
import json,gzip
import numpy as np
import shapely
from shapely.geometry import shape
from pyproj import Transformer
root=Path(__file__).resolve().parents[1];out=scenario_output(root)
idx=json.load(gzip.open(root/'data/gis_parcels/search_index.json.gz','rt'));res={r[0] for r in idx['records'] if r[13]>=0 and r[4] in {1111,1112,1121,1122,1123,1124,1125,1126}}
areas={};transform=Transformer.from_crs(4326,26915,always_xy=True)
for chunk in (root/'data/gis_parcels/raw').glob('*.geojson.gz'):
 for f in json.load(gzip.open(chunk,'rt'))['features']:
  pid=''.join(c for c in str(f['properties'].get('KIVAPIN') or '') if c.isalnum()).upper()
  if f.get('geometry'):
   g=shape(f['geometry']);g=shapely.make_valid(g) if not g.is_valid else g
   areas[pid]=areas.get(pid,0)+shapely.area(shapely.transform(g,transform.transform,interleaved=False))
base=json.loads((out/'points.json').read_text())['features'];current=[f['properties']['parcel'] for f in base if f['properties']['current'] and f['properties']['residential'] and f['properties']['parcel'] in areas]
largest=max(current,key=lambda pid:areas[pid]);maximum=areas[largest];distribution=sorted(areas[pid] for pid in res if pid in areas);percentile=100*np.searchsorted(distribution,maximum,side='right')/len(distribution)
result=dict(areas_m2=areas,residential_sizes_m2=distribution,default_percentile=float(percentile),default_max_m2=maximum,largest_current_parcel=largest,largest_current_address=next(f['properties']['address'] for f in base if f['properties']['parcel']==largest),reference='City residential GIS parcels with saved polygon geometry; licensed residential parcels set default maximum.')
(out/'parcel_sizes.json').write_text(json.dumps(result,separators=(',',':')));print({k:v for k,v in result.items() if k not in ['areas_m2','residential_sizes_m2']})
