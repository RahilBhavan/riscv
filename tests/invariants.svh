// Pipeline invariants, included inside a testbench module that instantiates rv32_core as
// `dut` and defines `function [31:0] program_word(input [31:0] address)`.
// Call invariants_step() once per falling edge while reset is low, and invariants_done()
// when the trap record retires. Any violation ends simulation through $fatal.
// Hierarchical references make this a white-box check of this core's pipeline registers.
integer inv_cycles = 0, inv_pending = 0, inv_k;
reg inv_primed = 0, inv_have_prev = 0;
reg [31:0] inv_regs [0:31];
reg [31:0] inv_mem_pc [0:7];
reg inv_commit, inv_stall, inv_flush, inv_halted;
reg [4:0] inv_rd;
reg [31:0] inv_value, inv_pc, inv_f_pc, inv_f_insn, inv_prev_pc, inv_prev_insn;
reg inv_f_valid;

task inv_fail(input [8*64-1:0] what);
    begin
        $display("INVARIANT FAILED: %0s at cycle %0d (retire pc %08x)", what, inv_cycles, dut.retire_pc);
        $fatal(1, "invariant violated: %0s", what);
    end
endtask

function inv_successor(input [31:0] from, input [31:0] insn, input [31:0] to);
    begin
        case (insn[6:0])
            7'h63: inv_successor = to == from + 4 ||
                to == from + {{19{insn[31]}}, insn[31], insn[7], insn[30:25], insn[11:8], 1'b0};
            7'h6f: inv_successor = to == from + {{11{insn[31]}}, insn[31], insn[19:12], insn[20], insn[30:21], 1'b0};
            7'h67: inv_successor = to[1:0] == 0;
            default: inv_successor = to == from + 4;
        endcase
    end
endfunction

task invariants_step;
    begin
        inv_cycles = inv_cycles + 1;
        if (dut.regs[0] !== 0) inv_fail("x0 is not zero");
        if (dut.stall_event && dut.flush_event) inv_fail("stall and flush in the same cycle");
        if (dut.halted && (dut.f_valid || dut.x_valid)) inv_fail("valid fetch after halt");
        if (inv_primed) begin
            for (inv_k = 1; inv_k < 32; inv_k = inv_k + 1)
                if (dut.regs[inv_k] !== inv_regs[inv_k] &&
                    !(inv_commit && {27'b0, inv_rd} == inv_k && dut.regs[inv_k] === inv_value))
                    inv_fail("register written without a valid WB commit");
            if (inv_commit && dut.regs[inv_rd] !== inv_value) inv_fail("valid WB commit lost");
            if (inv_commit && !(dut.retire_valid && !dut.retire_trap && dut.retire_rd == inv_rd && dut.retire_data == inv_value))
                inv_fail("retirement record differs from WB commit");
            if (dut.retire_valid && dut.retire_rd != 0 && !inv_commit) inv_fail("retired write with no WB commit");
            if (inv_stall && (dut.pc !== inv_pc || dut.f_pc !== inv_f_pc || dut.f_insn !== inv_f_insn ||
                              dut.f_valid !== inv_f_valid || dut.x_valid))
                inv_fail("stall did not hold IF/ID and insert a bubble");
            if (inv_flush && (dut.f_valid || dut.x_valid)) inv_fail("flush left a younger instruction valid");
            if (inv_halted && dut.pc !== inv_pc) inv_fail("PC moved while halted");
        end
        if (dut.retire_valid) begin
            if (dut.retire_insn !== program_word(dut.retire_pc)) inv_fail("retired word differs from program memory");
            if (dut.retire_trap && (dut.retire_rd != 0 || dut.retire_data != 0)) inv_fail("trap record has a register write");
            if (!inv_have_prev && dut.retire_pc != 0) inv_fail("first retirement is not the reset PC");
            if (inv_have_prev && !inv_successor(inv_prev_pc, inv_prev_insn, dut.retire_pc))
                inv_fail("retirement PC breaks program order");
            if (!dut.retire_trap && (dut.retire_insn[6:0] == 7'h03 || dut.retire_insn[6:0] == 7'h23)) begin
                if (inv_pending == 0 || inv_mem_pc[0] !== dut.retire_pc) inv_fail("load/store retired without its memory access");
                for (inv_k = 0; inv_k < 7; inv_k = inv_k + 1) inv_mem_pc[inv_k] = inv_mem_pc[inv_k + 1];
                inv_pending = inv_pending - 1;
            end else if (inv_pending != 0 && inv_mem_pc[0] === dut.retire_pc)
                inv_fail("memory access by a non-memory or trapping instruction");
            inv_have_prev = 1; inv_prev_pc = dut.retire_pc; inv_prev_insn = dut.retire_insn;
        end
        if (dut.dmem_wstrb != 0 || dut.dmem_read) begin
            if (dut.dmem_wstrb != 0 && dut.dmem_read) inv_fail("load and store in the same cycle");
            if (inv_pending == 8) inv_fail("memory access queue overflow");
            inv_mem_pc[inv_pending] = dut.m_pc;
            inv_pending = inv_pending + 1;
        end
        for (inv_k = 0; inv_k < 32; inv_k = inv_k + 1) inv_regs[inv_k] = dut.regs[inv_k];
        inv_commit = dut.w_valid && dut.w_write && !dut.w_trap && dut.w_rd != 0;
        inv_rd = dut.w_rd; inv_value = dut.w_result;
        inv_stall = dut.stall_event; inv_flush = dut.flush_event; inv_halted = dut.halted;
        inv_pc = dut.pc; inv_f_pc = dut.f_pc; inv_f_insn = dut.f_insn; inv_f_valid = dut.f_valid;
        inv_primed = 1;
    end
endtask

task invariants_done;
    begin
        if (inv_pending != 0) inv_fail("memory access by an instruction that never retired");
        $display("INVARIANTS %0d", inv_cycles);
    end
endtask

// For benches that reset the core between programs.
task invariants_restart;
    begin
        inv_primed = 0; inv_have_prev = 0; inv_pending = 0;
    end
endtask
