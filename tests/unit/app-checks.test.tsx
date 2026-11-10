// @vitest-environment jsdom
/**
 * The Checks tab: what a student reads of each trap (no claim IDs), and a netlist with thousands of
 * traps still draws quickly (security review M2: at most SHOWN_PER_GROUP of each severity).
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChecksPanel, SHOWN_PER_GROUP, withoutClaimIds } from '../../src/app/components/ChecksPanel.tsx';
import { parseNetlist } from '../../src/spice/parse.ts';
import { checkTraps } from '../../src/spice/traps.ts';

afterEach(cleanup);

describe('withoutClaimIds', () => {
  it('drops the evidence IDs at the end, and nothing else', () => {
    expect(withoutClaimIds('ngspice reads 1M as 1 mΩ and says nothing. [mega-as-milli-1, mega-as-milli-2, mega-as-milli-3]')).toBe(
      'ngspice reads 1M as 1 mΩ and says nothing.',
    );
    expect(withoutClaimIds("ngspice stops: 'unknown parameter (*)'. [midline-comment-1 ... midline-comment-6, midline-comment-9]")).toBe(
      "ngspice stops: 'unknown parameter (*)'.",
    );
    expect(withoutClaimIds("ngspice stops with a fatal error: 'Undefined parameter [k]'. [fatal-syntax-3, fatal-syntax-4]")).toBe(
      "ngspice stops with a fatal error: 'Undefined parameter [k]'.",
    );
    expect(withoutClaimIds('A sentence without IDs.')).toBe('A sentence without IDs.');
  });

  it('every trap text loses its IDs, so none reaches a student', () => {
    const traps = checkTraps(parseNetlist('* t\nV1 n1 0 6\nR1 n1 n2 1M\nR2 n2 0 1meg\nI1 0 n1 3A\nR3 n1 0 0\n.op\n.end\n'));
    expect(traps.length).toBeGreaterThan(2);
    for (const t of traps) expect(withoutClaimIds(t.ngspice)).not.toMatch(/\[[a-z-]+-\d/);
  });
});

describe('<ChecksPanel />', () => {
  it('says the severity with a pause before the title, and leaves the claim IDs out', () => {
    const traps = checkTraps(parseNetlist('* t\nV1 n1 0 6\nR1 n1 n2 1M\nR2 n2 0 1meg\n.op\n.end\n'));
    render(<ChecksPanel traps={traps} onGoToLine={() => {}} onFix={() => {}} />);
    const heading = screen.getByRole('heading', { level: 4 });
    expect(heading.textContent).toBe('Warning: 1M means 1 milliohm (1 mΩ), not 1 megaohm (1 MΩ)');
    expect(screen.getByRole('listitem').textContent).not.toContain('[mega-as-milli');
  });

  it(`draws at most ${SHOWN_PER_GROUP} traps of one severity and counts the rest`, () => {
    const text = `* many\nV1 a 0 1\n${Array.from({ length: 150 }, (_, i) => `R${i} a 0 1M`).join('\n')}\n.op\n.end\n`;
    const traps = checkTraps(parseNetlist(text));
    expect(traps.filter((t) => t.severity === 'warning')).toHaveLength(150);
    render(<ChecksPanel traps={traps} onGoToLine={() => {}} onFix={() => {}} />);
    const group = screen.getByRole('region', { name: '150 warnings' });
    expect(within(group).getAllByRole('listitem')).toHaveLength(SHOWN_PER_GROUP);
    expect(within(group).getByText(`And ${150 - SHOWN_PER_GROUP} more, shown once the ones above are fixed.`)).toBeTruthy();
  });
});
