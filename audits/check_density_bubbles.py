from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=False);page=b.new_page(viewport={'width':1500,'height':1000});errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://localhost:8765',wait_until='domcontentloaded')
 page.wait_for_function("typeof AreaStats!=='undefined'&&AreaStats.rows.length>0",timeout=90000)
 for s in ['#dismissFirstVisit','#denyCookies']:
  if page.locator(s).is_visible():page.locator(s).click()
 assert page.is_checked('#areaEnable-neighborhood')
 assert page.input_value('#areaColor-neighborhood')=='identity'
 assert page.evaluate("map.getPaintProperty('area-fill-neighborhood','fill-color')")==['get','color']
 assert page.evaluate("new Set(AreaStats.rowsByLayer.get('neighborhood').map(r=>r.properties.color)).size")>1
 assert page.input_value('#areaAlpha-neighborhood')=='28'
 assert page.locator('#areaCounts-neighborhood .area-count-row').first.is_visible()
 page.evaluate("map.stop();map.jumpTo({center:[-94.57,39.08],zoom:8.5})")
 page.wait_for_timeout(1800)
 low=page.evaluate("map.queryRenderedFeatures({layers:['area-bubbles-neighborhood']}).map(f=>f.properties.bubble)")
 assert low,low
 assert not page.evaluate("map.queryRenderedFeatures({layers:['listing-markers','area-labels-neighborhood']}).length")
 page.screenshot(path='audits/density_bubbles_preview.png')
 page.evaluate("map.stop();map.jumpTo({zoom:12.5})")
 page.wait_for_timeout(2500)
 print(page.evaluate("({zoom:map.getZoom(),max:map.getLayer('area-bubbles-neighborhood').maxzoom})"))
 assert not page.evaluate("map.queryRenderedFeatures({layers:['area-bubbles-neighborhood']}).length")
 assert page.evaluate("map.queryRenderedFeatures({layers:['area-labels-neighborhood']}).length")
 page.screenshot(path='audits/density_simple_preview.png')
 page.evaluate("map.stop();map.jumpTo({zoom:7})")
 page.wait_for_timeout(1500)
 assert page.evaluate("map.queryRenderedFeatures({layers:['density-overall-bubble']}).length")==1
 assert not page.evaluate("map.queryRenderedFeatures({layers:['area-bubbles-neighborhood']}).length")
 assert not errors,errors
 print({'bubbles':len(low),'examples':low[:8],'errors':errors})
 b.close()
