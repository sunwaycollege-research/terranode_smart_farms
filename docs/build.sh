#!/usr/bin/env bash
# Build the full TERANODE documentation site: firmware Doxygen XML/HTML, then the
# Sphinx HTML site (which embeds the firmware API reference via Breathe).
#
# Usage:  bash docs/build.sh
# Output: docs/_build/html/index.html
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

echo "==> [1/2] Doxygen (firmware C++ -> XML + HTML)"
doxygen doxygen/Doxyfile

echo "==> [2/2] Sphinx (HTML site)"
python3 -m sphinx -b html -q . _build/html

# Bundle the standalone Doxygen HTML into the site (the firmware API page links to it).
if [ -d doxygen/html ]; then
  rm -rf _build/html/_doxygen
  cp -r doxygen/html _build/html/_doxygen
fi

echo ""
echo "Done. Open: $HERE/_build/html/index.html"
