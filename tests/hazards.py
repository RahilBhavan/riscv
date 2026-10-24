"""Generated hazard-cross programs and the functional cross they are measured against.

Bins are measured on the sequential reference trace, so a bin counts only when the
dependency really occurs in retirement order, whatever program produced it.
"""
from run import imm, r, store, branch, jal

PRODUCERS = ('alu', 'load', 'jal', 'jalr', 'lui', 'auipc', 'dot4')
SLOTS = ('alu.rs1', 'alu.rs2', 'alu.both', 'branch.rs1', 'branch.rs2', 'branch.both',
         'jalr.rs1', 'store.addr', 'store.data', 'store.both', 'dot4.rs1', 'dot4.rs2',
         'dot4.both', 'load.addr')
DISTANCES = (1, 2, 3)
TRANSFERS = ('branch', 'jal', 'jalr')
REDIRECT_EVENTS = ('wrong_path_reads_recent', 'wrong_path_load_use', 'wrong_path_store', 'target_reads_recent')

CROSS_BINS = [f'{p}>{s}:d{d}' for p in PRODUCERS for s in SLOTS for d in DISTANCES]
X0_BINS = [f'x0:{p}>read:d{d}' for p in PRODUCERS for d in DISTANCES]
REDIRECT_BINS = [f'redirect:{t}:{e}' for t in TRANSFERS for e in REDIRECT_EVENTS]
ALL_BINS = CROSS_BINS + X0_BINS + REDIRECT_BINS

CLASS = {0x13: 'alu', 0x33: 'alu', 0x03: 'load', 0x23: 'store', 0x63: 'branch', 0x6f: 'jal',
         0x67: 'jalr', 0x37: 'lui', 0x17: 'auipc', 0x0b: 'dot4'}
WRITERS = {'alu', 'load', 'jal', 'jalr', 'lui', 'auipc', 'dot4'}


def fields(ins):
    return CLASS.get(ins & 127), (ins >> 7) & 31, (ins >> 15) & 31, (ins >> 20) & 31


def sources(ins):
    """(slot prefix, register) for each register operand the instruction really reads."""
    kind, _, rs1, rs2 = fields(ins)
    if kind == 'alu' and ins & 127 == 0x13:
        return [('alu.rs1', rs1)]
    if kind in ('alu', 'branch', 'dot4'):
        return [(kind + '.rs1', rs1), (kind + '.rs2', rs2)]
    if kind == 'store':
        return [('store.addr', rs1), ('store.data', rs2)]
    if kind == 'jalr':
        return [('jalr.rs1', rs1)]
    if kind == 'load':
        return [('load.addr', rs1)]
    return []


def read_regs(ins):
    return {reg for _, reg in sources(ins)}


