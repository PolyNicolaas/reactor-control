#!/usr/bin/env bash
# Download the device manuals into docs/manuals/<device>/ and check their checksums.
# The PDFs are not committed (copyrighted, public repo); run this after cloning.
set -euo pipefail
cd "$(dirname "$0")/../docs/manuals"

fetch() {
  local dir="$1" file="$2" url="$3" sha="$4"
  local dest="$dir/$file"
  if [[ -f "$dest" ]] && echo "$sha  $dest" | sha256sum -c --status; then
    echo "ok        $dest"
    return
  fi
  echo "download  $dest"
  curl -fsSL "$url" -o "$dest.part"
  if echo "$sha  $dest.part" | sha256sum -c --status; then
    mv "$dest.part" "$dest"
  else
    mv "$dest.part" "$dest"
    echo "WARNING   $dest has a different checksum: the source may have a newer edition. Check page references in notes.md." >&2
  fi
}

fetch eurostar-60-control \
  EUROSTAR_60-100_control_operating_instructions_20000003965c.pdf \
  "https://cdn.abicart.com/shop/ws72/72372/art14/156950114-5574d5-20000003965c_EN_EUROSTAR_60_100_control_032018_web.pdf" \
  92d67aad98e480845f60ca9dcd26f13192530eb1bea18d26cc4e1b8cc4862d2d

fetch ret-control-visc \
  RET_control-visc_operating_instructions_20000004159.pdf \
  "https://assets.wolflabs.co.uk/AssetsStore/IKA_hotplates_RET-Control-Visc_manual.pdf" \
  1e1606aeb1921599d8b60672cba583c1bbe40f58ca44b63fa7744ff9d177219b

fetch reglo-icc \
  Reglo_ICC_operating_manual_14-036-E_revC.pdf \
  "https://github.com/numat/ismatec/raw/master/doc/14-036-e-ismatec-reglo-icc-english-revc.pdf" \
  c54f492a7ffee366d98f4f8d3d25b989614ecc51ad89e59a1d207420d5719536
