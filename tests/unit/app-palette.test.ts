/**
 * Ctrl+K's list as words are typed: every typed word must start a word of the command (its name, its
 * group or its keywords), and the best come first (the accessibility re-check of step B: "open the
 * help" and Enter opened the settings, whose group is "Settings and help").
 */
import { describe, expect, it } from 'vitest';
import { commandWords, filterCommands, type Command } from '../../src/app/components/CommandPalette.tsx';
import { PANELS, panelTitle } from '../../src/app/components/Frame.tsx';
import { EXAMPLE_GROUPS, EXAMPLES } from '../../src/app/examples.ts';
import { toolAliases, toolPhrase, type Tool } from '../../src/app/tools.ts';
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
    ...(['R', 'C', 'L', 'V', 'I', 'E', 'F', 'G', 'H', 'ground'] as const).map((tl) => ({ ...command(`tool:${tl}`, placeLabel(tl), t('paletteGroupEdit'), `place add tool ${tl}`), aliases: toolAliases(tl) })),
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

  it('puts a dependent source’s Place command first for its other names: “dependent”, “dependent source”, “cccs” (the critic of words W4)', () => {
    const shown = (query: string): string[] => filterCommands(REAL, query).map((c) => c.id);
    // The channel's word: the four Place commands first, in the margin's order, before the examples named with it.
    for (const q of ['dependent', 'dependent source', 'Dependent', 'dep', 'dependent sources', 'Dependent sources']) {
      expect(shown(q).slice(0, 4), q).toEqual(['tool:E', 'tool:F', 'tool:G', 'tool:H']);
      expect(shown(q).some((id) => id.startsWith('example:')), q).toBe(true);
    }
    // The textbook's initials, each its own source first.
    expect(shown('vcvs')[0]).toBe('tool:E');
    expect(shown('cccs')[0]).toBe('tool:F');
    expect(shown('vccs')[0]).toBe('tool:G');
    expect(shown('ccvs')[0]).toBe('tool:H');
    expect(shown('VCVS')[0]).toBe('tool:E');
    // "controlled" (in their names) still finds the four, and an example's own name still finds that example first.
    expect(shown('controlled').slice(0, 4)).toEqual(['tool:E', 'tool:F', 'tool:G', 'tool:H']);
    const example = REAL.find((c) => c.id === 'example:sp01-3-dependent-sources')!;
    expect(example.label).toMatch(/Dependent sources E, G, F and H/);
    expect(shown(example.label)[0]).toBe(example.id);
    // Only the four have other names.
    expect((['R', 'C', 'L', 'V', 'I', 'ground', 'select', 'wire'] as const).map((tl) => toolAliases(tl))).toEqual([[], [], [], [], [], [], [], []]);
    // Their names as the margin, its menu and the phone's Parts sheet show them ("Dependent sources", the group), and their initials.
    expect(toolAliases('E')).toEqual(['Dependent source', 'Dependent sources', 'vcvs']);
    expect(toolAliases('H')).toEqual(['Dependent source', 'Dependent sources', 'ccvs']);
    expect(toolAliases('F')).toEqual([t('toolControlled'), t('partsGroupControlled'), 'cccs']);
    expect(t('controlledMenu')).toBe(t('partsGroupControlled'));
  });

  it('ranks a command by another name of its own as by words of its name, never as its start', () => {
    const list: Command[] = [
      command('example', 'Open the example “Dependent sources”', 'Examples'),
      { ...command('tool', 'Place a current-controlled current source', 'Edit the drawing', 'place F'), aliases: ['dependent source', 'cccs'] },
      command('draw', 'Draw a wire', 'Edit the drawing'),
      command('kw', 'Something else', 'Other', 'dependent current'),
    ];
    const order = (q: string): string[] => filterCommands(list, q).map((c) => c.id);
    // An alias with the typed word, and the example by its name: the list's order; a keyword: last.
    expect(order('dependent')).toEqual(['example', 'tool', 'kw']);
    expect(order('cccs')).toEqual(['tool']);
    // A name that starts with what was typed comes before an alias that does (the second critic of W4:
    // "d" put a dependent source before Draw a wire).
    expect(order('d')).toEqual(['draw', 'tool', 'example', 'kw']);
    // Every typed word in its names (an alias's words and the label's together): before a keyword.
    expect(order('dependent current')).toEqual(['tool', 'kw']);
    // Both by their names: the list's order (and the alias never makes "sources" a word of the tool).
    expect(order('source')).toEqual(['example', 'tool']);
    expect(order('sources')).toEqual(['example']);
  });

  it('keeps the command a short query starts first: “v” the voltage source, “d” Draw a wire, “de” Delete R1 (the second critic of words W4)', () => {
    // As the page lists them (App.tsx): the Wire tool after the parts, and with a part selected its commands next.
    const wireAt = REAL.findIndex((c) => c.id === 'tool:ground') + 1;
    const withWire = [...REAL.slice(0, wireAt), command('tool:wire', t('paletteWire'), t('paletteGroupEdit'), 'wire draw line'), ...REAL.slice(wireAt)];
    const g = t('paletteGroupEdit');
    const name = 'R1';
    const r1Selected = [
      ...withWire.slice(0, wireAt + 1),
      command('turn:r1', t('paletteTurn', { name }), g, 'turn rotate quarter'),
      command('mirror:r1', t('paletteMirror', { name }), g, 'mirror flip'),
      command('reverse:r1', t('paletteReverse', { name }), g, 'reverse swap ends nodes polarity'),
      command('move:r1', t('paletteMove', { name }), g, 'move drag pick place'),
      command('conn:r1', t('paletteConnections', { name }), g, 'connect disconnect wire node ends connections'),
      command('delete:r1', t('paletteDelete', { name }), g, 'delete remove erase'),
      ...withWire.slice(wireAt + 1),
    ];
    const first = (list: readonly Command[], query: string): string | undefined => filterCommands(list, query)[0]?.id;
    for (const list of [withWire, r1Selected]) {
      // The voltage source's own letter, its badge: the voltage source, not "vcvs"'s E.
      expect(first(list, 'v')).toBe('tool:V');
      expect(first(list, 'V')).toBe('tool:V');
      // Draw a wire starts with d ("dependent source" no longer puts E first).
      expect(first(list, 'd')).toBe('tool:wire');
      // The four still come first for the channel's word, and each set of initials finds its own source.
      expect(filterCommands(list, 'dependent').slice(0, 4).map((c) => c.id)).toEqual(['tool:E', 'tool:F', 'tool:G', 'tool:H']);
      expect(first(list, 'vcvs')).toBe('tool:E');
      expect(first(list, 'cccs')).toBe('tool:F');
    }
    // "cccs" and "ccvs" start with c too: the command whose name does stays first (Change R1, or with R1
    // selected, Connect or disconnect R1, whose group comes first).
    expect(first(withWire, 'c')).toBe('part:r1');
    expect(first(r1Selected, 'c')).toBe('conn:r1');
    // On the way to "delete": Delete R1, not E.
    expect(first(r1Selected, 'de')).toBe('delete:r1');
    expect(first(r1Selected, 'del')).toBe('delete:r1');
  });
});
