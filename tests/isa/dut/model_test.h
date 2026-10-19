// This core has no CSRs or trap vector. ECALL emits the trap record and halts the core;
// tests/isa/arch_tb.sv then dumps memory from begin_signature to end_signature.
#ifndef _COMPLIANCE_MODEL_H
#define _COMPLIANCE_MODEL_H
#define ALIGNMENT 2

#define RVMODEL_HALT \
  .global rvmodel_halt; rvmodel_halt: \
  ecall;

#define RVMODEL_BOOT

#define RVMODEL_DATA_BEGIN \
  .align ALIGNMENT; \
  .global begin_signature; begin_signature:

#define RVMODEL_DATA_END \
  .global end_signature; end_signature:

#define RVMODEL_IO_INIT
#define RVMODEL_IO_WRITE_STR(_R, _STR)
#define RVMODEL_IO_CHECK()
#define RVMODEL_IO_ASSERT_GPR_EQ(_S, _R, _I)
#define RVMODEL_IO_ASSERT_SFPR_EQ(_F, _R, _I)
#define RVMODEL_IO_ASSERT_DFPR_EQ(_D, _R, _I)
#define RVMODEL_SET_MSW_INT
#define RVMODEL_CLEAR_MSW_INT
#define RVMODEL_CLEAR_MTIMER_INT
#define RVMODEL_CLEAR_MEXT_INT
#endif
