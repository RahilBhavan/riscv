FROM ubuntu:24.04 AS spike
ARG SPIKE_COMMIT=5a760667bf0d0ab893173b9eeff9c109c8d7dd9a
ARG SPIKE_SHA256=7e59ed05df857727a9f3c07ab99502351a649f9f41e37ecaeeb20a50a3988446
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    build-essential device-tree-compiler curl ca-certificates libboost-regex-dev libboost-system-dev \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL -o /tmp/spike.tar.gz https://github.com/riscv-software-src/riscv-isa-sim/archive/${SPIKE_COMMIT}.tar.gz \
    && echo "${SPIKE_SHA256}  /tmp/spike.tar.gz" | sha256sum -c - \
    && mkdir /tmp/spike && tar xzf /tmp/spike.tar.gz -C /tmp/spike --strip-components=1 \
    && cd /tmp/spike && mkdir build && cd build \
    && ../configure --prefix=/opt/spike && make -j"$(nproc)" && make install \
    && echo "${SPIKE_COMMIT}" > /opt/spike/COMMIT

FROM ubuntu:24.04
ARG ARCH_TEST_TAG=3.10.0
ARG ARCH_TEST_SHA256=8d8562c348b3cff666d2aff9cd092cad0f15cbcae9610d0b00ffbcc56607ad82
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    iverilog verilator yosys nextpnr-ice40 fpga-icestorm python3 make g++ ca-certificates \
    gcc-riscv64-unknown-elf binutils-riscv64-unknown-elf device-tree-compiler curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=spike /opt/spike /opt/spike
ENV PATH=/opt/spike/bin:$PATH
RUN curl -fsSL -o /tmp/arch-test.tar.gz https://github.com/riscv-non-isa/riscv-arch-test/archive/refs/tags/${ARCH_TEST_TAG}.tar.gz \
    && echo "${ARCH_TEST_SHA256}  /tmp/arch-test.tar.gz" | sha256sum -c - \
    && mkdir -p /opt/riscv-arch-test \
    && tar xzf /tmp/arch-test.tar.gz -C /opt/riscv-arch-test --strip-components=1 \
       riscv-arch-test-${ARCH_TEST_TAG}/riscv-test-suite/env \
       riscv-arch-test-${ARCH_TEST_TAG}/riscv-test-suite/rv32i_m/I \
       riscv-arch-test-${ARCH_TEST_TAG}/riscv-test-suite/rv32i_m/M \
       riscv-arch-test-${ARCH_TEST_TAG}/riscv-test-suite/rv32i_m/privilege \
       riscv-arch-test-${ARCH_TEST_TAG}/COPYING.BSD riscv-arch-test-${ARCH_TEST_TAG}/COPYING.APACHE \
    && echo "${ARCH_TEST_TAG} ${ARCH_TEST_SHA256}" > /opt/riscv-arch-test/VERSION \
    && rm /tmp/arch-test.tar.gz
WORKDIR /work

