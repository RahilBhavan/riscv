// Measurement shell: synchronous, unconstrained board I/O. Not a board design.
// All core outputs are observable through a rotating scan register.
module timing_top(input wire clk, input wire reset, input wire [31:0] insn,
                  input wire [31:0] load_data, output wire [31:0] observe);
    reg [31:0] insn_q, data_q;
    wire [31:0] ia, da, dw, pc, instruction, result;
    wire [4:0] rd;
    wire [3:0] strb;
    wire read_en, valid, trap, stall, flush;
    reg [31:0] scan;
    rv32_core core(clk,reset,ia,insn_q,da,dw,strb,read_en,data_q,
                   valid,pc,instruction,rd,result,trap,stall,flush);
    always @(posedge clk) begin
        insn_q<=insn; data_q<=load_data;
        if(reset) scan<=0;
        else scan<={scan[30:0],scan[31]} ^ ia ^ da ^ dw ^ pc ^ instruction ^ result ^
                   {18'b0,rd,strb,read_en,valid,trap,stall,flush};
    end
    assign observe=scan;
endmodule
