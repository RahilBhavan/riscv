#!/usr/bin/env python3
"""Prove the new checkers fire: each mutant is one deliberate RTL bug that a named checker must catch.

invariant: the testbench invariants alone must stop the simulation (the Python oracle is not consulted).
hazard:    the generated hazard programs must expose it; whether the original 144 programs did is recorded.
Removing `!m_load` from MEM forwarding is not listed: the load-use stall means no consumer is in EX
while a load is in MEM, so that mutant is equivalent.
isa:       the riscv-arch-test signatures compared with Spike must expose it.
"""
import hashlib
import json
import subprocess
from pathlib import Path

import isa_compare
from run import WAITS, check, extended_suite, suite

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'build' / 'mutants'
CORE = ROOT / 'rtl' / 'rv32_core.sv'

MUTANTS = [
    ('bubble_writes_register', 'invariant', 'if(w_valid && w_write && !w_trap && w_rd!=0) regs[w_rd]<=w_result;',
     'if(w_write && !w_trap && w_rd!=0) regs[w_rd]<=w_result;'),
    ('trapping_store_writes', 'invariant', [("assign dmem_wstrb = (!reset && m_valid && m_store_en && !m_trap) ?",
     "assign dmem_wstrb = (!reset && m_valid && m_store_en) ?"), ('if (trap || irq) begin wr=0; ld=0; st=0;', 'if (trap || irq) begin wr=0; ld=0;')]),
    ('squashed_store_writes', 'invariant', "assign dmem_wstrb = (!reset && m_valid && m_store_en && !m_trap) ?",
     "assign dmem_wstrb = (!reset && m_store_en && !m_trap) ?"),
    ('flush_keeps_fetch', 'invariant', 'f_valid<=0; x_valid<=0;\n                        if(redirect) pc<=target;',
     'x_valid<=0;\n                        if(redirect) pc<=target;'),
    ('stall_without_bubble', 'invariant', 'end else if(hazard) begin\n                        x_valid<=0;',
     'end else if(hazard) begin\n                        x_valid<=x_valid;'),
    ('x0_writable', 'invariant', 'if(w_valid && w_write && !w_trap && w_rd!=0) regs[w_rd]<=w_result;\n            regs[0]<=0;',
     'if(w_valid && w_write && !w_trap) regs[w_rd]<=w_result;'),
    ('retire_wrong_pc', 'invariant', 'retire_pc<=w_pc;', 'retire_pc<=m_pc;'),
    ('fetch_after_halt', 'invariant', 'f_valid<=!halted && imem_ready;', 'f_valid<=imem_ready;'),
    ('no_mem_forward_rs2', 'hazard', 'if (rs2 == m_rd) b = m_result;', ''),
    ('no_wb_forward_rs1', 'hazard', 'if (rs1 == w_rd) a = w_result;', ''),
    ('no_wb_id_bypass_rs2', 'hazard', '(w_valid && w_write && !w_trap && w_rd==f_insn[24:20] ? w_result : regs[f_insn[24:20]])',
     'regs[f_insn[24:20]]'),
    ('mem_forward_wrong_stage_rs1', 'hazard', 'if (rs1 == m_rd) a = m_result;', 'if (rs1 == m_rd) a = w_result;'),
    ('mem_forwards_x0', 'hazard', 'if (m_valid && m_write && !m_load && !m_trap && m_rd != 0) begin',
     'if (m_valid && m_write && !m_load && !m_trap) begin'),
    ('no_load_use_stall_for_store_data', 'hazard', "wire uses_rs2 = f_op==7'h63 || f_op==7'h23 ||", "wire uses_rs2 = f_op==7'h63 ||"),
    ('no_load_use_stall_for_jalr', 'hazard', "wire uses_rs1 = f_op==7'h67 || ", 'wire uses_rs1 = '),
    ('no_load_use_stall_for_dot4_rs2', 'hazard', "f_op==7'h33 || (DOT4 && f_op==7'h0b);\n    wire hazard", "f_op==7'h33;\n    wire hazard"),
    ('sra_is_logical', 'isa', "result=$signed(a) >>> (op==7'h13 ? x_insn[24:20] : b[4:0]);", "result=a >> (op==7'h13 ? x_insn[24:20] : b[4:0]);"),
    ('sltu_signed', 'isa', "result={31'b0,(a<(op==7'h13 ? imm_i : b))};", "result={31'b0,($signed(a)<$signed(op==7'h13 ? imm_i : b))};"),
    ('lh_zero_extends', 'isa', '1: load_value={{16{shifted_load[15]}},shifted_load[15:0]};', '1: load_value={16\'b0,shifted_load[15:0]};'),
    ('jalr_keeps_bit0', 'isa', 'target=(a+imm_i)&32\'hfffffffe;', 'target=(a+imm_i);'),
    ('bge_strict', 'isa', '5: taken=$signed(a)>=$signed(b);', '5: taken=$signed(a)>$signed(b);'),
    ('auipc_ignores_pc', 'isa', '7\'h17: begin wr=1; result=x_pc+imm_u; end', '7\'h17: begin wr=1; result=imm_u; end'),
    ('sb_wrong_lane', 'isa', 'assign dmem_wdata = m_store << (8*m_result[1:0]);', 'assign dmem_wdata = m_store;'),
    ('fetch_ignores_ready', 'waits', 'f_valid<=!halted && imem_ready; f_pc<=pc; f_insn<=imem_rdata;\n                        if(!halted && imem_ready) pc<=pc+4;',
     'f_valid<=!halted; f_pc<=pc; f_insn<=imem_rdata;\n                        if(!halted) pc<=pc+4;'),
    ('load_ignores_ready', 'waits', 'wire mem_wait = m_valid && (m_load || m_store_en) && !m_trap && !dmem_ready;',
     'wire mem_wait = m_valid && m_store_en && !m_trap && !dmem_ready;'),
    ('no_operand_refresh_in_mem_wait', 'waits', 'w_valid<=0; x_a<=a; x_b<=b;', 'w_valid<=0;'),
    ('store_ignores_ready', 'waits', "wire mem_wait = m_valid && (m_load || m_store_en) && !m_trap && !dmem_ready;",
     "wire mem_wait = m_valid && m_load && !m_trap && !dmem_ready;"),
    ('rem_takes_quotient_sign', 'extended', 'md_neg<=funct3[2] && funct3[1] ? md_a_neg : md_a_neg ^ md_b_neg;', 'md_neg<=md_a_neg ^ md_b_neg;'),
    ('div_by_zero_returns_zero', 'extended', "md_zero ? 32'hffffffff", "md_zero ? 32'h0"),
    ('mulhsu_signs_rs2', 'extended', 'wire md_b_signed = funct3==1 || funct3==4 || funct3==6;', 'wire md_b_signed = funct3==1 || funct3==2 || funct3==4 || funct3==6;'),
    ('timer_over_software', 'extended', "pending[11] ? 4'd11 : pending[3] ? 4'd3 : 4'd7", "pending[11] ? 4'd11 : pending[7] ? 4'd7 : 4'd3"),
    ('interrupt_sees_mie_late', 'extended', 'wire irq = ZICSR && mstatus_mie && pending != 0 && x_valid && !md_active;',
     'reg mie_late; always @(posedge clk) mie_late <= mstatus_mie;\n    wire irq = ZICSR && (mstatus_mie || mie_late) && pending != 0 && x_valid && !md_active;'),
    ('interrupt_cuts_md', 'extended', 'x_valid && !md_active;', 'x_valid;'),
    ('mret_ignores_mpie', 'extended', 'mstatus_mie<=mstatus_mpie; mstatus_mpie<=1;', 'mstatus_mie<=1; mstatus_mpie<=1;'),
    ('load_fault_no_tval', 'extended', 'cause = 4; tval = result;', 'cause = 4; tval = 0;'),
    ('exceptions_vectored', 'extended', '((irq && mtvec[0])', '((mtvec[0])'),
    ('read_only_csr_writable', 'extended', "!(csr_write && csr_addr[11:10]==2'b11)", '1'),
    ('mepc_keeps_low_bits', 'extended', "12'h341: mepc<={csr_new[31:2], 2'b00};", "12'h341: mepc<=csr_new;"),
]


