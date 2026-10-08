"""Visible Edge checks for GIS number labels and actual clipboard contents."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]

def main():
    street_data=json.loads((ROOT/'data/privacy_streets/listing_streets.json').read_text(encoding='utf-8'))
    sample_id,record=next((key,row) for key,row in street_data['records'].items() if row['radius'] and row['streets'] and all('unavailable' not in ' '.join(s) for s in row['streets']))
    groups={}
    for street,city,zip_code in record['streets']:
        group=groups.setdefault(city,{'streets':set(),'zips':set()});group['streets'].add(street);group['zips'].add(zip_code)
    expected='\n\n'.join('\n'.join(sorted(g['streets']))+'\n'+city+' · '+', '.join(sorted(g['zips'])) for city,g in sorted(groups.items()))
    with sync_playwright() as p:
        browser=p.chromium.launch(channel='msedge',headless=False)
        context=browser.new_context(permissions=['clipboard-read','clipboard-write'],viewport={'width':1500,'height':1000})
        page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto('http://localhost:8765',wait_until='domcontentloaded')
        page.wait_for_function('typeof PrivacyStreetCopy!=="undefined" && !!map?.getSource("all-parcel-numbers")',timeout=90000)
        for selector in ['#dismissFirstVisit','#denyCookies']:
            if page.locator(selector).is_visible():page.locator(selector).click()
        page.evaluate('map.jumpTo({center:[-94.6078,39.045],zoom:18})')
        page.check('#parcelOutlines')
        page.wait_for_function('map.getSource("all-parcel-outlines")._data.features.some(f=>f.properties.objectid==="WY:96510"&&f.properties.address_number==="4540")',timeout=60000)
        assert page.evaluate('map.getSource("all-parcel-numbers")._data.features.some(f=>f.properties.address_number==="4540")')
        assert page.evaluate('map.getLayer("all-parcel-numbers").minzoom')==17
        page.uncheck('#parcelAddressNumbers')
        assert page.evaluate('map.getLayoutProperty("all-parcel-numbers","visibility")')=='none'
        page.check('#parcelAddressNumbers')
        page.evaluate('(id)=>showListing(listings.find(l=>String(l.listing_id)===id))',sample_id)
        page.locator('[data-copy-privacy-streets]').click()
        page.wait_for_function('document.querySelector("[data-privacy-street-status]").textContent.startsWith("Copied")',timeout=30000)
        assert page.evaluate('navigator.clipboard.readText()').replace('\r\n','\n')==expected
        page.evaluate('showListing(listings.find(l=>String(l.listing_id)==="42504809"))')
        page.locator('[data-copy-privacy-streets]').click()
        page.wait_for_function('document.querySelector("[data-privacy-street-status]").textContent.includes("clipboard unchanged")',timeout=30000)
        assert page.evaluate('navigator.clipboard.readText()').replace('\r\n','\n')==expected
        assert page.evaluate('PrivacyStreetCopy.format([["Oak St","Kansas City MO","64109"],["Oak St","Kansas City MO","64111"],["Pine Rd","Kansas City KS","66103"]])')=='Pine Rd\nKansas City KS · 66103\n\nOak St\nKansas City MO · 64109, 64111'
        original=page.evaluate('(id)=>listings.find(l=>String(l.listing_id)===id)',sample_id)
        original['point']=[-94.6,39.1]
        try:
            page.evaluate('(listing)=>PrivacyStreetCopy.getListing(listing)',original)
            raise AssertionError('Moved listing accepted stale street results')
        except Exception as error:
            assert 'need rebuilding' in str(error)
        assert not errors,errors
        browser.close()
    print('PASS original GIS address numbers, zoom threshold, label toggle, exact clipboard text, zero radius, stale location rejection, no page errors')

if __name__=='__main__':main()
