# Savannah Offline

This folder is an independent static site. `index.html` is its entry page.
Copy or upload the whole folder; no files from the parent workspace are needed.
Saved offline basemap, glyphs and sprites are included.

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
