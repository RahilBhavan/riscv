// Turns the Icarus snapshots in reports/visual-traces.json into what the machine shows each cycle.
// Every cartridge position comes from a trace frame. Forwarding is derived from the frame's stage
// contents with the rules in rtl/rv32_core.sv lines 39-49, because the trace does not record mux selects.
import { readFileSync } from "node:fs";

export const STAGES = ["IF", "ID", "EX", "MEM", "WB"];
const ROOT = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");

// tests/tb.sv fills instruction memory with this word before loading the program,
// so a fetch past the last program word reads it.
export function fillerWord() {
  const match = read("tests/tb.sv").match(/imem\[i\]\s*=\s*32'h([0-9a-fA-F]{8})/);
  if (!match) throw Error("tests/tb.sv no longer fills imem with a constant word; update the pipeline machine");
  return parseInt(match[1], 16);
}

const sext = (value, bits) => (value << (32 - bits)) >> (32 - bits);
const hex = (n) => "0x" + (n >>> 0).toString(16).padStart(2, "0");
const WORDS = ["no", "one", "two", "three", "four"];

export function decode(word) {
  const w = word >>> 0;
  const op = w & 127, rd = (w >>> 7) & 31, f3 = (w >>> 12) & 7, rs1 = (w >>> 15) & 31, rs2 = (w >>> 20) & 31, f7 = w >>> 25;
  const immI = sext(w >>> 20, 12);
  const immS = sext(((w >>> 25) << 5) | rd, 12);
  const immB = sext((((w >>> 31) & 1) << 12) | (((w >>> 7) & 1) << 11) | (((w >>> 25) & 63) << 5) | (((w >>> 8) & 15) << 1), 13);
  const immJ = sext((((w >>> 31) & 1) << 20) | (((w >>> 12) & 255) << 12) | (((w >>> 20) & 1) << 11) | (((w >>> 21) & 1023) << 1), 21);
  const x = (n) => "x" + n;
  // uses_rs1 and uses_rs2 in rtl/rv32_core.sv decide by opcode alone, so illegal funct3 values still count.
  const uses1 = [0x67, 0x63, 0x03, 0x23, 0x13, 0x33, 0x0b].includes(op);
  const uses2 = [0x63, 0x23, 0x33, 0x0b].includes(op);
  const base = { word: w, op, rd, rs1, rs2, f3, uses1, uses2, writes: false, load: false, trap: false, kind: "alu" };
  const illegal = { ...base, asm: ".word " + hex(w), trap: true, kind: "trap" };
  switch (op) {
    case 0x37: return { ...base, asm: `lui ${x(rd)},${hex(w >>> 12)}`, writes: true };
    case 0x17: return { ...base, asm: `auipc ${x(rd)},${hex(w >>> 12)}`, writes: true };
    case 0x6f: return { ...base, asm: `jal ${x(rd)},${immJ}`, writes: true, kind: "jump", imm: immJ };
    case 0x67: return f3 ? illegal : { ...base, asm: `jalr ${x(rd)},${immI}(${x(rs1)})`, writes: true, kind: "jump", imm: immI };
    case 0x63: {
      const name = ["beq", "bne", , , "blt", "bge", "bltu", "bgeu"][f3];
      return name ? { ...base, asm: `${name} ${x(rs1)},${x(rs2)},${immB}`, kind: "branch", imm: immB } : illegal;
    }
    case 0x03: {
      const name = ["lb", "lh", "lw", , "lbu", "lhu"][f3];
      return name ? { ...base, asm: `${name} ${x(rd)},${immI}(${x(rs1)})`, writes: true, load: true, kind: "load" } : illegal;
    }
    case 0x23: {
      const name = ["sb", "sh", "sw"][f3];
      return name ? { ...base, asm: `${name} ${x(rs2)},${immS}(${x(rs1)})`, kind: "store" } : illegal;
    }
    case 0x13: {
      if (w === 0x13) return { ...base, asm: "nop", writes: true };
      const shamt = rs2;
      const names = ["addi", "slli", "slti", "sltiu", "xori", f7 === 0x20 ? "srai" : "srli", "ori", "andi"];
      if ((f3 === 1 && f7 !== 0) || (f3 === 5 && f7 !== 0 && f7 !== 0x20)) return illegal;
      const arg = f3 === 1 || f3 === 5 ? shamt : immI;
      return { ...base, asm: `${names[f3]} ${x(rd)},${x(rs1)},${arg}`, writes: true };
    }
    case 0x33: {
      const names = { "0,0": "add", "0,32": "sub", "1,0": "sll", "2,0": "slt", "3,0": "sltu", "4,0": "xor", "5,0": "srl", "5,32": "sra", "6,0": "or", "7,0": "and" };
      const name = names[`${f3},${f7}`];
      return name ? { ...base, asm: `${name} ${x(rd)},${x(rs1)},${x(rs2)}`, writes: true } : illegal;
    }
    case 0x0b:
      return f3 === 0 && f7 === 0 ? { ...base, asm: `dot4 ${x(rd)},${x(rs1)},${x(rs2)}`, writes: true } : illegal;
    case 0x0f: return f3 === 0 && w >>> 28 === 0 ? { ...base, asm: "fence" } : illegal;
    case 0x73:
      if (w === 0x73) return { ...base, asm: "ecall", trap: true, kind: "trap" };
      if (w === 0x00100073) return { ...base, asm: "ebreak", trap: true, kind: "trap" };
      return illegal;
    default: return illegal;
  }
}

// Branch outcome from the post-forwarding operands the trace records (dut.a, dut.b).
function taken(info, a, b) {
  if (info.kind === "jump") return true;
  if (info.kind !== "branch") return false;
  const sa = a | 0, sb = b | 0, ua = a >>> 0, ub = b >>> 0;
  return [ua === ub, ua !== ub, , , sa < sb, sa >= sb, ua < ub, ua >= ub][info.f3];
}

function targetOf(info, pc, a) {
  if (info.op === 0x67) return ((a + info.imm) & ~1) >>> 0;
  return (pc + info.imm) >>> 0;
}

const need = (condition, message) => { if (!condition) throw Error(message); };

export function derive(name, trace, filler = fillerWord()) {
  for (const field of ["words", "frames", "retirements"]) need(trace[field] !== undefined, `reports/visual-traces.json: trace ${name} has no ${field}`);
  const wordAt = (pc) => trace.words[pc >>> 2] ?? filler;
  const past = (pc) => (pc >>> 2) >= trace.words.length;
  let next = 0;
  const fresh = (kind, pc) => ({ id: next++, kind, pc, ...(kind === "insn" ? { info: decode(wordAt(pc)), past: past(pc) } : {}) });

  const frames = trace.frames;
  need(frames.length > 0, `trace ${name} has no frames`);
  const rows = [];
  frames.forEach((frame, t) => {
    need(frame.stages?.length === 5, `trace ${name} cycle ${frame.cycle} does not have five stages`);
    for (const field of ["cycle", "stall", "flush", "a", "b"]) need(frame[field] !== undefined, `trace ${name} frame ${t} has no ${field}`);
    const valid = frame.stages.map((s) => s.valid);
    const pcs = frame.stages.map((s) => s.pc);
    let slots;
    if (t === 0) {
      slots = valid.map((v, s) => (v ? fresh("insn", pcs[s]) : null));
    } else {
      const prev = rows[t - 1];
      const before = frames[t - 1];
      const carry = (from, s) => {
        const slot = prev.slots[from];
        if (slot?.kind === "insn") {
          need(valid[s] && pcs[s] === slot.pc, `trace ${name} cycle ${frame.cycle}: ${STAGES[s]} should hold pc ${hex(slot.pc)} moved from ${STAGES[from]}`);
          return slot;
        }
        need(!valid[s], `trace ${name} cycle ${frame.cycle}: ${STAGES[s]} is valid but nothing moved into it`);
        return slot;
      };
      slots = new Array(5).fill(null);
      slots[0] = valid[0] ? (before.stall ? carry(0, 0) : fresh("insn", pcs[0])) : null;
      if (before.flush) {
        need(!valid[1], `trace ${name} cycle ${frame.cycle}: ID should be empty after a flush`);
        slots[1] = fresh("bubble", pcs[1]);
        slots[2] = fresh("bubble", pcs[2]);
        need(!valid[2], `trace ${name} cycle ${frame.cycle}: EX should be empty after a flush`);
      } else if (before.stall) {
        slots[1] = carry(1, 1);
        need(!valid[2], `trace ${name} cycle ${frame.cycle}: EX should take a bubble after a stall`);
        slots[2] = fresh("bubble", pcs[2]);
      } else {
        slots[1] = carry(0, 1);
        slots[2] = carry(1, 2);
      }
      slots[3] = carry(2, 3);
      slots[4] = carry(3, 4);
    }
    rows.push({ cycle: frame.cycle, slots, frame });
  });

  // Check the trace's own stall and flush flags against the RTL rules recomputed from the decoded words.
  rows.forEach(({ slots, frame }) => {
    const [, id, ex] = slots;
    const exInsn = ex?.kind === "insn" ? ex.info : null;
    const idInsn = id?.kind === "insn" ? id.info : null;
    const redirect = !!exInsn && !exInsn.trap && taken(exInsn, frame.a, frame.b);
    const fault = !!exInsn && exInsn.trap;
    const hazard = !!idInsn && !!exInsn && exInsn.load && !exInsn.trap && exInsn.rd !== 0 &&
      ((idInsn.uses1 && idInsn.rs1 === exInsn.rd) || (idInsn.uses2 && idInsn.rs2 === exInsn.rd));
    need(frame.stall === (hazard && !redirect && !fault), `trace ${name} cycle ${frame.cycle}: stall flag ${frame.stall} disagrees with the load-use rule`);
    need(frame.flush === (redirect || fault), `trace ${name} cycle ${frame.cycle}: flush flag ${frame.flush} disagrees with the redirect and trap rules`);
  });

  const retired = rows.filter((row) => row.slots[4]?.kind === "insn").length;
  need(retired === trace.retirements, `trace ${name}: ${retired} instructions reach WB but the report counts ${trace.retirements} retirements`);

  return rows.map((row, t) => {
    const { slots, frame } = row;
    const [ifs, id, ex, mem, wb] = slots;
    const insn = (slot) => (slot?.kind === "insn" ? slot : null);
    const events = {};
    const exI = insn(ex);

    if (exI) {
      // rtl/rv32_core.sv lines 39-49: WB is applied first, then MEM overrides it, so the newer producer wins.
      const memI = insn(mem), wbI = insn(wb);
      const memOk = memI && memI.info.writes && !memI.info.load && !memI.info.trap && memI.info.rd !== 0;
      const wbOk = wbI && wbI.info.writes && !wbI.info.trap && wbI.info.rd !== 0;
      const forwards = [];
      [["a", "uses1", "rs1"], ["b", "uses2", "rs2"]].forEach(([operand, uses, field]) => {
        if (!exI.info[uses]) return;
        const reg = exI.info[field];
        if (reg === 0) return;
        const fromMem = memOk && memI.info.rd === reg;
        const fromWb = wbOk && wbI.info.rd === reg;
        if (fromMem || fromWb) forwards.push({ operand, reg, from: fromMem ? "MEM" : "WB", over: fromMem && fromWb });
      });
      if (forwards.length) events.forwards = forwards;
      events.operands = { a: frame.a >>> 0, b: frame.b >>> 0 };
    }
    if (frame.stall) events.stall = { consumer: id, producer: ex };
    if (frame.flush) {
      const fault = exI.info.trap;
      events.flush = { kind: fault ? "trap" : "redirect", by: exI, dropped: [ifs, id].filter((slot) => slot?.kind === "insn"), target: fault ? null : targetOf(exI.info, exI.pc, frame.a) };
    }
    const wbI = insn(wb);
    if (wbI) events.retire = { slot: wbI, rd: wbI.info.writes && !wbI.info.trap && wbI.info.rd !== 0 ? wbI.info.rd : null };
    if (insn(ifs) && !frame.stall) events.fetch = ifs;

    const plain = (slot) => ({ id: slot.id, kind: slot.kind, pc: slot.pc, ...(slot.kind === "insn" ? { asm: slot.info.asm, past: slot.past } : {}) });
    const view = {
      cycle: row.cycle,
      slots: slots.map((slot) => (slot ? plain(slot) : null)),
      stall: frame.stall,
      flush: events.flush ? { kind: events.flush.kind, dropped: events.flush.dropped.map((slot) => slot.id), target: events.flush.target } : null,
      forwards: events.forwards ?? [],
      operands: events.operands ?? null,
      uses: exI ? { a: exI.info.uses1, b: exI.info.uses2 } : null,
      write: events.retire?.rd ?? null,
      retire: wbI ? wbI.id : null,
      halted: !frame.stages[0].valid,
      caption: captionOf(events, slots, frame),
    };
    return view;
  });
}

const code = (slot) => "`" + slot.info.asm + "`";

export function captionOf(events, slots, frame) {
  const retire = events.retire;
  const alsoRetire = () => (retire?.rd != null ? `, while ${code(retire.slot)} writes x${retire.rd} into the register cabinet` : "");
  if (events.flush) {
    const { kind, by, dropped, target } = events.flush;
    const lost = dropped.length === 2 ? "the two younger cartridges in IF and ID drop" : dropped.length === 1 ? "the younger cartridge drops" : "nothing younger is on the belt to drop";
    if (kind === "redirect") return `${code(by)} in EX is taken, so ${lost} through the trapdoor and fetch restarts at ${hex(target)}.`;
    return `${code(by)} in EX traps, so fetch halts and ${lost} through the trapdoor${dropped.length ? "" : " yet"}.`;
  }
  if (events.stall) {
    const { consumer, producer } = events.stall;
    return `${code(consumer)} in ID needs x${producer.info.rd} from the load ${code(producer)} in EX, so the gate closes, IF and ID hold, and an empty bubble enters EX.`;
  }
  if (events.forwards) {
    const ex = slots[2];
    const parts = events.forwards.map((f) => `x${f.reg} from ${f.from}`);
    const unique = [...new Set(parts)];
    const over = events.forwards.find((f) => f.over);
    const tail = over ? `; WB also holds x${over.reg}, but the newer MEM value wins` : "";
    return `${code(ex)} in EX takes ${unique.join(" and ")} through the bypass pipe${tail}${over ? "" : alsoRetire()}.`;
  }
  if (retire) {
    const { slot, rd } = retire;
    if (slot.info.trap) return `${code(slot)} reaches WB and retires as a trap; no register changes.`;
    if (rd != null) return `${code(slot)} leaves WB and writes x${rd} into the register cabinet.`;
    return `${code(slot)} leaves WB without writing a register.`;
  }
  if (events.fetch) {
    const others = slots.slice(1).filter((slot) => slot?.kind === "insn").length;
    const lead = `IF fetches ${code(events.fetch)} from address ${hex(events.fetch.pc)}`;
    return others ? `${lead} while ${others === 1 ? "one older instruction moves" : WORDS[others] + " older instructions move"} one station on.` : `${lead}.`;
  }
  if (!frame.stages[0].valid) return slots.some(Boolean) ? "Fetch is halted, and the empty bubbles drain toward WB." : "Fetch is halted and the belt is empty.";
  return "The belt moves one station.";
}

export function loadTraces() {
  const report = JSON.parse(read("reports/visual-traces.json"));
  for (const field of ["scope", "source_sha256", "traces"]) need(report[field] !== undefined, `reports/visual-traces.json has no ${field}; regenerate it with make visual-evidence`);
  const names = ["decode_add", "pipeline_spaced", "forward_priority", "load_store", "branch_flush", "dot_mixed"];
  for (const name of names) need(report.traces[name], `reports/visual-traces.json has no trace ${name}`);
  const filler = fillerWord();
  return {
    scope: report.scope,
    sha: report.source_sha256,
    traces: Object.fromEntries(names.map((name) => [name, { words: report.traces[name].words.length, checked: report.traces[name].checked, frames: derive(name, report.traces[name], filler) }])),
  };
}
