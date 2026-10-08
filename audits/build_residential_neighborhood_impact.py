"""Report neighborhood parcel mix and suitability of listing/parcel ratios.

Read-only analysis of saved source datasets. Does not modify website assets.
"""
import csv,gzip,json
from collections import Counter,defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
RES={1111,1112,1121,1122,1123,1124,1125,1126}
COMMON=set(range(7310,7361,10))

def main():
    areas=json.loads((ROOT/'data/area_boundaries.json').read_text(encoding='utf-8'))
    layer=areas['layers']['neighborhood']
    gis=json.load(gzip.open(ROOT/'data/gis_parcels/search_index.json.gz','rt',encoding='utf-8'))
    counts=defaultdict(Counter);unassigned=0
    for row in gis['records']:
        if row[13]<0:continue
        id=row[12].get('neighborhood')
        if id:counts[id][row[4]]+=1
        else:unassigned+=1
    overrides=json.loads((ROOT/'data/listing_address_overrides.json').read_text(encoding='utf-8'))['records']
    listing_counts=Counter();all_airbnbs=Counter();seen=set()
    for listing in json.loads((ROOT/'data/listings.json').read_text(encoding='utf-8')):
        id=str(listing['listing_id'])
        if id in seen:continue
        seen.add(id)
        override=overrides.get(id)
        distance=override['boundary_distance_m'] if override else listing.get('boundary_distance_m')
        if not listing.get('point') or listing.get('likely_hotel') or distance is None or distance<0:continue
        area=override['areas'].get('neighborhood') if override else layer['assignments'].get(id)
        if not area:continue
        all_airbnbs[area]+=1
        if str(listing.get('rental_type') or '').startswith('Entire'):listing_counts[area]+=1
    permits=json.loads((ROOT/'data/permits.json').read_text(encoding='utf-8'))
    normalize=lambda value:''.join(c for c in str(value or '').upper() if c.isalnum())
    current={normalize(parcel) for p in permits if p['status']=='current' for parcel in [p.get('parcel'),*(p.get('parcels') or [])] if normalize(parcel)}
    permit_counts=Counter()
    totals=json.loads((ROOT/'data/gis_parcels/area_counts.json').read_text(encoding='utf-8'))
    for row in totals['permit_parcel_records']:
        if row['parcel'] in current and row['boundary_distance_m']>=0 and row['areas'].get('neighborhood'):permit_counts[row['areas']['neighborhood']]+=1
    rows=[]
    for feature in layer['features']:
        id=feature['properties']['area_id'];c=counts[id];total=sum(c.values());res=sum(c[k] for k in RES);primary=c[1111]+c[1122];unknown=c[None]+c[0]
        all_share=100*primary/total if total else 0;res_share=100*primary/res if res else 0;missing=100*unknown/total if total else 0
        strong=res>=100 and all_share>=80 and res_share>=90 and missing<=10
        reasons=[]
        if res<100:reasons.append('Fewer than 100 classified residential parcels')
        if all_share<80:reasons.append('Single-family/duplex below 80% of all parcels')
        if res_share<90:reasons.append('Other residential types exceed 10% of residential parcels')
        if missing>10:reasons.append('More than 10% unknown land use')
        if 'Unnamed' in feature['properties']['name']:strong=False;reasons.append('Unnamed official neighborhood area')
        rows.append(dict(neighborhood=feature['properties']['name'],area_id=id,assessment='Stronger fit' if strong else 'Review mix / data',all_plots=total,residential_plots=res,single_family=c[1111],duplex=c[1122],townhouse=c[1121],multifamily_3_4=c[1123]+c[1124],multifamily_5_plus=c[1125],condominium=c[1126],mobile_home_park=c[1112],vacant_residential=c[9500],vacant_nonresidential=c[9600],common_area=sum(c[k] for k in COMMON),unknown_landuse=unknown,other_landuse=total-res-c[9500]-c[9600]-sum(c[k] for k in COMMON)-unknown,single_family_duplex_share_all_pct=all_share,single_family_duplex_share_residential_pct=res_share,residential_share_all_pct=100*res/total if total else 0,unknown_share_all_pct=missing,entire_place_airbnbs=listing_counts[id],all_nonhotel_airbnbs=all_airbnbs[id],licensed_plots=permit_counts[id],airbnb_per_residential_plot_pct=100*listing_counts[id]/res if res else None,licensed_per_residential_plot_pct=100*permit_counts[id]/res if res else None,review_reasons='; '.join(reasons)))
        r=rows[-1]
        assert total==sum(r[k] for k in ['residential_plots','vacant_residential','vacant_nonresidential','common_area','unknown_landuse','other_landuse'])
        assert res==sum(r[k] for k in ['single_family','duplex','townhouse','multifamily_3_4','multifamily_5_plus','condominium','mobile_home_park'])
        assert res==totals['totals']['0']['neighborhood'].get(id,{}).get('residential',0)
    rows.sort(key=lambda r:(r['assessment']!='Stronger fit',-r['entire_place_airbnbs'],r['neighborhood']))
    output=ROOT/'audits/residential_neighborhood_impact';output.mkdir(exist_ok=True)
    with (output/'neighborhood_mix.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
    report=dict(source=gis['source'],captured_at=gis['downloaded_at'],scope='KCMO boundary only; edge buffer 0 m; saved listing data without interactive filters; explicit user address corrections applied',method='Unique original GIS parcel IDs; internal point assignments. Single-family code 1111; duplex 1122; townhouse 1121 separately. Residential denominator includes codes 1111,1112,1121-1126. Parcel counts are not dwelling counts or land area.',stronger_fit_rule='At least 100 residential plots; single-family plus duplex >=80% of all plots and >=90% of residential plots; unknown <=10% of all plots. Analyst-selected screening criteria, not an official designation.',unassigned_city_parcels=unassigned,neighborhoods=rows)
    (output/'neighborhood_mix.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    strong=[r for r in rows if r['assessment']=='Stronger fit' and (r['all_nonhotel_airbnbs'] or r['licensed_plots'])]
    priority=sorted([r for r in strong if r['entire_place_airbnbs']>=5],key=lambda r:-r['airbnb_per_residential_plot_pct'])
    text=['# Residential neighborhood impact — saved parcel mix','',f"Source capture: {gis['downloaded_at']}. KCMO city boundary, 0 m buffer. Original listing/address sources remain untouched.",'', 'For comparing rental presence in primarily single-family/duplex neighborhoods, parcel-based percentages are more interpretable when other property types and missing classifications are scarce. They still measure entire-place listing records per residential parcel, not verified homes converted into rentals, and do not establish neighborhood harm. A duplex is one parcel with potentially two homes; apartment parcels may contain many homes. Townhouses are reported separately.','',report['stronger_fit_rule'],'',f'{len(strong)} stronger-fit neighborhoods have at least one non-hotel Airbnb or licensed plot; {len(priority)} have at least five entire-place Airbnb listings. Five listings is a practical shortlist filter, not statistical significance.','', '## Stronger-fit shortlist with at least five entire-place listings','', '| Neighborhood | Single-family | Duplex | SF + duplex / all plots | Residential plots | Entire-place listings | Listing / plot | Licensed plots | License / plot |','|---|---:|---:|---:|---:|---:|---:|---:|---:|']
    def line(r):return f"| {r['neighborhood']} | {r['single_family']:,} | {r['duplex']:,} | {r['single_family_duplex_share_all_pct']:.1f}% | {r['residential_plots']:,} | {r['entire_place_airbnbs']} | {r['airbnb_per_residential_plot_pct']:.2f}% | {r['licensed_plots']} | {r['licensed_per_residential_plot_pct']:.2f}% |"
    text.extend(line(r) for r in priority)
    text.extend(['','## Remaining stronger-fit neighborhoods with observed rental/license activity','', '| Neighborhood | Single-family | Duplex | SF + duplex / all plots | Residential plots | Entire-place listings | Listing / plot | Licensed plots | License / plot |','|---|---:|---:|---:|---:|---:|---:|---:|---:|'])
    text.extend(line(r) for r in sorted([r for r in strong if r not in priority],key=lambda r:-(r['airbnb_per_residential_plot_pct'] or 0)))
    text.extend(['','## Mixed or incomplete examples',''])
    for name in ['West Plaza','Volker','South Hyde Park','Central Hyde Park','North Hyde Park','Longfellow','Manheim Park','Squier Park']:
        r=next(r for r in rows if r['neighborhood']==name)
        text.append(f"- **{name}:** SF/duplex {r['single_family_duplex_share_all_pct']:.1f}% of all plots; {r['single_family_duplex_share_residential_pct']:.1f}% of residential plots; unknown land use {r['unknown_share_all_pct']:.1f}%. {r['review_reasons'] or 'Passes screen'}. Whole-neighborhood density can mix different housing types; examine individual blocks or verified parcels before inferring displacement.")
    text.extend(['','Full CSV/JSON include all named and unnamed source neighborhoods, including those with no observed rental activity. Airbnb counts exclude likely hotels; license counts are unique plots with current permits and do not depend on Airbnb counts. Neither numerator establishes an exact number of occupied housing units. Parcel mix uses counts, not acreage, and a large apartment/industrial parcel can disproportionately affect the character of an area despite counting once. Unknown classifications may bias all residential denominators. Recorded Airbnb points may be approximate; the four explicit user address corrections now fall outside KCMO and are excluded from this city-only comparison.'])
    (output/'report.md').write_text('\n'.join(text),encoding='utf-8')
    print('Stronger-fit active',len(strong),'priority',len(priority),'validated neighborhoods',len(rows))
    for r in priority[:15]:print(r['neighborhood'],r['single_family'],r['duplex'],round(r['single_family_duplex_share_all_pct'],1),r['entire_place_airbnbs'],round(r['airbnb_per_residential_plot_pct'],2),r['licensed_plots'])

if __name__=='__main__':main()
