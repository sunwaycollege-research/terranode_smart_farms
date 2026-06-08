# Building This Documentation

This site is **Sphinx** (the umbrella) + **Doxygen** (firmware C++ API reference) bridged by
**Breathe**. Everything lives under `docs/`.

## 1. Toolchain

```{list-table}
:header-rows: 1
:widths: 26 74

* - Tool
  - Role
* - **Sphinx** + MyST
  - Builds the HTML site from the Markdown/rST under `docs/`. Theme: Furo.
* - **Doxygen**
  - Parses the firmware `.ino` (C++) → XML + standalone HTML.
* - **Breathe**
  - Pulls the Doxygen XML into the Sphinx "Firmware API Reference" page.
* - **sphinxcontrib‑mermaid**
  - Renders the Mermaid diagrams (client‑side; no Node needed).
* - **sphinx‑design / copybutton**
  - Cards/grids + copy buttons.
```

## 2. Install

```bash
python3 -m pip install -r docs/requirements.txt     # sphinx, myst, breathe, furo, design, mermaid
conda install -c conda-forge doxygen                # or: apt-get install doxygen
```

## 3. Build

```bash
bash docs/build.sh           # doxygen → XML/HTML, then sphinx → docs/_build/html
# or:
cd docs && make all          # same; `make serve` builds + serves on :8000
```

Open `docs/_build/html/index.html`. A standalone firmware reference is also at
`docs/doxygen/html/index.html`.

```{mermaid}
flowchart LR
  INO["firmware *.ino"] --> DOX["doxygen"] --> XML["doxygen/xml"]
  XML --> BR["breathe"]
  MD["docs/*.md + *.rst"] --> SPX["sphinx-build"]
  BR --> SPX --> OUT["_build/html"]
```

## 4. Layout

```
docs/
  conf.py · index.md · requirements.txt · Makefile · make.bat · build.sh
  _static/teranode.css · _templates/
  doxygen/Doxyfile            # (xml/ + html/ are generated, gitignored)
  architecture/  components/  reference/  operations/
  (existing strategy/product .md reused in the toctree)
```

## 5. Authoring conventions

- **Markdown (MyST)** for prose pages; **reStructuredText** only where Breathe directives are
  needed (`reference/firmware-api.rst`).
- **Diagrams** as Mermaid fenced blocks (` ```{mermaid} `).
- **Cross‑links** with `{doc}` roles (e.g. `` {doc}`../components/api` ``).
- **Source‑link** every contract page back to the canonical code file so the docs stay honest.
- New pages must be added to a `toctree` in `index.md` (Sphinx warns about orphan pages).

## 6. Regenerating after code changes

- Changed firmware comments? Re‑run `doxygen docs/doxygen/Doxyfile` (or `make all`) — the
  Firmware API page updates.
- Changed a contract (MQTT/REST/schema/catalog)? Update the matching page under `reference/`.
- CI option (out of scope here): run `docs/build.sh` and publish `docs/_build/html` to GitHub
  Pages or Read the Docs.
```
