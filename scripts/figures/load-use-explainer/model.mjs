// A cycle model of rtl/rv32_core.sv: same stage registers, same hazard, forwarding and flush rules.
// model.test.mjs replays every trace in reports/visual-traces.json through it frame by frame.

const u32 = n => n >>> 0;
const s32 = n => n | 0;
const NOP = 0x00000013;
export const STAGES = ['IF', 'ID', 'EX', 'MEM', 'WB'];

export function fields(insn) {
  insn = u32(insn);
  return {
    op: insn & 127, rd: (insn >>> 7) & 31, f3: (insn >>> 12) & 7,
    rs1: (insn >>> 15) & 31, rs2: (insn >>> 20) & 31, f7: insn >>> 25,
    immI: s32(insn) >> 20,
    immS: ((s32(insn) >> 25) << 5) | ((insn >>> 7) & 31),
    immB: ((s32(insn) >> 31) << 12) | (((insn >>> 7) & 1) << 11) | (((insn >>> 25) & 63) << 5) | (((insn >>> 8) & 15) << 1),
    immU: u32(insn & 0xfffff000),
    immJ: ((s32(insn) >> 31) << 20) | (insn & 0xff000) | (((insn >>> 20) & 1) << 11) | (((insn >>> 21) & 1023) << 1),
  };
}

// rtl/rv32_core.sv lines 115-116.
export function usesRegs(insn, dot4 = true) {
  const op = u32(insn) & 127;
  return {
    rs1: [0x67, 0x63, 0x03, 0x23, 0x13, 0x33].includes(op) || (dot4 && op === 0x0b),
    rs2: [0x63, 0x23, 0x33].includes(op) || (dot4 && op === 0x0b),
  };
}

const ALU = { 0: 'add', 1: 'sll', 2: 'slt', 3: 'sltu', 4: 'xor', 5: 'srl', 6: 'or', 7: 'and' };
export function disasm(insn) {
  insn = u32(insn);
  const { op, rd, f3, rs1, rs2, f7, immI, immS, immB, immU, immJ } = fields(insn);
  const x = n => `x${n}`;
  if (insn === NOP) return 'nop';
  if (insn === 0x00100073) return 'ebreak';
  if (insn === 0x00000073) return 'ecall';
  switch (op) {
    case 0x37: return `lui ${x(rd)}, 0x${(immU >>> 12).toString(16)}`;
    case 0x17: return `auipc ${x(rd)}, 0x${(immU >>> 12).toString(16)}`;
    case 0x6f: return `jal ${x(rd)}, ${immJ}`;
    case 0x67: return `jalr ${x(rd)}, ${immI}(${x(rs1)})`;
    case 0x63: return `${['beq', 'bne', '?', '?', 'blt', 'bge', 'bltu', 'bgeu'][f3]} ${x(rs1)}, ${x(rs2)}, ${immB}`;
    case 0x03: return `${['lb', 'lh', 'lw', '?', 'lbu', 'lhu'][f3] ?? '?'} ${x(rd)}, ${immI}(${x(rs1)})`;
    case 0x23: return `${['sb', 'sh', 'sw'][f3] ?? '?'} ${x(rs2)}, ${immS}(${x(rs1)})`;
    case 0x13: {
      const name = f3 === 5 ? (f7 === 0x20 ? 'srai' : 'srli') : ['addi', 'slli', 'slti', 'sltiu', 'xori', '', 'ori', 'andi'][f3];
      return `${name} ${x(rd)}, ${x(rs1)}, ${f3 === 1 || f3 === 5 ? rs2 : immI}`;
    }
    case 0x33: return `${f3 === 0 && f7 === 0x20 ? 'sub' : f3 === 5 && f7 === 0x20 ? 'sra' : ALU[f3]} ${x(rd)}, ${x(rs1)}, ${x(rs2)}`;
    case 0x0b: return `dot4 ${x(rd)}, ${x(rs1)}, ${x(rs2)}`;
    default: return `.word 0x${insn.toString(16).padStart(8, '0')}`;
  }
}

