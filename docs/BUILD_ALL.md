# Build the whole project

Run `make all` from the repository root. This runs the real RTL tools, checks the teaching examples, regenerates the learning artifacts, verifies their contents, and packages a complete offline source release. It does not program a physical FPGA.

## Requirements

- Docker with a running daemon and permission to run containers.
- Node.js 22 or newer, Python 3, GNU Make and `flock`.
- Chromium available as `chromium`, or set `CHROMIUM_BIN` to its executable.
- Poppler tools `pdfinfo` and `pdftotext` for document checks.

The existing Dockerfile pins the Linux distribution to Ubuntu 24.04 and installs Icarus, Verilator, Yosys and nextpnr-ice40. These packages come from that distribution's repositories; tool versions are recorded in the evidence. No RISC-V cross-compiler is needed for the encoded regression programs.

```sh
git clone https://github.com/RahilBhavan/riscv.git
cd riscv
make all
```

The default `make` command also runs the full build. For individual tasks, use the named targets in `Makefile`. The image build uses Docker's cache. RTL tasks run inside Docker as your user so generated files remain writable. Node, Chromium and Poppler run on the host. No additional JavaScript or Python package installation is required for the full build.

## Build order

1. Check required tools and acquire an exclusive full-build lock.
2. Build the RTL tool image.
3. Run Icarus differential tests, both standalone teaching benches, 14 teaching core programs, pending-memory reset tests, lint, Verilator differential tests and core line coverage.
4. Synthesize and place/route the registered HX8K measurement shell; archive raw results and export six oracle-checked cycle traces.
5. Generate the 35-page overview, 14-slide review, eight textbooks, textbook archive, JavaScript model checks and eight-part Anatomy lab.
6. Verify source hashes, correctness reports, the timing constraint, all ten PDF page counts and readable pages, matching archive members, HTML companions and local navigation links.
7. Write the release report, start page and complete ZIP.

Each phase stops on failure. Logs are `build/project/tools.log`, `rtl.log`, `learning.log` and `release.log`. `build/project/SUCCESS` is written only after every phase passes and is removed before a rebuild begins. Do not run other build targets concurrently with the full build; the full-build lock protects against another `make all` invocation.

## Outputs

- `output/START-HERE.html`: entry point for the whole project.
- `output/riscv-project.zip`: complete source, docs, reports, PDFs, slides, visual lab, scripts and licenses under a `riscv/` folder.
- `reports/release.json`: current source hash, artifact hashes, page counts and measured results.
- `output/textbook/`: overview, review slides, eight volumes and their archive.
- `output/visual-lab/`: self-contained interactive lessons and recorded RTL state.
- `build/`: simulator executables, test programs/logs, mapped netlist, route output and coverage data.

Extract the ZIP and open `riscv/output/START-HERE.html`. Keep the folder layout to use relative links. To avoid local browser restrictions, serve the extracted `riscv/` directory with `python3 -m http.server 8878` and open `http://localhost:8878/output/START-HERE.html`.

`make release-check` reruns the artifact checks against an existing complete build. PDF page/text checks establish structure; visual inspection is also needed after changing layout. Historical textbook examples retain the earlier 34.74 MHz baseline; the README, release report and visual lab contain current metrics. No board clock, power, workload speedup, privileged architecture or external ISA certification is claimed.
