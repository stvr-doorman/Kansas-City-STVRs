"""Validate independent area controls in visible Edge against source records.

Serve the project on http://localhost:8765 before running. Requires Playwright.
"""
import csv
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
KEYS = ['neighborhood', 'zip', 'council', 'plan', 'tract', 'county']

def main():
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='msedge', headless=False)
        page = browser.new_page(viewport={'width':1500, 'height':1000})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto('http://localhost:8765', wait_until='domcontentloaded')
        page.wait_for_function("typeof AreaStats !== 'undefined' && AreaStats.rows.length>0", timeout=90000)
        for selector in ['#dismissFirstVisit', '#denyCookies']:
            if page.locator(selector).is_visible():
                page.locator(selector).click()
        for key in KEYS:
            page.check(f'#areaEnable-{key}')
        page.wait_for_timeout(400)
        # Independent expected totals from the live listing, permit and housing inventories.
        checks = page.evaluate('''() => {
          const output={}, data=AreaStats.data;
          const current=new Set(nashville.permits.filter(p=>p.status==='current').flatMap(p=>[p.parcel,...(p.parcels||[])]).map(v=>String(v||'').replace(/[^a-z\\d]/gi,'').toUpperCase()).filter(Boolean));
          for(const [key,rows] of AreaStats.rowsByLayer){
            const expected=new Map(data.layers[key].features.map(f=>[f.properties.area_id,{count:0,plots:0,homes:0,housing:0}]));
            for(const listing of nashville.visible){
              const total=expected.get(data.layers[key].assignments[String(listing.listing_id)]);
              if(total&&!listing.likely_hotel){total.count++;if(/^Entire\\b/i.test(listing.rental_type||''))total.homes++;}
            }
            for(const plot of AreaStats.gisData.permit_parcel_records){
              const total=expected.get(plot.areas[key]);
              if(total&&current.has(plot.parcel)&&plot.boundary_distance_m>=0)total.plots++;
            }
            for(const [id,gis] of Object.entries(AreaStats.gisData.totals['0'][key])){
              const total=expected.get(id);if(total)total.housing=gis.residential;
            }
            const retained=[...expected.entries()].filter(([id,e])=>e.count||e.plots);
            const bad=rows.filter(r=>{
              const e=expected.get(r.properties.area_id),v=r.properties;
              return v.count!==e.count||v.licensed_plots!==e.plots||v.homes!==e.homes||v.housing!==e.housing||(e.housing?Math.abs(v.percent-100*e.homes/e.housing)>1e-9:v.percent!==null);
            });
            output[key]={areas:rows.length,expected_areas:retained.length,bad:bad.length,airbnbs:rows.reduce((s,r)=>s+r.properties.count,0),licensed_plots:rows.reduce((s,r)=>s+r.properties.licensed_plots,0),permit_only_areas:rows.filter(r=>r.properties.count===0&&r.properties.licensed_plots>0).length,empty_shown:rows.some(r=>!r.properties.count&&!r.properties.licensed_plots)};
          }
          return output;
        }''')
        for key, check in checks.items():
            assert check['areas'] == check['expected_areas'], (key, check)
            assert check['bad'] == 0 and not check['empty_shown'], (key, check)
            assert page.locator(f'#areaCounts-{key} button').count() == check['areas']
            assert page.evaluate('(key)=>nashville.map.getLayoutProperty(`area-line-${key}`,"visibility")', key) == 'visible'
        results['source_reconciliation'] = checks
        page.select_option('#areaColor-neighborhood', 'percent')
        page.select_option('#areaColor-zip', 'plots')
        page.locator('#areaAlpha-zip').evaluate("e=>{e.value='7';e.dispatchEvent(new Event('input',{bubbles:true}));}")
        assert page.evaluate('nashville.map.getPaintProperty("area-fill-zip","fill-opacity")') == .07
        assert page.evaluate('nashville.map.getPaintProperty("area-fill-neighborhood","fill-opacity")') == .12
        assert page.evaluate('nashville.map.getPaintProperty("area-line-zip","line-width")') == 1.8
        assert page.evaluate('nashville.map.getPaintProperty("area-line-zip","line-color")') == '#000000'
        page.uncheck('#areaLabels-zip')
        assert page.evaluate('nashville.map.getLayoutProperty("area-labels-zip","visibility")') == 'none'
        assert page.evaluate('nashville.map.getLayoutProperty("area-labels-neighborhood","visibility")') == 'visible'
        page.uncheck('#areaEnable-zip')
        assert page.evaluate('nashville.map.getLayoutProperty("area-line-zip","visibility")') == 'none'
        assert page.evaluate('nashville.map.getLayoutProperty("area-line-neighborhood","visibility")') == 'visible'
        # Listing search excludes all Airbnbs while keeping current permit-only areas.
        before = page.evaluate('AreaStats.rowsByLayer.get("neighborhood").reduce((s,r)=>s+r.properties.licensed_plots,0)')
        page.fill('#search', '__no_matching_airbnb__')
        page.wait_for_timeout(500)
        assert page.evaluate('nashville.visible.length') == 0
        assert page.evaluate('AreaStats.rowsByLayer.get("neighborhood").every(r=>r.properties.count===0&&r.properties.licensed_plots>0)')
        assert page.evaluate('AreaStats.rowsByLayer.get("neighborhood").reduce((s,r)=>s+r.properties.licensed_plots,0)') == before
        page.fill('#search', '')
        page.wait_for_timeout(400)
        page.uncheck('#scopeOnly')
        page.wait_for_timeout(300)
        assert page.evaluate('AreaStats.rows.every(r=>r.properties.percent===null)')
        page.check('#scopeOnly')
        page.locator('#edgeBuffer').evaluate("e=>{e.value='550';e.dispatchEvent(new Event('change',{bubbles:true}));}")
        page.wait_for_timeout(300)
        assert page.evaluate('''() => AreaStats.rowsByLayer.get('county').every(r=>r.properties.housing===(AreaStats.gisData.totals['550'].county[r.properties.area_id]?.residential||0))''')
        page.locator('#edgeBuffer').evaluate("e=>{e.value='0';e.dispatchEvent(new Event('change',{bubbles:true}));}")
        page.wait_for_timeout(300)
        with page.expect_download() as pending:
            page.click('#downloadAreaCounts-neighborhood')
        download_path = ROOT / 'audits/area_counts_validation.csv'
        pending.value.save_as(download_path)
        records = list(csv.DictReader(download_path.open(encoding='utf-8-sig', newline='')))
        assert records and 'Licensed plots (unique parcels with current permit)' in records[0]
        assert all(int(r['Airbnb listings']) or int(r['Licensed plots (unique parcels with current permit)']) for r in records)
        assert any(r['Entire-place listings per residential GIS plot (%)'] for r in records)
        # Clear restores the independent defaults: neighborhoods only.
        page.click('#clearExploreFilters')
        page.wait_for_timeout(300)
        assert page.is_checked('#areaEnable-neighborhood')
        assert all(not page.is_checked(f'#areaEnable-{key}') for key in KEYS[1:])
        page.check('#areaEnable-zip')
        page.locator('#areaStats').scroll_into_view_if_needed()
        page.screenshot(path=str(ROOT / 'audits/area_stats_preview.png'))
        page.set_viewport_size({'width':390,'height':844})
        page.wait_for_timeout(300)
        if page.locator('#toggleFilters').get_attribute('aria-expanded') == 'false':
            page.click('#toggleFilters')
        page.locator('#areaEnable-zip').scroll_into_view_if_needed()
        assert page.locator('#areaEnable-zip').is_visible()
        page.screenshot(path=str(ROOT / 'audits/area_stats_mobile_preview.png'))
        results['checks']=['independent activation, opacity and labels','unique current licensed plot totals','empty-area suppression and permit-only retention','actual residential GIS parcel denominators and listing/plot ratios','listing filters do not change plot counts','scope disabled percentages unavailable','edge buffer housing scope','CSV counts and percentages','reset defaults','mobile controls']
        results['page_errors']=errors
        assert not errors, errors
        (ROOT / 'audits/area_stats_validation.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
        print(json.dumps(results,indent=2))
        browser.close()

if __name__ == '__main__':
    main()
