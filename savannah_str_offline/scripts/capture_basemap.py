"""Save the source basemap style, sprites, fonts and area tiles for offline use."""
from pathlib import Path
import json,math,requests
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'basemap';BASE.mkdir(exist_ok=True)
style=json.loads((BASE/'original_style.json').read_text());bounds=[-81.43,31.69,-80.81,32.26]
def download(task):
 url,path=task;path.parent.mkdir(parents=True,exist_ok=True)
 if path.exists() and path.stat().st_size:return
 for attempt in range(4):
  try:
   r=requests.get(url,timeout=45);r.raise_for_status();path.write_bytes(r.content);return
  except Exception:
   if attempt==3:raise
base='https://basemaps.arcgis.com/arcgis/rest/services/World_Basemap_v2/VectorTileServer';tasks=[]
def tile(lon,lat,z):n=2**z;return int((lon+180)/360*n),int((1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n)
for z in range(7,16):
 x0,y0=tile(bounds[0],bounds[3],z);x1,y1=tile(bounds[2],bounds[1],z)
 for x in range(x0,x1+1):
  for y in range(y0,y1+1):tasks.append((f'{base}/tile/{z}/{y}/{x}.pbf',BASE/'tiles'/str(z)/str(x)/(str(y)+'.pbf')))
print('Saving',len(tasks),'vector tiles; exportTilesAllowed=true, below 10,000 export limit.',flush=True)
fonts=set()
for layer in style['layers']:
 stack=layer.get('layout',{}).get('text-font')
 if isinstance(stack,list) and all(isinstance(x,str) for x in stack):fonts.add(','.join(stack))
for font in fonts:
 for start in range(0,1024,256):tasks.append((base+'/resources/fonts/'+quote(font,safe='')+f'/{start}-{start+255}.pbf',BASE/'fonts'/font/f'{start}-{start+255}.pbf'))
sprite='https://cdn.arcgis.com/sharing/rest/content/items/27e89eb03c1e4341a1d75e597f0291e6/resources/sprites/sprite'
for suffix in ['.json','.png','@2x.json','@2x.png']:tasks.append((sprite+suffix,BASE/('sprite'+suffix)))
with ThreadPoolExecutor(max_workers=12) as pool:
 for i,_ in enumerate(pool.map(download,tasks),1):
  if i%250==0:print('Basemap assets',i,'/',len(tasks),flush=True)
style['sources']['esri']={'type':'vector','tiles':['basemap/tiles/{z}/{x}/{y}.pbf'],'minzoom':7,'maxzoom':15,'bounds':bounds,'attribution':'Basemap © Esri and contributors; offline area snapshot. Data: Savannah Area GIS, Chatham County Board of Assessors.'};style['sprite']='basemap/sprite';style['glyphs']='basemap/fonts/{fontstack}/{range}.pbf'
(BASE/'style.json').write_text(json.dumps(style,separators=(',',':')));(BASE/'manifest.json').write_text(json.dumps(dict(bounds=bounds,minzoom=7,maxzoom=15,fonts=sorted(fonts),assets=len(tasks),source=base,export_tiles_allowed=True)))
print('Basemap capture complete',flush=True)
