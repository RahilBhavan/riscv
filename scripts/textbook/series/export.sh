#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
node scripts/textbook/series/build.mjs
browser_bin=${CHROMIUM_BIN:-chromium}
for edition in output/textbook/series/0*.html; do
    "$browser_bin" --headless --no-sandbox --disable-gpu \
        --no-pdf-header-footer --run-all-compositor-stages-before-draw \
        --virtual-time-budget=1500 \
        --print-to-pdf="$PWD/${edition%.html}.pdf" \
        "file://$PWD/$edition" \
        > "build/textbook/series/$(basename "$edition" .html)-export.log" 2>&1
done
python3 - <<'PY'
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path('output/textbook/series')
with ZipFile('output/textbook/riscv-build-textbooks.zip','w',compression=ZIP_DEFLATED) as archive:
    for p in sorted(root.iterdir()):
        if p.suffix in ('.pdf','.html','.json'):
            if p.name == 'index.html':
                html = p.read_text().replace('<a href="../riscv-build-textbooks.zip">Download all eight books</a>', '<span>Offline collection</span>')
                archive.writestr('series/index.html',html)
            else:
                archive.write(p,arcname='series/'+p.name)
    archive.write('output/textbook/riscv-textbook.html',arcname='riscv-textbook.html')
    archive.writestr('START-HERE.txt','Open series/index.html to read the eight textbooks. The overview is included as a companion. Run teaching labs inside a clone of the RISC-V repository, using the instructions in the books. The book series has 114 pages; the companion overview is separate.\n')
    for source,dest in [
        ('docs/textbook/fonts/Anton-LICENSE.txt','Anton-OFL.txt'),
        ('docs/textbook/fonts/LICENSE.txt','LearningSans-OFL.txt'),
        ('scripts/textbook/vendor/LICENSE','Anatomy-MIT.txt'),
        ('LICENSE','project-MIT.txt'),
        ('scripts/textbook/ATTRIBUTION.md','ATTRIBUTION.md'),
    ]:
        archive.write(source,arcname='licenses/'+dest)
print('Created output/textbook/riscv-build-textbooks.zip')
PY
