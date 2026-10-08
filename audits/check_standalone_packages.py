"""Serve each package as an isolated site root and exercise its actual viewer."""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
import gzip,json,hashlib
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUTPUT=ROOT/'standalone_pages'
class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass

results={}
with sync_playwright() as p:
    browser=p.chromium.launch(channel='msedge',headless=False)
    for name in ['listing_map','worst_case_map','residential_neighborhood_impact','savannah_offline']:
        folder=OUTPUT/name
        server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(folder)))
        Thread(target=server.serve_forever,daemon=True).start()
        base=f'http://127.0.0.1:{server.server_port}/'
        page=browser.new_page(viewport={'width':1500,'height':1000});errors=[];remote=[];failed=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.on('response',lambda response:failed.append(response.url) if response.url.startswith(base) and response.status>=400 else None)
        def route(request):
            url=request.request.url
            if url.startswith((base,'data:','blob:')):request.continue_()
            elif name!='savannah_offline' and ('tile.openstreetmap.org/' in url):request.continue_()
            else:remote.append(url);request.abort()
        page.route('**/*',route)
        page.goto(base+'index.html',wait_until='domcontentloaded')
        if name=='savannah_offline':
            page.wait_for_function("typeof OfflineViewer!=='undefined'&&OfflineViewer.ready",timeout=90000)
            count=page.evaluate('OfflineViewer.layers.reduce((n,l)=>n+l.features.length,0)')
            assert count==62034,count
            assert not remote,remote
            results[name]={'saved_records':count,'external_requests':remote}
        elif name=='worst_case_map':
            page.wait_for_function("typeof Scenario!=='undefined'&&Scenario.rows.length>0",timeout=90000)
            assert not page.is_checked('#includeOtherSavedPermits')
            assert page.locator('#includeOtherSavedPermits').evaluate("e=>Boolean(e.closest('#scenarioAdvanced'))")
            assert page.evaluate('PermitInventory.scenarioPath')=='data/residential_scenarios_confirmed'
            assert page.evaluate('Scenario.data.summary.confirmed_permits')==709
            assert page.locator('header a').get_attribute('href')=='listing_map.html'
            page.locator('#scenarioAdvanced').evaluate('(e)=>e.open=true')
            with page.expect_navigation(wait_until='domcontentloaded'):page.locator('#includeOtherSavedPermits').click()
            page.wait_for_function("typeof Scenario!=='undefined'&&Scenario.rows.length>0",timeout=90000)
            assert page.evaluate('PermitInventory.scenarioPath')=='data/residential_scenarios'
            assert page.is_checked('#includeOtherSavedPermits')
            page.goto(base+'index.html',wait_until='domcontentloaded')
            page.wait_for_function("typeof Scenario!=='undefined'&&Scenario.rows.length>0",timeout=90000)
            results[name]={'confirmed_permits':709,'default_other_permits':False,'switching':'passed'}
        else:
            page.wait_for_function("typeof AreaStats!=='undefined'&&AreaStats.gisData&&AreaStats.rows.length>0",timeout=90000)
            for selector in ['#dismissFirstVisit','#denyCookies']:
                if page.locator(selector).is_visible():page.locator(selector).click()
            if page.locator('#filters').evaluate("e=>e.classList.contains('collapsed')"):
                page.locator('#toggleFilters').click()
            page.locator('#parcelSearchQuery').evaluate("e=>{for(let x=e.parentElement;x;x=x.parentElement)if(x.tagName==='DETAILS')x.open=true;}")
            index=json.load(gzip.open(folder/'data/gis_parcels/search_index.json.gz','rt',encoding='utf-8'))
            sample=next(row for row in index['records'] if row[2] and row[4]==1111 and row[13]>=0)
            page.fill('#parcelSearchQuery',sample[2])
            page.wait_for_selector('.gis-parcel-result',timeout=90000)
            page.locator('.gis-parcel-result').first.click()
            page.wait_for_function('(id)=>ParcelSearch.selected?.[0]===id',arg=sample[0],timeout=90000)
            assert page.evaluate("map.getSource('gis-selected-parcel')._data.features.length")>0
            results[name]={'listings':page.evaluate('listings.length'),'area_rows':page.evaluate('AreaStats.rows.length'),'parcel_search':'passed'}
            page.goto(base+'records.html',wait_until='domcontentloaded')
            page.wait_for_function("typeof datasets!=='undefined'&&datasets.permits&&datasets.propertyLocations",timeout=90000)
            page.select_option('#kind','permits')
            assert page.locator('#count').inner_text().startswith('4,476 records')
            results[name]['inventory_records']=4476
        assert not errors,(name,errors)
        assert not remote,(name,remote)
        # No parent workspace is available from any of these isolated server roots.
        unexpected=[url for url in failed if '/data/scanner_status.json' not in url]
        assert not unexpected,(name,unexpected)
        results[name]['page_errors']=errors
        results[name]['missing_runtime_files']=unexpected
        page.screenshot(path=str(ROOT/'audits'/f'packaged_{name}_preview.png'))
        print(name,json.dumps(results[name]),flush=True)
        page.close();server.shutdown();server.server_close()
    browser.close()
(OUTPUT/'browser_validation.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
print('All standalone viewers passed isolated-root browser checks',flush=True)
