# Worst Case Map

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
The main map includes all saved permits by default. The current worst-case page excludes other saved permits by default; its checkbox is in Advanced filters.

`package_manifest.json` records source-file hashes and compressed paths;
`package_validation.json` records size and dependency validation.
Rebuild code: `audits/package_standalone_pages.py` in the source workspace.
