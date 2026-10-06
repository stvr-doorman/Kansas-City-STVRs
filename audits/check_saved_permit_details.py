"""Cross-check map permits against the saved CompassKC detail export."""
import csv
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
with (root / 'data/compasskc_str_permits.csv').open(encoding='utf-8-sig', newline='') as source:
    rows = list(csv.DictReader(source))
by_id = {row['case_id']: row for row in rows}
permits = json.loads((root / 'data/permits.json').read_text(encoding='utf8'))
discrepancies = []
details = {}
for permit in permits:
    row = by_id.get(permit['id'])
    if row is None:
        discrepancies.append({'permit_number': permit['permit_number'], 'field': 'case_id',
                              'map_value': permit['id'], 'saved_value': 'missing'})
        continue
    for field in ['permit_number', 'address']:
        if permit[field] != row[field]:
            discrepancies.append({'permit_number': permit['permit_number'], 'field': field,
                                  'map_value': permit[field], 'saved_value': row[field]})
    details[permit['id']] = {
        'addresses': [address.strip() for address in row['all_addresses'].split('|') if address.strip()],
        'main_parcel': row['main_parcel'], 'location_count': row['location_count'],
        'description': row['description'], 'retrieved_at': row['retrieved_at_utc'],
    }
with (root / 'audits/saved_permit_detail_discrepancies.csv').open('w', encoding='utf8', newline='') as output:
    writer = csv.DictWriter(output, fieldnames=['permit_number', 'field', 'map_value', 'saved_value'])
    writer.writeheader()
    writer.writerows(discrepancies)
(root / 'data/permit_saved_details.json').write_text(
    json.dumps(details, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
print(f'Checked {len(permits)} map permits against {len(rows)} saved records: {len(discrepancies)} ID/number/primary-address discrepancies.')
print(f'{sum(len(row["addresses"]) > 1 for row in details.values())} permits have multiple saved address entries (including unit variants).')
if discrepancies:
    raise SystemExit(1)
