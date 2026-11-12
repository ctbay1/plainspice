/**
 * Ctrl+K's list as words are typed: every typed word must start a word of the command (its name, its
 * group or its keywords), and the best come first (the accessibility re-check of step B: "open the
 * help" and Enter opened the settings, whose group is "Settings and help").
 */
import { describe, expect, it } from 'vitest';
import { filterCommands, type Command } from '../../src/app/components/CommandPalette.tsx';

const command = (id: string, label: string, group: string, keywords?: string): Command => ({ id, label, group, ...(keywords ? { keywords } : {}) });
const LIST: Command[] = [
  command('settings', 'Open the settings', 'Settings and help'),
  command('help', 'Open the help', 'Settings and help'),
  command('plain', 'Write results in the plain font', 'Settings and help', 'help font'),
  command('wire', 'Draw a wire', 'Edit', 'connect pins'),
  command('connect', 'Connect or disconnect R2', 'Edit'),
];
const ids = (query: string): string[] => filterCommands(LIST, query).map((c) => c.id);

describe('Ctrl+K’s matches', () => {
  it('put a command whose name starts with what was typed first', () => {
    expect(ids('open the help')[0]).toBe('help');
    expect(ids('connect')[0]).toBe('connect');
  });

  it('then the commands whose names have every typed word, then those found by their group or keywords', () => {
    expect(ids('help')).toEqual(['help', 'settings', 'plain']);
    expect(ids('connect')).toEqual(['connect', 'wire']);
  });

  it('keep each group in one piece, where its best command ranks (the list shows a group once, under its heading)', () => {
    const list: Command[] = [
      command('net', 'Open the Netlist panel', 'Panels'),
      command('turn', 'Turn R1 a quarter turn', 'Edit', 'open rotate'),
      command('num', 'Open the Numbers panel', 'Panels'),
      command('help', 'Open the help', 'Settings and help'),
    ];
    for (const q of ['open', 'the', 'numbers', 'open the']) {
      const groups = filterCommands(list, q).map((c) => c.group);
      const runs = groups.filter((g, i) => i === 0 || g !== groups[i - 1]);
      expect(new Set(runs).size, `${q}: ${groups.join(', ')}`).toBe(runs.length);
    }
    expect(filterCommands(list, 'open the numbers')[0]!.id).toBe('num');
  });

  it('keep the list’s order within a rank, and the whole list when nothing is typed', () => {
    expect(ids('open')).toEqual(['settings', 'help']);
    expect(ids('')).toEqual(LIST.map((c) => c.id));
    expect(ids('nothing like this')).toEqual([]);
  });
});
