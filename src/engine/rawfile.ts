/**
 * Reader for ngspice/SPICE3 rawfiles: what `ngspice -b -r out.raw circuit.cir` writes.
 *
 * Handles binary (float64, little-endian) and ASCII files, real and complex plots, and
 * several plots back to back (one per analysis). Header lines are ASCII; names are read as
 * Latin-1 bytes, never as UTF-16 string offsets, so a non-ASCII title cannot shift the data.
 */
import type { RawPlot, RawVariable } from './types.ts';

const LF = 0x0a;
const CR = 0x0d;

const latin1 = new TextDecoder('latin1');

export class RawfileError extends Error {
  override name = 'RawfileError';
}

export function parseRawfile(input: Uint8Array | ArrayBuffer): RawPlot[] {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const plots: RawPlot[] = [];
  let pos = 0;

  const readLine = (): string => {
    let eol = buf.indexOf(LF, pos);
    if (eol < 0) eol = buf.length;
    let end = eol;
    if (end > pos && buf[end - 1] === CR) end -= 1;
    const line = latin1.decode(buf.subarray(pos, end));
    pos = Math.min(eol + 1, buf.length);
    return line;
  };

  const isSpace = (b: number | undefined): boolean => b === LF || b === CR || b === 0x20 || b === 0x09;

  while (pos < buf.length) {
    while (pos < buf.length && isSpace(buf[pos])) pos += 1;
    if (pos >= buf.length) break;

    let title = '';
    let date = '';
    let plotname = '';
    let flags = '';
    let nVars = -1;
    let nPoints = -1;
    const variables: RawVariable[] = [];
    let inVariables = false;
    let kind: 'binary' | 'ascii' | null = null;

    const addVariable = (text: string): void => {
      const parts = text.trim().split(/\s+/);
      const [index, name, type] = parts;
      if (index === undefined || name === undefined || type === undefined) {
        throw new RawfileError(`bad variable line ${JSON.stringify(text)}`);
      }
      variables.push({ index: Number(index), name, type });
    };

    while (pos < buf.length) {
      const line = readLine();
      if (/^Binary:\s*$/i.test(line)) {
        kind = 'binary';
        break;
      }
      if (/^Values:\s*$/i.test(line)) {
        kind = 'ascii';
        break;
      }
      if (inVariables && /^\s/.test(line)) {
        if (line.trim()) addVariable(line);
        continue;
      }
      if (!line.trim()) continue;
      const m = /^([^:]+):\s?(.*)$/.exec(line);
      if (!m) throw new RawfileError(`unexpected header line ${JSON.stringify(line)}`);
      const key = (m[1] ?? '').trim().toLowerCase();
      const value = (m[2] ?? '').trim();
      inVariables = false;
      switch (key) {
        case 'title':
          title = value;
          break;
        case 'date':
          date = value;
          break;
        case 'plotname':
          plotname = value;
          break;
        case 'flags':
          flags = value;
          break;
        case 'no. variables':
          nVars = Number.parseInt(value, 10);
          break;
        case 'no. points':
          nPoints = Number.parseInt(value, 10);
          break;
        case 'variables':
          inVariables = true;
          if (value) addVariable(value);
          break;
        default:
          break; // e.g. "Command:" lines; not needed
      }
    }

    if (kind === null) throw new RawfileError('header without a Binary: or Values: section');
    if (nVars < 0 || nPoints < 0) throw new RawfileError('header without variable or point counts');
    if (variables.length !== nVars) {
      throw new RawfileError(`${variables.length} variables listed, header says ${nVars}`);
    }

    const complex = /\bcomplex\b/i.test(flags);
    const real = Array.from({ length: nVars }, () => new Float64Array(nPoints));
    const imag = complex ? Array.from({ length: nVars }, () => new Float64Array(nPoints)) : undefined;

    if (kind === 'binary') {
      const need = nPoints * nVars * (complex ? 16 : 8);
      if (pos + need > buf.length) {
        throw new RawfileError(`binary block truncated (need ${need} bytes, have ${buf.length - pos})`);
      }
      for (let p = 0; p < nPoints; p += 1) {
        for (let v = 0; v < nVars; v += 1) {
          real[v]![p] = view.getFloat64(pos, true);
          pos += 8;
          if (imag) {
            imag[v]![p] = view.getFloat64(pos, true);
            pos += 8;
          }
        }
      }
    } else {
      // ASCII: each point is "<index>\t<value 0>" followed by "\t<value i>" lines;
      // complex values are written "re,im".
      for (let p = 0; p < nPoints; p += 1) {
        const tokens: string[] = [];
        while (tokens.length < nVars + 1 && pos < buf.length) {
          const l = readLine().trim();
          if (l) tokens.push(...l.split(/\s+/));
        }
        for (let v = 0; v < nVars; v += 1) {
          const t = tokens[v + 1];
          if (t === undefined) throw new RawfileError(`ASCII block truncated at point ${p}`);
          if (imag) {
            const [re, im] = t.split(',');
            real[v]![p] = Number(re);
            imag[v]![p] = Number(im);
          } else {
            real[v]![p] = Number(t);
          }
        }
      }
    }

    const plot: RawPlot = { title, date, plotname, flags, complex, points: nPoints, variables, real };
    if (imag) plot.imag = imag;
    plots.push(plot);
  }
  return plots;
}
