/**
 * Ctrl+K's list as words are typed: every typed word must start a word of the command (its name, its
 * group or its keywords), and the best come first (the accessibility re-check of step B: "open the
 * help" and Enter opened the settings, whose group is "Settings and help").
 */
import { describe, expect, it } from 'vitest';
import { commandWords, filterCommands, type Command } from '../../src/app/components/CommandPalette.tsx';
import { PANELS, panelTitle } from '../../src/app/components/Frame.tsx';
import { EXAMPLE_GROUPS, EXAMPLES } from '../../src/app/examples.ts';
import { toolPhrase, type Tool } from '../../src/app/tools.ts';
import { t } from '../../src/i18n/index.ts';

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

describe('after the final reviews: Ctrl+K finds a command by the words it shows', () => {
  // Labels built as the page builds them (App.tsx), from the catalog and the examples themselves.
  const placeLabel = (tool: Tool): string => t('palettePlace', { part: toolPhrase(tool) });
  const exampleLabel = (e: (typeof EXAMPLES)[number]): string => {
    const video = EXAMPLE_GROUPS.find((g) => g.group === e.group && g.video)?.label;
    return video ? t('paletteOpenVideoExample', { name: e.name, video }) : t('paletteOpenExample', { name: e.name });
  };
  const REAL: Command[] = [
    command('run', t('paletteRun'), t('paletteGroupRun'), 'simulate solve ngspice'),
    ...PANELS.map((id) => command(`panel:${id}`, t('paletteOpenPanel', { panel: panelTitle(id) }), t('paletteGroupPanels'), id)),
    command('share', t('paletteShare'), t('paletteGroupCircuit'), 'link copy'),
    command('export:ngspice', t('exportNgspice'), t('paletteGroupCircuit'), 'export save download file cir'),
    command('export:ltspice', t('exportLtspice'), t('paletteGroupCircuit'), 'export save download file net'),
    command('fit', t('zoomFit'), t('paletteGroupDrawing'), 'zoom screen whole'),
    command('add-part', t('paletteAddPart'), t('paletteGroupEdit')),
    ...(['R', 'C', 'L', 'V', 'I', 'E', 'F', 'G', 'H', 'ground'] as const).map((tl) => command(`tool:${tl}`, placeLabel(tl), t('paletteGroupEdit'), `place add tool ${tl}`)),
    command('part:r1', t('paletteChangePart', { name: 'R1', kind: 'resistor' }), t('paletteGroupParts')),
    command('settings', t('paletteSettings'), t('paletteGroupSettings')),
    command('help', t('paletteHelp'), t('paletteGroupSettings')),
    ...EXAMPLES.map((e) => command(`example:${e.id}`, exampleLabel(e), t('paletteGroupExamples'), `${e.id} example circuit video`)),
  ];

  it('cuts what is typed into words as it cuts the commands: hyphens, colons and brackets typed as shown (words W5)', () => {
    expect(commandWords('current-controlled current')).toEqual(['current', 'controlled', 'current']);
    expect(commandWords('(V_Th)')).toEqual(['v_th']);
    expect(commandWords('Example 3: short')).toEqual(['example', '3', 'short']);
    expect(commandWords('Netlist for ngspice (.cir)')).toEqual(['netlist', 'for', 'ngspice', '.cir']);
    const first = (query: string): string | undefined => filterCommands(REAL, query)[0]?.id;
    expect(first('current-controlled current')).toBe('tool:F');
    expect(first('Place a current-controlled current source')).toBe('tool:F');
    expect(first('voltage-controlled voltage')).toBe('tool:E');
    expect(filterCommands(REAL, '(V_Th)').length).toBeGreaterThan(0);
    expect(filterCommands(REAL, '(V_Th)').every((c) => c.label.includes('V_Th'))).toBe(true);
    expect(filterCommands(REAL, 'Example 3: short').map((c) => c.id)).toContain('example:p02-5-short');
  });

  it('finds every command by its own name, exactly as it is shown', () => {
    for (const c of REAL) expect(filterCommands(REAL, c.label).map((x) => x.id), c.label).toContain(c.id);
  });

  it('reads accents or not alike: “Thévenin” and “Thevenin” each find every example spelt either way (words W12)', () => {
    const list: Command[] = [
      command('a', 'Open the example “Thevenin resistance with a dependent source”', 'Examples'),
      command('b', 'Open “Example 1: open circuit (V_Th)” from Thévenin with Dependent Sources', 'Examples'),
      command('c', 'Open the help', 'Settings and help'),
    ];
    expect(filterCommands(list, 'Thévenin').map((c) => c.id)).toEqual(['a', 'b']);
    expect(filterCommands(list, 'Thevenin').map((c) => c.id)).toEqual(['a', 'b']);
    expect(filterCommands(list, 'thevenin dependent').map((c) => c.id)).toEqual(['a', 'b']);
    // And in the real list: both spellings find the same examples.
    const ids = (q: string): string[] => filterCommands(REAL, q).map((c) => c.id).sort();
    expect(ids('Thévenin')).toEqual(ids('Thevenin'));
    expect(ids('Thévenin').length).toBeGreaterThanOrEqual(6);
  });
});