def cross_bins(program, trace):
    """Bins hit by one program, from its reference trace of (pc, ins, dest, value, trap, intr)."""
    hit = set()
    for i, (pc, ins, _, _, trap, _) in enumerate(trace):
        reads = sources(ins)
        for slot, reg in reads:
            if reg == 0:
                for d in DISTANCES:
                    if i - d >= 0:
                        kind, rd, _, _ = fields(trace[i - d][1])
                        if kind in WRITERS and rd == 0 and not trace[i - d][4]:
                            hit.add(f'x0:{kind}>read:d{d}')
                continue
            for d in DISTANCES:
                if i - d < 0:
                    break
                if trace[i - d][2] == reg:
                    both = len(reads) == 2 and reads[0][1] == reads[1][1]
                    consumer = slot.split('.')[0] + '.both' if both else slot
                    hit.add(f'{fields(trace[i - d][1])[0]}>{consumer}:d{d}')
                    break
        kind = fields(ins)[0]
        if trap or kind not in TRANSFERS or i + 1 >= len(trace) or trace[i + 1][0] == pc + 4:
            continue
        recent = {trace[j][2] for j in (i, i - 1, i - 2) if j >= 0} - {0}
        actual = {trace[j][0] for j in (i + 1, i + 2) if j < len(trace)}
        wrong = [program[a // 4] if a // 4 < len(program) else 0x13 for a in (pc + 4, pc + 8) if a not in actual]
        if any(read_regs(w) & recent for w in wrong):
            hit.add(f'redirect:{kind}:wrong_path_reads_recent')
        if any(fields(w)[0] == 'store' for w in wrong):
            hit.add(f'redirect:{kind}:wrong_path_store')
        if len(wrong) == 2 and fields(wrong[0])[0] == 'load' and fields(wrong[0])[1] and fields(wrong[0])[1] in read_regs(wrong[1]):
            hit.add(f'redirect:{kind}:wrong_path_load_use')
        if read_regs(trace[i + 1][1]) & ({trace[j][2] for j in (i, i - 1) if j >= 0} - {0}):
            hit.add(f'redirect:{kind}:target_reads_recent')
    return hit


def lui(rd, value):
    return (value & 0xfffff000) | rd << 7 | 0x37


def auipc(rd, value):
    return (value & 0xfffff000) | rd << 7 | 0x17


def jalr(rd, rs1, n):
    return imm(0, rd, rs1, n, 0x67)


def dot4(rd, a, b):
    return r(0, rd, a, b, op=0x0b)


def li(rd, value):
    low = value & 4095
    low = low - 4096 if low & 2048 else low
    return [lui(rd, (value - low) & 0xffffffff), imm(0, rd, rd, low)]


BODY = 0x800  # Code above 0x800 keeps every producer value inside one 12-bit offset of DATA.
DATA = 0xc00
BASE, PARTNER, ONES, EXPECT, DOT_A, DOT_B, LINK_BASE, FILLER, MARKER, RESULT = 28, 6, 23, 24, 25, 26, 27, 29, 30, 7
LOAD_VALUE, LOAD_FROM, LOAD_PROBE = 0xb00, 0x100, 0x80
POISON = -1445  # 0xfffffa5b: odd, so a missed forward also breaks any address use
TESTED = (5, 18, 31)
END = 0x00100073


class Program:
    def __init__(self):
        self.words = [jal(0, BODY)] + [0x13] * (BODY // 4 - 1)
        self.stores = 0

    @property
    def pc(self):
        return 4 * len(self.words)

    def emit(self, *words):
        self.words.extend(words)

    def store_slot(self):
        self.stores += 1
        return DATA + 0x200 + 4 * self.stores

    def setup(self):
        self.emit(*li(BASE, DATA), imm(0, PARTNER, 0, 0x123), *li(ONES, 0x01010101),
                  imm(0, DOT_A, 0, 0x30), imm(0, DOT_B, 0, 0x40), imm(0, 22, 0, LOAD_VALUE // 2), r(0, 22, 22, 22),
                  store(2, BASE, 22, LOAD_FROM), store(2, BASE, PARTNER, LOAD_PROBE), *self.fill(3))

    @staticmethod
    def fill(n):
        return [imm(0, FILLER, 0, 0x29)] * n

    def produce(self, kind, rd):
        """Emit one producer of rd and return the value it writes."""
        if kind == 'alu':
            self.emit(imm(0, rd, 0, 0x7f0))
            return 0x7f0
        if kind == 'load':
            self.emit(imm(2, rd, BASE, LOAD_FROM, 3))
            return LOAD_VALUE
        if kind == 'jal':
            self.emit(jal(rd, 4))
            return self.pc
        if kind == 'jalr':
            self.emit(auipc(LINK_BASE, 0), jalr(rd, LINK_BASE, 8))
            return self.pc
        if kind == 'lui':
            self.emit(lui(rd, 0x1000))
            return 0x1000
        if kind == 'auipc':
            self.emit(auipc(rd, 0))
            return self.pc - 4
        self.emit(dot4(rd, DOT_A, DOT_B))
        return 0x30 * 0x40

    def consume(self, slot, x, value):
        """Emit a consumer whose observable effect is wrong unless x holds value."""
        if slot == 'alu.rs1':
            self.emit(imm(0, RESULT, x, 3))
        elif slot == 'alu.rs2':
            self.emit(r(0, RESULT, PARTNER, x, 32))
        elif slot == 'alu.both':
            self.emit(r(0, RESULT, x, x))
        elif slot.startswith('branch'):
            a, b, f3 = {'branch.rs1': (x, EXPECT, 0), 'branch.rs2': (EXPECT, x, 0), 'branch.both': (x, x, 5)}[slot]
            self.emit(branch(f3, a, b, 8), imm(0, MARKER, 0, 1))
        elif slot == 'jalr.rs1':
            self.emit(jalr(RESULT, x, self.pc + 8 - value), imm(0, MARKER, 0, 2))
        elif slot == 'store.addr':
            self.emit(store(2, x, PARTNER, self.store_slot() - value))
        elif slot == 'store.data':
            self.emit(store(2, BASE, x, self.store_slot() - DATA))
        elif slot == 'store.both':
            self.emit(store(2, x, x, self.store_slot() - value))
        elif slot == 'dot4.rs1':
            self.emit(dot4(RESULT, x, ONES))
        elif slot == 'dot4.rs2':
            self.emit(dot4(RESULT, ONES, x))
        elif slot == 'dot4.both':
            self.emit(dot4(RESULT, x, x))
        else:
            self.emit(imm(2, RESULT, x, DATA + LOAD_PROBE - value, 3))


def cross_program(producer, slot):
    p = Program()
    p.setup()
    for d, x in zip(DISTANCES, TESTED):
        # The expected value is known only after the producer's PC is fixed, so reserve its slot.
        expect_at = len(p.words)
        p.emit(0x13, 0x13, imm(0, x, 0, POISON))
        value = p.produce(producer, x)
        p.words[expect_at:expect_at + 2] = li(EXPECT, value)
        p.emit(*p.fill(d - 1))
        p.consume(slot, x, value)
        p.emit(*p.fill(3))
    return p.words + [END]


def x0_program(producer):
    p = Program()
    p.setup()
    for d in DISTANCES:
        p.produce(producer, 0)
        p.emit(*p.fill(d - 1))
        p.emit([r(0, RESULT, 0, PARTNER), store(2, BASE, 0, p.store_slot() - DATA), dot4(RESULT, 0, ONES)][d - 1])
        p.emit(*p.fill(3))
    return p.words + [END]


def redirect_program(transfer):
    p = Program()
    p.setup()
    p.emit(auipc(LINK_BASE, 0))
    origin = p.pc - 4
    p.emit(imm(0, 5, 0, 0x40))
    target = p.pc + 12
    p.emit({'branch': branch(0, 5, 5, 12), 'jal': jal(9, 12), 'jalr': jalr(9, LINK_BASE, target - origin)}[transfer])
    # Squashed: a load, its immediate use, and a store reading the producer and the link.
    p.emit(imm(2, 10, BASE, LOAD_PROBE, 3), store(2, 5, 10, 0))
    p.emit(r(0, 11, 5, 9), *p.fill(3))
    return p.words + [END]


def suite():
    for producer in PRODUCERS:
        for slot in SLOTS:
            yield f'hazard_{producer}_{slot.replace(".", "_")}', cross_program(producer, slot)
        yield f'hazard_x0_{producer}', x0_program(producer)
    for transfer in TRANSFERS:
        yield f'hazard_redirect_{transfer}', redirect_program(transfer)
