# Savannah / Chatham STR map — offline portfolio copy

Open **START_OFFLINE.cmd** on Windows. It starts a local-only server and opens the viewer in your browser. Leave its terminal open while using the map. Python 3 is required; no Python packages, internet connection, ArcGIS account or API key are required to view the saved map. This computer's existing Anaconda Python is supported automatically.

On another platform, run `python3 serve.py`. To use an existing static server, serve this folder and open `index.html`. Browsers restrict local file loading, so double-clicking `index.html` directly is not supported. Viewing the archive does not send data anywhere; its server binds only to 127.0.0.1.

## What was preserved

Original public viewer:
https://www.arcgis.com/apps/mapviewer/index.html?url=https://services5.arcgis.com/CEpuXecVrKGiDoOH/ArcGIS/rest/services/STR_Map_and_Parcel_WFL1/FeatureServer&source=sd

Feature-service item: `a763625ec8f64072a4c4d4a7e59c9739`, owned by `IA_akcantrell`. The source item title is **STR Map and Parcel_WFL1**. It covers Savannah / Chatham County, Georgia. Capture time is recorded in `data/manifest.json` in UTC.

| Source layer/table | Records |
|---|---:|
| STRStatusFinal3 | 462 |
| ParcelNeighborData | 36,777 |
| Current Neighbhood | 61 |
| All Neighborhood | 61 |
| CCPDResponseArea | 1 |
| FullRentalscapeDatav2_ExcelToTable | 488 |
| FullRentalscapeDat2 | 483 |
| FullRentalscapeDa_Statistics | 340 |
| Property_exemptions_ExcelToTable | 22,899 |
| STRSTatus092420262 | 462 |
| **Total** | **62,034** |

The complete public object-ID inventory was queried for every layer/table. Every batch was checked against the requested IDs; missing and duplicate records cause the capture to fail. Original API responses, full fields, layer metadata, item metadata, saved renderer definitions and popup definitions are retained in `data/`. WGS84 display geometry is converted from those original API responses and saved in compressed chunks; each is below 8 MiB before compression. Raw source queries used 100-ID batches because the service gateway rejected longer query URLs.

The offline viewer recreates the Map Viewer layout with source neighborhood colors and status symbols, layer visibility, transparency, configurable field coloring, source-field popups, search across saved records, paginated/sortable attribute tables, field and license-status filters, local bookmarks, charts, distance/area measurements and sketch export, CSV/GeoJSON exports, PNG map export and browser printing. Original status strings are preserved; no licensing conclusions are inferred by this reconstruction.

## Offline basemap

The source Esri vector basemap style `27e89eb03c1e4341a1d75e597f0291e6`, sprites, fonts and **4,888 vector tiles** are stored locally. Captured area: longitude -81.43 to -80.81, latitude 31.69 to 32.26. Saved zoom levels: 7–15. Higher zoom magnifies the available level-15 basemap; parcel and STR geometries retain their detail. Panning is restricted to the saved area. All URLs actually used by the renderer resolve locally. Layer properties and the About panel retain source links, which require internet only if you deliberately open them.

This is a faithful independent reconstruction, **not a byte-for-byte or fully feature-identical copy of Esri Map Viewer**. Esri cloud sign-in, editing, saving/sharing to ArcGIS, live address geocoding, additional remote layers/basemaps and the full ArcGIS analysis/authoring suite are not available offline. The original viewer's hillshade overlay is not included. Offline search matches attributes in the saved study-area data rather than arbitrary world addresses. The source's 399-layer basemap styling is retained, but rendering and UI details may differ between MapLibre and ArcGIS. Measurements are approximate, not a survey or legal compliance determination.

## Portfolio presentation

Use `screenshots/offline_viewer.png` for a preview and link this demo alongside the original public map. Identify your role as the STR data contributor, as you described, and identify the public map's authors separately; this reconstruction does not claim authorship of their ArcGIS application or cartography. The public service metadata itself does not contain a contributor credit for your listing dataset, so retain your original research/source files or correspondence as evidence of that contribution.

Suggested description, based on your stated contribution:

> Collected short-term-rental data used in a public Savannah/Chatham County GIS map. Preserved the published dataset in an offline interactive portfolio demo containing 462 STR locations and 36,777 parcels, with property search, filters, tables and exports.

## Refreshing the archive

Viewing requires only Python's standard library for the local server. Refreshing requires internet, `requests` and `shapely`:

```
python scripts/capture_service.py
python scripts/capture_basemap.py
```

Source batches and basemap assets are cached for resumability. To capture a fresh source snapshot rather than resume the existing one, use a separate copy of this folder with an empty `data/` directory; preserve this snapshot. Scripts do not edit the remote service. `scripts/validate_archive.py` validates saved counts, IDs, geometry types, asset completeness, and GitHub's 100 MiB per-file limit without internet.

A test with every non-local network request blocked verified layer controls, popups, search, filters (including zero matches), tables, local bookmarks, charts, measurement, CSV/GeoJSON/PNG exports and desktop/mobile layouts. Details are in `validation.json`.

## Credits and source rights

Public data and map: Savannah Area GIS; Chatham County Board of Assessors; Chatham 911 Communication Services; the public ArcGIS service's publisher. Basemap: Esri and its contributors, as credited in the preserved style/service metadata. MapLibre GL JS 3.6.0: BSD-3-Clause, see `vendor/MAPLIBRE-LICENSE.txt`. Noto fonts: see `vendor/NOTO-LICENSE.txt`. The basemap service reported `exportTilesAllowed: true` with a 10,000-tile export limit; the saved capture is below that limit. Source data and basemap retain their respective rights and terms; this archive does not grant ownership of them.

Optional browser verification: `python scripts/test_offline_viewer.py` requires Playwright and an installed Edge browser. The test starts its own local server and blocks external requests. These dependencies are not needed to use the viewer.
