# A Core You Can Explain

The textbook follows the current reference core and the October 17–18 learning sprint. It starts with binary values and clocked logic, then covers RV32I, the datapath, five stages, forwarding, load stalls, branch flushes, DOT4, verification, coverage and FPGA implementation evidence. It ends with labs, 16 worked answers and runnable test recipes.

- [Textbook PDF](../../output/textbook/riscv-textbook.pdf): 35 pages, A4.
- [Interactive textbook](../../output/textbook/riscv-textbook.html): self-contained HTML with a cycle stepper and signed DOT4 calculator. Download and open locally, or serve the repository.
- [Review slides PDF](../../output/textbook/riscv-review-slides.pdf): 14 slides, 16:9.
- [Review slides HTML](../../output/textbook/riscv-review-slides.html): editable source edition, readable in a browser.
- [Production and chapter plan](PLAN.md).
- [Chapter-mapped primary sources](SOURCES.md).

Today: pages 3–21, then the lab on page 28. Tomorrow: pages 22–29. Check the answer key after making predictions. Appendices A and B provide concrete Python test entries.

## Rebuild

Node.js and Chromium are required. Fonts and SVG geometry helpers are included in the repository. From the repository root:

```sh
make textbook
```

Set `CHROMIUM_BIN` if your Chromium executable has another name. HTML text and chapter data are authored in `scripts/textbook/content.mjs`; diagrams are in `figures.mjs`; layouts and interactions are in `build.mjs`. `export.sh` generates both PDFs. No Python packages are needed to rebuild. PDF generation is a deterministic browser export, separate from live browser inspection.

To read through a local server:

```sh
python3 -m http.server 8876
```

Open `http://localhost:8876/output/textbook/riscv-textbook.html`.

The reference metrics remain 144 programs, 7,358 retirements, 37/38 line instrumentation points and a 34.74 MHz internal post-route estimate. The new recipe tests are teaching additions, not part of those baseline counts. No physical board run or workload speedup is implied. The current implementation and teaching material were created with assistant support.

Design follows Rahil's personal charcoal/white/yellow system, Anton display and IBM Plex Sans body. The print textbook uses a light reading surface to reduce ink. Font licenses and geometry attribution are included. The review deck is HTML/PDF, not a claimed PowerPoint export.
