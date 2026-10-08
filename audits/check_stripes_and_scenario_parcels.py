from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=False);page=b.new_page(viewport={'width':1500,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.route('https://unpkg.com/maplibre-gl@3.6.0/dist/maplibre-gl.js',lambda route:route.fulfill(path='residential_neighborhood_impact/vendor/maplibre-gl.js',content_type='application/javascript'))
 page.goto('http://localhost:8765',wait_until='domcontentloaded');page.wait_for_function("typeof AreaStats!=='undefined'&&AreaStats.rows.length>0",timeout=90000)
 for s in ['#dismissFirstVisit','#denyCookies']:
  if page.locator(s).is_visible():page.locator(s).click()
 assert page.is_checked('#showUnreliableAreas')
 allrows=page.evaluate("AreaStats.rowsByLayer.get('neighborhood').map(r=>r.properties)");flagged=[r for r in allrows if r['unreliable']];assert flagged
 assert all(r['unreliable_reason'] for r in flagged)
 assert page.evaluate("map.getImage('unreliable-area-stripes')!==undefined")
 assert page.evaluate("map.getLayer('area-stripes-neighborhood').filter")==['==',['get','unreliable'],True]
 page.uncheck('#showUnreliableAreas');clean=page.evaluate("AreaStats.rowsByLayer.get('neighborhood').map(r=>r.properties)");assert len(clean)==len(allrows)-len(flagged);assert not any(r['unreliable'] for r in clean)
 page.check('#showUnreliableAreas');assert page.evaluate("AreaStats.rowsByLayer.get('neighborhood').length")==len(allrows)
 page.screenshot(path='audits/density_stripes_preview.png')
 page.goto('http://localhost:8765/worst_case.html',wait_until='domcontentloaded');page.wait_for_function("typeof Scenario!=='undefined'&&Scenario.rows.length>0",timeout=90000)
 page.click('#toggleScenarioPanel')
 assert not page.is_checked('#showDots')
 assert page.evaluate("Scenario.map.getLayoutProperty('scenario-current','visibility')")=='none'
 assert page.evaluate("Scenario.map.getLayoutProperty('scenario-proposed','visibility')")=='none'
 assert page.evaluate("Scenario.map.getLayer('scenario-plot-line').minzoom||0")==0
 assert page.evaluate("Scenario.map.getPaintProperty('scenario-plot-fill','fill-opacity')")>=.7
 small=page.evaluate('Scenario.rows.length');page.check('#includeMixedAreas');assert page.evaluate('Scenario.rows.length')>small
 assert page.evaluate("Scenario.rows.length===Scenario.data.neighborhoods.features.length")
 page.check('#showDots');assert page.evaluate("Scenario.map.getLayoutProperty('scenario-current','visibility')")=='visible'
 page.uncheck('#showDots');page.wait_for_timeout(1000);page.screenshot(path='audits/scenario_parcels_preview.png')
 assert not errors,errors
 print({'all_neighborhoods':len(allrows),'striped_neighborhoods':len(flagged),'reliable_neighborhoods':len(clean),'optional_dots':'passed','all_simulated_sections':'passed','browser_errors':errors})
 b.close()
