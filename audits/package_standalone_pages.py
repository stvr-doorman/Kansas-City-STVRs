"""Create independent static map packages with GitHub-sized assets.

All source pages/data stay intact. Generated folders need no parent-directory
files and can each be served as a static-site root. Internet basemaps are kept
for Kansas City; Savannah retains its saved offline basemap.
"""
from pathlib import Path
import argparse, gzip, hashlib, json, re
from html.parser import HTMLParser

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'standalone_pages'
LIMIT=25*1024**2
CACHE={}
LOADER=r'''/* Static-host loader for packaged JSON assets. No server transforms needed. */
'use strict';
(()=>{
 const base=new URL('.',document.currentScript.src),nativeFetch=globalThis.fetch.bind(globalThis);
 const assets=globalThis.PackagedAssets;
 globalThis.fetch=async function(input,options){
  const url=new URL(input instanceof Request?input.url:String(input),document.baseURI);
  const key=url.origin===base.origin&&url.pathname.startsWith(base.pathname)?decodeURIComponent(url.pathname.slice(base.pathname.length)):'';
  const asset=assets[key];
  if(!asset||((options?.method||'GET').toUpperCase()!=='GET'))return nativeFetch(input,options);
  const target=new URL(asset,base);target.search=url.search;
  const response=await nativeFetch(input instanceof Request?new Request(target,input):target,options);
  if(!response.ok)return response;
  const bytes=new Uint8Array(await response.arrayBuffer());
  const body=bytes[0]===31&&bytes[1]===139
   ?await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer():bytes;
  return new Response(body,{status:response.status,statusText:response.statusText,headers:{'Content-Type':'application/json;charset=utf-8'}});
 };
})();
'''
ICON='''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path stroke="#64748b" stroke-width="2" d="M23 1v30"/><circle fill="#db2777" cx="13" cy="6" r="3"/><path fill="none" stroke="#db2777" stroke-width="3" stroke-linecap="round" d="M14 12l3 7-5 10m5-10 4 10M14 12l9-3M14 12l-7 6"/></svg>'''
DATA_FILES=set('''listings.json listings.csv permits.json permits.csv build_report.json
compasskc_str_permits.csv permit_evidence.csv spatial.json licensed_parcels.geojson
permit_parcels.geojson permit_property_parcels.geojson permit_saved_details.json
permit_location_points.json nicknames.json parcel_matching_candidates.geojson
listing_plot_addresses.json listing_address_overrides.json area_boundaries.json
council_members.json scanner_status.json'''.split())
DATA_DIRS={'parcels','property_matches','nearby_candidates','nearby_parcels','gis_parcels',
           'border_parcels','privacy_streets','confirmed_permits','residential_scenarios',
           'residential_scenarios_confirmed'}

def digest(value):return hashlib.sha256(value).hexdigest()

def files_for_kansas(source):
    for path in sorted(source.iterdir()):
        if path.is_file() and path.suffix.lower() in {'.html','.js','.css','.jpg','.jpeg','.png','.webp','.svg','.pdf'}:
            yield path,path.name
    config=source/'reporting_config.json'
    if config.exists():yield config,config.name
    for path in sorted((source/'data').rglob('*')):
        if not path.is_file():continue
        relative=path.relative_to(source/'data')
        if relative.parts[0] in DATA_DIRS or relative.as_posix() in DATA_FILES:
            # Preserve GIS raw geometry chunks: address search loads them at runtime.
            if relative.parts[0]=='gis_parcels' and relative.as_posix() in {'capture.json','validation.json'}:continue
            if path.suffix in {'.log','.tmp','.pyc'}:continue
            yield path,'data/'+relative.as_posix()
    vendor=source/'vendor' if (source/'vendor').exists() else ROOT/'residential_neighborhood_impact/vendor'
    for path in sorted(vendor.rglob('*')):
        if path.is_file():yield path,'vendor/'+path.relative_to(vendor).as_posix()

def files_for_savannah(source):
    manifest=json.loads((source/'data/manifest.json').read_text(encoding='utf-8'))
    names={'data/manifest.json','data/item_data.json','data/item.json','data/service.json'}
    for entry in manifest['layers']:
        names.add('data/'+entry['metadata'])
        names.update('data/'+name for name in entry['chunks'])
    for name in ['index.html','viewer.js','viewer.css','serve.py','START_OFFLINE.cmd']:
        names.add(name)
    for directory in ['basemap','vendor']:
        names.update(path.relative_to(source).as_posix() for path in (source/directory).rglob('*') if path.is_file())
    for name in sorted(names):yield source/name,name

