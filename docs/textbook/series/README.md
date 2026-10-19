# RISC-V build textbook series

Eight separate implementation textbooks, 114 pages total. The original 35-page overview remains a companion.

[Open the library](../../../output/textbook/series/index.html) · [Download all books](../../../output/textbook/riscv-build-textbooks.zip)

## 1. RTL FOUNDATIONS

Build a working environment, understand binary values and write a self-checking clocked RTL experiment.

14 pages. [PDF](../../../output/textbook/series/01-foundations.pdf) · [HTML](../../../output/textbook/series/01-foundations.html)

1. RTL FOUNDATIONS
2. What you will build
3. A bit pattern needs an interpretation
4. Signed arithmetic reuses the same bits
5. A clock edge separates old state from new state
6. RTL describes concurrent hardware
7. Step 1: establish a working baseline
8. Step 2: read widths and operators
9. Step 3: run a two-register experiment
10. Step 4: write synthesizable next-state logic
11. Debugging the first simulation
12. A research experiment for this part
13. Answers and completion check
14. Sources and next steps

## 2. THE RV32I DATAPATH

Implement instruction fields, immediates, arithmetic, control flow and byte-addressed memory behavior.

15 pages. [PDF](../../../output/textbook/series/02-rv32i-datapath.pdf) · [HTML](../../../output/textbook/series/02-rv32i-datapath.html)

1. THE RV32I DATAPATH
2. What you will build
3. The ISA defines visible behavior
4. An instruction word names operands and work
5. Addresses count bytes
6. Step 1: define the instruction contract
7. Step 2: extract fields and immediates
8. Build a minimal single-cycle baseline
9. Step 3: implement ALU operations
10. Step 4: implement branches and links
11. Step 5: implement memory lanes
12. Step 6: test legality and side effects
13. A research experiment for this part
14. Answers and completion check
15. Sources and next steps

## 3. BUILD THE PIPELINE

Plan stage boundaries, carry control with data, implement edge updates and inspect a correct pipeline trace.

14 pages. [PDF](../../../output/textbook/series/03-pipeline.pdf) · [HTML](../../../output/textbook/series/03-pipeline.html)

1. BUILD THE PIPELINE
2. What you will build
3. One instruction moves through a datapath
4. Different instructions share the machine over time
5. Step 1: assign work to stages
6. Step 2: list each pipeline payload
7. Step 3: implement the older-stage updates
8. Step 4: implement valid bits and reset
9. Step 5: capture the front end
10. Step 6: create an observable retirement record
11. Step 7: check fill, drain and lost instructions
12. A research experiment for this part
13. Answers and completion check
14. Sources and next steps

## 4. HAZARDS AND CONTROL

Implement operand forwarding, WB-to-ID bypass, load interlocks, redirects and halt/drain behavior.

15 pages. [PDF](../../../output/textbook/series/04-hazards.pdf) · [HTML](../../../output/textbook/series/04-hazards.html)

1. HAZARDS AND CONTROL
2. What you will build
3. Forwarding selects the newest available value
4. Writeback and decode can meet on one edge
5. A load address is not the loaded value
6. Step 1: wire both operand muxes
7. Step 2: handle the WB/ID coincidence
8. Step 3: identify a true load consumer
9. Step 4: insert one bubble without stopping the load
10. A taken branch discards two younger stages
11. Step 5: squash effects, then drain traps
12. Step 6: make a hazard test matrix
13. A research experiment for this part
14. Answers and completion check
15. Sources and next steps

## 5. BUILD DOT4

Implement a custom four-lane signed dot product and design a fair software/hardware comparison.

13 pages. [PDF](../../../output/textbook/series/05-dot4.pdf) · [HTML](../../../output/textbook/series/05-dot4.html)

1. BUILD DOT4
2. What you will build
3. DOT4 multiplies four signed byte pairs
4. Lane interpretation changes the answer
5. Step 1: freeze the arithmetic contract
6. Step 2: allocate an exact encoding
7. Step 3: preserve signedness and width in RTL
8. Step 4: write a separate scalar oracle
9. Step 5: exercise real pipeline consumers
10. Step 6: evaluate a fair comparison
11. A research experiment for this part
12. Answers and completion check
13. Sources and next steps

## 6. VERIFY THE CORE

Run differential tests, verify memory writes, add directed cases, preserve seeds and measure a named coverage metric.

15 pages. [PDF](../../../output/textbook/series/06-verification.pdf) · [HTML](../../../output/textbook/series/06-verification.html)

1. VERIFY THE CORE
2. What you will build
3. A reference model predicts architectural results
4. Tests should target a reason the core could fail
5. A percentage needs a denominator
6. Step 1: define the oracle state
7. Step 2: drive the actual RTL
8. Step 3: compare the first divergence
9. Step 4: add a named directed case
10. Step 5: use randomness reproducibly
11. Step 6: collect coverage with a declared scope
12. Step 7: strengthen the evidence
13. A research experiment for this part
14. Answers and completion check
15. Sources and next steps

## 7. SYNTHESIS AND FPGA

Run open-source implementation, interpret resources and critical paths, and design a synchronous-memory board adaptation.

14 pages. [PDF](../../../output/textbook/series/07-synthesis-fpga.pdf) · [HTML](../../../output/textbook/series/07-synthesis-fpga.html)

1. SYNTHESIS AND FPGA
2. What you will build
3. Synthesis maps logic, routing estimates timing
4. Clock frequency is only one part of performance
5. Step 1: define what is being measured
6. Step 2: run mapping and route
7. Step 3: read resource counts correctly
8. Step 4: trace the limiting timing path
9. Step 5: compare configurations fairly
10. Step 6: adapt to synchronous FPGA memory
11. Step 7: make a board demonstration observable
12. A research experiment for this part
13. Answers and completion check
14. Sources and next steps

## 8. RESEARCH AND RELEASE

Organize hypotheses, preserve evidence, reproduce reports, publish a clear repository and prepare a technical explanation.

14 pages. [PDF](../../../output/textbook/series/08-research-release.pdf) · [HTML](../../../output/textbook/series/08-research-release.html)

1. RESEARCH AND RELEASE
2. What you will build
3. Step 1: start with a question you can test
4. Step 2: spread research across the build
5. Step 3: make a complete experiment entry
6. Step 4: control the comparison
7. Step 5: reproduce from a clean clone
8. Step 6: write a README around reproducible claims
9. Step 7: publish the learning work
10. Step 8: prepare a technical explanation
11. Step 9: connect the artifact to research interests
12. A research experiment for this part
13. Answers and completion check
14. Sources and next steps

## Run the teaching labs

From the repository root, build the existing tools image and run:

```sh
docker build -t rv32-tools .
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" rv32-tools make learning-labs
```

The labs include a standalone two-register experiment, a single-cycle ADD/ADDI/LW/SW/EBREAK subset, and 14 small programs checked in the actual pipelined core. Results and traces stay under build/learning-series/. They are separate from the published baseline coverage counts.

Run one case with `python3 docs/textbook/series/labs/run_labs.py --case load_jalr` inside the tools container. Use `--list` to list cases.

## Rebuild the books

Node.js, Chromium and Python 3 are required. The committed overview HTML supplies the existing personal design CSS. Fonts and figures are local/self-contained. Run `make textbook-series`. No Python PDF library is needed to export.

The editable content is in scripts/textbook/series/content.mjs. The renderer is build.mjs and export is export.sh. Full technical readings are in ../SOURCES.md. Work on a learning branch, preserve raw experiment evidence and do not promote planned board or formal experiments into completed claims.
