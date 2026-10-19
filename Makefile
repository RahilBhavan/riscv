.DEFAULT_GOAL := all

.PHONY: all release-check
all:
	bash scripts/build.sh

release-check:
	python3 scripts/release/build.py --check-only

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

# iCE40-HX8K Breakout self-test image. See docs/BOARD.md.
BOARD_RTL := rtl/rv32_core.sv rtl/board_top.sv
BOARD_PCF := board/ice40hx8k-breakout.pcf
BOARD_SIM := iverilog -g2012 -I build/board -s board_tb
# Must match the parameter overrides in tests/board_tb.sv.
BOARD_SIM_PARAMS := -set POR_BITS 4 -set WATCHDOG_BITS 14 -set REPORT_BITS 15 -set CLK_HZ 921600

.PHONY: board-program board-sim board-netlist-sim board board-pll prog prog-sram prog-pll
board-program:
	mkdir -p build/board
	python3 tests/board_program.py --out build/board

board-sim: board-program
	verilator --lint-only -Wall -Wno-UNUSEDSIGNAL -Wno-UNUSEDPARAM -Wno-DECLFILENAME -Ibuild/board --top-module board_top $(BOARD_RTL)
	$(BOARD_SIM) -o build/board/sim $(BOARD_RTL) tests/board_tb.sv
	vvp -n build/board/sim
	$(BOARD_SIM) -P board_tb.EXPECT_FAIL=1 -P 'board_tb.PROGRAM_HEX="build/board/program-corrupt.hex"' \
		-o build/board/sim-corrupt $(BOARD_RTL) tests/board_tb.sv
	vvp -n build/board/sim-corrupt

# Same testbench against the yosys iCE40 netlist, so the block-RAM cells, their
# INIT contents and falling-edge clocks run as mapped. Simulation-speed parameters.
board-netlist-sim: board-program
	yosys -ql build/board/netlist-synth.log -p 'read_verilog -sv -Ibuild/board $(BOARD_RTL); chparam $(BOARD_SIM_PARAMS) board_top; synth_ice40 -top board_top; write_verilog -noattr build/board/netlist.v'
	$(BOARD_SIM) -DNETLIST -o build/board/sim-netlist build/board/netlist.v \
		$$(dirname $$(command -v yosys))/../share/yosys/ice40/cells_sim.v tests/board_tb.sv
	vvp -n build/board/sim-netlist

# $(1)=output stem, $(2)=yosys chparam options, $(3)=nextpnr target MHz.
define board_build
	yosys -ql build/board/$(1)-synth.log -p 'read_verilog -sv -Ibuild/board $(BOARD_RTL); chparam $(2) board_top; synth_ice40 -top board_top -json build/board/$(1).json; stat'
	nextpnr-ice40 --hx8k --package ct256 --pcf $(BOARD_PCF) --json build/board/$(1).json --asc build/board/$(1).asc \
		--freq $(3) --seed 1 --report build/board/$(1)-timing.json > build/board/$(1)-nextpnr.log 2>&1
	icepack build/board/$(1).asc build/board/$(1).bin
	python3 scripts/board_report.py $(1) $(3)
endef

board: board-program
	$(call board_build,board,-set USE_PLL 0,12)

# Optional faster clock from SB_PLL40_CORE; icepll picks the divider settings.
PLL_MHZ ?= 30
PLL_ICEPLL = icepll -i 12 -o $(PLL_MHZ)
PLL_ACHIEVED = $(shell $(PLL_ICEPLL) | awk '/achieved/{print $$2}')
PLL_PARAMS = $(shell $(PLL_ICEPLL) | awk '/^DIVR/{r=$$2}/^DIVF/{f=$$2}/^DIVQ/{q=$$2}/^FILTER_RANGE/{fr=$$2}/achieved/{hz=$$2*1000000} \
	END{printf "-set USE_PLL 1 -set PLL_DIVR %d -set PLL_DIVF %d -set PLL_DIVQ %d -set PLL_FILTER_RANGE %d -set CLK_HZ %d",r,f,q,fr,hz}')

board-pll: board-program
	$(call board_build,board-pll,$(PLL_PARAMS),$(PLL_ACHIEVED))

# Flash and SRAM modes need different J6/J7 jumpers; see docs/BOARD.md.
prog:
	iceprog build/board/board.bin

prog-sram:
	iceprog -S build/board/board.bin

prog-pll:
	iceprog build/board/board-pll.bin

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
