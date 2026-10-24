# Pipeline hazard exercise: predict, then measure

This is a self-check. It has no answer key, and none of the repository's reports contain one for this sequence. Write your predictions down before you run anything. Your predictions go in a file you commit before the first simulation, so the measurement cannot quietly rewrite them. The file lives in `notes/`, outside the paths that `output/riscv-project.zip` packages, so committing it does not make the committed zip stale.

Read `docs/ARCHITECTURE.md` (stages, hazards, memory contract) first if you need it. Do not read `tests/hazards.py` or the hazard chapter's worked examples while you predict.

Simulation only. This exercise uses the Icarus Verilog testbench in `tests/tb.sv`. It says nothing about a physical board.

## Part 1: the sequence

The core starts at address 0 with all registers and data memory zero. Data memory is little-endian, and instruction memory is separate from it. The program is 16 instructions and ends with `ebreak`, which the core reports as a trap.

```
addr  instruction            word
0x00  addi x1, x0, 64        04000093
0x04  addi x2, x0, 5         00500113
0x08  addi x9, x0, 0x38      03800493
0x0c  sw   x2, 0(x1)         0020a023
0x10  sw   x9, 8(x1)         0090a423
0x14  lw   x3, 0(x1)         0000a183
0x18  addi x4, x3, 3         00318213
0x1c  bne  x4, x2, 0x28      00221663
0x20  addi x5, x0, 111       06f00293
0x24  addi x6, x0, 222       0de00313
0x28  lw   x8, 8(x1)         0080a403
0x2c  jalr x0, 0(x8)         00040067
0x30  addi x7, x0, 333       14d00393
0x34  addi x7, x0, 444       1bc00393
0x38  add  x10, x4, x2       00220533
0x3c  ebreak                 00100073
```

### Predict (run `mkdir -p notes`, then write these in `notes/my-predictions.md`)

1. Which instruction pairs in this program create a data dependency that the pipeline must handle? List each as producer address, consumer address and register.
2. For each of those, name the source the consumer's operand comes from in the cycle it needs it, or say that no special source is needed. Use the names in `docs/ARCHITECTURE.md`.
3. List every cycle in which `stall` is high and every cycle in which `flush` is high. Number cycles the way the testbench does: the first cycle after reset is cycle 1, counted at the falling edge.
4. Which instructions are fetched but never retire?
5. In which cycle does the `ebreak` retire, and how many `RET` lines does the testbench print in total?
6. Which bytes does the core store, and to which addresses? What are the final values of x1 to x10?

Be explicit about the assumptions you rely on (for example, where a branch resolves). If one of them is a guess, say so. That is useful information.

## Part 2: measure

From the repository root, build the tool image once (it is cached after that):

```
docker build -t rv32-tools .
```

Write the program as a hex file, one word per line:

```
mkdir -p build
cat > build/exercise.hex <<'HEX'
04000093
00500113
03800493
0020a023
0090a423
0000a183
00318213
00221663
06f00293
0de00313
0080a403
00040067
14d00393
1bc00393
00220533
00100073
HEX
```

Compile the testbench and run it with the pipeline trace on:

```
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" rv32-tools bash -c \
  'iverilog -g2012 -s tb -Ptb.DOT4=1 -o build/sim rtl/rv32_core.sv tests/tb.sv && vvp build/sim +program=build/exercise.hex +trace'
```

Output lines:

| Line | Meaning |
| --- | --- |
| `TRACE n ia run f_pc f_v x_pc x_v m_pc m_v w_pc w_v stall flush a b` | One per cycle. PCs of the instruction in each stage and whether it is valid, then the `stall` and `flush` flags, then the two ALU operands |
| `STALL`, `FLUSH` | The cycle's flags, printed again on their own |
| `RET pc instr rd value trap` | An instruction retiring |
| `STORE address byte` | One line per stored byte |
| `CYCLES n` | Printed when the trapping instruction retires |

Compare the trace with your file, line by line. For each disagreement, write down which assumption of yours was wrong before you change the prediction. Keep the original text and add a "what I got wrong" section below it.

You can also ask the sequential reference model for the architectural result and compare it with the pipeline (this checks values and retirement order, not cycle counts):

```
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" rv32-tools python3 -c '
import sys; sys.path[:0] = ["tests"]
import run
prog = [int(w, 16) for w in open("build/exercise.hex").read().split()]
run.check("exercise", prog, ["vvp", "build/sim"])
print("pipeline matches the reference model")
'
```

## Part 3: write a new regression

Design a second program of your own, 10 to 20 instructions, that does one thing this program does not. Pick a hazard combination not covered above. Before running it:

1. Write the program as encoder calls (`imm`, `r`, `store`, `branch`, `jal` in `tests/run.py`). There is no load or `jalr` helper: `imm(f3, rd, rs1, offset, op=...)` encodes both. Use `op=0x03` for loads (`f3` selects the width: 0 `lb`, 1 `lh`, 2 `lw`, 4 `lbu`, 5 `lhu`) and `op=0x67` for `jalr` (`f3=0`). Its default `op=0x13` is the ALU-immediate group.
2. Write your cycle-by-cycle prediction of `stall` and `flush`.
3. Say what a missing forwarding path or a missing stall would do to the final architectural result, so that the regression would fail if the core were broken. A test that passes on a broken core is not a test.

Then put it in a standalone script, so the repository's counted suite does not change:

```
mkdir -p build
cat > build/my_regression.py <<'PY'
import sys
sys.path[:0] = ["tests"]
import run
from run import imm, r, store, branch, jal

program = [
    # your instructions here, ending with 0x00100073
]
run.check("my_regression", program, ["vvp", "build/sim"])
print("PASS my_regression")
PY
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" rv32-tools bash -c \
  'iverilog -g2012 -s tb -Ptb.DOT4=1 -o build/sim rtl/rv32_core.sv tests/tb.sv && python3 build/my_regression.py'
```

Do not add it to `suite()` in `tests/run.py` unless you also want the program count to change. `reports/verification.json`, `reports/raw/regression.log` and the README quote the count, and `scripts/textbook/check-readme.mjs` fails the build when they disagree. If you do add it, rerun `make all` and update the quoted figures. `make test` alone does not rewrite `reports/`; only the Verilator run in `make coverage` does.

Finally, check that your regression can fail. Copy `rtl/rv32_core.sv` to `build/broken_core.sv`, remove one forwarding path or the stall condition, compile `tests/tb.sv` against the copy, and confirm that your program fails. Never edit `rtl/rv32_core.sv` for this.

## What done looks like

- `notes/my-predictions.md` was committed before the first run.
- You can explain each disagreement between prediction and trace in one sentence.
- Your new regression passes on the real core and fails on at least one broken copy.
