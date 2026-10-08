# Residential neighborhood impact — Kansas City

Ready-to-host static site. Main page: `index.html`. All saved listing, permit, parcel, boundary, outline-tile and street data is included.

## Publish on GitHub Pages
Upload this folder's **contents** into your repository root, retaining all subfolders (including `data` and `vendor`) and `.nojekyll`. Enable Settings → Pages → Deploy from a branch → main → /(root). No build step or Git LFS is needed. For about 1,000 files, a Git push is easier than repeated browser uploads; browser uploads accept at most 100 files per batch.

## Preview locally
Run `python -m http.server 8000` from this folder, then open http://localhost:8000. Serve through HTTP; double-clicking HTML does not support the data-fetching features.

## Included behavior
Neighborhoods, stronger outlines and translucent density shading are enabled by default. Areas are ranked by the entire-place Airbnb / residential GIS parcel ratio. Residential mix sliders select areas without altering the percentage math. Private/shared rooms and likely hotels are excluded from the Airbnb percentage; licensed plots and hotel comparison ratios are separate. Parcel counts are not dwelling-unit counts. At wide zoom, neighborhood percentage bubbles replace individual dots; at regional zoom, one overall bubble is shown. Other controls remain under Advanced filters.

## External services
Application scripts, MapLibre 3.6.0, basic Latin map-label glyphs and saved data are local. Internet is still needed for OpenStreetMap background tiles, optional live city parcel candidate lookups, and external listing/source/form links. This is a portable static-site bundle, not an offline background-map cache. No original checkout, server backend or API secret is required. Source snapshot dates remain in the data and site.

Third-party licenses are in `vendor`. `PACKAGE_MANIFEST.json` records file sizes and SHA-256 hashes. Every packaged file is smaller than GitHub's 25 MiB browser-upload limit, and therefore below its 100 MiB Git file limit.
