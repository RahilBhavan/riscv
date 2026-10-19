#!/usr/bin/env bash
# Full project build. RTL tools stay in the versioned Ubuntu tool image;
# Node/Chromium/Poppler run on the host to export the learning artifacts.
set -euo pipefail
cd "$(dirname "$0")/.."
browser_bin=${CHROMIUM_BIN:-chromium}
for tool in docker node python3 make flock pdfinfo pdftotext "$browser_bin"; do
    command -v "$tool" >/dev/null || { echo "Missing required tool: $tool (see docs/BUILD_ALL.md)" >&2; exit 1; }
done
node -e 'if(Number(process.versions.node.split(".")[0])<22){console.error("Node.js 22 or newer is required");process.exit(1)}'
docker info >/dev/null
mkdir -p build/project
exec 9>build/project/full-build.lock
flock -n 9 || { echo 'A full project build is already running.' >&2; exit 1; }
# Removing the completion marker prevents a failed rebuild from looking current.
rm -f build/project/SUCCESS
run_phase() {
    local phase=$1
    shift
    echo "Building $phase..."
    if "$@" >"build/project/$phase.log" 2>&1; then
        echo "PASS $phase (build/project/$phase.log)"
    else
        tail -n 60 "build/project/$phase.log" >&2
        echo "FAIL $phase; inspect build/project/$phase.log" >&2
        return 1
    fi
}
run_phase tools docker build -t rv32-tools .
run_phase rtl docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" rv32-tools \
    make test learning-labs reset-test dot4-sweep isa-compare mutants lint coverage timing bench ablation board-sim board visual-evidence
run_phase learning make -j1 textbook textbook-series visual-models visual-lab
run_phase release python3 scripts/release/build.py
touch build/project/SUCCESS
echo 'Complete: output/riscv-project.zip'
echo 'Start: output/START-HERE.html'