def packed_file(path,name):
    raw=path.read_bytes();sha=digest(raw)
    if path.suffix.lower() in {'.json','.geojson'} and len(raw)>512*1024:
        if sha not in CACHE:CACHE[sha]=gzip.compress(raw,compresslevel=9,mtime=0)
        packed=CACHE[sha]
        if len(packed)<len(raw):return name+'.gz',packed,sha
    return name,raw,sha

def write_file(folder,name,value):
    target=folder/name
    assert target.resolve().is_relative_to(folder.resolve())
    target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(value)

def transform_pages(folder,entry):
    if entry!='index.html':
        original=(folder/'index.html').read_bytes()
        write_file(folder,'listing_map.html',original)
        write_file(folder,'index.html',(folder/entry).read_bytes())
    for path in folder.glob('*.html'):
        text=path.read_text(encoding='utf-8')
        if entry!='index.html':text=text.replace('href="index.html"','href="listing_map.html"')
        text=re.sub(r'https://unpkg\.com/maplibre-gl@[^/]+/dist/maplibre-gl\.(js|css)',r'vendor/maplibre-gl.\1',text)
        # Also retain older copied pages with an external dependency path.
        text=text.replace('src="stripper.png"','src="stripper.svg"')
        text=text.replace('</head>','<script src="compressed_assets.js"></script><script src="asset_loader.js"></script></head>',1)
        path.write_text(text,encoding='utf-8')
    for path in folder.glob('*.js'):
        if path.name in {'asset_loader.js','compressed_assets.js'}:continue
        text=path.read_text(encoding='utf-8')
        text=text.replace("const scenario=location.pathname.endsWith('/worst_case.html');","const scenario=Boolean(document.getElementById('scenarioMap'));")
        text=text.replace("'stripper.png'","'stripper.svg'")
        glyph="new URL('vendor/fonts/{fontstack}/{range}.pbf',location.href).href.replace(/%7B/gi,'{').replace(/%7D/gi,'}')"
        text=text.replace("'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf'",glyph)
        path.write_text(text,encoding='utf-8')
    if not (folder/'stripper.png').exists():write_file(folder,'stripper.svg',ICON.encode())

class Dependencies(HTMLParser):
    def __init__(self):super().__init__();self.refs=[]
    def handle_starttag(self,tag,attrs):
        for key,value in attrs:
            if key in {'src','href'} and value:self.refs.append(value)

def validate(folder,compressed,source_info):
    failures=[]
    for page in folder.glob('*.html'):
        parser=Dependencies();parser.feed(page.read_text(encoding='utf-8'))
        for ref in parser.refs:
            if ref.startswith(('http:','https:','data:','mailto:','tel:','#')):continue
            name=ref.split('#')[0].split('?')[0]
            if name and not (page.parent/name).is_file():failures.append(f'{page.name}: missing {ref}')
    for original,packed in compressed.items():
        assert digest(gzip.decompress((folder/packed).read_bytes()))==source_info[original]['source_sha256'],original
        assert not (folder/original).exists(),original
    files=[p for p in folder.rglob('*') if p.is_file()]
    too_large=[str(p.relative_to(folder)) for p in files if p.stat().st_size>=LIMIT]
    assert not too_large,too_large
    assert not failures,failures
    return {'files':len(files),'total_bytes':sum(p.stat().st_size for p in files),
            'largest_file':max(files,key=lambda p:p.stat().st_size).relative_to(folder).as_posix(),
            'largest_bytes':max(p.stat().st_size for p in files),'missing_local_html_dependencies':failures,
            'compressed_assets_verified':len(compressed),'file_limit_bytes':LIMIT}

