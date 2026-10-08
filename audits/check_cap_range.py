from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=False);page=b.new_page(viewport={'width':1500,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.route('https://unpkg.com/maplibre-gl@3.6.0/dist/maplibre-gl.js',lambda r:r.fulfill(path='residential_neighborhood_impact/vendor/maplibre-gl.js',content_type='application/javascript'));page.goto('http://localhost:8765/worst_case.html');page.wait_for_function("typeof Scenario!=='undefined'&&Scenario.rows.length>0",timeout=120000)
 for id in ['topCap-cap','topCap-mixed','capPercent']:
  assert page.get_attribute('#'+id,'min')=='0.5';assert page.get_attribute('#'+id,'max')=='20';assert page.input_value('#'+id)=='5'
 results=[]
 for value in [.5,10,20]:
  page.eval_on_selector('#topCap-cap',f"e=>{{e.value={value};e.dispatchEvent(new Event('input'))}}");page.wait_for_timeout(400)
  assert page.evaluate("Scenario.data.neighborhoods.features.every(f=>f.properties.cap_added===0||f.properties.cap_total<=f.properties.cap_limit)")
  assert page.evaluate("Scenario.data.summary.cap_additions===Scenario.data.points.features.filter(f=>!f.properties.current&&f.properties.cap).length")
  results.append((value,page.locator('#capPercentResult').inner_text()))
 assert not errors,errors;print({'range_and_default':'passed','allocations_and_neighborhood_caps':'passed','results':results});b.close()
