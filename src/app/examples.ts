/**
 * The examples, in the Examples menu's order:
 *
 * 1. the circuits of the Solved Circuits videos, in channel order (SPICE for Beginners, then p01,
 *    p02 and e04): examples/<video>/*.cir with examples/examples.json, each netlist crediting its
 *    video; tests/golden/examples.test.ts checks each against the channel's native ngspice runs;
 * 2. the basics: the fixtures from Tarık's first brief (tests/fixtures/*.cir, checked against
 *    native ngspice by the golden tests), including the only .dc and .tran examples.
 */
import manifest from '../../examples/examples.json';
import { t, type MessageKey } from '../i18n/index.ts';

const videoFiles = import.meta.glob<string>('../../examples/*/*.cir', { query: '?raw', import: 'default', eager: true });
const fixtureFiles = import.meta.glob<string>('../../tests/fixtures/*.cir', { query: '?raw', import: 'default', eager: true });

export interface Example {
  /** A stable id: the file name without .cir ("sp01-1-example-1", "f5-thevenin-cccs"). */
  id: string;
  /** The menu section it belongs to (a video id, or a group of the basics). */
  group: string;
  /** The name in the menu. */
  name: string;
  netlist: string;
}

export interface ExampleGroup {
  group: string;
  label: string;
  /** For a video: its YouTube address, to credit it. */
  video?: string;
}

const fileName = (path: string): string => path.split('/').pop()!.replace(/\.cir$/, '');
const videoText = new Map(Object.entries(videoFiles).map(([path, text]) => [fileName(path), text]));
const fixtureText = new Map(Object.entries(fixtureFiles).map(([path, text]) => [fileName(path), text]));

const VIDEO_EXAMPLES: Example[] = manifest.examples.flatMap((e) => {
  const netlist = videoText.get(e.id);
  return netlist === undefined ? [] : [{ id: e.id, group: e.video, name: e.name, netlist }];
});

const BASICS: readonly { id: string; group: string; nameKey: MessageKey }[] = [
  { id: 'f1a-voltage-source', group: 'sources', nameKey: 'exampleF1a' },
  { id: 'f1b-voltage-source-swapped', group: 'sources', nameKey: 'exampleF1b' },
  { id: 'f2a-current-source', group: 'sources', nameKey: 'exampleF2a' },
  { id: 'f2b-current-source-swapped', group: 'sources', nameKey: 'exampleF2b' },
  { id: 'f3a-1M-trap', group: 'traps', nameKey: 'exampleF3a' },
  { id: 'f3b-1meg', group: 'traps', nameKey: 'exampleF3b' },
  { id: 'f4-tf-output-impedance', group: 'analyses', nameKey: 'exampleF4' },
  { id: 'f5-thevenin-cccs', group: 'analyses', nameKey: 'exampleF5' },
  { id: 'd1-dc-divider-sweep', group: 'analyses', nameKey: 'exampleD1' },
  { id: 't1-tran-rc-charge', group: 'analyses', nameKey: 'exampleT1' },
];

export const EXAMPLES: readonly Example[] = [
  ...VIDEO_EXAMPLES,
  ...BASICS.flatMap((e) => {
    const netlist = fixtureText.get(e.id);
    return netlist === undefined ? [] : [{ id: e.id, group: e.group, name: t(e.nameKey), netlist }];
  }),
];

export const EXAMPLE_GROUPS: readonly ExampleGroup[] = [
  ...manifest.videos.map((v) => ({ group: v.id, label: v.short, video: `https://youtu.be/${v.youtube}` })),
  { group: 'sources', label: t('exampleGroupSources') },
  { group: 'traps', label: t('exampleGroupTraps') },
  { group: 'analyses', label: t('exampleGroupAnalyses') },
];

/** The circuit a first visit opens with: the channel's Thevenin example (F5). */
export const DEFAULT_EXAMPLE_ID = 'f5-thevenin-cccs';

export function exampleById(id: string): Example | undefined {
  return EXAMPLES.find((e) => e.id === id);
}

export function exampleName(e: Example): string {
  return e.name;
}
