# RISC-V visual lab build plan

The outcome is a reproducible RV32I + DOT4 learning project: real RTL, an independent checker, eight textbooks, and eight interactive Anatomy views. Open-source synthesis is the implementation target. A board image exists for the iCE40-HX8K Breakout; running it on hardware remains a separate task.

## Build sequence and completion gates

1. **Truth and contracts.** Inspect the implemented memory, pipeline, reset and instruction contracts. Preserve explicit limits: combinational Harvard memory, local halt-on-trap, no privileged architecture. Gate: every visual labels its illustrative model or recorded RTL evidence.
2. **Reset hardening.** Suppress external memory requests during reset. Exercise reset with a pending store and a pending load, restart, and check architectural state. Gate: a regression fails against the old RTL and passes the fix.
3. **Recorded execution.** Export cycle snapshots from the actual RTL, run the same words through the Python oracle, compare retirement and byte stores, and hash the sources. Gate: visual traces cannot be regenerated from a failing execution.
4. **Eight mechanisms.** Build a shared bench with interchangeable inserts: bit switches, instruction card reader, five-station conveyor, interlocked conveyor, four-lane product press, twin comparator tracks, device socket bed, and experiment filing rack. Gate: each view has an action, a live result, source/test links, and a textbook.
5. **Evidence refresh.** Run the differential suite, teaching labs, reset checks, lint, core line coverage and HX8K synthesis/place-and-route. Gate: current RTL hashes agree across reports; claim no board execution.
6. **Visual review.** Exercise all eight views, boundaries, reset, keyboard controls, light/dark, reduced motion, desktop and 390px mobile. Inspect detailed geometry and run the line-end check. Gate: no horizontal overflow or broken lesson controls.
7. **Release.** Commit the generator, self-contained lab, recorded data, reports and guide; push to the existing GitHub repository. Gate: a reader can reproduce evidence with documented commands.

## Anatomy concept and inventory (before geometry)

One teaching bench receives eight different instrument inserts. A switch, moving instruction carrier, comparator pin or selected file is the subject; its state means exactly the number described outside the drawing. Mechanisms are physical analogies, not literal transistor layouts. The pipeline and hazard occupancy comes from captured RTL cycles.

Shared base: 1 beveled plate, 4 feet, 4 foot pads, 4 corner fasteners, 2 mounting rails, 4 rail stops, 8 stop fasteners, 2 instrument mounting bars, 4 mount fasteners, 1 front control strip, 8 inset keys (42 pieces).

Insert inventory: up to 8 switch sockets and 8 sliding caps; card reader has 6 field guides, 6 field inserts and 12 retaining clips; conveyor has 5 press beds, 10 posts, 5 crossheads, 5 actuator blocks, 5 carriers and 20 clamps; DOT4 has 4 press beds, 8 guide posts, 4 crossheads, 4 product carriers and 16 clamps; comparator has 2 parallel rails, 8 sample mounts, 8 sample caps and 4 comparator contacts; FPGA has a socket frame, 16 socket contacts, 16 logic package bodies and 16 tops; research rack has 8 divider feet, 8 dividers, 8 file bodies and 8 tabs. All sit on the bench or their own mount. No unsupported cables, tubes or round parts.

## Learning and research workflow

For each numbered textbook: predict an outcome on paper, change one input in its visual, run the linked lab, then inspect the RTL and raw log. Keep prediction, observed result and explanation in an experiment note. A passing example is evidence for that example; it does not certify the ISA.

For an extension: state a falsifiable question, choose a baseline, vary one factor, record source hashes/tool versions/seed/constraints, rerun correctness, and report the scope of the result. The reference has since added an external ISA comparison against Spike, hazard cross coverage, a scalar RV32I software-multiply comparison and a falling-edge block-RAM board image. Next: a physical board run, formal checks and ACT4. Keep board frequency and energy claims pending real measurements.

## Two-day route

Day 1: volumes 1–4; run the two standalone teaching benches, follow decode, step independent instructions, then explain forwarding and the load-use bubble. Day 2: volumes 5–8; check signed DOT4, inspect differential traces and coverage, reproduce synthesis, and write one evidence-backed experiment note. Reading/build times depend on prior RTL knowledge; this schedule is a focused learning route, not an expertise guarantee.
