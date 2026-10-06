Permit connection checks
=======================

The map and inventory page recompute matches from the literal saved permit evidence
in `permit_properties.js`. Formatting differences can be normalized, but CD and NSD
prefixes must remain distinct. Abbreviated STR numbers connect provisionally only when exactly one same-series-suffix city record is less than 550 m away; ambiguous numbers retain review candidates.
Original source JSON/CSV snapshots remain unchanged; downloaded snapshots may contain
the earlier matching results.

Property history uses city parcel identifiers with a conservative street-address
consistency check. Unit suffixes and common street abbreviations are normalized.
Secondary or conflicting addresses remain visible as evidence but do not supply automatic line destinations. Some city records explicitly list multiple separate street addresses.
Related permits cannot expand a listing's connections to their other parcels.
A current permit on the same property does not verify authorization for the listing's unit.

`permit_location_points.json` supplements the display geometry with existing city
parcel points. It changes neither current permit counts nor licensing geometry.
Rebuild after updating input snapshots:

    python audits/rebuild_permit_location_points.py

Cross-check primary map addresses and build the supplementary saved city details:

    python audits/check_saved_permit_details.py

All saved city address entries are displayed in permit cards, including secondary addresses and unit variants.

Run the rendered map/inventory checks with Python, Playwright and installed Edge:

    python audits/check_permit_connections.py

The check refreshes `permit_location_discrepancies.csv`. A connection is rejected when its distance exceeds 550 metres, regardless of the listing privacy radius.
This is a review threshold, not a legal or licensing finding. Exact number matches with conflicting locations retain a popup explanation, but no line longer than 550 metres is drawn. The available
snapshot cannot establish whether a remaining mismatch comes from listing text,
listing coordinates, or the underlying city record.

Restore missing display boundaries by exact KIVAPIN from the official KCMO parcel service:

    python audits/rebuild_missing_permit_polygons.py

This creates `data/permit_property_parcels.geojson`. It supplements display geometry only.
Denied and other non-current records use gray highlights, expired yellow, revoked/suspended red, and current green.
The 550 m cap applies to all connection layers, including candidate previews.

Name matching data is generated from the supplied nicknames-master CSV:

    python audits/rebuild_name_matching_data.py

Assigned To staff names are excluded. Owner/host nickname evidence is provisional.
Full-number lines without competing matches are green. Abbreviated-number, nickname,
and parcel-candidate lines are yellow with a question mark. When both number and
nickname evidence apply, each gets a separate line; the nickname line is offset.
Parcel fallback runs only with zero permit matches. The sidebar radius starts at
160 m and tops out at 550 m, using the saved parcel coverage (not a citywide owner census).
Address-based recovery of missing parcel IDs retains source_parcel and match_basis;
it does not establish that an old parcel ID and a current parcel ID are identical.

Owner/name fallback shows at most five candidates under 550 m, with candidates inside the Airbnb privacy radius first and distance as the tie-breaker. The adjustable 160–550 m slider limits distance-only results; name/nickname candidates are searched up to 550 m. Parcel-owner nickname cards show parcel details before any permit history.

A permit number at an unusable or more-than-550-m location does not suppress parcel-owner fallback. The map preserves that number match as conflicting evidence and checks city parcel owners nearby through the official KCMO service (read-only; cached per location for the session). Name candidates remain provisional; lookup failures retain the available saved candidates.
