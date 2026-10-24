// riscv-formal harness. Every core input is unconstrained: instruction words, load data,
// both ready signals and the interrupt lines. RV32_FAIRNESS bounds how long ready stays low,
// which only the liveness check needs.
module rvfi_wrapper (
    input clock,
    input reset,
    `RVFI_OUTPUTS
);
    (* keep *) `rvformal_rand_reg [31:0] imem_rdata;
    (* keep *) `rvformal_rand_reg [31:0] dmem_rdata;
    (* keep *) `rvformal_rand_reg imem_ready;
    (* keep *) `rvformal_rand_reg dmem_ready;
    (* keep *) `rvformal_rand_reg [2:0] irq;
    (* keep *) wire [31:0] imem_addr, dmem_addr, dmem_wdata, retire_pc, retire_insn, retire_data;
    (* keep *) wire [4:0] retire_rd;
    (* keep *) wire [3:0] dmem_wstrb;
    (* keep *) wire dmem_read, retire_valid, retire_trap, retire_intr, stall_event, flush_event, imem_valid;

    rv32_core #(.DOT4(`RV32_DOT4), .MEXT(`RV32_MEXT), .ZICSR(`RV32_ZICSR)) uut (
        .clk(clock), .reset(reset),
        .imem_addr(imem_addr), .imem_rdata(imem_rdata),
        .dmem_addr(dmem_addr), .dmem_wdata(dmem_wdata), .dmem_wstrb(dmem_wstrb), .dmem_read(dmem_read), .dmem_rdata(dmem_rdata),
        .retire_valid(retire_valid), .retire_pc(retire_pc), .retire_insn(retire_insn), .retire_rd(retire_rd),
        .retire_data(retire_data), .retire_trap(retire_trap), .stall_event(stall_event), .flush_event(flush_event),
        .imem_valid(imem_valid), .imem_ready(imem_ready), .dmem_ready(dmem_ready),
        .irq_software(irq[0]), .irq_timer(irq[1]), .irq_external(irq[2]), .retire_intr(retire_intr),
        .rvfi_valid(rvfi_valid), .rvfi_order(rvfi_order), .rvfi_insn(rvfi_insn), .rvfi_trap(rvfi_trap),
        .rvfi_halt(rvfi_halt), .rvfi_intr(rvfi_intr), .rvfi_mode(rvfi_mode), .rvfi_ixl(rvfi_ixl),
        .rvfi_rs1_addr(rvfi_rs1_addr), .rvfi_rs2_addr(rvfi_rs2_addr), .rvfi_rs1_rdata(rvfi_rs1_rdata), .rvfi_rs2_rdata(rvfi_rs2_rdata),
        .rvfi_rd_addr(rvfi_rd_addr), .rvfi_rd_wdata(rvfi_rd_wdata), .rvfi_pc_rdata(rvfi_pc_rdata), .rvfi_pc_wdata(rvfi_pc_wdata),
        .rvfi_mem_addr(rvfi_mem_addr), .rvfi_mem_rmask(rvfi_mem_rmask), .rvfi_mem_wmask(rvfi_mem_wmask),
        .rvfi_mem_rdata(rvfi_mem_rdata), .rvfi_mem_wdata(rvfi_mem_wdata)
    );

`ifdef RV32_FAIRNESS
    reg [2:0] imem_waited = 0, dmem_waited = 0;
    always @(posedge clock) begin
        imem_waited <= {imem_waited, !imem_ready};
        dmem_waited <= {dmem_waited, !dmem_ready};
        assume (~imem_waited);
        assume (~dmem_waited);
    end
`endif
endmodule
