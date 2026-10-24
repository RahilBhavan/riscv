#!/usr/bin/env python3
"""Build the board self-test image and its expected signature.

The program reuses directed and random cases from tests/run.py. After each case
it folds every register the case wrote into x31; at the end it folds the data
region, stores x31 to the signature address, and jumps back to the start. The
expected signature comes from the reference model, not from the RTL.
"""
import argparse
from pathlib import Path

from run import B_NAMES, L_NAMES, S_NAMES, branch, imm, jal, r, reference, store, suite

IMEM_WORDS = 2048
SIGNATURE_ADDR = 0x2000
DATA_WORDS = range(128 // 4, 384 // 4)
SIG, TMP, BASE, LOADED = 31, 30, 29, 28
EBREAK = 0x00100073
CASES = ('forwarding', 'priority_x0', 'srai', 'upper', 'backward_loop', 'jal', 'random_0')
PREFIXES = ('alu_', 'load_', 'store_', 'branch_', 'dot_')


def fold(reg):
    # x31 = x31 * 33 + reg keeps every earlier value influential.
    return [imm(1, TMP, SIG, 5), r(0, SIG, SIG, TMP), r(0, SIG, SIG, reg)]


def cases():
    for name, program in suite():
        if name in CASES or name.startswith(PREFIXES):
            assert program[-1] == EBREAK, name
            yield name, program[:-1]
    # tests/run.py jumps to an absolute address; this variant is position-independent.
    yield 'jalr_relative', [0x00000097, imm(0, 2, 1, 16, 0x67), store(2, 0, 1, 128), 0xffffffff, r(0, 3, 2, 1)]


def build():
    words = [imm(0, reg, 0, 0) for reg in range(1, 32)]
    words += [store(2, 0, 0, 4 * w) for w in DATA_WORDS]
    names = []
    for name, body in cases():
        trace, _, _ = reference(body + [EBREAK])
        written = sorted({dest for _, _, dest, _, _, _ in trace if dest})
        assert not {SIG, TMP, BASE, LOADED} & set(written), name
        words += body
        for reg in written:
            words += fold(reg)
        names.append(name)
    for w in DATA_WORDS:
        words += [imm(2, LOADED, 0, 4 * w, 3)] + fold(LOADED)
    words += [SIGNATURE_ADDR >> 12 << 12 | BASE << 7 | 0x37, store(2, BASE, SIG, 0)]
    trace, writes, bins = reference(words + [EBREAK])
    sig = sum(byte << (8 * (addr - SIGNATURE_ADDR)) for addr, byte in writes if SIGNATURE_ADDR <= addr < SIGNATURE_ADDR + 4)
    assert [a for a, _ in writes if a >= SIGNATURE_ADDR] == [SIGNATURE_ADDR + k for k in range(4)], 'one signature store'
    assert trace[-1][4] == 1 and trace[-1][1] == EBREAK, 'reference ends at the loop point'
    required = {'dot4', 'jal', 'jalr', 'lui', 'auipc'} | set(L_NAMES.values()) | set(S_NAMES.values())
    required |= {n + o for n in B_NAMES.values() for o in (':taken', ':not_taken')}
    assert required <= bins, sorted(required - bins)
    words.append(jal(0, -4 * len(words)))
    assert len(words) <= IMEM_WORDS, len(words)
    return words, sig, len(trace), names


def corrupt(words):
    # A wrong immediate in the first case changes data, not control flow.
    first = words.index(imm(0, 1, 0, 7))
    return words[:first] + [imm(0, 1, 0, 8)] + words[first + 1:]


def image(words):
    padded = words + [imm(0, 0, 0, 0)] * (IMEM_WORDS - len(words))
    return ''.join(f'{w:08x}\n' for w in padded)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    words, sig, retired, names = build()
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / 'program.hex').write_text(image(words))
    (args.out / 'program-corrupt.hex').write_text(image(corrupt(words)))
    (args.out / 'board_program.vh').write_text(
        f"localparam [31:0] EXPECTED_SIGNATURE = 32'h{sig:08x};\n"
        f"localparam [31:0] SIGNATURE_ADDR = 32'h{SIGNATURE_ADDR:08x};\n"
        f"localparam integer RETIRED_PER_PASS = {retired};\n")
    print(f'board program: {len(words)} words, {len(names)} cases, {retired} instructions per pass, signature {sig:08x}')


if __name__ == '__main__':
    main()