def mutate(name, edits):
    source = CORE.read_text()
    for old, new in edits:
        assert source.count(old) == 1, f'{name}: pattern must occur exactly once: {old}'
        source = source.replace(old, new)
    path = WORK / f'{name}.sv'
    path.write_text(source)
    return path


def regression(core, programs, invariant_only=False):
    """Return (killer, program, message) for the first program that fails, else None.

    With invariant_only, oracle mismatches are ignored and the search continues until
    an invariant stops a simulation."""
    sim = WORK / 'tb-sim'
    subprocess.run(['iverilog', '-g2012', '-s', 'tb', '-o', str(sim), str(core), 'tests/tb.sv'], cwd=ROOT, check=True)
    for name, program in programs:
        try:
            check(name, program, ['timeout', '20', 'vvp', str(sim)])
        except AssertionError as error:
            text = str(error)
            if 'INVARIANT FAILED' in text:
                return 'invariant', name, text.split('INVARIANT FAILED: ')[1].split(' at cycle')[0]
            if not invariant_only:
                return 'oracle', name, text[:160]
    return None


def extended_regression(core, programs):
    """Return (program, message) for the first MEXT=1 ZICSR=1 program that fails, with and without wait states, else None."""
    sim = WORK / 'tb-extended'
    subprocess.run(['iverilog', '-g2012', '-s', 'tb', '-Ptb.MEXT=1', '-Ptb.ZICSR=1', '-o', str(sim), str(core), 'tests/tb.sv'], cwd=ROOT, check=True)
    return wait_regression(sim, programs, mext=True, zicsr=True, passes=('', f'+waits={WAITS}'))


