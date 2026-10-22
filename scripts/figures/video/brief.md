# riscv.mp4 brief

**Format:** square 1:1, 1080x1080, 20 s, 96 BPM (8 bars, BAR = 2.5 s, BEAT = 0.625 s). Motion-graphics explainer in Rahil's palette: canvas #111214, ink #F5F5EF, one accent #FFE500. Big Shoulders 700 for display, Geist Mono for code and numbers, Instrument Sans for small text.

**Logline:** A real five-stage pipeline ticks on the beat. One yellow instruction enters EX, the camera pushes into EX, and four int8 lanes multiply and add into one register. The result floods the screen yellow and becomes the payoff number.

**Twist:** the CPU clock is the music's clock. Each pipeline cycle is one beat and one tick. The new instruction is the only yellow thing on screen until its result takes over the frame.

**Hook (0-0.5 s):** "I built a RISC-V CPU." is up, and instruction tiles slide between IF, ID and EX with a tick and soft kick on frame 0.

**Beats:**
- 0-2.5 s. Cycles 3 to 7 of the dot_mixed Icarus trace, one per beat.
- 2.5 s. DOT4 reaches EX. Line 2 "and gave it one new instruction." lands.
- 5.0-5.6 s. Push through the EX box.
- 5.6-9.75 s. x1 and x2 lanes (decoded from the program words), one multiply hit for all four lanes, then the sum lands in x3. The trace confirms the forwarded value.
- 9.0-9.75 s. x3 grows to fill the frame. Silence at 9.75 s.
- 10 s. Drop. "5.3x" on yellow, "faster on an int8 dot product", "after clock cost".
- 13.75 s. 39 cells fill in. "39/39 RV32I tests match Spike".
- 16.25-20 s. End card. Mini pipeline with EX in yellow, "One new instruction.", the GitHub URL and a note that results come from simulation.

**Signature move:** the x3 result box grows into the full-frame yellow drop.

**Sound:** A minor, Am-F-C-G. Pluck motif A4 C5 E5 D5 in the hook, resolved to A on the end card. A tick and soft kick per pipeline cycle, pops for lanes, one chord hit for the four multiplies, riser into true silence, impact and groove on the drop, ticks for the 39 cells, bells on the end card.

**Honesty:** every number comes from reports/*.json at build time. No board claim. The footnote says the results come from simulation and post-route estimates.
