from pathlib import Path
import json
from playwright.sync_api import sync_playwright
r=Path('data/residential_scenarios');out=json.loads((r/'scenario_outcomes.json').read_text());summary=json.loads((r/'summary.json').read_text());areas=json.loads((r/'neighborhoods.json').read_text())['features'];byid={f['properties']['area_id']:f['properties'] for f in areas};ids=out['neighborhood_ids'];current=summary['current_residential_plots'];denom=summary['residential']
for feet,mixedcases in out['mixed'].items():
 for cap,m in mixedcases.items():
  c=out['caps'][cap];s=out['spacing'][feet]
  assert m['city_total']==current+sum(m['added']);assert abs(m['city_percent']-100*m['city_total']/denom)<1e-9
  for i,id in enumerate(ids):
   p=byid[id];room=max(0,c['limit'][i]-p['current_residential']);assert m['added'][i]<=s['added'][i] and m['added'][i]<=room
   assert m['total'][i]==p['current_residential']+m['added'][i]
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=False);page=b.new_page(viewport={'width':1500,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.route('https://unpkg.com/maplibre-gl@3.6.0/dist/maplibre-gl.js',lambda t:t.fulfill(path='residential_neighborhood_impact/vendor/maplibre-gl.js',content_type='application/javascript'))
 page.goto('http://localhost:8765/worst_case.html',wait_until='domcontentloaded');page.wait_for_function("typeof Scenario!=='undefined'&&Scenario.rows.length>0",timeout=90000)
 page.click('#toggleScenarioPanel')
 page.wait_for_timeout(500);assert page.locator('.maplibregl-ctrl-scale').is_visible();assert any(u in page.locator('.maplibregl-ctrl-scale').inner_text() for u in ['ft','mi'])
 assert page.locator('#modelResults').evaluate('e=>e.getBoundingClientRect().height')<165
 baseline=page.evaluate('Scenario.data.summary.cap_additions');results=[]
 for feet in [400,1000,1600]:
  page.eval_on_selector('#distanceFeet',f"e=>{{e.value={feet};e.dispatchEvent(new Event('input'))}}")
  page.wait_for_timeout(350)
  s=page.evaluate('Scenario.data.summary');expected=out['spacing'][str(feet)];assert s['spacing_additions']==expected['city_total']-current;assert s['cap_additions']==baseline
  assert page.evaluate("Scenario.map.getPaintProperty('scenario-neighborhood-fill','fill-color').slice(-1)[0]")=='#7f1d1d'
  results.append((feet,s['spacing_additions'],s['spacing_percent']))
 page.click('#toggleScenarioPanel');assert not page.locator('#scenarioPanelBody').is_visible();assert page.locator('#toggleScenarioPanel').inner_text()=='Show';page.click('#toggleScenarioPanel');assert page.locator('#scenarioPanelBody').is_visible()
 assert page.locator('#scenarioPanel').evaluate("e=>e.getBoundingClientRect().top>document.getElementById('modelResults').getBoundingClientRect().bottom")
 page.screenshot(path='audits/scenario_compact_scale_preview.png')
 page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(400)
 assert page.locator('#scenarioPanel').evaluate("e=>e.getBoundingClientRect().top>document.getElementById('modelResults').getBoundingClientRect().bottom")
 page.click('#toggleScenarioPanel');assert not page.locator('#scenarioPanelBody').is_visible();page.screenshot(path='audits/scenario_compact_scale_mobile.png')
 assert not errors,errors
 print({'precomputed_combinations':273,'distances':results,'scale':'feet/miles visible','panel_collapse':'passed','overlap':'none','errors':errors});b.close()
