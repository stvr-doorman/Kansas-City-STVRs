from pathlib import Path
import csv,json
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=False);page=b.new_page(viewport={'width':1500,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.route('https://unpkg.com/maplibre-gl@3.6.0/dist/maplibre-gl.js',lambda route:route.fulfill(path='residential_neighborhood_impact/vendor/maplibre-gl.js',content_type='application/javascript'))
 page.goto('http://localhost:8765/worst_case.html',wait_until='domcontentloaded');page.wait_for_function("typeof Scenario!=='undefined'&&Scenario.rows.length>0",timeout=90000)
 page.click('#toggleScenarioPanel')
 results=[]
 for cap in [0,.5,1,5,10]:
  page.eval_on_selector('#capPercent',f"e=>{{e.value={cap};e.dispatchEvent(new Event('input'))}}")
  checked=page.evaluate("""() => {const s=Scenario.data.summary,rows=Scenario.data.neighborhoods.features,points=Scenario.data.points.features;return {cap:s.cap_additions,mixed:s.mixed_additions,spacing:s.spacing_additions,cap_percent:s.cap_percent,mixed_percent:s.mixed_percent,bad:rows.filter(f=>{const p=f.properties;return (p.cap_added>0&&p.cap_total>p.cap_limit)||(p.mixed_added>0&&p.mixed_total>p.cap_limit)||p.mixed_added>p.spacing_added;}).length,wrong_subset:points.some(f=>f.properties.mixed&&!f.properties.spacing),cap_points:points.filter(f=>f.properties.cap).length,mixed_points:points.filter(f=>f.properties.mixed).length};}""")
  assert checked['bad']==0 and not checked['wrong_subset'],checked
  assert checked['cap']==checked['cap_points'] and checked['mixed']==checked['mixed_points']
  assert checked['mixed']<=checked['spacing'] and checked['mixed']<=checked['cap']
  assert all(page.locator('#result-'+n).is_visible() for n in ['spacing','cap','mixed'])
  results.append({'setting':cap,**checked})
 assert results[0]['cap']==results[0]['mixed']==0
 assert all(a['cap']<=z['cap'] and a['mixed']<=z['mixed'] for a,z in zip(results,results[1:]))
 page.eval_on_selector('#capPercent',"e=>{e.value=5;e.dispatchEvent(new Event('input'))}");page.click('#mixedView')
 assert page.locator('#mixedView').get_attribute('aria-pressed')=='true'
 assert page.locator('#mixedView').evaluate("e=>getComputedStyle(e).backgroundColor")=='rgb(220, 38, 38)'
 assert page.evaluate("Scenario.map.getFilter('scenario-proposed')[1][1][1]")=='mixed'
 page.wait_for_timeout(1000);page.screenshot(path='audits/scenario_mixed_preview.png')
 with page.expect_download() as event:page.click('#downloadScenarioCounts')
 rows=list(csv.DictReader(Path(event.value.path()).read_text(encoding='utf-8-sig').splitlines()));assert len(rows)==page.evaluate('Scenario.data.neighborhoods.features.length');assert 'mixed_total' in rows[0];assert all(float(r['cap_setting_percent'])==5 for r in rows)
 mobile=b.new_page(viewport={'width':390,'height':844});mobile.route('https://unpkg.com/maplibre-gl@3.6.0/dist/maplibre-gl.js',lambda route:route.fulfill(path='residential_neighborhood_impact/vendor/maplibre-gl.js',content_type='application/javascript'));mobile.goto('http://localhost:8765/worst_case.html',wait_until='domcontentloaded');mobile.wait_for_function("typeof Scenario!=='undefined'&&Scenario.rows.length>0",timeout=90000)
 assert all(mobile.locator('#result-'+n).is_visible() for n in ['spacing','cap','mixed']);mobile.screenshot(path='audits/scenario_models_mobile_preview.png')
 assert not errors,errors
 print(json.dumps({'models':results,'errors':errors,'download':'all three models at selected cap','mobile':'all results visible'}));b.close()
