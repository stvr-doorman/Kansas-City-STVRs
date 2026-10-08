# Standalone page packages

Each subfolder is a complete independently hostable map/viewer. Supporting
records, About, Data & rules and Legislative tips pages remain with their map.
The worst-case folder opens the scenario page at index.html and includes a
local listing map for its return link. Original workspace files are untouched.

Upload the contents of one subfolder as its own GitHub Pages site, or host all
subfolders with this index. All package files are below 25 MiB. See
package_sizes.json and each folder's README and validation report.

Build script: ../audits/package_standalone_pages.py

To refresh without overwriting these packages, run
`python audits/package_standalone_pages.py --output standalone_pages_REFRESH`
from the original workspace, using a new folder name.
