.PHONY: test lint synth timing clean

test:
	python3 tests/run.py

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