// rtl/rv32_core.sv lines 50-113: the EX stage.
export function execute(insn, pc, a, b, dot4 = true) {
  const { op, f3, f7, immI, immS, immB, immU, immJ } = fields(insn);
  let result = 0, target = 0, wr = false, ld = false, st = false, trap = false, taken = false, legal = true;
  const shamt = op === 0x13 ? (u32(insn) >>> 20) & 31 : b & 31;
  const rhs = op === 0x13 ? u32(immI) : b;
  switch (op) {
    case 0x37: wr = true; result = immU; break;
    case 0x17: wr = true; result = u32(pc + immU); break;
    case 0x6f: wr = true; result = u32(pc + 4); taken = true; target = u32(pc + immJ); break;
    case 0x67: wr = true; result = u32(pc + 4); taken = true; target = u32(a + immI) & 0xfffffffe; legal = f3 === 0; break;
    case 0x63:
      target = u32(pc + immB);
      if (f3 === 0) taken = a === b;
      else if (f3 === 1) taken = a !== b;
      else if (f3 === 4) taken = s32(a) < s32(b);
      else if (f3 === 5) taken = s32(a) >= s32(b);
      else if (f3 === 6) taken = a < b;
      else if (f3 === 7) taken = a >= b;
      else legal = false;
      break;
    case 0x03:
      wr = true; ld = true; result = u32(a + immI);
      legal = [0, 1, 2, 4, 5].includes(f3);
      if ((f3 === 1 || f3 === 5) && (result & 1)) trap = true;
      if (f3 === 2 && (result & 3)) trap = true;
      break;
    case 0x23:
      st = true; result = u32(a + immS); legal = f3 <= 2;
      if (f3 === 1 && (result & 1)) trap = true;
      if (f3 === 2 && (result & 3)) trap = true;
      break;
    case 0x13: case 0x33: {
      wr = true;
      const imm = op === 0x13;
      const plain = imm || f7 === 0;
      if (f3 === 0) {
        if (imm) result = u32(a + immI);
        else { legal = f7 === 0 || f7 === 0x20; result = u32(f7 === 0x20 ? a - b : a + b); }
      } else if (f3 === 1) { result = u32(a << shamt); legal = f7 === 0; }
      else if (f3 === 2) { result = s32(a) < s32(rhs) ? 1 : 0; legal = plain; }
      else if (f3 === 3) { result = a < rhs ? 1 : 0; legal = plain; }
      else if (f3 === 4) { result = u32(a ^ rhs); legal = plain; }
      else if (f3 === 5) { legal = f7 === 0 || f7 === 0x20; result = f7 === 0x20 ? u32(s32(a) >> shamt) : a >>> shamt; }
      else if (f3 === 6) { result = u32(a | rhs); legal = plain; }
      else { result = u32(a & rhs); legal = plain; }
      break;
    }
    case 0x0b: {
      let dot = 0;
      for (let lane = 0; lane < 4; lane++) dot += ((a << (24 - 8 * lane)) >> 24) * ((b << (24 - 8 * lane)) >> 24);
      wr = true; result = u32(dot); legal = dot4 && f3 === 0 && f7 === 0; break;
    }
    case 0x0f: legal = f3 === 0 && (u32(insn) >>> 28) === 0; break;
    case 0x73: trap = true; legal = u32(insn) === 0x00000073 || u32(insn) === 0x00100073; break;
    default: legal = false;
  }
  if (!legal || (taken && (target & 3))) trap = true;
  if (trap) { wr = false; ld = false; st = false; taken = false; }
  return { result, target, wr, ld, st, trap, taken };
}

const empty = () => ({ valid: false, pc: 0, insn: 0 });

