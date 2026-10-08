"""Precompute original GIS residential mix for every area and edge buffer."""
import gzip,json
from pathlib import Path
from collections import Counter,defaultdict

ROOT=Path(__file__).resolve().parents[1]
RES={1111,1112,1121,1122,1123,1124,1125,1126}

def main():
    with gzip.open(ROOT/'data/gis_parcels/search_index.json.gz','rt',encoding='utf-8') as f:data=json.load(f)
    result={str(buffer):{} for buffer in range(-550,551,50)}
    for row in data['records']:
        code=row[4]
        category='single_family' if code==1111 else 'duplex' if code==1122 else 'townhouse' if code==1121 else 'other_residential' if code in RES else 'unknown' if code in {None,0} else 'other'
        for buffer in range(-550,551,50):
            if row[13]<-buffer:continue
            for id in row[12].values():
                count=result[str(buffer)].setdefault(id,dict(single_family=0,duplex=0,townhouse=0,other_residential=0,unknown=0,other=0))
                count[category]+=1
    counts=json.loads((ROOT/'data/gis_parcels/area_counts.json').read_text(encoding='utf-8'))
    for buffer,areas in result.items():
        for id,mix in areas.items():
            key=id.split(':')[0];expected=counts['totals'][buffer][key][id]
            assert sum(mix.values())==expected['plots']
            assert sum(mix[k] for k in ['single_family','duplex','townhouse','other_residential'])==expected['residential']
    (ROOT/'data/gis_parcels/area_mix.json').write_text(json.dumps(dict(source=data['source'],captured_at=data['downloaded_at'],totals=result),separators=(',',':')),encoding='utf-8')
    print('Validated parcel mix for all six area types and 23 edge buffers.')

if __name__=='__main__':main()
