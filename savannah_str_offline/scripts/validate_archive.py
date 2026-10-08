from pathlib import Path
import json,gzip
ROOT=Path(__file__).resolve().parents[1]
manifest=json.loads((ROOT/'data/manifest.json').read_text());total=0
for layer in manifest['layers']:
 ids=json.loads((ROOT/'data'/str(layer['id'])/'object_ids.json').read_text())['objectIds'];features=[]
 for chunk in layer['chunks']:features+=json.load(gzip.open(ROOT/'data'/chunk,'rt'))['features']
 got=[f['properties'][layer['object_id']] for f in features];assert len(got)==layer['count']==len(ids);assert len(set(got))==len(got) and set(got)==set(ids)
 for f in features:
  if not layer['table']:assert f['geometry'] is not None
 total+=len(got)
files=[p for p in ROOT.rglob('*') if p.is_file()];assert all(p.stat().st_size<100*1024**2 for p in files)
base=json.loads((ROOT/'basemap/manifest.json').read_text());tiles=list((ROOT/'basemap/tiles').rglob('*.pbf'));assert len(tiles)==4888
for font in base['fonts']:
 for start in range(0,1024,256):assert (ROOT/'basemap/fonts'/font/f'{start}-{start+255}.pbf').is_file()
for name in ['sprite.json','sprite.png','sprite@2x.json','sprite@2x.png','style.json']:assert (ROOT/'basemap'/name).is_file()
report=dict(records=total,layers=len(manifest['layers']),complete_unique_object_ids=True,basemap_tiles=len(tiles),all_assets_local=True,files_below_github_100_mib=True,largest_file_bytes=max(p.stat().st_size for p in files),total_bytes=sum(p.stat().st_size for p in files))
print(json.dumps(report,indent=2));(ROOT/'archive_validation.json').write_text(json.dumps(report,indent=2))
