# Sphinx configuration for the TERANODE documentation site.
#
# Build:  doxygen docs/doxygen/Doxyfile      # firmware C++ -> XML (for Breathe)
#         sphinx-build -b html docs docs/_build/html
# (or just: bash docs/build.sh)

import os

# -- Project information ------------------------------------------------------
project = "TERANODE"
copyright = "2026, TERANODE Engineering"
author = "TERANODE Engineering"
release = "1.0"
version = "1.0"

# -- General configuration ---------------------------------------------------
extensions = [
    "myst_parser",            # Markdown (MyST) authoring
    "breathe",                # Doxygen XML -> Sphinx (firmware API reference)
    "sphinx_design",          # cards, grids, tabs
    "sphinx_copybutton",      # copy button on code blocks
    "sphinxcontrib.mermaid",  # Mermaid diagrams
]

# MyST extensions used across the docs (admonitions, deflists, anchors, etc.).
myst_enable_extensions = [
    "colon_fence",
    "deflist",
    "attrs_block",
    "linkify",
    "substitution",
    "tasklist",
    "fieldlist",
]
myst_heading_anchors = 3
myst_fence_as_directive = ["mermaid"]

source_suffix = {".md": "markdown", ".rst": "restructuredtext"}

templates_path = ["_templates"]

# Everything under docs/ that is NOT part of the rendered site.
exclude_patterns = [
    "_build",
    "_templates",
    "doxygen",        # generated firmware HTML/XML
    "diagrams",       # raw SVG exports (referenced as images, not built as pages)
    "assets",         # PDFs / photos (referenced as downloads)
    "requirements.txt",
    "build.sh",
    "Makefile",
    "make.bat",
    "Thumbs.db",
    ".DS_Store",
]

# -- Breathe (Doxygen bridge) ------------------------------------------------
breathe_projects = {"firmware": os.path.join(os.path.dirname(__file__), "doxygen", "xml")}
breathe_default_project = "firmware"
# Treat Arduino .ino files as C++ so Doxygen/Breathe parse them correctly.
breathe_domain_by_extension = {"ino": "cpp", "h": "cpp", "hpp": "cpp", "cpp": "cpp"}
breathe_default_members = ("members",)

# ESP32 attribute macros the C/C++ domain parser must accept (e.g. `void IRAM_ATTR fn()`).
cpp_id_attributes = ["IRAM_ATTR", "ICACHE_RAM_ATTR"]
c_id_attributes = ["IRAM_ATTR", "ICACHE_RAM_ATTR"]

# -- HTML output -------------------------------------------------------------
html_theme = "furo"
html_title = "TERANODE Engineering Docs"
html_static_path = ["_static"]
html_css_files = ["teranode.css"]
html_show_sourcelink = False
html_theme_options = {
    "sidebar_hide_name": False,
    "navigation_with_keys": True,
    "light_css_variables": {
        "color-brand-primary": "#2f6b46",
        "color-brand-content": "#2f6b46",
    },
    "dark_css_variables": {
        "color-brand-primary": "#5fae7e",
        "color-brand-content": "#7fc99a",
    },
}

# Mermaid: render in the browser (no mmdc binary required).
mermaid_version = "10.9.1"
mermaid_init_js = "mermaid.initialize({startOnLoad:true, theme:'neutral'});"

# Tidy up. `myst.xref_missing` + `misc.highlighting_failure` come only from the
# REUSED legacy strategy docs (relative links to files outside the doc set, and a
# couple of code fences with non-lexable tokens) — cosmetic, so we silence them
# here rather than rewrite that content. The authored pages use `{doc}` roles.
suppress_warnings = ["myst.header", "myst.xref_missing", "misc.highlighting_failure"]
