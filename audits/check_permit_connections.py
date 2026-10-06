"""Check rendered permit connections and refresh the location discrepancy audit.

Run from the repository root with Python and Playwright (Edge installed).
"""
import csv
import functools
import http.server
import json
from pathlib import Path
import threading

from playwright.sync_api import sync_playwright


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


root = Path(__file__).resolve().parent.parent
server = http.server.ThreadingHTTPServer(
    ('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(root)))
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='msedge', headless=True)
        page = browser.new_page(viewport={'width': 1400, 'height': 1000})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        url = f'http://127.0.0.1:{server.server_port}'
        page.goto(url + '/index.html', wait_until='domcontentloaded')
        page.wait_for_function('window.nashville?.map?.getSource("listings")', timeout=60000)
        result = page.evaluate('''() => {
          const api=window.nashville,map=api.map,all=permitParcelLinks(api.listings);
          if(api.listings.some(l=>Number.isFinite(l.boundary_distance_m)&&l.boundary_distance_m < -550))throw Error('Outside-city listing retained');
          const boundsTest=[{boundary_distance_m:-551},{boundary_distance_m:-550},{boundary_distance_m:1}];
          PermitProperties.prepare(boundsTest,[]);
          if(boundsTest.length!==2)throw Error('City boundary cutoff');
          const rejected=permitParcelLinks(api.listings,true).filter(f=>f.properties.location_conflict);
          if(all.some(f=>f.properties.distance_m>550))throw Error('Long line drawn');
          const assert=(value,message)=>{if(!value)throw Error(message);};
          const legend=document.getElementById('mapLegend');
          assert(legend.open&&document.querySelector('#filters .panel-body').firstElementChild===legend,'Legend expanded at top');
          assert(legend.querySelector('[data-legend-count=warning]').closest('label').nextElementSibling.id==='screeningFilters'&&legend.contains(document.getElementById('over'))&&legend.contains(document.getElementById('unlicensedCertainty')),'Sliders directly beneath warning legend category');
          const legendBoxes=[...document.querySelectorAll('.legend-category')];
          for(const input of legendBoxes)input.checked=input.value==='current';
          api.update();assert(api.visible.length>0&&api.visible.every(l=>legendCategory(l)==='current'),'Legend category checkbox filters listings');
          for(const input of legendBoxes)input.checked=true;
          document.getElementById('legendGuestLabels').checked=false;
          api.update();assert(map.getLayoutProperty('listing-labels','visibility')==='none','Guest label checkbox hides labels');
          document.getElementById('legendGuestLabels').checked=true;
          api.update();
          const noNumber={registration_text:'',detected_permit_numbers:[],privacy_radius_meters:500,nearest_licensed_parcel_m:600,likely_unlicensed_number:true};
          assert(unlicensedTier(noNumber)===99,'Highest certainty requires no number and no nearby current parcel');
          assert(unlicensedTier({...noNumber,nearest_licensed_parcel_m:400})===49.5,'Nearby licensed parcel reduces certainty');
          assert(unlicensedTier({...noNumber,nearest_licensed_parcel_m:null})!==99,'Missing parcel distance cannot reach highest certainty');
          assert(unlicensedTier({...noNumber,registration_text:'NSD-STR-99999'})!==99,'Listed number cannot reach highest certainty');
          assert(unlicensedTier({...noNumber,property_permits:[{status:'current'}]})===-1,'Current property excluded');
          document.getElementById('likely').checked=true;
          document.getElementById('unlicensedCertainty').value='99';
          document.getElementById('over').value='1';
          api.update();
          assert(api.visible.every(l=>unlicensedTier(l)===99&&overCapacityFlag(l)&&l.over_capacity>=1),'Capacity and certainty filters compose');
          assert(document.getElementById('unlicensedCertaintyValue').textContent==='Very certain','Certainty slider label');
          document.getElementById('likely').checked=false;
          document.getElementById('unlicensedCertainty').value='0';
          document.getElementById('over').value='0';
          document.getElementById('noLicenseNumber').checked=true;
          api.update();assert(api.visible.every(noListedPermit),'No-number checkbox');
          document.getElementById('noLicenseNumber').checked=false;
          document.getElementById('nameParcelNoPermit').checked=true;
          api.update();assert(api.visible.every(l=>screeningNames(l).some(row=>!anyPermitParcels.has(normalizeParcel(row.source_parcel||row.parcel))&&!anyPermitParcels.has(normalizeParcel(row.parcel)))),'Name parcel without permit checkbox');
          document.getElementById('nameParcelNoPermit').checked=false;
          api.update();
          const deniedPlot=permitParcels.features.find(f=>String(f.properties.parcel)==='221179');
          assert(deniedPlot?.geometry.type==='Polygon'&&deniedPlot.properties.permit_status==='denied','Denied permit parcel restored');
          const deniedListing=api.listings.find(l=>l.listing_id==='1747457444011081072');
          api.showListing(deniedListing);
          assert(map.getSource('parcels')._data.features.some(f=>String(f.properties.parcel)==='221179'),'Denied highlight in map source');
          assert(!map.getSource('connections')._data.features.length,'Denied cross-town line suppressed');
          assert(!permitParcelLinks([deniedListing]).length,'Denied line cap');
          const major=api.listings.find(l=>l.listing_id==='1639451491324765130');
          assert(major.matched_permits.some(p=>p.permit_number==='NSD-STRMAJ-00037'),'Major event permit recognized');
          assert(major.registration_class!=='none','Registration present');
          assert(api.markerColor(major)==='#a855f7','Expired major-event marker purple');
          assert(permitCard(major.matched_permits.find(p=>p.permit_number==='NSD-STRMAJ-00037')).includes('#a855f7'),'Major-event badge purple');
          api.showListing(major);
          assert(!document.querySelector('.maplibregl-popup').textContent.includes('no registration number shown'),'No contradictory absence message');
          const uncertaintySize=map.getLayoutProperty('connection-question-labels','text-size');
          assert(JSON.stringify(uncertaintySize)===JSON.stringify(['interpolate',['linear'],['zoom'],9,2.4,11,4,13,9.6,16,16]),'Uncertainty text scales with dot radius');
          const current=api.permits.filter(p=>p.status==='current').length;
          const estimates=[-550,550].map(buffer=>{const items=filterListings(false,false,buffer);return Math.max(0,items.length-items.filter(l=>l.likely_hotel).length-current);});
          const min=Math.min(...estimates),max=Math.max(...estimates),range=min===max?min.toLocaleString():`${min.toLocaleString()}–${max.toLocaleString()}`;
          assert(document.querySelector('#potentiallyUnlicensedCount').textContent===`Current estimate: up to ~${max.toLocaleString()} potentially unlicensed`,'Footer maximum estimate');
          const loft=api.listings.find(l=>l.listing_id==='21524923');
          assert(!loft.matched_permits.length&&loft.detected_permit_count===1&&!loft.dual_license_capacity,'Loft duplicate permit evidence corrected');
          assert(loft.allowed_guests===5,'Loft single-unit capacity corrected');
          api.showListing(loft);
          const loftCard=document.querySelector('.maplibregl-popup').textContent;
          assert(loftCard.includes('NSD-STR-02471')&&loftCard.includes('NSD-STR-02470'),'Candidate parcel permit histories');
          assert(!loftCard.includes('Two permit numbers were detected'),'No erroneous two-unit caveat');
          const wes=api.listings.find(l=>l.listing_id==='1662658295981245205');
          api.showListing(wes);
          const wesCard=document.querySelector('.maplibregl-popup').textContent;
          assert(wesCard.includes('Parcel nickname match ?')&&wesCard.includes('Pope Wesley')&&wesCard.includes('5736 Booth Ave')&&wesCard.includes('52062'),'Wes parcel nickname evidence displayed');
          const wesSections=[...document.querySelectorAll('.maplibregl-popup details>summary')].filter(el=>!el.parentElement.classList.contains('permit-record')).map(el=>el.textContent);
          assert(wesSections.indexOf('Parcel nickname match ?')===wesSections.indexOf('Matched permit-number records')+1,'Parcel nickname immediately after permit match');
          const wesNames=permitParcelLinks([wes]).filter(f=>f.properties.method==='owner_nickname');
          assert(wesNames.length&&wesNames.every(f=>f.properties.name_source==='parcel'&&f.properties.matched_name==='Pope Wesley'),'Wes parcel source explicit');
          const compact=api.listings.find(l=>l.party_house&&l.matched_permits.length&&overCapacityFlag(l));
          api.showListing(compact);
          const compactText=document.querySelector('.maplibregl-popup').textContent;
          for(const label of ['Party/event keyword matches','Permit-number evidence','Data and capacity rules','Forms and corrections','All permits at the matched property'])assert(!compactText.includes(label),'Disabled card section '+label);
          assert(document.querySelector('[data-capacity-explanation]'),'Capacity explanation at top');
          assert(!document.querySelector('.maplibregl-popup .report-actions'),'Forms disabled');
          const cancelled=api.listings.find(l=>l.matched_permits.some(p=>p.permit_number==='NSD-STR-02532'));
          assert(cancelled&&cancelled.noncurrent_permit_at_permitted_address&&!api.likelyUnlicensed(cancelled),'Cancelled permit with current property record');
          assert(api.markerColor(cancelled)==='#22c55e'&&!listingFeature(cancelled).properties.renewed,'Cancelled listing with current property is solid green');
          assert(cancelled.matched_permits.find(p=>p.permit_number==='NSD-STR-02532').status==='cancelled','Cancelled status preserved');
          api.showListing(cancelled);
          const cancelledCard=document.querySelector('.maplibregl-popup').textContent;
          assert(cancelledCard.includes('Valid · Permit discrepancy:')&&cancelledCard.includes('Permit discrepancy:')&&cancelledCard.includes('NSD-STR-02609')&&!cancelledCard.includes('Likely unlicensed'),'Cancelled property screening explains current record');
          const saved=api.permits.find(p=>p.permit_number==='CD-STR-00651');
          assert(saved.saved_details?.addresses?.some(a=>a.includes('1111 W 39th St')),'Saved secondary address loaded');
          assert(permitCard(saved).includes('501 W 11th St')&&permitCard(saved).includes('1111 W 39th St'),'Saved addresses displayed');
          const airport=api.listings.find(l=>l.listing_id==='680334709287009417');
          assert(airport.matched_permits.map(p=>p.permit_number).join(',')==='CD-STR-00811','CD prefix');
          const airportLinks=permitParcelLinks([airport]);
          assert(airportLinks.length && airportLinks.every(f=>f.properties.distance_m<1000),'Airport connection');
          const ambiguous=api.listings.find(l=>l.listing_id==='32384582');
          assert(ambiguous.matched_permits.length===1 && permitParcelLinks([ambiguous]).every(f=>f.properties.distance_m<550&&f.properties.uncertain),'Nearby abbreviated prefix');
          const farmhouse=api.listings.find(l=>l.listing_id==='883235496371886890');
          assert(farmhouse.matched_permits.some(p=>p.permit_number==='NSD-STR-00085'),'Farmhouse abbreviated registration');
          assert(permitParcelLinks([farmhouse]).length===2&&permitParcelLinks([farmhouse]).every(f=>f.properties.uncertain&&f.properties.distance_m<550),'Farmhouse uncertain short line '+JSON.stringify(permitParcelLinks([farmhouse])));
          api.showListing(farmhouse);
          assert(map.getSource('connection-labels')._data.features.some(f=>f.properties.label==='Permit ?')&&map.getSource('connection-labels')._data.features.some(f=>f.properties.label==='Parcel ?'),'Both uncertain reference labels');
          assert(PermitProperties.nameMatch('Lauren','Kennedy Tobin',nameMatchingData)==='distance','No fabricated staff or owner nickname');
          const normal=api.listings.find(l=>l.expired_permit_at_permitted_address&&l.point&&!l.over_capacity);
          const over=api.listings.find(l=>l.expired_permit_at_permitted_address&&l.point&&l.over_capacity>0&&l.bedrooms<=5);
          for(const l of [normal,over]){
            assert(l,'Renewal sample');api.showListing(l);
            assert(document.querySelector('.maplibregl-popup').textContent.includes('Likely permitted · Listed permit expired, property permit renewed'),'Renewal popup');
          }
          const pixel=(id,x,y)=>{
            const image=map.style.imageManager.getImage(id).data;
            return Array.from(image.data.slice((y*64+x)*4,(y*64+x)*4+4)).join(',');
          };
          assert(pixel('renewed-permit',16,32)==='250,204,21,255','Yellow half');
          assert(pixel('renewed-permit',48,32)==='34,197,94,255','Green half');
          assert(pixel('permitted-over-capacity',16,32)==='220,38,38,255','Over-capacity red half');
          assert(pixel('permitted-over-capacity',48,32)==='34,197,94,255','Permitted green half');
          assert(listingFeature(over).properties.renewal_icon==='permitted-over-capacity','Renewed property over capacity');
          const currentOver=api.listings.find(l=>!l.likely_hotel&&l.registration_class==='current'&&overCapacityFlag(l));
          assert(currentOver&&listingFeature(currentOver).properties.renewal_icon==='permitted-over-capacity','Current permit over capacity');
          assert(listingFeature(normal).properties.renewal_icon==='renewed-permit','Renewed normal capacity stays yellow/green');
          api.showListing(api.listings.find(l=>l.listing_id==='54361028'));
          assert(document.querySelector('.maplibregl-popup').textContent.includes('Listing / permit location discrepancy'),'Location warning');
          assert(!permitParcelLinks([api.listings.find(l=>l.listing_id==='54361028')]).length,'Cross-town line excluded');
          for(const id of ['connections','permit-links','candidate-connections']){
            sourceData(id,collection([feature({type:'LineString',coordinates:[[0,0],[1,1]]})]));
            assert(map.getSource(id)._data.features.length===0,'Source cap '+id);
          }
          const geometry=propertyLocationGeometry(),byParcel=new Map(geometry.features.map(f=>[normalizeParcel(f.properties.parcel),f.properties]));
          const old={id:'old',permit_number:'CD-STR-99999',parcel:'1',address:'1 Main St',status:'expired'};
          const newer={id:'new',permit_number:'NSD-STR-99999',parcels:['1','2'],address:'1 Main St',status:'current'};
          const synthetic={listing_id:'test',point:[1,2],registration_class:'expired',matched_permits:[old]};
          const testGeometry={features:[{properties:{parcel:'1',address:'1 Main St',point:[1.001,2]}},{properties:{parcel:'2',address:'99 Other St',point:[5,6]}}]};
          PermitProperties.prepare([synthetic],[old,newer],testGeometry);
          assert(synthetic.expired_permit_at_permitted_address,'Renewal association');
          assert(PermitProperties.links([synthetic],testGeometry).length===1,'No expansion to unrelated parcel');
          PermitProperties.prepare([synthetic],[old],testGeometry);
          assert(!synthetic.expired_permit_at_permitted_address && PermitProperties.links([synthetic],testGeometry).length===1,'Expired-only connection');
          const nicknameListing={listing_id:'nickname-test',point:[1,2],host_name:'Bill',matched_permits:[old]};
          const nicknameGeometry={features:[{properties:{parcel:'1',point:[1.001,2],owner:'William Smith'}}]};
          const nicknameLines=PermitProperties.links([nicknameListing],nicknameGeometry,false,{bill:['william']});
          assert(nicknameLines.length===2&&nicknameLines.every(f=>f.properties.uncertain),'Separate uncertain number and nickname lines');
          assert(new Set(nicknameLines.map(f=>f.properties.method)).size===2,'Distinct evidence methods');
          const permitNickname={...old,owner:'William Smith'};
          const permitNameLines=PermitProperties.links([{...nicknameListing,matched_permits:[permitNickname]}],{features:[{properties:{parcel:'1',point:[1.001,2],owner:'Someone Else'}}]},false,{bill:['william']});
          assert(permitNameLines.some(f=>f.properties.method==='permit_owner_nickname'&&f.properties.name_source==='permit'&&f.properties.matched_name==='William Smith'),'Permit nickname source explicit');
          const fallback={listing_id:'fallback',point:[1,2],host_name:'Bill',matched_permits:[]};
          assert(PermitProperties.candidates(fallback,nicknameGeometry,{bill:['william']},160).length===1,'Nickname parcel fallback');
          assert(PermitProperties.candidates(nicknameListing,nicknameGeometry,{bill:['william']},550).length===0,'No parcel fallback with license match');
          const manyNames={features:Array.from({length:8},(_,i)=>({type:'Feature',geometry:{type:'Point',coordinates:[1+(i+1)*0.0005,2]},properties:{parcel:String(i+10),address:'Candidate '+i,owner:'William Smith',point:[1+(i+1)*0.0005,2]}}))};
          const preferred=PermitProperties.candidates({...fallback,privacy_radius_meters:120},manyNames,{bill:['william']},160);
          assert(preferred.length===5&&preferred.every(row=>row.distance_m<550),'Top five nickname results');
          assert(preferred.some(row=>row.distance_m>160),'Nickname search independent of distance slider');
          assert(preferred[0].within_privacy_radius&&preferred[0].distance_m<=preferred[1].distance_m,'Privacy-radius preference');
          const historical=api.listings.filter(l=>l.point&&l.matched_permits.some(p=>p.status!=='current'));
          const linked=new Set(all.map(f=>f.properties.listing_id));
          return {
            renewed:api.listings.filter(l=>l.expired_permit_at_permitted_address).length,
            ambiguous:api.listings.filter(l=>l.ambiguous_permit_candidates.length).length,
            lines:all.length,historical:historical.length,
            unmappedHistorical:historical.filter(l=>!linked.has(l.listing_id)).map(l=>l.listing_id),
            airportDistance:Math.round(airportLinks[0].properties.distance_m),
            conflictingParcelListings:api.listings.filter(l=>l.conflicting_permit_parcels.length).length,
            discrepancies:rejected.map(f=>({...f.properties,
              listing_url:api.listings.find(l=>l.listing_id===f.properties.listing_id).url,
              permit_address:api.permits.find(p=>p.permit_number===f.properties.permit_number)?.address,
              parcel_address:byParcel.get(normalizeParcel(f.properties.parcel))?.address}))
          };
        }''')
        page.evaluate("window.nashville.showListing(window.nashville.listings.find(l=>l.listing_id==='1674630929745778267'))")
        page.wait_for_function("document.querySelector('[data-property-associations]')?.textContent.includes('Leftwich Suzette')", timeout=20000)
        suzette = page.evaluate('''()=>{
          const listing=window.nashville.selectedListing;
          const rows=PermitProperties.candidates(listing,{features:[...(parcelMatchingData?.features||[]),...fallbackParcelLookups.get(listing.listing_id).data.features]},nameMatchingData,parcelMatchRadius());
          const owner=rows.find(row=>row.owner.includes('Leftwich Suzette'));
          if(!map.getSource('candidate-connections')._data.features.some(f=>f.properties.method==='owner_first_name'&&f.properties.uncertain))throw Error('Uncertain owner-name line');
          if(!needsParcelFallback(listing)||!owner||owner.distance_m>=550||rows.length>5)throw Error('Distant permit parcel fallback');
          return {address:owner.address,owner:owner.owner,distance_m:Math.round(owner.distance_m),type:owner.type};
        }''')
        print('Suzette city owner candidate:', json.dumps(suzette))
        name_lookup = page.evaluate("""async()=>{
          const listing=window.nashville.listings.find(l=>l.listing_id==='1674630929745778267');
          const data=await ParcelCandidates.loadNames(listing,nameMatchingData);
          const rows=PermitProperties.candidates(listing,data,nameMatchingData,550);
          const owner=rows.find(row=>row.owner.includes('Leftwich Suzette'));
          if(!owner||parcelHasAnyPermit(owner))throw Error('City name-only lookup must find unpermitted Suzette parcel');
          screeningNameLookups.set(listing.listing_id,{data});screeningNameCache.delete(listing);
          const previous=document.getElementById('nameParcelNoPermit').checked;
          document.getElementById('nameParcelNoPermit').checked=true;
          if(!matchesScreeningFilters(listing))throw Error('Name-only city result excluded by checkbox');
          document.getElementById('nameParcelNoPermit').checked=previous;
          return {parcel:owner.parcel,distance_m:owner.distance_m};
        }""")
        print('Unpermitted city owner filter:', json.dumps(name_lookup))

        page.evaluate('''async()=>{
          await showProperty({parcel:'221179',address:'9105 N Lewis Ave',owner:'De La Cruz Isaac',parcel_first:true},[-94.47548213327718,39.25783562348339]);
          const summaries=[...document.querySelectorAll('.maplibregl-popup details summary')].map(el=>el.textContent);
          if(!summaries[0]?.startsWith('Parcel details')||!summaries[1]?.startsWith('License details'))throw Error('Parcel-first nickname card');
        }''')
        page.evaluate('''()=>{
          const listing=window.nashville.visible.find(l=>!l.matched_permits.length&&PermitProperties.candidates(l,parcelMatchingData,nameMatchingData,550).length);
          if(!listing)throw Error('No parcel fallback test sample');
          window.nashville.showListing(listing);
          if(!document.querySelector('[data-property-associations]'))throw Error('Fallback UI missing');
          const slider=document.querySelector('#parcelMatchRadius');
          if(slider.min!=='160'||slider.max!=='550'||slider.defaultValue!=='160')throw Error('Radius controls');
          slider.value='550';slider.dispatchEvent(new Event('change',{bubbles:true}));
        }''')
        page.wait_for_function("document.querySelector('[data-parcel-radius]')?.textContent==='550'")
        if page.locator('#firstVisitDisclaimer').is_visible():
            page.locator('#dismissFirstVisit').click()
        page.evaluate('popup?.remove()')
        if page.locator('#filters').evaluate("el=>el.classList.contains('collapsed')"):
            page.locator('#toggleFilters').click()
        page.locator('#expiredMajorOnly').check()
        page.wait_for_function("window.nashville.visible.length>0&&window.nashville.visible.every(l=>l.matched_permits.some(expiredMajorPermit))")
        assert page.evaluate("window.nashville.visible.some(l=>l.listing_id==='1639451491324765130')")
        page.wait_for_function("Number(document.querySelector('#buildStatus').textContent.replace(/[^0-9]/g,''))===window.nashville.visible.length")
        assert page.evaluate("Number(document.querySelector('[data-legend-count=guest-label]').textContent.replace(/[^0-9]/g,''))===window.nashville.visible.filter(overCapacityFlag).length")
        assert page.evaluate("[...document.querySelectorAll('[data-legend-count]')].filter(el=>!['gray-parcel','guest-label'].includes(el.dataset.legendCount)).reduce((n,el)=>n+Number(el.textContent.replace(/[^0-9]/g,'')),0)===window.nashville.visible.length")
        page.locator('#clearExploreFilters').click()
        assert not page.locator('#expiredMajorOnly').is_checked()
        page.evaluate("window.nashville.map.jumpTo({center:[-94.47548213327718,39.25783562348339],zoom:17})")
        page.wait_for_function("window.nashville.map.queryRenderedFeatures({layers:['parcel-fill']}).some(f=>String(f.properties.parcel)==='221179')", timeout=15000)
        assert page.evaluate("window.nashville.map.getPaintProperty('parcel-fill','fill-color').slice(-1)[0].slice(-1)[0]") == '#94a3b8'
        page.wait_for_function("Number(document.querySelector('#buildStatus').textContent.replace(/[^0-9]/g,''))===window.nashville.visible.length")
        discrepancies = result.pop('discrepancies')
        with (root / 'audits/permit_location_discrepancies.csv').open('w', encoding='utf8', newline='') as output:
            writer = csv.DictWriter(output, fieldnames=['listing_id', 'listing_url', 'permit_number',
                'permit_address', 'parcel', 'parcel_address', 'distance_m', 'location_conflict', 'uncertain', 'method', 'reference_label', 'source_parcel'])
            writer.writeheader()
            writer.writerows(discrepancies)
        result['discrepancyLines'] = len(discrepancies)
        page.goto(url + '/records.html', wait_until='networkidle')
        page.wait_for_function('document.querySelector("#count").textContent.includes("records")')
        assert 'Listed permit expired, property permit renewed' in page.locator('#body').inner_text()
        for name in ['app.js', 'records.js', 'permit_properties.js', 'parcel_candidates.js']:
            page.evaluate('(source)=>new Function(source)', (root / name).read_text(encoding='utf8'))
        assert not errors, errors
        print(json.dumps(result, indent=2))
        print('Map, records, colors, matching, historical connections and warnings passed; no browser errors.')
        browser.close()
finally:
    server.shutdown()
