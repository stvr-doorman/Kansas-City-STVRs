from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=False);page=b.new_page(viewport={'width':1500,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.route('https://unpkg.com/maplibre-gl@3.6.0/dist/maplibre-gl.js',lambda r:r.fulfill(path='residential_neighborhood_impact/vendor/maplibre-gl.js',content_type='application/javascript'))
 page.goto('http://localhost:8765/worst_case.html',wait_until='domcontentloaded');page.wait_for_function("typeof Scenario!=='undefined'&&Scenario.rows.length>0",timeout=90000)
 page.click('#toggleScenarioPanel')
 assert not page.is_checked('#includeMixedAreasTop')
 assert page.locator('#scenarioPanel').evaluate("e=>e.getBoundingClientRect().top>=document.getElementById('modelResults').getBoundingClientRect().bottom")
 for model in ['cap','mixed','spacing']:
  page.click('#selectResult-'+model);assert page.evaluate('Scenario.view')==model
  assert page.locator('#selectResult-'+model).get_attribute('aria-pressed')=='true'
  assert page.locator('#selectResult-'+model).evaluate('e=>getComputedStyle(e).backgroundColor')=='rgb(220, 38, 38)'
  assert page.evaluate("Scenario.map.getLayoutProperty('scenario-city-outline','visibility')||'visible'")=='visible'
 page.eval_on_selector('#topCap-cap',"e=>{e.value=2;e.dispatchEvent(new Event('input'))}");assert page.input_value('#topCap-mixed')==page.input_value('#capPercent')=='2'
 page.eval_on_selector('#topCap-mixed',"e=>{e.value=5;e.dispatchEvent(new Event('input'))}");assert page.input_value('#topCap-cap')==page.input_value('#capPercent')=='5'
 small=page.evaluate('Scenario.rows.length');page.check('#includeMixedAreasTop');assert page.is_checked('#includeMixedAreas');assert page.evaluate('Scenario.rows.length')>small
 page.uncheck('#includeMixedAreas');assert not page.is_checked('#includeMixedAreasTop')
 assert page.locator('#scenarioPanel').evaluate("e=>e.getBoundingClientRect().top>=document.getElementById('modelResults').getBoundingClientRect().bottom")
 page.click('#fitScenarioCity');page.wait_for_timeout(1400)
 assert page.evaluate("Scenario.map.queryRenderedFeatures({layers:['scenario-city-outline']}).length")>0
 page.screenshot(path='audits/scenario_top_controls_preview.png')
 mobile=b.new_page(viewport={'width':390,'height':844});mobile.on('pageerror',lambda e:errors.append(str(e)));mobile.route('https://unpkg.com/maplibre-gl@3.6.0/dist/maplibre-gl.js',lambda r:r.fulfill(path='residential_neighborhood_impact/vendor/maplibre-gl.js',content_type='application/javascript'));mobile.goto('http://localhost:8765/worst_case.html',wait_until='domcontentloaded');mobile.wait_for_function("typeof Scenario!=='undefined'&&Scenario.rows.length>0",timeout=90000)
 assert mobile.locator('#topCap-mixed').is_visible();mobile.click('#selectResult-mixed');assert mobile.evaluate('Scenario.view')=='mixed';mobile.click('#fitScenarioCity');mobile.wait_for_timeout(1200);mobile.screenshot(path='audits/scenario_top_controls_mobile.png')
 assert not errors,errors;print({'top_card_buttons':'passed','shared_sliders':'passed','mixed_area_toggle':'passed','permanent_city_outline':'passed','desktop_mobile':'passed','errors':errors});b.close()
