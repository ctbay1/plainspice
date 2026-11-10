/**
 * The three panels of the Playground (Netlist, Checks, Explain) as HTML strings. Every sentence about
 * the circuit comes from the real model (../shared/sim.ts): this file only lays the words out.
 */
import type { LineAnnotation, LineExplanation, Trap } from '../shared/sim.ts';
import { icon } from './icons.ts';

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The ids of the ngspice runs that back a claim ("[mega-as-milli-1, ...]") are for the docs, not for students. */
export function withoutClaimIds(text: string): string {
  return text.replace(/\s*\[[a-z][\w-]*\d[a-z]?(?:(?:,\s*|\s*\.\.\.\s*)[a-z][\w-]*\d[a-z]?)*\]\s*$/, '');
}

/** The app's words for the three kinds of check (src/i18n/en.ts). */
const SEVERITY_WORD: Record<Trap['severity'], string> = { error: 'Error', warning: 'Warning', info: 'Note' };
const SEVERITY_ICON: Record<Trap['severity'], string> = { error: 'error', warning: 'warn', info: 'info' };

/** Which parts of the drawing a netlist line stands for (so a line can select its part). */
export interface LineLink {
  line: number;
  partId: string;
}

export interface NetlistView {
  text: string;
  /** From explain(): where each field of each line is, and what it is. */
  explanations: LineExplanation[];
  annotations: LineAnnotation[];
  colours: Map<string, string>;
  links: LineLink[];
  selectedLine?: number;
  /** A line whose value just changed (it glows for a moment). */
  changedLine?: number;
}

/** The netlist, coloured by what each word is, with ngspice's results at the end of each line. */
export function netlistHTML(v: NetlistView): string {
  const lines = v.text.split('\n');
  let offset = 0;
  const rows: string[] = [];
  lines.forEach((text, i) => {
    const number = i + 1;
    const start = offset;
    offset += text.length + 1;
    if (number === lines.length && text === '') return;
    const ex = v.explanations.find((e) => e.line === number);
    const fields = (ex?.fields ?? []).filter((f) => f.span && f.span.from >= start && f.span.to <= start + text.length);
    let html = '';
    let at = 0;
    const kindOf = (label: string): string =>
      label === 'name' ? 'name' : /node/.test(label) ? 'node' : label === 'value' ? 'value' : label === 'command' ? 'command' : 'other';
    for (const f of fields) {
      const from = f.span!.from - start;
      const to = f.span!.to - start;
      if (from < at) continue;
      html += esc(text.slice(at, from));
      const word = text.slice(from, to);
      const kind = kindOf(f.label);
      const colour = kind === 'node' ? v.colours.get(word.toLowerCase()) : undefined;
      const style = colour ? ` style="--node:${colour}"` : '';
      const ground = kind === 'node' && (word === '0' || word.toLowerCase() === 'gnd');
      html += `<span class="tok tok--${kind}${ground ? ' tok--ground' : ''}"${style}>${esc(word)}</span>`;
      at = to;
    }
    html += esc(text.slice(at));
    const isComment = /^\s*\*/.test(text) || number === 1;
    const note = v.annotations.find((a) => a.line === number);
    const link = v.links.find((l) => l.line === number);
    const classes = ['nl-row', isComment ? 'nl-row--comment' : '', v.selectedLine === number ? 'is-selected' : '', v.changedLine === number ? 'is-changed' : '']
      .filter(Boolean)
      .join(' ');
    const lineCell = link
      ? `<button class="nl-line" type="button" data-select-part="${link.partId}" aria-label="Line ${number}: select ${esc(link.partId.toUpperCase())} on the drawing">${number}</button>`
      : `<span class="nl-line" aria-hidden="true">${number}</span>`;
    rows.push(
      `<div class="${classes}" role="listitem"><span class="sr-only">Line ${number}: </span>${lineCell}<code class="nl-code">${html || ' '}</code>${
        note ? `<span class="nl-note" title="${esc(note.speech)}">${esc(note.text)}</span>` : ''
      }</div>`,
    );
  });
  return `<div class="netlist" role="list" aria-label="Netlist lines">${rows.join('')}</div>`;
}

export interface ChecksView {
  traps: Trap[];
  /** The trap the "Try a beginner trap" link sets up, shown while there is nothing to report. */
  offerTrap: boolean;
  /** One line instead of the illustration, when other panels share the column. */
  compact?: boolean;
}

