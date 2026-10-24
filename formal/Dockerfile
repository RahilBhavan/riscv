# riscv-formal needs SymbiYosys and SMT solvers, which Ubuntu 24.04 does not package.
# A separate image keeps synthesis and timing on the Ubuntu Yosys their reports record.
# Build from the repository root: docker build -f formal/Dockerfile --build-arg TOOLS=rv32-tools -t rv32-formal .
ARG TOOLS=rv32-tools
FROM ${TOOLS}
ARG OSS_CAD_SUITE_TAG=2026-10-24
ARG OSS_CAD_SUITE_DATE=20261024
ARG OSS_CAD_SUITE_SHA256=f33dc250de5e3d2b4325c32dafc695c44e4f19cdc1e3bdb1fea7c78a7c5daa0a
ARG RISCV_FORMAL_COMMIT=c992aa61fdfe0846c5ed90324c596202a1c69b76
ARG RISCV_FORMAL_SHA256=0e357116da2aaa0b57e6dab6fd9ff7612e04d4fdc37372754f72ec963b01e000
RUN curl -fsSL -o /tmp/oss-cad-suite.tgz https://github.com/YosysHQ/oss-cad-suite-build/releases/download/${OSS_CAD_SUITE_TAG}/oss-cad-suite-linux-x64-${OSS_CAD_SUITE_DATE}.tgz \
    && echo "${OSS_CAD_SUITE_SHA256}  /tmp/oss-cad-suite.tgz" | sha256sum -c - \
    && tar xzf /tmp/oss-cad-suite.tgz -C /opt && rm /tmp/oss-cad-suite.tgz \
    && echo "${OSS_CAD_SUITE_DATE} ${OSS_CAD_SUITE_SHA256}" > /opt/oss-cad-suite/VERSION
RUN curl -fsSL -o /tmp/riscv-formal.tar.gz https://github.com/YosysHQ/riscv-formal/archive/${RISCV_FORMAL_COMMIT}.tar.gz \
    && echo "${RISCV_FORMAL_SHA256}  /tmp/riscv-formal.tar.gz" | sha256sum -c - \
    && mkdir /opt/riscv-formal && tar xzf /tmp/riscv-formal.tar.gz -C /opt/riscv-formal --strip-components=1 \
    && rm /tmp/riscv-formal.tar.gz && echo "${RISCV_FORMAL_COMMIT}" > /opt/riscv-formal/COMMIT
ENV PATH=/opt/oss-cad-suite/bin:$PATH
