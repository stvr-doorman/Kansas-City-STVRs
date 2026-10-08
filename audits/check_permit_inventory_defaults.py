"""Check actual browser defaults and switching against the two permit inventories."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
BASE='http://127.0.0.1:8766'
saved=json.loads((ROOT/'data/permits.json').read_text(encoding='utf-8'))
confirmed=json.loads((ROOT/'data/confirmed_permits/permits.json').read_text(encoding='utf-8'))
assert len({p['id'] for p in confirmed})==len(confirmed)
assert all(p['portal_confirmed'] and p['status']=='current' and '-STRMAJ-' not in p['permit_number'] and 'event' not in p['type'].lower() for p in confirmed)
for root in ['residential_scenarios','residential_scenarios_confirmed']:
    report=json.loads((ROOT/'data'/root/'spacing_measurement_validation.json').read_text(encoding='utf-8'))
    for patterns in report['patterns'].values():
        for feet, record in patterns.items():
            assert record['minimum_new_to_new_ft']>=int(feet)
            assert record['minimum_new_to_existing_ft']>=int(feet)

with sync_playwright() as p:
    browser=p.chromium.launch(channel='msedge',headless=False)
    page=browser.new_page(viewport={'width':1500,'height':1000})
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    def ready_map():
        page.wait_for_function("typeof map!=='undefined'&&map&&map.loaded()",timeout=90000)
        for selector in ['#dismissFirstVisit','#denyCookies']:
            if page.locator(selector).is_visible():page.locator(selector).click()
        if page.locator('#filters').evaluate("e=>e.classList.contains('collapsed')"):
            page.locator('#toggleFilters').click()
        page.locator('#includeOtherSavedPermits').evaluate("e=>{for(let p=e.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;}")
    def ready_scenario():
        page.wait_for_function("typeof Scenario!=='undefined'&&Scenario.rows.length>0&&Scenario.map.getSource('scenario-plots')",timeout=90000)
    page.goto(BASE+'/index.html',wait_until='domcontentloaded');ready_map()
    assert page.is_checked('#includeOtherSavedPermits')
    assert page.evaluate('permits.length')==len(saved)
    assert page.evaluate("permits.filter(p=>p.status==='current').length")==733
    print('Main map defaults: all saved permits included',flush=True)
    with page.expect_navigation(wait_until='domcontentloaded'):page.uncheck('#includeOtherSavedPermits')
    ready_map()
    assert page.evaluate('permits.length')==len(confirmed)
    assert page.evaluate('permits.every(p=>p.portal_confirmed)')
    assert page.evaluate("permitParcels.features.every(f=>f.properties.permit_status==='current')")
    assert page.locator('#downloadPermits').get_attribute('href')=='data/confirmed_permits/permits.csv'
    print('Main map checkbox: confirmed permits, geometry and CSV selected',flush=True)
    page.goto(BASE+'/worst_case.html',wait_until='domcontentloaded');ready_scenario()
    assert not page.is_checked('#includeOtherSavedPermits')
    assert page.evaluate('PermitInventory.scenarioPath')=='data/residential_scenarios_confirmed'
    expected=json.loads((ROOT/'data/residential_scenarios_confirmed/summary.json').read_text())
    assert page.evaluate('Scenario.data.summary.nonresident_anchors')==expected['nonresident_anchors']
    strict_ids={v for permit in confirmed for v in permit['parcels']}
    ids=page.evaluate('Scenario.data.points.features.filter(f=>f.properties.current).map(f=>f.properties.parcel)')
    assert set(ids)<=strict_ids
    page.locator('#scenarioAdvanced').evaluate('(e)=>e.open=true')
    page.uncheck('#spacingMeasurement');page.wait_for_function("document.getElementById('measurementValue').textContent==='Border-to-border'")
    assert page.evaluate('Scenario.data.models.border_all.patterns.patterns["1000"].length')>0
    print('Worst-case default: confirmed parcels only; centroid and border models load',flush=True)
    with page.expect_navigation(wait_until='domcontentloaded'):page.check('#includeOtherSavedPermits')
    ready_scenario()
    assert page.evaluate('PermitInventory.scenarioPath')=='data/residential_scenarios'
    original=json.loads((ROOT/'data/residential_scenarios/summary.json').read_text())
    assert page.evaluate('Scenario.data.summary.nonresident_anchors')==original['nonresident_anchors']
    print('Worst-case checkbox: original saved scenario inventory restored',flush=True)
    page.goto(BASE+'/records.html',wait_until='domcontentloaded')
    page.wait_for_function("document.getElementById('count').textContent.includes('records')")
    page.select_option('#kind','permits')
    assert page.locator('#count').inner_text().startswith(f'{len(saved):,} records')
    with page.expect_navigation(wait_until='domcontentloaded'):page.uncheck('#includeOtherSavedPermits')
    page.wait_for_function("typeof datasets!=='undefined'&&datasets.permits&&datasets.propertyLocations")
    page.select_option('#kind','permits')
    assert page.locator('#count').inner_text().startswith(f'{len(confirmed):,} records')
    print('Inventory page: both default and confirmed counts verified',flush=True)
    assert not errors,errors
    page.goto(BASE+'/worst_case.html',wait_until='domcontentloaded');ready_scenario()
    page.screenshot(path=str(ROOT/'audits/confirmed_permit_scenario_preview.png'))
    print('All browser checks passed; no page errors',flush=True)
    browser.close()
