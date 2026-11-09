/**
 * Record what native ngspice prints and computes for every fixture, for the golden tests.
 *
 *   node --experimental-strip-types scripts/record-native.ts --ngspice /usr/bin/ngspice [--ngspice /path/to/ngspice-47]
 *
 * For each binary and each tests/fixtures/*.cir it runs, in a temporary directory:
 *   ngspice -b <file>               -> "printed": what a student sees on the command line
 *   ngspice -b -r out.raw <file>    -> "plots":   every vector at full precision (float64)
 * and writes tests/golden/native/ngspice-<major>/<fixture>.json.
 * (Without -r or .print lines, batch mode runs no .dc or .tran at all, so "printed" is only
 * meaningful for .op and .tf; ngspice exits 1 for the others.)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseRawfile } from '../src/engine/rawfile.ts';

const root = resolve(import.meta.dirname, '..');
const fixturesDir = join(root, 'tests/fixtures');
const outRoot = join(root, 'tests/golden/native');

const binaries: string[] = [];
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i] === '--ngspice' && process.argv[i + 1]) binaries.push(process.argv[++i]!);
}
if (binaries.length === 0) binaries.push('ngspice');

for (const bin of binaries) {
  const banner = spawnSync(bin, ['--version'], { encoding: 'utf8' }).stdout;
  const version = /ngspice-([\d.]+)/.exec(banner)?.[1];
  if (!version) throw new Error(`${bin}: cannot read the version from: ${banner}`);
  const major = version.split('.')[0]!;
  const outDir = join(outRoot, `ngspice-${major}`);
  mkdirSync(outDir, { recursive: true });
  console.log(`# ${bin}: ngspice ${version}`);

  for (const file of readdirSync(fixturesDir).filter((f) => f.endsWith('.cir')).sort()) {
    const id = basename(file, '.cir');
    const work = mkdtempSync(join(tmpdir(), `record-${id}-`));
    try {
      copyFileSync(join(fixturesDir, file), join(work, 'circuit.cir'));
      const printed = spawnSync(bin, ['-b', 'circuit.cir'], { cwd: work, encoding: 'utf8', timeout: 60_000 });
      const raw = spawnSync(bin, ['-b', '-r', 'out.raw', 'circuit.cir'], { cwd: work, encoding: 'utf8', timeout: 60_000 });
      if (raw.status !== 0) throw new Error(`${id}: ngspice -b -r exited ${raw.status}\n${raw.stderr}`);
      const plots = parseRawfile(readFileSync(join(work, 'out.raw')));
      const record = {
        fixture: `tests/fixtures/${file}`,
        netlist: readFileSync(join(fixturesDir, file), 'utf8'),
        ngspice: {
          version,
          banner: banner.split('\n').filter((l) => l.includes('ngspice-') || l.includes('Compiled')).map((l) => l.replace(/\*+/g, '').trim()),
          host: execFileSync('uname', ['-sm'], { encoding: 'utf8' }).trim(),
        },
        commands: { printed: 'ngspice -b circuit.cir', plots: 'ngspice -b -r out.raw circuit.cir' },
        printed: {
          exitCode: printed.status,
          // Drop the resource-usage lines at the end; they change on every run.
          stdout: stripVolatile(printed.stdout),
          stderr: stripVolatile(printed.stderr),
        },
        plots: plots.map((p) => ({
          plotname: p.plotname,
          flags: p.flags,
          points: p.points,
          vectors: p.variables.map((v, i) => ({ name: v.name, type: v.type, values: Array.from(p.real[i] ?? []) })),
        })),
      };
      writeFileSync(join(outDir, `${id}.json`), `${JSON.stringify(record, null, 1)}\n`);
      console.log(`  ${id}: ${plots.map((p) => `${p.plotname} (${p.points} points)`).join(', ')}`);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
}

function stripVolatile(text: string): string {
  return text
    .split('\n')
    .filter((l) => !/^(Total (analysis|elapsed) time|Total DRAM available|DRAM currently available|Maximum ngspice program size|Current ngspice program size|Shared ngspice pages|Text \(code\) pages|Stack =|Library pages)/.test(l.trim()))
    .join('\n');
}
