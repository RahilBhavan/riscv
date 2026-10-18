# Teaching labs

These examples supplement the main core regression. They do not contribute to the published baseline coverage counts.

From the repository root:

```sh
docker build -t rv32-tools .
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" rv32-tools make learning-labs
```

The runner first checks two standalone hardware benches:

- `rtl_basics.sv`: two clocked registers demonstrate old/new nonblocking-assignment state.
- `single_cycle.sv`: a complete teaching subset for ADDI, ADD, aligned LW, aligned SW and EBREAK. It has a different interface from `rv32_core` and is not the measured core.

Then it compiles the actual pipelined core with `tests/tb.sv` and runs fourteen small programs. It compares every retirement and byte write to the local reference and checks additional hand-calculated register/memory outcomes. Programs cover instruction decode, little-endian loads, spaced stage flow, forwarding priority, WB/ID coincidence, load consumers, wrong paths, DOT4 and faults.

Generated hex words, raw traces and `results.json` live under `build/learning-series/`.

To list or run one program inside the tools container:

```sh
python3 docs/textbook/series/labs/run_labs.py --list
python3 docs/textbook/series/labs/run_labs.py --case load_jalr
```

The full run includes the two standalone benches. A selected `--case` runs only that core program. The modeled memory remains the original combinational-read Harvard environment. These finite examples do not establish certification, formal proof, complete hazard coverage or physical FPGA operation.
