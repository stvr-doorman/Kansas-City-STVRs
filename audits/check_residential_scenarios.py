"""Visible Edge validation of both hypothetical policy views and saved count formulas."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
s=json.loads((ROOT/'data/residential_scenarios/summary.json').read_text());areas=json.loads((ROOT/'data/residential_scenarios/neighborhoods.json').read_text())['features'];points=json.loads((ROOT/'data/residential_scenarios/points.json').read_text())['features']
assert sum(p['properties']['current'] for p in points)==s['current_plots']
assert sum(p['properties']['spacing'] for p in points)==s['spacing_additions']
assert sum(p['properties']['cap'] for p in points)==s['cap_additions']
for f in areas:
 p=f['properties'];assert p['spacing_total']==p['current_residential']+p['spacing_added'];assert p['cap_total']==p['current_residential']+p['cap_added']
 assert p['cap_added']==0 or p['cap_total']<=p['cap_limit']
 if p['residential']:
  assert abs(p['spacing_percent']-100*p['spacing_total']/p['residential'])<1e-9
  assert abs(p['cap_percent']-100*p['cap_total']/p['residential'])<1e-9
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=False);page=b.new_page(viewport={'width':1500,'height':1000});errors=[];bad=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('response',lambda r:bad.append((r.status,r.url)) if r.status>=400 and '/data/residential_scenarios/' in r.url else None)
 page.goto('http://localhost:8765/worst_case.html',wait_until='domcontentloaded')
 page.wait_for_function("typeof Scenario!=='undefined'&&Scenario.rows.length>0",timeout=90000)
 page.click('#toggleScenarioPanel')
 assert '2.33%' in page.locator('#scenarioSummary').inner_text()
 assert page.evaluate("Scenario.map.getFilter('scenario-proposed')")==['all',['==',['get','spacing'],True],['in',['get','neighborhood'],['literal',page.evaluate("Scenario.rows.map(r=>r.properties.area_id)")]]]
 page.check('#showRings');assert page.evaluate("Scenario.map.getSource('scenario-rings')._data.features.length")>0
 page.uncheck('#showRings')
 page.wait_for_timeout(1200);page.screenshot(path=str(ROOT/'audits/scenario_spacing_preview.png'))
 focus=page.locator('#scenarioAreas .scenario-area').count();page.check('#includeMixedAreas');assert page.locator('#scenarioAreas .scenario-area').count()>focus
 page.click('#capView');assert '4.94%' in page.locator('#scenarioSummary').inner_text();assert page.locator('#showRings').is_disabled()
 assert page.evaluate("Scenario.map.getFilter('scenario-proposed')")==['all',['==',['get','cap'],True],['in',['get','neighborhood'],['literal',page.evaluate("Scenario.rows.map(r=>r.properties.area_id)")]]]
 page.fill('#scenarioSearch','Longview');assert page.locator('#scenarioAreas .scenario-area').count()==1
 page.locator('#scenarioAreas .scenario-area').click();page.wait_for_timeout(1000)
 assert '31.62%' in page.locator('.maplibregl-popup').inner_text()
 assert '5% cap model' in page.locator('.maplibregl-popup').inner_text()
 page.screenshot(path=str(ROOT/'audits/scenario_cap_preview.png'))
 page.uncheck('#showAdditions');assert page.evaluate("Scenario.map.getLayoutProperty('scenario-proposed','visibility')")=='none'
 mobile=b.new_page(viewport={'width':390,'height':844});mobile.goto('http://localhost:8765/worst_case.html',wait_until='domcontentloaded');mobile.wait_for_function("typeof Scenario!=='undefined'&&Scenario.rows.length>0",timeout=90000);assert mobile.locator('#capView').is_visible()
 assert not errors,errors;assert not bad,bad
 print(json.dumps(dict(current_plots=s['current_plots'],spacing_additions=s['spacing_additions'],cap_additions=s['cap_additions'],focus_neighborhoods=focus,above_five_percent=sum((f['properties']['spacing_percent'] or 0)>5 for f in areas),browser_errors=errors,data_http_errors=bad)))
 b.close()
