# Verification receipt

Checked 2026-10-18 against RTL SHA-256 `cf82d634602b581589efd80a7172ec384885a25fd4d5faf449ad407cff213757`.

- Old RTL fails the pending-store reset test; fixed RTL passes pending store/load suppression, state clearing and restart.
- Icarus and Verilator: 144 differential programs, 7,358 retirement records; all byte writes checked. Sixteen supplemental teaching checks pass.
- Lint passes. Core Verilator line instrumentation: 37/38, 97.37%, no exclusions. Reset bench and visual model sweeps are separate evidence, not part of that percentage.
- HX8K CT256: 37.0768585 MHz internal post-route estimate at seed 1, 12 MHz constraint. 3,962 LUT4, 1,692 FF, 5,555 packed logic cells. No board run.
- Six exported RTL executions independently match retirement and stores before traces are written. Report hashes agree with the current source; the visual builder rejects stale/mixed core hashes.
- JavaScript: all 256 bytes, known encodings, DOT4 extrema and 262,144 isolated lane pairs, plus mismatch/missing-record detection pass. These checks cover teaching models.
- Collaborative browser: all eight views exercised at desktop and 390px width with no horizontal page overflow. Both figure themes work. Signed input errors, maximum DOT4, decode switch, byte capture, injected mismatch and experiment selection were exercised. Keyboard Enter activates capture; hover treatment and focus are visible. Cycle playback reaches the final frame and stops.
- Geometry: desktop screenshots of all eight mechanisms and a mobile research view inspected. Sixteen 4× deterministic geometry exports generated; light/dark joint contact sheets inspected. A mounting deck was added to support the inserts at their common z=4 seat. Line-end checker reports zero problems in all eight views (zero authored free lines). Round-part/pipe audit does not apply: all parts are beveled slab solids. This is visual inspection, not a mechanical-clearance proof.
- Inline preview rendered at 728px and 390px without console errors. Eight HTML/PDF textbook link pairs exist.

Remaining limits: no physical FPGA, formal proof, external ISA certification, exhaustive RTL DOT4 sweep, workload speedup, or power measurement. Existing PDFs are historical baseline editions. Native phone hardware and assistive-technology usability have not been tested.
