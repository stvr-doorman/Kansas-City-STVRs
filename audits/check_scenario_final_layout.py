import json
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path('data/residential_scenarios');v=json.loads((root/'spacing_measurement_validation.json').read_text());checks=0
for mode,patterns in v['patterns'].items():
 for feet,p in patterns.items():
  assert p['minimum_new_to_new_ft']>=int(feet) and p['minimum_new_to_existing_ft']>=int(feet);checks+=1
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=False);page=b.new_page(viewport={'width':1500,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.route('https://unpkg.com/maplibre-gl@3.6.0/dist/maplibre-gl.js',lambda r:r.fulfill(path='residential_neighborhood_impact/vendor/maplibre-gl.js',content_type='application/javascript'))
 page.goto('http://localhost:8765/worst_case.html');page.wait_for_function("typeof Scenario!=='undefined'&&Scenario.rows.length>0",timeout=90000);page.wait_for_timeout(1600)
 assert page.locator('#modelResults > article').evaluate_all("es=>es.map(e=>e.id)")==['result-spacing','result-mixed','result-cap']
 assert not page.locator('#scenarioPanelBody').is_visible()
 for slider,value,model in [('topCap-cap',4,'cap'),('mixedDistanceFeet',800,'mixed'),('distanceFeet',1200,'spacing'),('topCap-mixed',3,'mixed')]:
  page.eval_on_selector('#'+slider,f"e=>{{e.value={value};e.dispatchEvent(new Event('input'))}}");page.wait_for_timeout(250);assert page.evaluate('Scenario.view')==model
 assert page.locator('#mixedDistanceFeet').bounding_box()['y']<page.locator('#topCap-mixed').bounding_box()['y']
 for mode in [0,1]:
  page.eval_on_selector('#spacingMeasurement',f"e=>{{e.value={mode};e.dispatchEvent(new Event('input'))}}");page.wait_for_timeout(250)
  for all_block in [False,True]:
   page.locator('#blockAllLicensed').set_checked(all_block);page.wait_for_timeout(250)
   key=('border' if mode else 'centroid')+('_all' if all_block else '_nonresident')
   assert page.evaluate('Scenario.data.summary.spacing_additions')==len(json.loads((root/f'spacing_patterns_{key}.json').read_text())['patterns']['1200'])
 page.click('#fitScenarioCity');page.wait_for_timeout(1600)
 assert page.evaluate("(()=>{const b=Scenario.map.getBounds();function check(c){return typeof c[0]==='number'?b.contains(c):c.every(check)}return Scenario.data.city_boundary.features.every(f=>check(f.geometry.coordinates))})()")
 print({'slider_selection':'passed','order_and_stacking':'passed','city_extents':'passed','spacing_patterns_validated':checks,'top_height':page.locator('#modelResults').bounding_box()['height'],'errors':errors});assert not errors
 b.close()