def package(name,source,entry,savannah=False):
    folder=OUT/name
    if folder.exists():raise RuntimeError(f'{folder} already exists. Preserve it before rebuilding to a new output directory.')
    folder.mkdir(parents=True)
    compressed={};source_info={}
    for path,relative in files_for_savannah(source) if savannah else files_for_kansas(source):
        packed,value,sha=packed_file(path,relative)
        write_file(folder,packed,value)
        source_info[relative]={'packed_path':packed,'source_sha256':sha,'source_bytes':path.stat().st_size}
        if packed!=relative:compressed[relative]=packed
    write_file(folder,'compressed_assets.js',('globalThis.PackagedAssets='+json.dumps(compressed,separators=(',',':'))+';\n').encode())
    write_file(folder,'asset_loader.js',LOADER.encode())
    if not savannah:transform_pages(folder,entry)
    else:
        page=folder/'index.html';text=page.read_text(encoding='utf-8').replace('</head>','<script src="compressed_assets.js"></script><script src="asset_loader.js"></script></head>',1);page.write_text(text,encoding='utf-8')
    write_file(folder,'.nojekyll',b'')
    write_file(folder,'.gitignore',b'__pycache__/\n*.pyc\n*.log\n.DS_Store\nThumbs.db\n')
    note='Saved offline basemap, glyphs and sprites are included.' if savannah else 'Application scripts, styles, glyphs and saved datasets are local. OpenStreetMap basemap tiles still require internet access.'
    readme=f'''# {name.replace('_',' ').title()}

This folder is an independent static site. `index.html` is its entry page.
Copy or upload the whole folder; no files from the parent workspace are needed.
{note}

Run `python -m http.server 8000` from this folder, then open
http://localhost:8000/index.html . HTTP serving is required; avoid file URLs.
GitHub Pages can host these files directly. `.nojekyll` is included.

Files are below 25 MiB. Large JSON datasets are stored as gzip files;
`compressed_assets.js` and `asset_loader.js` transparently serve their original
JSON URLs to application code. No build step or Git LFS is required.
Use a modern browser supporting DecompressionStream (current Edge/Chrome/Firefox).

Saved records, licensing caveats and page defaults are preserved.
{('The main map includes all saved permits by default. The current worst-case page excludes other saved permits by default; its checkbox is in Advanced filters.' if source==ROOT else 'This is a preserved snapshot of the original viewer/version.')}

`package_manifest.json` records source-file hashes and compressed paths;
`package_validation.json` records size and dependency validation.
Rebuild code: `audits/package_standalone_pages.py` in the source workspace.
'''
    write_file(folder,'README.md',readme.encode())
    write_file(folder,'package_manifest.json',json.dumps({'source':source.name,'entry_page':entry,'files':source_info},indent=2).encode())
    result=validate(folder,compressed,source_info)
    write_file(folder,'package_validation.json',json.dumps(result,indent=2).encode())
    print(name,json.dumps(result),flush=True)
    return result

def main():
    global OUT
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',default='standalone_pages',help='New output directory; existing packages are preserved')
    args=parser.parse_args()
    OUT=ROOT/args.output
    OUT.mkdir(exist_ok=True)
    results={}
    for name,source,entry,savannah in [
        ('listing_map',ROOT,'index.html',False),
        ('worst_case_map',ROOT,'worst_case.html',False),
        ('residential_neighborhood_impact',ROOT/'residential_neighborhood_impact','index.html',False),
        ('savannah_offline',ROOT/'savannah_str_offline','index.html',True)]:
        results[name]=package(name,source,entry,savannah)
    write_file(OUT,'package_sizes.json',json.dumps(results,indent=2).encode())
    links='\n'.join(f'<li><a href="{name}/index.html">{name.replace("_"," ").title()}</a></li>' for name in results)
    write_file(OUT,'index.html',f'<!doctype html><html lang="en"><meta charset="utf-8"><title>Standalone map packages</title><h1>Standalone map packages</h1><ul>{links}</ul></html>'.encode())
    write_file(OUT,'README.md',('''# Standalone page packages

Each subfolder is a complete independently hostable map/viewer. Supporting
records, About, Data & rules and Legislative tips pages remain with their map.
The worst-case folder opens the scenario page at index.html and includes a
local listing map for its return link. Original workspace files are untouched.

Upload the contents of one subfolder as its own GitHub Pages site, or host all
subfolders with this index. All package files are below 25 MiB. See
package_sizes.json and each folder's README and validation report.

Build script: ../audits/package_standalone_pages.py
''').encode())

if __name__=='__main__':main()
