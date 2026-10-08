"""Apply explicit user address corrections without changing original listings."""
import csv,json,gzip
from pathlib import Path
import requests
from shapely.geometry import shape,Point,mapping
from shapely.ops import unary_union,transform
from pyproj import Transformer

ROOT=Path(__file__).resolve().parents[1]

def main():
    path=ROOT/'data/listing_address_associations.csv'
    with path.open(encoding='utf-8-sig',newline='') as f:reader=csv.DictReader(f);fields=reader.fieldnames;rows=list(reader)
    border=json.load(gzip.open(ROOT/'data/border_parcels/features.json.gz','rt',encoding='utf-8'))
    original={f['properties']['border_id']:f for f in border['features']}
    spatial=json.loads((ROOT/'data/spatial.json').read_text(encoding='utf-8'))
    project=Transformer.from_crs(4326,26915,always_xy=True).transform
    city=transform(project,unary_union([shape(f['geometry']) for f in spatial['boundary']['features']]))
    areas=json.loads((ROOT/'data/area_boundaries.json').read_text(encoding='utf-8'))
    area_shapes={key:[(f['properties']['area_id'],shape(f['geometry'])) for f in layer['features']] for key,layer in areas['layers'].items()}
    cells=[(f['properties']['cell_id'],shape(f['geometry'])) for f in spatial['cells']]
    licensed=json.loads((ROOT/'data/licensed_parcels.geojson').read_text(encoding='utf-8'))
    licensed_geometry=transform(project,unary_union([shape(f['geometry']) for f in licensed['features'] if f.get('geometry')]))
    overrides={}
    for row in rows:
        if row['parcel_key'] in original:
            f=original[row['parcel_key']];source=row['parcel_source'];pid=row['parcel_id']
        elif row['listing_id']=='1571297833387479780':
            source='https://services7.arcgis.com/3c8lLdmDNevrTlaV/ArcGIS/rest/services/ClayCountyParcelService/FeatureServer/0'
            d=requests.get(source+'/query',params={'f':'geojson','where':"situs_num = '222' AND UPPER(situs_st_name) = 'BRIAR'",'outFields':'*','outSR':4326},timeout=30).json()
            assert len(d['features'])==1;f=d['features'][0];pid=f['properties']['parcel_id'];row.update(parcel_key='CL:'+pid,parcel_id=pid,gis_address='222 BRIAR LN',parcel_source=source)
        elif row['listing_id']=='1672773013470253229':
            locator='https://jcgis.jacksongov.org/arcgis/rest/services/SitusAddresses_Locator/GeocodeServer'
            d=requests.get(locator+'/findAddressCandidates',params={'f':'json','SingleLine':f"{row['address']}, {row['city']}, {row['state']} {row['zip']}",'outFields':'*','outSR':4326},timeout=30).json()
            candidates=[c for c in d['candidates'] if c['score']>=99 and c['attributes'].get('Addr_type')=='PointAddress' and c['attributes'].get('StAddr')=='8700 KENTUCKY AVE'];assert len(candidates)==1
            location=candidates[0]['location'];source='https://jcgis.jacksongov.org/arcgis/rest/services/ParcelViewer/ParcelsAscendRelate/MapServer/1'
            d=requests.get(source+'/query',params={'f':'geojson','geometry':json.dumps(location),'geometryType':'esriGeometryPoint','inSR':4326,'spatialRel':'esriSpatialRelIntersects','where':'1=1','outFields':'*','outSR':4326},timeout=30).json()
            matches=[f for f in d['features'] if shape(f['geometry']).covers(Point(location['x'],location['y']))];assert len(matches)==1;f=matches[0];pid=str(f['properties'].get('parcel_id') or f['properties']['PropertyID']);row.update(parcel_key='JA:'+pid,parcel_id=pid,gis_address='8700 KENTUCKY AVE (county address locator)',parcel_source=source)
        else:raise RuntimeError(f"Resolve supplied address before placing listing: {row['address']}")
        evidence=ROOT/'audits/user_address_evidence';evidence.mkdir(exist_ok=True)
        (evidence/(row['listing_id']+'.json')).write_text(json.dumps(dict(source=source,feature=f)),encoding='utf-8')
        geometry=shape(f['geometry']);point=geometry.representative_point();projected=transform(project,point)
        distance=city.boundary.distance(projected)*(1 if city.covers(projected) else -1)
        row['scope']='Inside KCMO' if distance>=0 else 'Outside KCMO'
        row['verification_status']='Address confirmed by user; GIS parcel located'
        assignments={}
        for key,features in area_shapes.items():
            ids=[id for id,g in features if g.covers(point)]
            if len(ids)==1:assignments[key]=ids[0]
        overrides[row['listing_id']]=dict(address=', '.join([row['address'],row['city'],row['state']+' '+row['zip']]),parcel=row['parcel_key'],point=[point.x,point.y],boundary_distance_m=distance,areas=assignments,geometry=mapping(geometry),source=source,cell_id=next((id for id,g in cells if g.covers(point)),None),nearest_licensed_parcel_m=projected.distance(licensed_geometry))
        print(row['listing_id'],row['address'],row['parcel_key'],round(distance,1),flush=True)
    with path.open('w',encoding='utf-8-sig',newline='') as f:writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader();writer.writerows(rows)
    (ROOT/'data/listing_address_overrides.json').write_text(json.dumps(dict(records=overrides),separators=(',',':')),encoding='utf-8')

if __name__=='__main__':main()
