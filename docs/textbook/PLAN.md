# Textbook production plan

Reader: Rahil, learning the reference core during the October 17–18 sprint.

Outcome: predict instruction results and pipeline behavior, add meaningful tests, and interpret coverage and FPGA implementation evidence.

Design: rahil-design charcoal/white/yellow, Anton and IBM Plex Sans. Static reading, light mechanism figures, an Anatomy conveyor model, directly labeled tables and SVG instructional diagrams. Print edition uses the same fonts on a light reading surface.

Deliverables: 35-page textbook PDF, self-contained interactive HTML, 14-slide review deck in HTML and PDF, reproducible source.

## Chapter map

1. A CORE YOU CAN EXPLAIN (BUILD NOTES / COMPUTER ARCHITECTURE)
2. Two days, one coherent project (READING ROUTE)
3. A bit pattern needs an interpretation (01 / REPRESENTATION)
4. Signed arithmetic reuses the same bits (01 / REPRESENTATION)
5. A clock edge separates old state from new state (02 / DIGITAL HARDWARE)
6. RTL describes concurrent hardware (02 / DIGITAL HARDWARE)
7. The ISA defines visible behavior (03 / THE INSTRUCTION CONTRACT)
8. An instruction word names operands and work (03 / THE INSTRUCTION CONTRACT)
9. One instruction moves through a datapath (04 / THE DATAPATH)
10. Addresses count bytes (04 / THE DATAPATH)
11. Different instructions share the machine over time (05 / FIVE STAGES)
12. The pipeline as an indexed conveyor (05 / FIVE STAGES)
13. A younger instruction can need an unfinished result (06 / DEPENDENCIES)
14. Forwarding selects the newest available value (06 / DEPENDENCIES)
15. Writeback and decode can meet on one edge (06 / DEPENDENCIES)
16. A load address is not the loaded value (07 / THE LOAD-USE STALL)
17. One bubble preserves the instruction order (07 / THE LOAD-USE STALL)
18. A taken branch discards two younger stages (08 / CONTROL FLOW)
19. A trap halts this execution environment (08 / CONTROL FLOW)
20. DOT4 multiplies four signed byte pairs (09 / CUSTOM COMPUTE)
21. Lane interpretation changes the answer (09 / CUSTOM COMPUTE)
22. The RTL has four useful reading passes (10 / READING THE ACTUAL CORE)
23. A reference model predicts architectural results (11 / VERIFICATION)
24. Tests should target a reason the core could fail (11 / VERIFICATION)
25. A percentage needs a denominator (11 / VERIFICATION)
26. Synthesis maps logic, routing estimates timing (12 / IMPLEMENTATION EVIDENCE)
27. Clock frequency is only one part of performance (12 / IMPLEMENTATION EVIDENCE)
28. A passing program you can explain (13 / TODAY’S LAB)
29. A reproducible result with a clear scope (13 / TOMORROW’S LAB)
30. Representation and timing (14 / WORKED ANSWERS)
31. Hazards, arithmetic and evidence (14 / WORKED ANSWERS)
32. Words to use precisely (REFERENCE)
33. Read the source behind the explanation (SOURCES & NEXT STEPS)
34. A short program becomes a regression (APPENDIX A / A RUNNABLE TEST)
35. The skipped store must never write (APPENDIX B / A RUNNABLE TEST)

## Quality gates

- Verify arithmetic, encodings, actual-RTL timelines and measurement scope.
- Check desktop/mobile, keyboard controls and reduced motion.
- Render every PDF page and review slide; repair overflow and missing glyphs.
- Keep source provenance, illustrative values and personal work distinct.

## Follow-up topics

Formal/ACT4 integration, complete hazard crosses, mid-flight reset assertions, scalar/DOT4 workload comparison, area ablation and synchronous-memory board integration remain outside this two-day teaching scope.
