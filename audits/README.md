Permit connection checks
=======================

Area boundaries and rental counts
---------------------------------

Run `python audits/build_area_boundaries.py` followed by
`python audits/build_gis_parcels.py` from the project root. Requires requests,
shapely and pyproj. Originals are preserved. The GIS builder captures every
object ID from the same city parcel service used by the map, validates each
raw chunk against those IDs, then deduplicates by original KIVAPIN.
`data/gis_parcels/raw/*.geojson.gz` retain original geometry and attributes;
`capture.json` retains the complete object ID inventory and capture date.
Re-running resumes saved chunks. To refresh the source, back up the entire
`data/gis_parcels` directory and start a new capture in a new directory.

City GIS supplies census neighborhoods, ZIP areas, 2021 council boundaries,
area plans and counties; Census TIGERweb ACS 2025 supplies census tracts.
Boundary display is clipped to the city plus 550 m. Missing city names remain
separate by source object ID, never merged into a fictitious neighborhood.

Airbnb counts deduplicate filtered listing IDs by approximate point location.
Licensed plots deduplicate exact parcel IDs referenced by current city permits;
full GIS geometry supplies their location. Plot counts follow analysis scope
independently of listing filters. Areas with both zero Airbnbs and zero licensed
plots are omitted from map, list and CSV. Missing geometry and ambiguous area
assignments are reported, never counted twice. Rebuild after changing listing,
permit or parcel inputs. No parcel proximity is evidence of an Airbnb address.

The denominator is an actual GIS residential parcel count. City land-use codes
1111,1112,1121-1126 identify residential parcels. Explicit vacant residential
(9500), common areas and other uses are excluded. Missing/conflicting land-use
codes remain unknown, and total/unknown plot counts are available in area
popups and CSV. Each unique original parcel contributes one count, assigned by
an internal point of its original polygon and the selected city-edge buffer.
Split-boundary assignments are geographic conventions, not fractional homes.
Single-family/townhouse plots are also counted separately. No unit-count field
exists in this city layer; multifamily parcels are never treated as one house.

The displayed ratio is filtered non-hotel entire-place listing IDs divided by
residential GIS parcels, multiplied by 100. It is a listing/plot ratio, not a
verified share of homes: multifamily plots may contain many dwelling units,
and listings may share a property. Zero/missing denominators are N/A; no Census
housing estimate is substituted. Percentages require the analysis-area limit
because the GIS capture does not cover arbitrary outside listing locations.
Legacy Census captures remain retained for provenance but are unused by the UI.

Each boundary type has independent activation, shading, opacity, labels,
search, sorting and CSV export. Multiple types can be combined; their totals
must not be added together. Fill alpha defaults to 0.12 (range 0-0.35). Black
area borders are 1.8 px at 85% opacity versus the city outline's 5 px.

`Search addresses & plots` searches the full GIS inventory, independently of
Airbnb filters, by address, parcel ID, APN, owner, land use, plat, lot, block
and legal description. The index loads only on first use in a Web Worker.
Selecting a result loads its original parcel boundary, highlights it, shows
GIS fields and exact-parcel STR permit history, and links to the city viewer.
It never assigns a nearby Airbnb to that address. Gzip readers check magic
bytes so static hosts that already decompress responses work as well.

Serve this folder on port 8765 and run
`python audits/check_area_stats_browser.py` to verify all six layers and counts;
`python audits/check_gis_parcel_browser.py` verifies address/parcel searches,
original geometry display, and denominator values from full GIS records.

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


Parcel outline tiles: run `python audits/build_parcel_outline_tiles.py` after refreshing the full city parcel raw capture. This creates geometry-only gzip tiles and a manifest in `data/gis_parcels/outlines/`. The map loads them only when outlines are enabled at zoom 14 or higher, limits viewport requests to 24 tiles with four simultaneous downloads, and retains up to 32 tiles in memory. Counts report parcels loaded in viewport tiles, including parcels just beyond the screen; they are not dwelling-unit totals.


Outside border parcels: `python audits/build_border_parcels.py` queries public county services for parcels intersecting the exterior 550 m KCMO band, retains original geometry and source fields, and prefixes IDs by county. Rebuild outline tiles afterward. These supplemental records support search and outlines only, not city denominator totals or license matching. See `data/border_parcels/report.json` for coverage gaps; Johnson requires a token, Platte uses Parkville coverage and Cass uses Belton coverage. `data/listing_address_associations.csv` records user-supplied listing/address associations and explicitly separates this evidence from independent verification.


