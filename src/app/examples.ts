/**
 * The examples: the fixtures from Tarık's brief (tests/fixtures/*.cir, the same files the golden
 * tests check against native ngspice), each with a friendly name, in teaching order.
 */
import { t, type MessageKey } from '../i18n/index.ts';

const files = import.meta.glob<string>('../../tests/fixtures/*.cir', { query: '?raw', import: 'default', eager: true });

export type ExampleGroup = 'sources' | 'traps' | 'analyses';

export interface Example {
  /** The fixture's file name without .cir, e.g. "f5-thevenin-cccs". */
  id: string;
  group: ExampleGroup;
  nameKey: MessageKey;
  netlist: string;
}

const ORDER: readonly { id: string; group: ExampleGroup; nameKey: MessageKey }[] = [
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

const byId = new Map(Object.entries(files).map(([path, text]) => [path.split('/').pop()!.replace(/\.cir$/, ''), text]));

export const EXAMPLES: readonly Example[] = ORDER.flatMap((e) => {
  const netlist = byId.get(e.id);
  return netlist === undefined ? [] : [{ ...e, netlist }];
});

export const EXAMPLE_GROUPS: readonly { group: ExampleGroup; labelKey: MessageKey }[] = [
  { group: 'sources', labelKey: 'exampleGroupSources' },
  { group: 'traps', labelKey: 'exampleGroupTraps' },
  { group: 'analyses', labelKey: 'exampleGroupAnalyses' },
];

/** The circuit a first visit opens with: the channel's Thevenin example (F5). */
export const DEFAULT_EXAMPLE_ID = 'f5-thevenin-cccs';

export function exampleById(id: string): Example | undefined {
  return EXAMPLES.find((e) => e.id === id);
}

export function exampleName(e: Example): string {
  return t(e.nameKey);
}
