// DOT4 as the RTL computes it (rtl/rv32_core.sv lines 53-55 and 106):
// lane i is bits [8i+7:8i] of each source, read as a signed byte; the four
// products are summed into a signed 32-bit result. build.mjs inlines this file
// into the page with the `export` keywords removed, so it must stay plain JS.
export const LANES = 4;

export const signed8 = n => ((n & 255) ^ 128) - 128;

export const lanesOf = word => Array.from({length: LANES}, (_, i) => signed8(word >>> (8 * i)));

export function pack(lanes) {
  if (lanes.length !== LANES || lanes.some(n => !Number.isInteger(n) || n < -128 || n > 127))
    throw new RangeError('each lane is an integer from -128 to 127');
  return lanes.reduce((w, n, i) => w | ((n & 255) << (8 * i)), 0) >>> 0;
}

export function dot4(rs1, rs2) {
  const a = lanesOf(rs1 >>> 0), b = lanesOf(rs2 >>> 0);
  const products = a.map((x, i) => x * b[i]);
  const low = products[0] + products[1], high = products[2] + products[3];
  const sum = (low + high) | 0;
  return {a, b, products, low, high, sum, rd: sum >>> 0};
}

export const hex32 = n => '0x' + (n >>> 0).toString(16).padStart(8, '0');

// Two's complement bits of n in `width` bits, most significant first.
export const bitsOf = (n, width) => Array.from({length: width}, (_, i) => (n >>> (width - 1 - i)) & 1);

export const DOT4_ENCODING = {opcode: 0x0b, funct3: 0, funct7: 0};

export function encodeDot4(rd, rs1, rs2) {
  for (const r of [rd, rs1, rs2]) if (!Number.isInteger(r) || r < 0 || r > 31) throw new RangeError('registers are x0 to x31');
  const {opcode, funct3, funct7} = DOT4_ENCODING;
  return ((funct7 << 25) | (rs2 << 20) | (rs1 << 15) | (funct3 << 12) | (rd << 7) | opcode) >>> 0;
}