// Runs from reset release until the trap that ends the program retires, like the testbench.
export function simulate(words, { memory = {}, dot4 = true, maxCycles = 500 } = {}) {
  const imem = addr => words[(addr >>> 2) & 4095] ?? NOP;
  const mem = new Uint8Array(16384);
  for (const [addr, word] of Object.entries(memory)) for (let i = 0; i < 4; i++) mem[(+addr + i) & 16383] = (word >>> (8 * i)) & 255;
  const regs = new Uint32Array(32);
  let s = {
    pc: 0, halted: false, retireValid: false, retireTrap: false,
    f: empty(),
    x: { ...empty(), a: 0, b: 0, aFrom: 'regfile', bFrom: 'regfile' },
    m: { ...empty(), rd: 0, write: false, load: false, store: false, trap: false, result: 0, storeData: 0, f3: 0 },
    w: { ...empty(), rd: 0, write: false, trap: false, result: 0 },
  };
  const frames = [];
  let retired = 0;
  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    const { f, x, m, w } = s;
    const xf = fields(x.insn);
    let a = x.a, b = x.b, aFrom = x.aFrom, bFrom = x.bFrom;
    if (w.valid && w.write && w.rd !== 0) {
      if (xf.rs1 === w.rd) { a = w.result; aFrom = 'WB'; }
      if (xf.rs2 === w.rd) { b = w.result; bFrom = 'WB'; }
    }
    if (m.valid && m.write && !m.load && !m.trap && m.rd !== 0) {
      if (xf.rs1 === m.rd) { a = m.result; aFrom = 'MEM'; }
      if (xf.rs2 === m.rd) { b = m.result; bFrom = 'MEM'; }
    }
    const ex = execute(x.insn, x.pc, a, b, dot4);
    const ff = fields(f.insn), uses = usesRegs(f.insn, dot4);
    const hazard = f.valid && x.valid && ex.ld && !ex.trap && xf.rd !== 0 &&
      ((uses.rs1 && ff.rs1 === xf.rd) || (uses.rs2 && ff.rs2 === xf.rd));
    const redirect = x.valid && ex.taken;
    const fault = x.valid && ex.trap;
    const stall = hazard && !redirect && !fault;
    const flush = redirect || fault;
    if (s.retireValid) retired++;
    frames.push({
      cycle,
      stages: [{ pc: s.pc, valid: !s.halted }, f, x, m, w].map(({ pc, valid }) => ({ pc, valid })),
      stall, flush, hazard, redirect, fault, a, b, aFrom, bFrom,
      mem: m.valid && m.write && m.rd !== 0 ? { rd: m.rd, load: m.load, value: m.result } : null,
      wb: w.valid && w.write && !w.trap && w.rd !== 0 ? { rd: w.rd, value: w.result } : null,
    });
    if (s.retireTrap) return { frames, retired, stalls: frames.filter(fr => fr.stall).length, flushes: frames.filter(fr => fr.flush).length };

    const da = m.result & ~3;
    const word = (mem[da & 16383] | (mem[(da + 1) & 16383] << 8) | (mem[(da + 2) & 16383] << 16) | (mem[(da + 3) & 16383] << 24)) >>> 0;
    const shifted = word >>> (8 * (m.result & 3));
    const loadValue = [s32(shifted << 24) >> 24, s32(shifted << 16) >> 16, shifted, shifted, shifted & 255, shifted & 0xffff, shifted, shifted][m.f3];
    if (m.valid && m.store && !m.trap) {
      const strobe = ((m.f3 === 0 ? 1 : m.f3 === 1 ? 3 : 15) << (m.result & 3)) & 15;
      const data = u32(m.storeData << (8 * (m.result & 3)));
      for (let i = 0; i < 4; i++) if (strobe & (1 << i)) mem[(da + i) & 16383] = (data >>> (8 * i)) & 255;
    }
    const wbBypass = r => w.valid && w.write && !w.trap && w.rd === r;
    const latch = r => r === 0 ? [0, 'zero'] : wbBypass(r) ? [w.result, 'bypass'] : [regs[r], 'regfile'];
    const idRead = [latch(ff.rs1), latch(ff.rs2)];
    if (w.valid && w.write && !w.trap && w.rd !== 0) regs[w.rd] = w.result;
    const next = {
      pc: s.pc, halted: s.halted,
      retireValid: w.valid, retireTrap: w.valid && w.trap,
      f: { ...f }, x: { ...x },
      m: { valid: x.valid, pc: x.pc, insn: x.insn, rd: xf.rd, write: ex.wr, load: ex.ld, store: ex.st, trap: ex.trap, result: ex.result, storeData: b, f3: xf.f3 },
      w: { valid: m.valid, pc: m.pc, insn: m.insn, rd: m.rd, write: m.write, trap: m.trap, result: u32(m.load ? loadValue : m.result) },
    };
    if (flush) {
      next.f.valid = false; next.x.valid = false;
      if (redirect) next.pc = ex.target;
      if (fault) next.halted = true;
    } else if (hazard) {
      next.x.valid = false;
    } else {
      const [[xa, aSrc], [xb, bSrc]] = idRead;
      next.x = { valid: f.valid, pc: f.pc, insn: f.insn, a: xa, b: xb, aFrom: aSrc, bFrom: bSrc };
      next.f = { valid: !s.halted, pc: s.pc, insn: imem(s.pc) };
      if (!s.halted) next.pc = u32(s.pc + 4);
    }
    s = next;
  }
  throw Error(`program did not retire a trap within ${maxCycles} cycles`);
}

const ADDI = (rd, rs1, imm) => u32((imm << 20) | (rs1 << 15) | (0 << 12) | (rd << 7) | 0x13);
const LW = (rd, rs1, imm) => u32((imm << 20) | (rs1 << 15) | (2 << 12) | (rd << 7) | 0x03);
const EBREAK = 0x00100073;
export const TRY_VALUE = 42;
const TRY_ADDRESS = 0x80;

// The "try it" programs: producer writes x5, the consumer at the chosen distance reads x5 as rs1.
export function tryProgram(producer, distance) {
  if (!['alu', 'load'].includes(producer) || ![1, 2, 3].includes(distance)) throw RangeError(`no case ${producer}/${distance}`);
  const first = producer === 'alu' ? ADDI(5, 0, TRY_VALUE) : LW(5, 0, TRY_ADDRESS);
  return [first, ...Array(distance - 1).fill(NOP), ADDI(6, 5, 1), EBREAK];
}

export function tryIt(producer, distance) {
  const words = tryProgram(producer, distance);
  const run = simulate(words, { memory: { [TRY_ADDRESS]: TRY_VALUE } });
  const consumerPc = 4 * distance;
  const inEx = run.frames.find(fr => fr.stages[2].valid && fr.stages[2].pc === consumerPc);
  return { producer, distance, words, ...run, source: inEx.aFrom, operand: inEx.a, consumerCycle: inEx.cycle };
}

export const CASES = ['alu', 'load'].flatMap(p => [1, 2, 3].map(d => [p, d]));
