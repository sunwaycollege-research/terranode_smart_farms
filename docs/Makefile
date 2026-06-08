# TERANODE docs — Sphinx + Doxygen.
# Targets: make html | make doxygen | make all | make clean | make serve

SPHINXBUILD ?= python3 -m sphinx
SOURCEDIR    = .
BUILDDIR     = _build

.PHONY: all html doxygen clean serve help

all: doxygen html ## Build firmware API ref + the HTML site

doxygen: ## Generate firmware C++ XML/HTML (Breathe input)
	doxygen doxygen/Doxyfile

html: doxygen ## Build the Sphinx HTML site (+ bundle the Doxygen reference)
	$(SPHINXBUILD) -b html "$(SOURCEDIR)" "$(BUILDDIR)/html"
	@[ -d doxygen/html ] && rm -rf "$(BUILDDIR)/html/_doxygen" && cp -r doxygen/html "$(BUILDDIR)/html/_doxygen" || true

clean: ## Remove generated output
	rm -rf "$(BUILDDIR)" doxygen/html doxygen/xml

serve: html ## Build then serve locally on :8000
	cd "$(BUILDDIR)/html" && python3 -m http.server 8000

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN{FS=":.*?## "}{printf "  %-10s %s\n", $$1, $$2}'
