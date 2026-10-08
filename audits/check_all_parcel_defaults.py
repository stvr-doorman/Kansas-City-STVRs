from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=False);page=b.new_page(viewport={'width':1400,'height':950});errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.route('https://unpkg.com/maplibre-gl@3.6.0/dist/maplibre-gl.js',lambda r:r.fulfill(path='residential_neighborhood_impact/vendor/maplibre-gl.js',content_type='application/javascript'))
 for url,expr in [('worst_case.html','Scenario.map'),('index.html','map')]:
  page.goto('http://localhost:8765/'+url);page.wait_for_function(f"typeof ParcelOutlines!=='undefined'&&typeof {expr.split('.')[0]}!=='undefined'&&{expr}?.getSource('all-parcel-overview')",timeout=120000)
  page.wait_for_function(f"{expr}.getSource('all-parcel-overview')._data.features?.length>200000",timeout=120000);assert page.is_checked('#parcelOutlines');assert page.evaluate(f"{expr}.getLayer('nonresidential-overview-hatch').type")=='fill';assert page.evaluate(f"{expr}.getSource('all-parcel-overview')._data.features.some(f=>f.properties.nonresidential===true)");page.wait_for_timeout(2000)
  print(url,page.evaluate(f"{expr}.getSource('all-parcel-overview')._data.features.length"))
 assert not errors,errors;b.close()
