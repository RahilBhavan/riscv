`timescale 1ns/1ps
// Complete teaching subset: ADDI, ADD, LW, SW and EBREAK only.
// Harvard combinational reads, aligned word data, no access-fault interface.
// This is NOT the measured rv32_core and has no pipeline/retirement interface.
module learning_single_cycle (
    input wire clk, reset,
    output wire [31:0] imem_addr, input wire [31:0] insn,
    output wire [31:0] dmem_addr, dmem_wdata,
    output wire [3:0] dmem_wstrb, input wire [31:0] dmem_rdata,
    output reg halted
);
    reg [31:0] pc;
    reg [31:0] regs[0:31];
    wire [6:0] op=insn[6:0];
    wire [4:0] rd=insn[11:7], rs1=insn[19:15], rs2=insn[24:20];
    wire [31:0] a=rs1==0 ? 32'b0 : regs[rs1];
    wire [31:0] b=rs2==0 ? 32'b0 : regs[rs2];
    wire [31:0] ii={{20{insn[31]}},insn[31:20]};
    wire [31:0] si={{20{insn[31]}},insn[31:25],insn[11:7]};
    wire [31:0] address=a+(op==7'h23 ? si : ii);
    reg legal;
    always @* begin
        legal=0;
        case(op)
            7'h13: legal=insn[14:12]==0;
            7'h33: legal=insn[14:12]==0 && insn[31:25]==0;
            7'h03,7'h23: legal=insn[14:12]==2 && address[1:0]==0;
            7'h73: legal=insn==32'h00100073;
            default: legal=0;
        endcase
    end
    assign imem_addr=pc;
    assign dmem_addr={address[31:2],2'b0};
    assign dmem_wdata=b;
    assign dmem_wstrb=(!reset && !halted && legal && op==7'h23) ? 4'hf : 4'h0;
    integer i;
    always @(posedge clk) begin
        if(reset) begin
            pc<=0; halted<=0;
            for(i=0;i<32;i=i+1) regs[i]<=0;
        end else if(!halted) begin
            if(!legal) halted<=1;
            else begin
                pc<=pc+4;
                case(op)
                    7'h13: if(rd!=0) regs[rd]<=a+ii;
                    7'h33: if(rd!=0) regs[rd]<=a+b;
                    7'h03: if(rd!=0) regs[rd]<=dmem_rdata;
                    7'h73: halted<=1;
                    default: begin end // SW updates external memory at this edge.
                endcase
            end
            regs[0]<=0;
        end
    end
endmodule
module single_cycle_tb;
    reg clk=0,reset=1;
    always #5 clk=~clk;
    wire [31:0] ia,da,dw;
    wire [3:0] we;
    wire halted;
    reg [31:0] rom[0:15],mem[0:63];
    learning_single_cycle dut(clk,reset,ia,rom[ia[5:2]],da,dw,we,mem[da[7:2]],halted);
    integer i,cycles;
    always @(posedge clk) if(!reset && we==4'hf) mem[da[7:2]]<=dw;
    initial begin
        for(i=0;i<16;i=i+1) rom[i]=32'h00000013;
        for(i=0;i<64;i=i+1) mem[i]=0;
        rom[0]=32'h00700093; // addi x1,x0,7
        rom[1]=32'h00300113; // addi x2,x0,3
        rom[2]=32'h002081b3; // add x3,x1,x2
        rom[3]=32'h08302023; // sw x3,128(x0)
        rom[4]=32'h08002203; // lw x4,128(x0)
        rom[5]=32'h00100073; // ebreak
        repeat(2) @(negedge clk);
        reset=0;
        cycles=0;
        while(!halted && cycles<50) begin @(negedge clk); cycles=cycles+1; end
        if(!halted || dut.regs[0]!==0 || dut.regs[3]!==10 ||
           dut.regs[4]!==10 || mem[32]!==10) $fatal(1,"single-cycle subset result wrong");
        $display("PASS single_cycle: x3=10 x4=10 memory[128]=10");
        $finish;
    end
endmodule
