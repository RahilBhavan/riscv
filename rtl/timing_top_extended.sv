// Measurement shell for the MEXT=1 ZICSR=1 core. Like timing_top, but the ready and interrupt
// inputs come from registered pins, so synthesis keeps the wait-state and interrupt logic.
module timing_top_extended(input wire clk, input wire reset, input wire [31:0] insn,
                           input wire [31:0] load_data, input wire [4:0] control, output wire [31:0] observe);
    reg [31:0] insn_q, data_q;
    reg [4:0] control_q;
    wire [31:0] ia, da, dw, pc, instruction, result;
    wire [4:0] rd;
    wire [3:0] strb;
    wire read_en, valid, trap, stall, flush, fetch, intr;
    reg [31:0] scan;
    rv32_core #(.MEXT(1), .ZICSR(1)) core(clk,reset,ia,insn_q,da,dw,strb,read_en,data_q,
                   valid,pc,instruction,rd,result,trap,stall,flush,
                   fetch,control_q[0],control_q[1],control_q[2],control_q[3],control_q[4],intr);
    always @(posedge clk) begin
        insn_q<=insn; data_q<=load_data; control_q<=control;
        if(reset) scan<=0;
        else scan<={scan[30:0],scan[31]} ^ ia ^ da ^ dw ^ pc ^ instruction ^ result ^
                   {16'b0,rd,strb,read_en,valid,trap,stall,flush,fetch,intr};
    end
    assign observe=scan;
endmodule