export function checksHTML(v: ChecksView): string {
  if (!v.traps.length) {
    const trap = v.offerTrap
      ? `<button class="btn btn--soft btn--block" type="button" data-action="try-trap">${icon('wand', 18)}<span>Try a beginner trap: R1 = 1M</span></button>`
      : '';
    if (v.compact) {
      return `<div class="empty empty--compact"><p class="empty__line">${icon('ok', 18)}<span><b>No problems found.</b> PlainSpice checks for beginner traps before ngspice runs.</span></p>${trap}</div>`;
    }
    return `<div class="empty">
      <div class="empty__art" aria-hidden="true">${icon('ok', 34)}</div>
      <p class="empty__title">No problems found</p>
      <p class="empty__text">PlainSpice looks for beginner traps before ngspice runs the netlist, says why each one matters, and offers a fix.</p>
      ${trap}
    </div>`;
  }
  return `<ul class="traps" role="list">${v.traps
    .map(
      (t) => `<li class="trap trap--${t.severity}">
      <div class="trap__head">
        <span class="sev sev--${t.severity}">${icon(SEVERITY_ICON[t.severity], 16)}<span>${SEVERITY_WORD[t.severity]}</span></span>
        <button class="chip-btn" type="button" data-select-line="${t.line}" aria-label="Line ${t.line}: open it on the drawing">Line ${t.line}</button>
      </div>
      <h3 class="trap__title">${esc(t.title)}</h3>
      <p class="trap__why">${esc(t.why)}</p>
      <p class="trap__ngspice"><strong>What ngspice does:</strong> ${esc(withoutClaimIds(t.ngspice))}</p>
      ${
        t.fixes.length
          ? `<div class="trap__fixes">${t.fixes
              .map(
                (f, i) =>
                  `<button class="btn ${i === 0 ? 'btn--primary' : 'btn--ghost'}" type="button" data-fix="${esc(t.id)}:${i}">${i === 0 ? icon('wand', 18) : ''}<span>${esc(f.label)}</span></button>`,
              )
              .join('')}</div>`
          : ''
      }
    </li>`,
    )
    .join('')}</ul>`;
}

export interface ExplainView {
  circuit: string;
  part?: { name: string; explanation: LineExplanation; lineText: string };
  /** The parts a student can pick, when none is selected. */
  choices: { id: string; name: string; word: string }[];
  /** Whether "The circuit in words" is open (it folds away while a part is selected). */
  circuitOpen?: boolean;
}

export function explainHTML(v: ExplainView): string {
  if (!v.part) {
    return `<section class="ex-block" aria-labelledby="ex-circuit">
      <h3 class="ex-kicker" id="ex-circuit">The circuit in words</h3>
      <p class="ex-circuit">${esc(v.circuit)}</p>
    </section>
    <section class="ex-block" aria-labelledby="ex-pick">
      <h3 class="ex-kicker" id="ex-pick">One part, word by word</h3>
      <p class="ex-muted">Select a part on the drawing, or pick one here:</p>
      <div class="ex-choices">${v.choices
        .map((c) => `<button class="pill-btn" type="button" data-select-part="${c.id}"><strong>${esc(c.name)}</strong> ${esc(c.word)}</button>`)
        .join('')}</div>
    </section>`;
  }
  const ex = v.part.explanation;
  const rows = ex.fields
    .map(
      (f) => `<tr><th scope="row">${esc(f.label)}</th><td><code>${esc(f.text || '—')}</code></td><td>${emphasise(f.meaning, f.emphasis)}</td></tr>`,
    )
    .join('');
  return `<section class="ex-part" aria-labelledby="ex-part-title">
    <p class="ex-line"><span class="ex-line__no">Line ${ex.line}</span><code>${esc(v.part.lineText)}</code></p>
    <h3 class="ex-heading" id="ex-part-title">${esc(ex.heading)}</h3>
    <p class="ex-summary">${esc(ex.summary)}</p>
    ${
      rows
        ? `<table class="fields"><caption class="sr-only">What each word of line ${ex.line} means</caption><thead><tr><th scope="col">Field</th><th scope="col">Written</th><th scope="col">Meaning</th></tr></thead><tbody>${rows}</tbody></table>`
        : ''
    }
    ${ex.notes.length ? `<ul class="ex-notes">${ex.notes.map((n) => `<li>${icon('info', 16)}<span>${esc(n)}</span></li>`).join('')}</ul>` : ''}
  </section>
  <details class="ex-more"${v.circuitOpen ? ' open' : ''}>
    <summary>${icon('chevronRight', 16, 'ex-more__chev')}<span>The circuit in words</span></summary>
    <p class="ex-circuit">${esc(v.circuit)}</p>
  </details>`;
}

function emphasise(text: string, words?: string[]): string {
  let html = esc(text);
  for (const w of words ?? []) html = html.replace(esc(w), `<strong class="em">${esc(w)}</strong>`);
  return html;
}
