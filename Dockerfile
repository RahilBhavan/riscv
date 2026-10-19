FROM ubuntu:24.04
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    iverilog verilator yosys nextpnr-ice40 fpga-icestorm python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /work
