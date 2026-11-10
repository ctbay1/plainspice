/**
 * Studio prototype: the three panels (Netlist, Checks, Explain) as HTML builders. They only lay out
 * what the model says (design/prototypes/shared/sim.ts): the netlist is dividerNetlist() exactly,
 * the checks are check(), the words are describe() and explain(), the line notes are solve()'s.
 */
import type { LineAnnotation, LineExplanation, Trap } from '../shared/sim.ts';
import { icon } from './icons.ts';

export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The trap's "what ngspice does" without the claim IDs at its end ("[mega-as-milli-1, …]"): they
 * name the evidence in docs/spice-facts/ and mean nothing to a student. The same rule as the app's
 * withoutClaimIds (src/app/components/ChecksPanel.tsx).
 */
export function withoutClaimIds(text: string): string {
  return text.replace(/\s*\[[a-z][\w-]*\d[a-z]?(?:(?:,\s*|\s*\.\.\.\s*)[a-z][\w-]*\d[a-z]?)*\]\s*$/, '');
}

/** The part each line of dividerNetlist() writes. */
export const LINE_PART: Record<number, string> = { 2: 'V1', 3: 'R1', 4: 'R2' };
export const PART_LINE: Record<string, number> = { V1: 2, R1: 3, R2: 4 };

// ------------------------------------------------------------------ Netlist

export interface NetlistView {
  text: string;
  colours: Map<string, string>;
  /** solve()'s notes, when they belong to this exact netlist. */
  annotations: LineAnnotation[];
  /** True while the shown results are older than the netlist (Live off). */
  stale: boolean;
  selectedLine?: number;
  /** Lines with a check, by severity. */
  flagged: Map<number, Trap['severity']>;
  /** New parts on the canvas that are not wired into the netlist yet. */
  unconnected: string[];
}

export function netlistHTML(v: NetlistView): string {
  const lines = v.text.replace(/\n$/, '').split('\n');
  const notes = new Map(v.annotations.map((a) => [a.line, a]));
  const rows = lines
    .map((line, i) => {
      const no = i + 1;
      const part = LINE_PART[no];
      const words = line.split(/(\s+)/);
      let code: string;
      if (no === 1) code = `<span class="t-title">${esc(line)}</span>`;
      else if (line.startsWith('.')) code = `<span class="t-dot">${esc(line)}</span>`;
      else {
        let field = 0;
        code = words
          .map((w) => {
            if (/^\s+$/.test(w)) return w;
            const f = field++;
            if (f === 0) return `<span class="t-name">${esc(w)}</span>`;
            if (f === 1 || f === 2) {
              const colour = v.colours.get(w.toLowerCase());
              return colour
                ? `<span class="t-node" data-node="${esc(w.toLowerCase())}" style="--node:${colour}">${esc(w)}</span>`
                : `<span class="t-node t-node--ground" data-node="0">${esc(w)}</span>`;
            }
            return `<span class="t-value">${esc(w)}</span>`;
          })
          .join('');
      }
      const note = notes.get(no);
      const flag = v.flagged.get(no);
      const noteHTML = note
        ? `<span class="nl__note${v.stale ? ' is-stale' : ''}"><span aria-hidden="true">${esc(note.text)}</span><span class="sr-only">${esc(note.speech)}</span></span>`
        : '';
      const flagHTML = flag ? `<span class="nl__flag nl__flag--${flag}">${icon(flag === 'error' ? 'error' : flag === 'warning' ? 'warning' : 'info', 13)}<span class="sr-only">(${flag === 'error' ? 'error' : flag === 'warning' ? 'warning' : 'note'} on this line)</span></span>` : '';
      const inner = `<span class="nl__no"><span class="sr-only">Line </span>${no}<span class="sr-only">:</span></span><code class="nl__code">${code}</code>${flagHTML}${noteHTML}`;
      const selected = v.selectedLine === no;
      if (part) {
        return `<li class="nl__row${selected ? ' is-selected' : ''}"><button type="button" class="nl__line" data-select="${part}" aria-pressed="${selected}">${inner}<span class="sr-only">. Select ${part}.</span></button></li>`;
      }
      return `<li class="nl__row"><div class="nl__line">${inner}</div></li>`;
    })
    .join('');
  const loose = v.unconnected.length
    ? `<p class="pane__aside">${icon('info', 14)}<span>${esc(v.unconnected.join(', '))} ${v.unconnected.length === 1 ? 'is' : 'are'} on the canvas but not wired yet, so ${v.unconnected.length === 1 ? 'it is' : 'they are'} not in the netlist.</span></p>`
    : '';
  return `<ol class="nl" aria-label="Netlist, ${lines.length} lines">${rows}</ol>${loose}`;
}

// ------------------------------------------------------------------ Checks

export interface ChecksView {
  traps: Trap[];
  /** ngspice's own messages from the last run, in plain words (solve().words.warnings). */
  messages: { severity: string; title: string; why: string; line?: number }[];
  compact?: boolean;
}

const SEVERITY_WORD: Record<string, string> = { error: 'Error', warning: 'Warning', info: 'Note', note: 'Note' };
const SEVERITY_ICON: Record<string, string> = { error: 'error', warning: 'warning', info: 'info', note: 'info' };

