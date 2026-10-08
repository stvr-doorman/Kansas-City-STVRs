"""Visible Edge checks for full-GIS denominator and original-parcel search.

Serve the project on port 8765 before running. Requires Playwright.
"""
import gzip
import json
from collections import Counter
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

def main():
    report = json.loads((ROOT / 'data/gis_parcels/area_counts.json').read_text(encoding='utf-8'))
    with gzip.open(ROOT / 'data/gis_parcels/search_index.json.gz', 'rt', encoding='utf-8') as source:
        index = json.load(source)
    assert len(index['records']) == report['searchable_parcels']
    assert len({row[0] for row in index['records']}) == len(index['records'])
    expected = {key:Counter() for key in report['totals']['0']}
    for row in index['records']:
        if row[13] < 0 or row[4] not in report['residential_codes']:
            continue
        for key, area_id in row[12].items():
            expected[key][area_id] += 1
    for key, areas in report['totals']['0'].items():
        for area_id, counts in areas.items():
            assert counts['residential'] == expected[key][area_id], (key,area_id)
            assert counts['plots'] == counts['residential'] + counts['other'] + counts['unknown']
    sample = next(row for row in index['records'] if row[2] and row[1] and row[3] and row[4] == 1111 and row[13] >= 0)
    with gzip.open(ROOT / f'data/gis_parcels/raw/{sample[6]:04d}.geojson.gz', 'rt', encoding='utf-8') as source:
        raw = json.load(source)
    feature = next(f for f in raw['features'] if f['properties']['OBJECTID'] == sample[7])
    assert feature['properties']['KIVAPIN'] == sample[0]
    assert feature['properties']['ADDRESS'] == sample[2]
    result = dict(source_records=report['source_record_count'],unique_parcels=report['unique_parcels'],searchable_parcels=report['searchable_parcels'],missing_geometry=report['missing_geometry_parcels'],sample_parcel=sample[0],sample_address=sample[2])
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='msedge',headless=False)
        page = browser.new_page(viewport={'width':1500,'height':1000})
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto('http://localhost:8765',wait_until='domcontentloaded')
        page.wait_for_function("typeof AreaStats!=='undefined' && AreaStats.gisData && AreaStats.rows.length>0",timeout=90000)
        for selector in ['#dismissFirstVisit','#denyCookies']:
            if page.locator(selector).is_visible():page.locator(selector).click()
        live = page.evaluate("AreaStats.rows.map(r=>({id:r.properties.area_id,residential:r.properties.housing,all:r.properties.total_plots,homes:r.properties.homes,percent:r.properties.percent}))")
        for row in live:
            counts=report['totals']['0']['neighborhood'].get(row['id'],{'residential':0,'plots':0})
            assert row['residential']==counts['residential'] and row['all']==counts['plots']
            assert row['percent'] is None if not row['residential'] else abs(row['percent']-100*row['homes']/row['residential'])<1e-9
        page.fill('#search','__no_matching_airbnb__')
        page.wait_for_timeout(400)
        assert page.evaluate('nashville.visible.length')==0
        # Full parcel search must still find residential parcels with zero visible Airbnbs.
        page.fill('#parcelSearchQuery',sample[2].lower())
        page.wait_for_selector('.gis-parcel-result',timeout=90000)
        assert sample[2] in page.locator('.gis-parcel-result').first.inner_text()
        page.locator('.gis-parcel-result').first.click()
        page.wait_for_function('(id)=>ParcelSearch.selected?.[0]===id',arg=sample[0],timeout=30000)
        geometry=page.evaluate('nashville.map.getSource("gis-selected-parcel")._data.features[0].geometry')
        assert geometry==feature['geometry']
        assert sample[0] in page.locator('.maplibregl-popup').inner_text()
        assert page.locator('.maplibregl-popup a[href*="parcelviewer"]').count()==1
        page.wait_for_timeout(600)
        box=page.locator('.maplibregl-popup-content').bounding_box()
        footer=page.locator('#statusbar').bounding_box()
        assert box['y']>=64 and box['y']+box['height']<=footer['y']+1,(box,footer)
        page.screenshot(path=str(ROOT / 'audits/gis_parcel_selection_preview.png'))
        for query in [sample[0],sample[1]]:
            page.fill('#parcelSearchQuery',query)
            page.wait_for_selector('.gis-parcel-result',timeout=30000)
            page.wait_for_function('(id)=>document.querySelector("#parcelSearchResults button")?.textContent.includes("Parcel "+id)',arg=sample[0],timeout=30000)
        page.fill('#parcelSearchQuery',sample[3])
        page.wait_for_selector('.gis-parcel-result',timeout=30000)
        assert page.locator('.gis-parcel-result').count()>0
        page.fill('#parcelSearchQuery','__no_such_city_parcel_9xz__')
        page.wait_for_function('document.querySelector("#parcelSearchResults").textContent.includes("No matching")')
        page.click('#clearParcelSelection')
        assert page.evaluate('nashville.map.getSource("gis-selected-parcel")._data.features.length')==0
        page.fill('#search','');page.wait_for_timeout(400)
        page.fill('#parcelSearchQuery',sample[2]);page.wait_for_selector('.gis-parcel-result')
        page.locator('#gisParcelSearch').scroll_into_view_if_needed()
        page.screenshot(path=str(ROOT / 'audits/gis_parcel_search_preview.png'))
        page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(300)
        if page.locator('#toggleFilters').get_attribute('aria-expanded')=='false':page.click('#toggleFilters')
        page.locator('#gisParcelSearch').scroll_into_view_if_needed()
        assert page.locator('#parcelSearchQuery').is_visible()
        assert not errors,errors
        browser.close()
        result['checks']=['GIS index deduplication','actual residential code counts for all areas','all/residential/unknown partition','live UI GIS denominators','address / ID / APN / owner searches','search independent of Airbnb filters','selected geometry identical to original capture','city viewer link','no-result and clear handling','mobile parcel search']
        result['page_errors']=errors
    (ROOT / 'audits/gis_parcel_validation.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result,indent=2))

if __name__=='__main__':
    main()
