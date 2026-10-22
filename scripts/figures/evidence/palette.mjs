// Project tokens (rahil-design dark surface) plus the two neutral series steps, and a build-time contrast and colour-vision check.
export const C = {
  bg: '#111214', surface: '#202124', ink: '#F5F5EF', secondary: '#B7B8B1', accent: '#FFE500',
  grid: '#2C2D31', axis: '#62645F', line: '#424348', gray1: '#A3A59D', gray2: '#75776F',
};

export const SERIES = {dot4: C.accent, rv32i_qsquare: C.ink, rv32i_shift: C.gray1, rv32i_lb: C.gray2};

const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const rgb = hex => [1, 3, 5].map(i => lin(parseInt(hex.slice(i, i + 2), 16)));
const luminance = hex => { const [r, g, b] = rgb(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// Machado, Oliveira and Fernandes (2009), severity 1.0, applied in linear RGB.
const CVD = {
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const oklab = ([r, g, b]) => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
};
const simulate = (hex, M) => { const c = rgb(hex); return M.map(row => Math.min(1, Math.max(0, row[0] * c[0] + row[1] * c[1] + row[2] * c[2]))); };
const deltaE = (a, b, M) => Math.hypot(...oklab(simulate(a, M)).map((v, i) => v - oklab(simulate(b, M))[i])) * 100;

export function checkPalette() {
  const rows = [];
  const fail = [];
  for (const [name, hex] of Object.entries({ink: C.ink, secondary: C.secondary})) {
    const r = contrast(hex, C.bg);
    rows.push(`text ${name} ${hex} on ${C.bg}: ${r.toFixed(2)}:1`);
    if (r < 4.5) fail.push(`text ${name} contrast ${r.toFixed(2)} < 4.5`);
  }
  for (const [name, hex] of Object.entries(SERIES)) {
    const r = contrast(hex, C.bg);
    rows.push(`mark ${name} ${hex} on ${C.bg}: ${r.toFixed(2)}:1`);
    if (r < 3) fail.push(`mark ${name} contrast ${r.toFixed(2)} < 3`);
  }
  const entries = Object.entries(SERIES);
  for (const [vision, M] of Object.entries(CVD)) {
    let worst = {d: Infinity};
    for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
      const d = deltaE(entries[i][1], entries[j][1], M);
      if (d < worst.d) worst = {d, pair: `${entries[i][0]}/${entries[j][0]}`};
    }
    rows.push(`${vision}: worst series pair ${worst.pair} OKLab dE ${worst.d.toFixed(1)}`);
    if (worst.d < 8) fail.push(`${vision} pair ${worst.pair} dE ${worst.d.toFixed(1)} < 8`);
  }
  if (fail.length) throw Error(`palette check failed: ${fail.join('; ')}`);
  return rows;
}
