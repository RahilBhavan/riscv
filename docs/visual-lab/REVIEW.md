# Verification receipt

Checked 2026-10-18 against RTL SHA-256 `cf82d634602b581589efd80a7172ec384885a25fd4d5faf449ad407cff213757`.

- Old RTL fails the pending-store reset test; fixed RTL passes pending store/load suppression, state clearing and restart.
- Icarus and Verilator differential programs pass with all byte writes checked. Sixteen supplemental teaching checks pass.
- Lint passes. Core Verilator line instrumentation has no exclusions. Reset bench and visual model sweeps are separate evidence, not part of that percentage.
- HX8K CT256 route meets the 12 MHz constraint. No board run.
- The counts and estimates behind these checks are not repeated here. The lab reads them from `reports/*.json` when it is built, and the README lists the current values.
- Six exported RTL executions independently match retirement and stores before traces are written. Report hashes agree with the current source; the visual builder rejects stale/mixed core hashes.
- JavaScript: all 256 bytes, known encodings, DOT4 extrema and 262,144 isolated lane pairs, plus mismatch/missing-record detection pass. These checks cover teaching models.
- Collaborative browser: all eight views exercised at desktop and 390px width with no horizontal page overflow. Both figure themes work. Signed input errors, maximum DOT4, decode switch, byte capture, injected mismatch and experiment selection were exercised. Keyboard Enter activates capture; hover treatment and focus are visible. Cycle playback reaches the final frame and stops.
- Geometry: desktop screenshots of all eight mechanisms and a mobile research view inspected. Sixteen 4× deterministic geometry exports generated; light/dark joint contact sheets inspected. A mounting deck was added to support the inserts at their common z=4 seat. Line-end checker reports zero problems in all eight views (zero authored free lines). Round-part/pipe audit does not apply: all parts are beveled slab solids. This is visual inspection, not a mechanical-clearance proof.
- Inline preview rendered at 728px and 390px without console errors. Eight HTML/PDF textbook link pairs exist.

Remaining limits at the time of this review: no physical FPGA, formal proof, external ISA certification, exhaustive RTL DOT4 sweep, workload speedup, or power measurement. Since then the project has added a Spike comparison, an RTL DOT4 sweep, a DOT4 benchmark and an untested board image (see the README). A physical board run, formal proof, ISA certification and power measurement are still missing. Native phone hardware and assistive-technology usability have not been tested.
