.DEFAULT_GOAL := all

.PHONY: all release-check
all:
	bash scripts/build.sh

release-check:
	python3 scripts/release/build.py --check-only

.PHONY: test lint synth timing clean

test:
	python3 tests/run.py
	python3 tests/run.py --no-dot4

lint:
	verilator --lint-only -Wall --top-module rv32_core rtl/rv32_core.sv

synth:
	mkdir -p build
	yosys -ql build/synthesis.log -p 'read_verilog -sv rtl/rv32_core.sv; synth_ice40 -top rv32_core -json build/core.json; stat'

# Core-only estimate on HX8K. No board pinout or external-memory timing contract.
# Registered shell gives representative synchronous endpoints and modest I/O count.
timing:
	mkdir -p build
	yosys -ql build/synthesis.log -p 'read_verilog -sv rtl/rv32_core.sv rtl/timing_top.sv; synth_ice40 -top timing_top -json build/core.json; stat'
	nextpnr-ice40 --hx8k --package ct256 --json build/core.json --asc build/core.asc --pcf-allow-unconstrained --freq 12 --seed 1 --report build/timing.json > build/nextpnr.log 2>&1
	python3 scripts/metrics.py

clean:
	rm -rf build

.PHONY: coverage
coverage:
	mkdir -p build
	rm -f build/*.dat
	verilator --cc --exe --build --timing --coverage-line -Wno-fatal --top-module tb --Mdir build/obj_dir rtl/rv32_core.sv tests/tb.sv $(CURDIR)/tests/coverage_main.cpp
	python3 tests/run.py --verilator
	verilator_coverage --write build/merged.dat build/*.dat
	python3 scripts/coverage.py

.PHONY: textbook
textbook:
	bash scripts/textbook/export.sh

.PHONY: learning-labs
learning-labs:
	python3 docs/textbook/series/labs/run_labs.py

.PHONY: textbook-series
textbook-series:
	bash scripts/textbook/series/export.sh

.PHONY: reset-test visual-evidence visual-lab visual-models
reset-test:
	mkdir -p build
	iverilog -g2012 -s reset_tb -o build/reset-sim rtl/rv32_core.sv tests/reset_tb.sv
	vvp build/reset-sim

visual-evidence:
	python3 scripts/visual-lab/evidence.py

visual-models:
	node --test scripts/visual-lab/models.test.mjs

visual-lab:
	node scripts/visual-lab/build.mjs
	node scripts/visual-lab/preview.mjs

.PHONY: bench ablation
# Simulation cycle counts for matched RV32I and DOT4 dot-product kernels.
bench:
	python3 scripts/bench.py

# Both DOT4 settings through the timing flow, nextpnr seeds 1-5, combined with bench cycles.
ablation: bench
	python3 scripts/ablation.py
