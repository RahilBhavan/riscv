#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
node scripts/textbook/build.mjs
mkdir -p build/textbook
browser_bin=${CHROMIUM_BIN:-chromium}
for edition in riscv-textbook riscv-review-slides; do
    "$browser_bin" --headless --no-sandbox --disable-gpu \
        --no-pdf-header-footer --run-all-compositor-stages-before-draw \
        --virtual-time-budget=2000 \
        --print-to-pdf="$PWD/output/textbook/$edition.pdf" \
        "file://$PWD/output/textbook/$edition.html" \
        > "build/textbook/$edition-export.log" 2>&1
done
