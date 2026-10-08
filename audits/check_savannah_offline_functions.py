"""Exercise the offline viewer while blocking every external request."""
from pathlib import Path
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 browser=p.chromium.launch(channel='msedge',headless=False);page=browser.new_page(viewport={'width':1440,'height':1000});errors=[];remote=[];maperrors=[]
 page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda m:maperrors.append(m.text) if m.type=='error' else None)
 def offline_route(route):
  if route.request.url.startswith(('http://localhost:8765/','blob:','data:')):route.continue_()
  else:remote.append(route.request.url);route.abort()
 page.route('**/*',offline_route);page.goto('http://localhost:8765/savannah_str_offline/index.html');page.wait_for_function("typeof OfflineViewer!=='undefined'&&OfflineViewer.ready",polling=500,timeout=60000);page.wait_for_timeout(1000)
 assert page.evaluate('OfflineViewer.layers.reduce((n,l)=>n+l.features.length,0)')==62034
 page.check('[data-visible="3"]');assert page.evaluate("OfflineViewer.map.getLayoutProperty('fill-3','visibility')")=='visible';page.uncheck('[data-visible="3"]')
 page.click('[data-panel="filter"]');page.select_option('#filterField','License_Status');page.select_option('#filterOp','equals');page.fill('#filterValue','Licensed STR');page.click('#applyFilter');licensed=page.evaluate('OfflineViewer.filterFeatures(OfflineViewer.layers[0]).length');assert 0<licensed<462
 page.click('#clearFilter');assert page.evaluate('OfflineViewer.filterFeatures(OfflineViewer.layers[0]).length')==462
 for box in page.locator('#statusChecks input').all():box.uncheck()
 assert page.evaluate('OfflineViewer.filterFeatures(OfflineViewer.layers[0]).length')==0;page.click('#clearFilter')
 page.click('[data-panel="search"]');address=page.evaluate("OfflineViewer.layers[0].features[0].properties.PropAddress_Full");page.fill('#searchInput',address);assert page.locator('#searchResults button').count()>0;page.locator('#searchResults button').first.click();assert page.locator('.maplibregl-popup-content').is_visible();assert address in page.locator('.maplibregl-popup-content').inner_text();page.locator('.maplibregl-popup-close-button').click()
 page.evaluate('OfflineViewer.openTable(8)');assert '22,899' in page.locator('#tableCount').inner_text();page.select_option('#tableLayer','0');assert '462 matching' in page.locator('#tableCount').inner_text();page.click('#nextPage');assert 'Page 2' in page.locator('#pageNumber').inner_text();page.click('#previousPage');page.fill('#tableSearch',address);assert '1 matching' in page.locator('#tableCount').inner_text()
 with page.expect_download() as result:page.click('#tableExport')
 csv=result.value;csv.save_as('audits/offline_table_test.csv');assert address in Path('audits/offline_table_test.csv').read_text(encoding='utf-8-sig');page.click('#closeTable')
 page.click('[data-panel="measure"]');page.click('#distanceMode');page.evaluate("void OfflineViewer.map.fire('click',{lngLat:new maplibregl.LngLat(-81.1,32.0)})");page.evaluate("void OfflineViewer.map.fire('click',{lngLat:new maplibregl.LngLat(-81.1,32.001)})");assert '364' in page.locator('#measureResult').inner_text();page.click('#stopMeasure');page.click('#clearMeasure')
 page.click('[data-panel="bookmarks"]');page.fill('#bookmarkName','Offline test view');page.click('#addBookmark');assert page.locator('[data-bookmark]').count()>0;page.locator('[data-delete]').last.click()
 page.click('[data-panel="charts"]');assert page.locator('.stat-bar').count()==3
 page.click('[data-panel="export"]');page.select_option('#exportLayer','0')
 with page.expect_download() as result:page.click('#exportGeo')
 result.value.save_as('audits/offline_export_test.geojson')
 with page.expect_download() as result:page.click('#exportImage')
 result.value.save_as('audits/offline_export_test.png');assert Path('audits/offline_export_test.png').stat().st_size>10000
 page.click('[data-panel="layers"]');page.click('#homeMap');page.wait_for_function("!OfflineViewer.map.isMoving()&&OfflineViewer.map.isSourceLoaded('layer-0')&&OfflineViewer.map.queryRenderedFeatures({layers:['points-0','triangles-0']}).length>=400",polling=500,timeout=45000);print('POINT DEBUG',page.evaluate("({source:OfflineViewer.map.getSource('layer-0')._data.features.length,visible:OfflineViewer.map.getLayoutProperty('points-0','visibility'),opacity:OfflineViewer.map.getPaintProperty('points-0','circle-opacity'),rendered:OfflineViewer.map.queryRenderedFeatures({layers:['points-0','triangles-0']}).length,loaded:OfflineViewer.map.isSourceLoaded('layer-0')})"),flush=True);page.screenshot(path='savannah_str_offline/screenshots/offline_viewer.png')
 page.set_viewport_size({'width':390,'height':844});page.click('#closeLeft');page.wait_for_timeout(500);page.screenshot(path='savannah_str_offline/screenshots/offline_mobile.png')
 assert not errors,errors;assert not remote,remote;assert not maperrors,maperrors
 print({'records':62034,'licensed_filter':licensed,'layers_popups_tables_search':'passed','filters_and_zero_match':'passed','measurement_bookmarks_charts':'passed','csv_geojson_png_exports':'passed','desktop_mobile':'passed','external_requests':remote,'javascript_errors':errors,'console_errors':maperrors});browser.close()
