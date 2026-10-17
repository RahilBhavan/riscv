#include "Vtb.h"
#include "verilated.h"
#include "verilated_cov.h"
#include <memory>
#include <string>

int main(int argc, char** argv) {
    auto context = std::make_unique<VerilatedContext>();
    context->commandArgs(argc, argv);
    auto top = std::make_unique<Vtb>(context.get());
    std::string coverage_path = "build/coverage.dat";
    for (int i = 1; i < argc; ++i) {
        const std::string arg{argv[i]};
        if (arg.rfind("+coverage=", 0) == 0) coverage_path = arg.substr(10);
    }
    while (!context->gotFinish()) {
        top->eval();
        if (!top->eventsPending()) break;
        context->time(top->nextTimeSlot());
    }
    top->final();
    context->coveragep()->write(coverage_path.c_str());
    return context->gotFinish() ? 0 : 1;
}