Parcel numbers: outline tiles now carry the GIS address number and saved interior point; labels appear at zoom 17+ when enabled. Rebuild with `python audits/build_parcel_outline_tiles.py`. Privacy street clipboard: run `python audits/build_privacy_streets.py` after refreshing listing points/radii. This caches official city street centerlines and joins their side-specific place codes to Census city names, retaining segment ZIP attributes. The output is scoped to the actual reported radius, not the display fallback or leeway. Clipboard results are unique street/city/ZIP tuples, without house numbers, and use saved GIS coverage. Unknown city/ZIP fields are explicit. Zero or unknown radii do not produce guessed streets.


User-confirmed addresses: `python audits/build_user_address_overrides.py` resolves the four explicit CSV associations to original county parcels, writes `data/listing_address_overrides.json`, and retains GIS evidence in `audits/user_address_evidence/`. The website loads these corrections before matching: corrected pins use the parcel interior point without marker offsets, suppress name/distance candidates and privacy circles, and show the supplied address. Original listing data and Airbnb coordinates remain preserved. Boundary distances, grid cells, and area assignments follow corrected points. Existing scope controls still apply; all four current corrections are outside KCMO within 100 m. Street-copy results remain based on the original reported Airbnb circle, labeled accordingly.

Density exploration: `build_area_mix.py` rebuilds six-way GIS land-use mixes after the parcel index changes. `check_density_browser.py` checks slider membership, unchanged ratios, independent layers, Advanced filters and default mobile sidebar in visible Edge. Council metadata is a dated snapshot in `data/council_members.json`; district 6 at-large updated from official resolution 260832.

`build_residential_scenarios.py` regenerates the standalone `worst_case.html` page data under `data/residential_scenarios`. Twelve deterministic greedy maximal independent-set trials model 1,000-ft separation for hypothetical non-resident STRs on single-family/duplex parcels, preserving current resident and non-resident licensed plots. Geodesic spacing and maximality are validated. Alternative cap allocation uses floor(residential parcels / 20) per neighborhood, preserves existing licenses, and applies no spacing. These are parcel-point illustrations, not exact maximum capacity or legal eligibility. A coarse square clique cover is retained as a loose upper bound on additions, not displayed as an attainable scenario. Other zoning and building rules are not applied.

`check_stripes_and_scenario_parcels.py` verifies default unreliable-area hatching and its hide checkbox, reliability reasons, default parcel-only scenario rendering, optional dots and activation of all mixed/multifamily sections. Reliability flags use adjustable residential-mix thresholds and indicate limitations of parcels as a home-impact denominator, not arithmetic errors. Simulation visibility toggles do not change computed scenarios or totals.

`check_adjustable_scenarios.py` checks the permanent three-model results bar, red selected model button, adjustable 0–10% neighborhood cap (0.5-point increments), cap budgets, monotonic totals, mixed spacing subset, mobile results and current-cap CSV export. The mixed model retains a capped subset of the selected spacing pattern and does not re-pack freed spaces. The builder exports ranked cap candidates through 10% so runtime cap changes never fetch new GIS or recompute the spacing pack. All results use residential parcels as a home-impact proxy, not verified homes.

`check_scenario_top_controls.py` verifies clickable three-model result buttons, synchronized top/sidebar cap sliders, the default-off mixed-area checkbox, permanent city outline and city-fit control on desktop/mobile. `city_boundary.json` uses the original saved city boundary, independently of neighborhood filtering.

Separation slider rebuild order: `build_residential_scenarios.py`, then `build_spacing_scenarios.py`, then `build_scenario_outcomes.py`. Separation patterns span 400–1600 ft in 100-ft steps, with saved outcomes for 0–10% caps in 0.5-point steps (273 combinations). Every proposed pair and current non-resident blocker distance is validated geodesically by the pattern builder. Resident permits do not block, and existing-existing spacing is not treated as a new violation. Geometry is chunked below 8 MiB; sliders select saved results without recomputing the pack. `check_spacing_slider_and_scale.py` validates lookup outcomes, distance changes, cap-only independence, dark-red density shading, imperial scale, collapsible sidebar and responsive no-overlap layout.

Top controls distinguish Outcome density (computed citywide result) from Cap setting (input shown on each slider thumb). Mixed has synchronized distance and cap inputs. Sidebar starts collapsed as Scenario details; Show expands it below the measured dashboard.

