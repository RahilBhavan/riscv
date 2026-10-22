// Copies output/figures into a checkout of the rahilbhavan.com site repo, served at /riscv.
import {cpSync, existsSync, rmSync} from 'node:fs';
import {join} from 'node:path';

const site = process.argv[2];
if (!site || !existsSync(join(site, 'astro.config.mjs'))) {
  console.error('usage: node scripts/figures/publish-site.mjs <path to a RahilBhavan/website checkout>');
  process.exit(1);
}
const source = new URL('../../output/figures/', import.meta.url).pathname;
const target = join(site, 'public/riscv');
rmSync(target, {recursive: true, force: true});
cpSync(source, target, {recursive: true, filter: path => !path.includes('/evidence/svg')});
console.log(`copied ${source} to ${target}`);
