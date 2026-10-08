# Residential Neighborhood Impact

This folder is an independent static site. `index.html` is its entry page.
Copy or upload the whole folder; no files from the parent workspace are needed.
Application scripts, styles, glyphs and saved datasets are local. OpenStreetMap basemap tiles still require internet access.

Run `python -m http.server 8000` from this folder, then open
http://localhost:8000/index.html . HTTP serving is required; avoid file URLs.
GitHub Pages can host these files directly. `.nojekyll` is included.

Files are below 25 MiB. Large JSON datasets are stored as gzip files;
`compressed_assets.js` and `asset_loader.js` transparently serve their original
JSON URLs to application code. No build step or Git LFS is required.
Use a modern browser supporting DecompressionStream (current Edge/Chrome/Firefox).

Saved records, licensing caveats and page defaults are preserved.
This is a preserved snapshot of the original viewer/version.

`package_manifest.json` records source-file hashes and compressed paths;
`package_validation.json` records size and dependency validation.
Rebuild code: `audits/package_standalone_pages.py` in the source workspace.

Neighborhood percentages use all GIS plots. Every neighborhood at or below the adjustable percentage ceiling is shown; the ceiling defaults to 10%. Regular listing filters are retired. Park Central: 12/135 = 8.89%. Overall: 833/203517 = 0.409%, shown as 0.4% on the city dot. Confirmed licensed parcels are dark green and pulsing; Airbnb points are tiny.

Neighborhood names are shown; the city-wide dot replaces neighborhood dots below zoom 9.5. ZIP outlines use 166 full City GIS polygons without the city-edge clipping. ZIP overlays are geographic context; outside-city licensing, listings and tax compliance are not assessed.

Percentage dots are precalculated in data/percentage_snapshot.json; zooming never recalculates ratios. Neighborhood names and percentage text use percentage_overlay.js with system fonts, independent of map font downloads and collision hiding. Saved parcel lookups use local tiles only. The decorative street basemap still uses OSM tiles, but percentages, names and plots work if external requests are blocked.
Rebuild the percentage snapshot with audits/build_percentage_snapshot.py from the source workspace after refreshing local inputs; then repackage.