export function checksHTML(v: ChecksView): string {
  if (!v.traps.length && !v.messages.length) {
    return `<div class="empty">
      <div class="empty__badge">${icon('checkCircle', 22)}</div>
      <p class="empty__title">No problems found</p>
      <p class="empty__text">PlainSpice looks for beginner traps before ngspice runs the netlist, says why each one matters, and offers a fix.</p>
      <button type="button" class="btn btn--soft" data-action="trap">${icon('trap', 15)}<span>Try a beginner trap: R1 = 1M</span></button>
    </div>`;
  }
  const traps = v.traps
    .map((t, i) => {
      const part = LINE_PART[t.line];
      const fixes = t.fixes
        .map((f, k) => `<button type="button" class="btn ${k === 0 ? 'btn--primary' : 'btn--ghost'} btn--sm" data-fix="${i}:${k}">${k === 0 ? icon('check', 14) : ''}<span>${esc(f.label)}</span></button>`)
        .join('');
      return `<li class="trap trap--${t.severity}">
        <div class="trap__head">
          <span class="sev sev--${t.severity}">${icon(SEVERITY_ICON[t.severity] ?? 'info', 14)}${SEVERITY_WORD[t.severity]}</span>
          ${part ? `<button type="button" class="linkish" data-select="${part}">Line ${t.line} · ${part}<span class="sr-only">, select ${part}</span></button>` : `<span class="muted">Line ${t.line}</span>`}
        </div>
        <h4 class="trap__title" tabindex="-1">${esc(t.title)}</h4>
        <p class="trap__why">${esc(t.why)}</p>
        <p class="trap__spice"><span class="trap__label">What ngspice does</span> ${esc(withoutClaimIds(t.ngspice))}</p>
        ${fixes ? `<div class="trap__fixes" role="group" aria-label="Fixes for line ${t.line}">${fixes}</div>` : ''}
      </li>`;
    })
    .join('');
  const messages = v.messages
    .map(
      (m) => `<li class="trap trap--${m.severity === 'note' ? 'info' : m.severity}">
        <div class="trap__head"><span class="sev sev--${m.severity === 'note' ? 'info' : m.severity}">${icon(SEVERITY_ICON[m.severity] ?? 'info', 14)}${SEVERITY_WORD[m.severity] ?? 'Note'}</span>${m.line ? `<span class="muted">Line ${m.line}</span>` : ''}</div>
        <h4 class="trap__title">${esc(m.title)}</h4>
        <p class="trap__why">${esc(m.why)}</p>
      </li>`,
    )
    .join('');
  return `${traps ? `<p class="pane__kicker">Found in the netlist</p><ul class="traps">${traps}</ul>` : ''}${messages ? `<p class="pane__kicker">What ngspice said</p><ul class="traps">${messages}</ul>` : ''}`;
}

// ------------------------------------------------------------------ Explain

export interface ExplainView {
  circuitWords: string;
  lines: LineExplanation[];
  selectedLine?: number;
  /** Set when a part is selected that is not in the netlist (a new, unwired part). */
  loose?: string;
}

function emphasise(text: string, words: string[] | undefined): string {
  let out = esc(text);
  for (const w of words ?? []) out = out.split(esc(w)).join(`<strong>${esc(w)}</strong>`);
  return out;
}

export function lineCardHTML(l: LineExplanation, headingLevel = 3): string {
  const rows = l.fields
    .map(
      (f) => `<tr><th scope="row">${esc(f.label)}</th><td><code class="field-chip">${esc(f.text || '—')}</code></td><td>${emphasise(f.meaning, f.emphasis)}</td></tr>`,
    )
    .join('');
  const notes = l.notes.map((n) => `<li>${icon('info', 14)}<span>${esc(n)}</span></li>`).join('');
  return `<article class="xcard">
    <header class="xcard__head"><span class="xcard__line">Line ${l.line}</span><h${headingLevel} class="xcard__title">${esc(l.heading)}</h${headingLevel}></header>
    <p class="xcard__summary">${esc(l.summary)}</p>
    ${rows ? `<table class="fields"><caption class="sr-only">The fields of line ${l.line}</caption><thead><tr><th scope="col">Field</th><th scope="col">Written</th><th scope="col">What it means</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
    ${notes ? `<ul class="xcard__notes">${notes}</ul>` : ''}
  </article>`;
}

export function explainHTML(v: ExplainView): string {
  const words = `<section class="xwords" aria-labelledby="xwords-h"><h3 class="pane__kicker" id="xwords-h">The circuit in words</h3><p>${esc(v.circuitWords)}</p></section>`;
  if (v.loose) {
    return `${words}<p class="pane__aside">${icon('info', 14)}<span>${esc(v.loose)} is not wired into the circuit yet, so there is no netlist line to explain.</span></p>`;
  }
  const selected = v.selectedLine ? v.lines.find((l) => l.line === v.selectedLine) : undefined;
  if (selected) return `${lineCardHTML(selected)}<div class="xwords--after">${words}</div>`;
  const parts = v.lines
    .filter((l) => LINE_PART[l.line])
    .map(
      (l) => `<li><button type="button" class="xrow" data-select="${LINE_PART[l.line]}">
        <span class="xrow__line">Line ${l.line}</span><span class="xrow__heading">${esc(l.heading)}</span><span class="xrow__summary">${esc(l.summary)}</span>${icon('chevronRight', 16, 'xrow__chev')}
      </button></li>`,
    )
    .join('');
  const op = v.lines.find((l) => l.heading.startsWith('.op'));
  return `${words}<p class="pane__kicker">Select a part to see its line explained</p><ul class="xrows">${parts}</ul>${op ? `<p class="pane__aside">${icon('info', 14)}<span><strong>${esc(op.heading)}.</strong> ${esc(op.summary)}</span></p>` : ''}`;
}
