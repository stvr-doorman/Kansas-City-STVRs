from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=False);page=b.new_page(viewport={'width':1500,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.route('https://unpkg.com/maplibre-gl@3.6.0/dist/maplibre-gl.js',lambda r:r.fulfill(path='residential_neighborhood_impact/vendor/maplibre-gl.js',content_type='application/javascript'));page.goto('http://localhost:8765/worst_case.html');page.wait_for_function("typeof Scenario!=='undefined'&&Scenario.rows.length>0",timeout=90000)
 assert page.locator('#spacingMeasurementTop').is_visible();assert not page.is_checked('#spacingMeasurementTop');page.check('#spacingMeasurementTop');assert page.is_checked('#spacingMeasurement');page.locator('#scenarioAdvanced summary').click();page.uncheck('#spacingMeasurement');assert not page.is_checked('#spacingMeasurementTop')
 for name in ['cap','mixed','spacing']:
  page.locator('#result-'+name).click(position={'x':2,'y':2});assert page.evaluate('Scenario.view')==name
 page.eval_on_selector('#topCap-mixed',"e=>{e.value=3;e.dispatchEvent(new Event('input'))}");assert page.evaluate('Scenario.view')=='mixed'
 page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(300);assert page.locator('#spacingMeasurementTop').is_visible();assert not errors,errors;print('Synchronized centroid checkboxes, full-card selection, slider selection, desktop/mobile: passed');b.close()
