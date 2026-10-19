# Interactive RISC-V visual lab

Open [the lab](../../output/visual-lab/index.html) in a browser. Its scripts, fonts and eight figures are embedded, so the lab itself works offline. Keep the repository folder layout to use its local textbook links. To serve it locally:

```sh
python3 -m http.server 8878 --bind 0.0.0.0
# Open http://localhost:8878/output/visual-lab/
```

Use the eight lesson buttons. Step cycles or play the captured trace, change signed lanes, inject a teaching mismatch, and inspect the measurement boundary. Native buttons, selects and sliders support keyboard input. Motion stops offscreen; reduced motion removes visual transitions. Captured trace state is historical data, not a browser RTL simulator.

## Reproduce

```sh
docker build -t rv32-tools .
docker run --rm -v "$PWD:/work" rv32-tools make test learning-labs reset-test lint coverage timing visual-evidence
make visual-models visual-lab  # Node.js on the host
```

The builder refuses mixed RTL hashes across verification, line coverage, timing and visual traces. The trace exporter independently compares retirement tuples and byte stores before writing any trace. `reports/visual-traces.json` records the phase convention and exact source hashes. `build/visual-lab/*.log` holds the raw executions.

The JavaScript tests exhaust all 256 byte representations and all 262,144 isolated signed lane pairs across four positions **in the teaching model**. That sweep checks the teaching calculator. The RTL has its own isolated-lane sweep (`make dot4-sweep`, `reports/dot4-sweep.json`), and the regression and teaching programs exercise packed DOT4 and pipeline dependencies.

The [build plan](BUILD_PLAN.md) records the mechanisms, acceptance gates and two-day learning route. The [eight textbooks](../textbook/series/README.md) provide the implementation instructions. The [experiment log](../EXPERIMENT_LOG.md) tracks measured results and open research questions. The lab's measured numbers come from `reports/*.json` through `scripts/textbook/metrics.mjs`.
