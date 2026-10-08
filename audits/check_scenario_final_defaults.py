from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=False);page=b.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.route('https://unpkg.com/maplibre-gl@3.6.0/dist/maplibre-gl.js',lambda r:r.fulfill(path='residential_neighborhood_impact/vendor/maplibre-gl.js',content_type='application/javascript'));page.goto('http://localhost:8765/worst_case.html');page.wait_for_function("typeof Scenario!=='undefined'&&Scenario.rows.length>0",timeout=120000)
 for id in ['includeMixedAreasTop','includeMixedAreas']:assert page.is_checked('#'+id)
 for id in ['spacingMeasurementTop','spacingMeasurement']:assert not page.is_checked('#'+id)
 assert page.locator('#measurementValue').text_content()=='Border-to-border';assert page.evaluate('Scenario.rows.length===Scenario.data.neighborhoods.features.length');assert not errors,errors;print('Property borders and mixed areas defaults synchronized and applied: passed');b.close()