### Parcel spacing measurement scenarios

After `build_residential_scenarios.py`, `build_spacing_scenarios.py`, and `build_scenario_outcomes.py`, run `build_measurement_scenarios.py`. It precomputes centroid and shortest parcel-border scenarios, each with all-current-license and nonresident-only blockers, for 400–1600 feet in 100-foot steps. Default is conservative border-to-border with all existing licensed parcels blocking additions. Existing licenses remain even when existing–existing spacing is smaller. EPSG:26915 distances include a 0.1% guard; all 52 patterns validate new–new and new–existing minimum distances. These feasible greedy examples are parcel proxies, not legal compliance or proven maximum capacity. Cap and mixed outcomes use 0–10% in 0.5-point steps.

`check_scenario_final_layout.py` verifies card order, slider-owned selection, stacked mixed sliders, initial city extent, and all measurement modes. `check_scenario_top_controls.py` checks desktop/mobile controls and permanent city outline.

Run `build_scenario_parcel_sizes.py` to refresh projected polygon areas and the residential size distribution. The default upper limit is the largest current residential licensed parcel, with its exact percentile preserved. Size filtering removes hypothetical additions from saved feasible patterns without re-packing and refills cap ranks among captured eligible cap candidates; therefore filtered results are feasible examples, not maximum capacity. Existing licenses and residential denominators stay unchanged. `check_scenario_size_controls.py` validates draggable number labels, filtered allocations and percentages, border defaults, and responsive layout. Redundant sidebar model controls are preserved in comments, with hidden state used by the top controls.

The scenario UI now defaults to the 98th parcel-size percentile. At a 100th-percentile size limit and 10% neighborhood cap, summed whole-parcel neighborhood limits are 15,373; CBD Downtown and Crown Center lack seven eligible candidates, producing 15,366 / 154,751 = 9.9295%. This is a neighborhood allocation cap, not a single citywide rounded limit.

Percentage cap controls range from 0.5% to 20% in 0.5-point increments, default 5%. Run `build_cap_extension.py` after the measurement and parcel-size builders to capture the complete eligible single-family/duplex cap candidate pool and chunked geometry. This allows size-filtered cap allocations to refill from all eligible candidates. `check_cap_range.py` validates limits, defaults and count/geometry agreement at 0.5%, 10%, and 20%. Existing licenses remain when above a reduced cap.


Confirmed current permits in the live preview
--------------------------------------------

The original `data/compasskc_str_permits.csv` and `data/permits.json` come from
CompassKC. The original scraper was recorded under `sites/29_kansas_city` in
the earlier D:\Airbnb workspace; this checkout contains its saved exports.

`capture_confirmed_permits.py` queries the city's Short Term Rental layer:
https://mapd.kcmo.org/kcgis/rest/services/DataLayers/MapServer/34
It validates the complete object ID inventory, retains raw GIS captures,
deduplicates by permit ID and number, excludes temporary/event permits, and
requires issued status, an issue date already reached and a future expiration.
Missing GIS records or expiration dates remain unconfirmed, never inferred invalid.
Exact GIS parcel IDs supply geometry; no proximity or address recovery is used.

Run `python audits/capture_confirmed_permits.py --as-of 2026-10-07` to capture
and build `data/confirmed_permits`. `--saved-capture` rebuilds from captured GIS
rows. Current-date builds use the actual capture time in America/Chicago;
other dates use midnight Central. Keep prior captures before a future refresh.

Main map and inventory page include all saved records by default. The checkbox
`Include other saved permits` selects all saved records when checked and only
portal-confirmed current regular records when unchecked. `worst_case.html`
defaults to unchecked and uses a separate, fully rebuilt scenario dataset.
Historical/expired temporary permits never become current scenario licenses.
The other saved scenario dataset and copied site versions remain unchanged.

To rebuild the confirmed scenario variant, set `STVR_SCENARIO_OUTPUT` to
`data/residential_scenarios_confirmed` and `STVR_SCENARIO_PERMITS` to
`data/confirmed_permits/permits.json`, then run these audit scripts in order:
`build_residential_scenarios.py`, `build_spacing_scenarios.py`,
`build_scenario_outcomes.py`, `build_measurement_scenarios.py`,
`build_scenario_parcel_sizes.py`, `build_cap_extension.py`.
Without these environment variables, the scripts retain their original paths.

Serve the project locally on port 8766 and run
`python audits/check_permit_inventory_defaults.py` for visible Edge validation.
