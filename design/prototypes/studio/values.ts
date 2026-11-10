/**
 * Studio prototype: value sliders and arrow-key stepping. Numbers are read the way ngspice reads
 * them (src/spice/numbers.ts: readNumber) and written back in netlist spelling (formatSpiceNumber:
 * "3.3k", "1meg", never the "M" trap), so the slider can never produce a value ngspice misreads.
 */
import { formatSpiceNumber, readNumber } from '../../../src/spice/numbers.ts';
import { formatSI } from '../shared/sim.ts';

/** Friendly resistor steps: the E12 series plus 2, 3 and 5, so 2k and 3k are on the slider. */
const NICE = [1, 1.2, 1.5, 1.8, 2, 2.2, 2.7, 3, 3.3, 3.9, 4.7, 5, 5.6, 6.8, 8.2];

export interface SliderModel {
  /** Number of slider positions (the input's max is count − 1). */
  count: number;
  valueAt(index: number): number;
  /** The nearest position for a value (values outside the range clamp to the ends). */
  indexOf(value: number): number;
  unit: string;
  /** Labels under the track: [position, text]. */
  ticks: [number, string][];
}

function steps(kind: 'R' | 'V'): number[] {
  if (kind === 'V') return Array.from({ length: 25 }, (_, i) => i * 0.5); // 0 … 12 V
  const out: number[] = [];
  for (const decade of [100, 1_000, 10_000]) for (const n of NICE) out.push(Math.round(n * decade * 1000) / 1000);
  out.push(100_000);
  return out; // 100 Ω … 100 kΩ
}

const MODELS = new Map<string, SliderModel>();

export function sliderModel(kind: 'R' | 'V'): SliderModel {
  const cached = MODELS.get(kind);
  if (cached) return cached;
  const values = steps(kind);
  const unit = kind === 'V' ? 'V' : 'Ω';
  const indexOf = (value: number): number => {
    if (!Number.isFinite(value)) return 0;
    let best = 0;
    let bestDistance = Infinity;
    values.forEach((v, i) => {
      // Resistors: compare on a log scale (2.4k is nearer 2.2k than 2.7k by ratio).
      const d = kind === 'R' ? Math.abs(Math.log(Math.max(value, 1e-12)) - Math.log(v)) : Math.abs(value - v);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    });
    return best;
  };
  const tickValues = kind === 'V' ? [0, 3, 6, 9, 12] : [100, 1_000, 10_000, 100_000];
  const model: SliderModel = {
    count: values.length,
    valueAt: (i) => values[Math.max(0, Math.min(values.length - 1, Math.round(i)))]!,
    indexOf,
    unit,
    ticks: tickValues.map((v) => [indexOf(v), formatSI(v, unit)]),
  };
  MODELS.set(kind, model);
  return model;
}

/** The value ngspice reads from the text (undefined when it is not a number). */
export function readValue(text: string): number | undefined {
  const reading = readNumber(text.trim());
  return reading && Number.isFinite(reading.value) ? reading.value : undefined;
}

/** Netlist spelling for a slider value: 3300 -> "3.3k", 0.5 -> "500m", 6 -> "6". */
export function spell(value: number): string {
  return formatSpiceNumber(value);
}

/**
 * The next value up or down from `text`, for ↑/↓ in a value field: the next slider step
 * (Shift: ten times bigger or smaller for resistors, 1 V for sources).
 */
export function stepText(kind: 'R' | 'V', text: string, direction: 1 | -1, big: boolean): string {
  const value = readValue(text);
  const model = sliderModel(kind);
  if (value === undefined) return spell(model.valueAt(model.indexOf(kind === 'R' ? 1000 : 6)));
  if (kind === 'R' && big) return spell(Number((value * (direction > 0 ? 10 : 0.1)).toPrecision(6)));
  if (kind === 'V' && big) return spell(Number((value + direction).toPrecision(6)));
  if (kind === 'V') return spell(Number((value + direction * 0.5).toPrecision(6)));
  // Resistors: the next step of the series beyond the current value (works beyond the slider's range too).
  const decade = 10 ** Math.floor(Math.log10(value));
  const candidates: number[] = [];
  for (const d of [decade / 10, decade, decade * 10]) for (const n of NICE) candidates.push(Number((n * d).toPrecision(6)));
  candidates.sort((a, b) => a - b);
  const next = direction > 0 ? candidates.find((c) => c > value * 1.0001) : [...candidates].reverse().find((c) => c < value * 0.9999);
  return spell(next ?? value);
}