def wait_regression(sim, programs, mext=False, zicsr=False, passes=(f'+waits={WAITS}',)):
    for name, program in programs:
        for extra in passes:
            try:
                check(name, program, ['timeout', '60', 'vvp', str(sim)], mext=mext, zicsr=zicsr, plusargs=[extra, '+wait_seed=5eed'] if extra else [])
            except AssertionError as error:
                return name, str(error)[:160]
    return None


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    programs = list(suite())
    baseline = [p for p in programs if not p[0].startswith('hazard_')]
    generated = [p for p in programs if p[0].startswith('hazard_')]
    extended = list(extended_suite())
    results = []
    for name, kind, *edit in MUTANTS:
        core = mutate(name, edit[0] if len(edit) == 1 else [tuple(edit)])
        row = dict(mutant=name, checker=kind)
        if kind == 'invariant':
            kill = regression(core, programs, invariant_only=True)
            row.update(killed=bool(kill), by=kill and kill[1], message=kill and kill[2])
        elif kind == 'hazard':
            before, after = regression(core, baseline), regression(core, generated)
            row.update(killed=bool(after), by=after and after[1], message=after and after[2], killed_by_original_144=bool(before))
        elif kind == 'waits':
            sim = WORK / 'tb-sim'
            subprocess.run(['iverilog', '-g2012', '-s', 'tb', '-o', str(sim), str(core), 'tests/tb.sv'], cwd=ROOT, check=True)
            kill = wait_regression(sim, programs)
            row.update(killed=bool(kill), by=kill and kill[0], message=kill and kill[1])
        elif kind == 'extended':
            kill = extended_regression(core, extended)
            row.update(killed=bool(kill), by=kill and kill[0], message=kill and kill[1])
        else:
            out = WORK / name
            out.mkdir(exist_ok=True)
            try:
                isa_compare.compile_rtl(['icarus'], core=str(core), out=out)
                isa_compare.arch_tests(['icarus'], out=out)
                row.update(killed=False)
            except (AssertionError, subprocess.CalledProcessError) as error:
                row.update(killed=True, by=str(error)[:160])
        results.append(row)
        print(('KILLED ' if row['killed'] else 'SURVIVED ') + json.dumps(row))
    report = dict(
        scope='Each mutant is a single deliberate edit to a copy of rtl/rv32_core.sv. A mutant counts as killed only by its named checker: '
              'invariant = tests/invariants.svh stops the Icarus run on its own; hazard = the generated hazard programs diverge from the reference model; '
              'isa = a riscv-arch-test signature differs from Spike; waits = a base program diverges or breaks an invariant when memory ready is withheld at random; '
              'extended = an MEXT=1 ZICSR=1 extended program diverges from the reference model, with or without wait states. '
              'killed_by_original_144 records whether the pre-existing programs already caught a hazard mutant.',
        mutants=len(results), killed=sum(r['killed'] for r in results), results=results,
        source_sha256={p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in ['rtl/rv32_core.sv', 'tests/mutants.py', 'tests/invariants.svh', 'tests/hazards.py']})
    (ROOT / 'reports' / 'mutation.json').write_text(json.dumps(report, indent=2) + '\n')
    survivors = [r['mutant'] for r in results if not r['killed']]
    assert not survivors, f'mutants not caught by their checker: {survivors}'
    print(f'PASS mutation: {len(results)}/{len(results)} mutants killed by their named checker')


if __name__ == '__main__':
    main()
