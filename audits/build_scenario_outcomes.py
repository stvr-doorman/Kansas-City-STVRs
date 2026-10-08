from scenario_inputs import scenario_output, scenario_permits
"""Save all discrete slider density outcomes, without live model calculations."""
from pathlib import Path
import json
from collections import Counter
ROOT=Path(__file__).resolve().parents[1];OUT=scenario_output(ROOT)
load=lambda name:json.loads((OUT/(name+'.json')).read_text(encoding='utf-8'))
summary=load('summary');neighborhoods=[f['properties'] for f in load('neighborhoods')['features']];points=load('points')['features']+load('spacing_extra_points')['features'];properties={f['properties']['parcel']:f['properties'] for f in points};patterns=load('spacing_patterns')['patterns'];ids=[p['area_id'] for p in neighborhoods];cap_candidates=Counter(p['neighborhood'] for p in properties.values() if p.get('cap_rank',0)>0)
result=dict(neighborhood_ids=ids,cap_steps=[i/2 for i in range(21)],distance_steps=[int(x) for x in patterns],spacing={},caps={},mixed={})
def totals(added):
 total=[p['current_residential']+n for p,n in zip(neighborhoods,added)];percent=[100*n/p['residential'] if p['residential'] else None for n,p in zip(total,neighborhoods)];city=summary['current_residential_plots']+sum(added);return dict(added=added,total=total,percent=percent,city_total=city,city_percent=100*city/summary['residential'])
for step in result['cap_steps']:
 key=str(int(step)) if step.is_integer() else str(step);limits=[p['residential']*int(step*10)//1000 for p in neighborhoods];room=[max(0,n-p['current_residential']) for n,p in zip(limits,neighborhoods)];added=[min(n,cap_candidates[p['area_id']]) for n,p in zip(room,neighborhoods)];result['caps'][key]=dict(**totals(added),limit=limits,over_existing=[max(0,p['current_residential']-n) for n,p in zip(limits,neighborhoods)])
for feet,pattern in patterns.items():
 c=Counter(properties[id]['neighborhood'] for id in pattern);spacing=[c[id] for id in ids];result['spacing'][feet]=totals(spacing);result['mixed'][feet]={}
 for key,cap in result['caps'].items():
  added=[min(s,max(0,n-p['current_residential'])) for s,n,p in zip(spacing,cap['limit'],neighborhoods)];result['mixed'][feet][key]=totals(added)
(OUT/'scenario_outcomes.json').write_text(json.dumps(result,separators=(',',':')),encoding='utf-8');print('Saved',len(patterns)*len(result['cap_steps']),'precomputed setting combinations:',(OUT/'scenario_outcomes.json').stat().st_size,'bytes')
