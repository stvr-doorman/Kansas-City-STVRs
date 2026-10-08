"""Choose a separate scenario build without changing source snapshots."""
import os,json

def scenario_output(root):
    path=root/os.environ.get('STVR_SCENARIO_OUTPUT','data/residential_scenarios')
    path.mkdir(parents=True,exist_ok=True)
    return path

def scenario_permits(root):
    return json.loads((root/os.environ.get('STVR_SCENARIO_PERMITS','data/permits.json')).read_text(encoding='utf-8'))


def scenario_provenance(root):
    source=root/os.environ.get('STVR_SCENARIO_PERMITS','data/permits.json')
    if source.parent.name!='confirmed_permits': return {}
    validation=json.loads((source.parent/'validation.json').read_text(encoding='utf-8'))
    return dict(permit_inventory='confirmed_current_regular',permit_source=validation['source'],permit_snapshot=validation['cutoff'],confirmed_permits=validation['confirmed_current_regular_permits'])
