// @vitest-environment jsdom
/**
 * Which circuit the app opens with (src/app/startup.ts): a share link first (and whether to run
 * it), then the netlist saved on this device, then the first example (F5). Links that cannot be
 * opened say why; a fragment that is not a share link is ignored.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_EXAMPLE_ID, EXAMPLE_GROUPS, EXAMPLES, exampleById } from '../../src/app/examples.ts';
import { clearShareFragment, decideStartup, readStartup } from '../../src/app/startup.ts';
import { encodeShare } from '../../src/share/link.ts';

const example = { id: 'f5-thevenin-cccs', netlist: '* F5\n.op\n.end\n' };

afterEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/');
});

describe('decideStartup', () => {
  it('a share link wins, with its run flag', () => {
    expect(decideStartup({ share: { ok: true, netlist: '* shared\n', run: true }, saved: '* mine\n', example })).toEqual({
      source: 'share',
      netlist: '* shared\n',
      run: true,
    });
  });

  it('then the netlist saved on this device', () => {
    expect(decideStartup({ share: null, saved: '* mine\n', example })).toEqual({ source: 'saved', netlist: '* mine\n' });
  });

  it('then the first example (F5); an empty saved netlist does not count', () => {
    expect(decideStartup({ share: null, saved: null, example })).toEqual({ source: 'example', netlist: example.netlist, exampleId: 'f5-thevenin-cccs' });
    expect(decideStartup({ share: null, saved: '  \n', example }).source).toBe('example');
  });

  it('a damaged link says why, and the app opens the next choice', () => {
    const d = decideStartup({ share: { ok: false, code: 'cut-short', reason: 'This link looks cut short.' }, saved: '* mine\n', example });
    // With its code, so the app can react to some (a newer version: look for an update).
    expect(d).toEqual({ source: 'saved', netlist: '* mine\n', problem: 'This link looks cut short.', problemCode: 'cut-short' });
  });

  it('a fragment that is no share link at all (#main) is ignored silently', () => {
    const d = decideStartup({ share: { ok: false, code: 'no-circuit', reason: 'This link has no circuit in it.' }, saved: null, example });
    expect(d).toEqual({ source: 'example', netlist: example.netlist, exampleId: 'f5-thevenin-cccs' });
  });
});

describe('readStartup', () => {
  it('opens a real share link from the address', async () => {
    const fragment = await encodeShare('* from a video\nV1 a 0 6\nR1 a 0 2\n.op\n.end\n', { run: true });
    expect(await readStartup(`#${fragment}`)).toEqual({ source: 'share', netlist: '* from a video\nV1 a 0 6\nR1 a 0 2\n.op\n.end\n', run: true });
  });

  it('restores the saved netlist, or opens F5', async () => {
    expect(await readStartup('')).toMatchObject({ source: 'example', exampleId: DEFAULT_EXAMPLE_ID });
    expect((await readStartup('')).netlist).toBe(exampleById(DEFAULT_EXAMPLE_ID)!.netlist);
    localStorage.setItem('plainspice:netlist', '* saved\n.op\n.end\n');
    expect(await readStartup('#main')).toEqual({ source: 'saved', netlist: '* saved\n.op\n.end\n' });
  });

  it('a link with an unknown format letter says so', async () => {
    const d = await readStartup('#c=q123');
    expect(d.source).toBe('example');
    expect('problem' in d && d.problem).toMatch(/newer version of PlainSpice/);
  });
});

describe('clearShareFragment', () => {
  it('removes the link from the address (so a reload keeps the student’s edits) and keeps the path', () => {
    history.replaceState(null, '', '/plainspice/?x=1#c=zabc&run=1');
    clearShareFragment();
    expect(location.pathname).toBe('/plainspice/');
    expect(location.search).toBe('?x=1');
    expect(location.hash).toBe('');
  });
});

describe('examples', () => {
  it('the channel’s videos come first, in channel order, then every fixture in teaching order, F5 among them', () => {
    expect(EXAMPLE_GROUPS.map((g) => g.group)).toEqual(['sp01', 'p01', 'p02', 'e04', 'sources', 'traps', 'analyses']);
    expect(EXAMPLES.slice(0, 20).map((e) => e.group)).toEqual([...Array(6).fill('sp01'), ...Array(3).fill('p01'), ...Array(5).fill('p02'), ...Array(6).fill('e04')]);
    for (const e of EXAMPLES.slice(0, 20)) expect(e.netlist).toMatch(/^\* .+\n\* From the Solved Circuits video "/);
    expect(EXAMPLES.slice(20).map((e) => e.id)).toEqual([
      'f1a-voltage-source',
      'f1b-voltage-source-swapped',
      'f2a-current-source',
      'f2b-current-source-swapped',
      'f3a-1M-trap',
      'f3b-1meg',
      'f4-tf-output-impedance',
      'f5-thevenin-cccs',
      'd1-dc-divider-sweep',
      't1-tran-rc-charge',
    ]);
    for (const e of EXAMPLES) expect(e.netlist).toMatch(/\.end\s*$/);
  });
});
