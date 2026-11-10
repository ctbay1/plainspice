/**
 * The three panels of the notebook prototype, as HTML strings: the Netlist (the dark simulator
 * screen of the videos), the Checks (green pen when clean, red pen for a trap) and Explain (the
 * circuit in words and the selected line's field table). Every sentence about the circuit comes
 * from the model (design/prototypes/shared/sim.ts): check(), explain(), describe() and solve().
 *
 * On a desktop the panels are sections of one paper sheet that slides out from the divider tabs
 * on the right edge of the page; on a phone each is a bottom sheet with a grab handle.
 */
import type { LineExplanation, Solution, Trap } from '../shared/sim.ts';

export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * The trap's "what ngspice does" without the claim IDs at its end ("[mega-as-milli-1, …]"): they
 * name the evidence in docs/spice-facts/ and mean nothing to a student. The same rule as the app's
 * withoutClaimIds() in src/app/components/ChecksPanel.tsx.
 */
export function withoutClaimIds(text: string): string {
  return text.replace(/\s*\[[a-z][\w-]*\d[a-z]?(?:(?:,\s*|\s*\.\.\.\s*)[a-z][\w-]*\d[a-z]?)*\]\s*$/, '');
}

const ARROW_SVG = '<svg class="arr" viewBox="0 0 14 10" aria-hidden="true"><path d="M1 5h11M8.5 1.5L12 5 8.5 8.5"/></svg>';
const BACK_ARROW = '<svg class="arr" viewBox="0 0 14 10" aria-hidden="true"><path d="M13 5H2M5.5 1.5L2 5l3.5 3.5"/></svg>';

/** Model text with "→" drawn as a small pen arrow (Caveat has no arrow glyph). */
function handText(text: string): string {
  return esc(text)
    .split('→')
    .join(ARROW_SVG);
}

export const CLOSE = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 5.5l9 9m0-9l-9 9"/></svg>';

/** The grab handle of a phone sheet (hidden on a desktop): drag it, or press it to make the sheet taller. */
export function grabHandle(label: string): string {
  return `<button class="sheet-grab" type="button" data-grab aria-label="${esc(label)}: make the sheet taller" aria-expanded="false"><span aria-hidden="true"></span></button>`;
}

/** A panel's header: the divider tab's colour runs on into it (the band), then the heading and its close button. */
function head(id: string, title: string, sub: string, closeLabel: string): string {
  return `
    ${grabHandle(title)}
    <header class="card__head">
      <div class="card__titles">
        <h2 class="card__title" id="h-${id}" tabindex="-1">${esc(title)}</h2>
        <p class="card__sub">${sub}</p>
      </div>
      <button class="icon-btn" type="button" data-close="${id}" aria-label="${esc(closeLabel)}">${CLOSE}</button>
    </header>`;
}

export interface NetlistView {
  netlist: string;
  sol: Solution | undefined;
  explains: LineExplanation[];
  checks: Trap[];
  colours: Map<string, string>;
  selectedLine: number | undefined;
}

interface Tok {
  text: string;
  from: number;
}

function tokens(line: string, offset: number): Tok[] {
  const out: Tok[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push({ text: m[0], from: offset + m.index });
  return out;
}

/** How many monospace columns a handwritten field name needs (Caveat is narrower than the code), plus one to breathe. */
function labelCh(label: string): number {
  return Math.ceil(label.length * 0.62) + 1;
}

/**
 * The netlist on the simulator screen: tokens coloured, results noted at the line ends. The words
 * of the part lines sit in columns, as in the episodes' simulator window, wide enough for the
 * field names written above the selected line. Only the spacing on screen changes: the characters
 * are exactly the netlist's (selecting and copying gives the netlist itself). Code lines never
 * wrap; a note that does not fit beside its line drops under it.
 */
export function netlistHTML(v: NetlistView): string {
  const rows: string[] = [];
  const lines = v.netlist.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const trapSpans = v.checks.map((t) => t.span);
  const isPartLine = (text: string, number: number): boolean => number !== 1 && !text.startsWith('*') && !text.startsWith('.') && text.trim() !== '';

  // Column widths over every part line (in ch).
  const colW: number[] = [];
  let off = 0;
  lines.forEach((text, i) => {
    if (isPartLine(text, i + 1)) {
      const ex = v.explains.find((e) => e.line === i + 1);
      tokens(text, off).forEach((t, k) => {
        const field = ex?.fields.find((fl) => fl.span?.from === t.from);
        colW[k] = Math.max(colW[k] ?? 0, t.text.length, field ? labelCh(field.label) : 0);
      });
    }
    off += text.length + 1;
  });

  let offset = 0;
  lines.forEach((text, i) => {
    const number = i + 1;
    const ex = v.explains.find((e) => e.line === number);
    const selected = v.selectedLine === number;
    const part = isPartLine(text, number);
    let body = '';
    if (number === 1 || text.startsWith('*')) {
      body = `<span class="tok tok--comment">${esc(text)}</span>`;
    } else {
      let cursor = 0;
      const toks = tokens(text, offset);
      toks.forEach((t, k) => {
        const col = t.from - offset;
        body += esc(text.slice(cursor, col));
        cursor = col + t.text.length;
        const field = ex?.fields.find((fl) => fl.span?.from === t.from);
        const label = selected && field ? ` data-label="${esc(field.label)}"${field.emphasis?.length ? ' data-emph="1"' : ''}` : '';
        const isTrap = trapSpans.some((s) => s.from <= t.from && t.from < s.to);
        let cls = 'tok';
        const style: string[] = [];
        if (part && k < toks.length - 1 && colW[k]) style.push(`min-width:${colW[k]}ch`);
        if (text.startsWith('.')) cls += ' tok--dot';
        else if (k === 0) cls += ' tok--name';
        else if (field && /node/.test(field.label)) {
          const name = t.text.toLowerCase();
          if (name === '0' || name === 'gnd') cls += ' tok--gnd';
          else {
            cls += ' tok--node';
            const c = v.colours.get(name);
            if (c) style.push(`--node:${esc(c)}`);
          }
        } else cls += ' tok--value';
        if (isTrap) cls += ' tok--trap';
        body += `<span class="${cls}"${style.length ? ` style="${style.join(';')}"` : ''}${label}>${esc(t.text)}</span>`;
      });
      body += esc(text.slice(cursor));
    }
    // The note at the end of the line: the result (from solve) or what the line is (from explain).
    let note = '';
    const ann = v.sol?.status === 'ok' ? v.sol.annotations.find((a) => a.line === number) : undefined;
    if (ann) note = `<span class="code__note">${BACK_ARROW} ${handText(ann.text)}</span>`;
    else if (ex && (number === 1 || text.startsWith('.'))) {
      const what = number === 1 ? ex.heading.toLowerCase() : ex.heading.replace(/^[^:]*:\s*/, '');
      note = `<span class="code__note is-dim">${BACK_ARROW} ${handText(what)}</span>`;
    }
    const kind = number === 1 || text.startsWith('*') ? ' is-comment' : '';
    rows.push(
      `<div class="code__line${selected ? ' is-sel' : ''}${kind}" data-line="${number}"${part ? ' data-part="1"' : ''}><span class="code__no" aria-hidden="true">${number}</span><span class="code__text">${body}</span>${note}</div>`,
    );
    offset += text.length + 1;
  });
  return `<div class="code" role="group" aria-label="Netlist lines">${rows.join('')}</div>`;
}

export function netlistCard(v: NetlistView, extraNote: string): string {
  return `
    ${head('netlist', 'Netlist', 'written for you from the drawing', 'Close the netlist')}
    <div class="card__body">
      <div class="screen">
        <div class="screen__bar">
          <span class="screen__dots" aria-hidden="true"><span></span><span></span><span></span></span>
          <span class="screen__file">divider.cir</span>
          <button class="screen__copy" type="button" data-copy="1" aria-label="Copy the netlist">
            <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-1A1 1 0 0 0 9.5 1.5h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1"/></svg>
            <span data-copy-label>Copy</span>
          </button>
        </div>
        <div class="netlist-code">${netlistHTML(v)}</div>
      </div>
      <p class="panel-foot">Change a value on the drawing and its line changes here. ${extraNote}</p>
    </div>`;
}

const WARN_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8l6.6 11.6H1.4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6.3v3.4M8 11.6v.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
const ERROR_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.2 1.5h5.6l3.7 3.7v5.6l-3.7 3.7H5.2l-3.7-3.7V5.2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M5.8 5.8l4.4 4.4m0-4.4l-4.4 4.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const NOTE_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 7.2v4M8 4.8v.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
const SEVERITY: Record<Trap['severity'], [string, string]> = { error: ['Error', ERROR_ICON], warning: ['Warning', WARN_ICON], info: ['Note', NOTE_ICON] };

export function checksCard(traps: Trap[], partNameOfLine: (line: number) => string | undefined): string {
  let body: string;
  if (traps.length === 0) {
    body = `
      <div class="checks-ok">
        <svg class="checks-ok__tick" viewBox="0 0 44 44" aria-hidden="true"><path d="M7 24.5c3.2 2.4 6.4 5.6 9.4 10.2C21.8 23 28.6 14.4 38 7.5"/></svg>
        <div>
          <p class="checks-ok__title">No problems found</p>
          <p class="checks-ok__text">PlainSpice looks for beginner traps before every run, says why each one matters, and offers a fix.</p>
        </div>
      </div>
      <div class="try-trap">
        <p class="try-trap__text">See what a trap looks like:</p>
        <button class="link" type="button" data-try-trap="1">Try a beginner trap: R1 = 1M</button>
      </div>`;
  } else {
    body = traps
      .map((t, i) => {
        const [word, icon] = SEVERITY[t.severity];
        const part = partNameOfLine(t.line);
        const fixes = t.fixes
          .map((f, k) => `<button class="btn ${k === 0 ? 'btn--green' : 'btn--paper'}" type="button" data-fix="${i}:${k}">${esc(f.label)}</button>`)
          .join('');
        return `
          <article class="trap trap--${t.severity}" aria-labelledby="trap-${i}">
            <span class="sev">${icon}${word}</span>
            <h3 class="trap__title" id="trap-${i}" tabindex="-1">${esc(t.title)}</h3>
            <p class="trap__why">${esc(t.why)}</p>
            <p class="trap__ng"><b>What ngspice does:</b> ${esc(withoutClaimIds(t.ngspice))}</p>
            ${fixes ? `<div class="trap__fixes" role="group" aria-label="Fixes for line ${t.line}">${fixes}</div>` : ''}
            <p class="trap__line"><button class="link" type="button" data-show-line="${t.line}">Show ${part ? `${esc(part)} on line ${t.line}` : `line ${t.line}`} in the netlist</button></p>
          </article>`;
      })
      .join('');
  }
  return `
    ${head('checks', 'Checks', traps.length === 0 ? 'before every run' : `${traps.length} found`, 'Close the checks')}
    <div class="card__body">${body}</div>`;
}

export interface ExplainView {
  describeText: string;
  netlist: string;
  explains: LineExplanation[];
  sol: Solution | undefined;
  colours: Map<string, string>;
  selected: { kind: 'part'; id: string; line?: number; placed?: LineExplanation } | { kind: 'node'; node: string } | null;
  parts: { id: string; label: string }[];
}

function emphasise(meaning: string, words: string[] | undefined): string {
  let html = esc(meaning);
  for (const w of words ?? []) {
    const e = esc(w);
    html = html.replace(new RegExp(`(^|\\s)(${e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=\\s|$)`), '$1<em>$2</em>');
  }
  return html;
}

/** The netlist line with its field names written above each word, then the field table (the channel's field tables). */
function fieldsOf(ex: LineExplanation, colours: Map<string, string>): string {
  const strip = ex.fields
    .map((fl, i) => {
      const node = /node/.test(fl.label) ? colours.get(fl.text.toLowerCase()) : undefined;
      const cls = `fs-tok${node ? ' fs-tok--node' : ''}`;
      const style = [`min-width:${Math.max(fl.text.length, Math.ceil(fl.label.length * 0.62))}ch`, ...(node ? [`--node:${esc(node)}`] : [])].join(';');
      return `${i ? ' ' : ''}<span class="${cls}" data-label="${esc(fl.label)}"${fl.emphasis?.length ? ' data-emph="1"' : ''} style="${style}">${esc(fl.text || '·')}</span>`;
    })
    .join('');
  const rows = ex.fields
    .map((fl) => `<tr><td>${esc(fl.label)}</td><td>${esc(fl.text || '—')}</td><td>${emphasise(fl.meaning, fl.emphasis)}</td></tr>`)
    .join('');
  return `
    ${strip ? `<div class="fieldstrip" aria-hidden="true">${strip}</div>` : ''}
    ${rows ? `<table class="ftable"><caption class="sr-only">The fields of line ${ex.line}</caption><thead><tr><th scope="col">Field</th><th scope="col">Written</th><th scope="col">What it means</th></tr></thead><tbody>${rows}</tbody></table>` : ''}`;
}

function lineExplanation(v: ExplainView, line: number): string {
  const ex = v.explains.find((e) => e.line === line);
  if (!ex) return '';
  const current = v.sol?.status === 'ok' ? v.sol.currents.find((c) => c.line === line) : undefined;
  // The model's sentence ("2 mA from in to out through R1"), its number written large, said once.
  let currentHTML = '';
  if (current) {
    const cut = current.text.indexOf(' from ');
    const value = cut > 0 ? current.text.slice(0, cut) : '';
    const rest = cut > 0 ? current.text.slice(cut + 1) : current.text;
    currentHTML = `<div class="ex-current">${value ? `<span class="ex-current__v">${esc(value)}</span>` : ''}<span>${esc(rest)}${current.power ? `. ${esc(current.power.text)}.` : '.'}</span></div>`;
  }
  return `
    <p class="ex-kicker">Line ${ex.line} of the netlist</p>
    <h3 class="ex-head">${esc(ex.heading)}</h3>
    <p class="ex-summary">${esc(ex.summary)}</p>
    ${fieldsOf(ex, v.colours)}
    ${currentHTML}
    ${ex.notes.length ? `<ul class="ex-notes">${ex.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`;
}

export function explainCard(v: ExplainView): string {
  let selected = '';
  if (v.selected?.kind === 'part' && v.selected.line) selected = lineExplanation(v, v.selected.line);
  else if (v.selected?.kind === 'part') {
    const ex = v.selected.placed;
    selected = `
      <p class="ex-kicker">Placed, not connected yet</p>
      <h3 class="ex-head">${esc(ex?.heading ?? v.selected.id)}</h3>
      <p class="ex-summary">${esc(ex?.summary ?? '')}</p>
      ${ex ? fieldsOf(ex, v.colours) : ''}
      <p class="ex-empty">It is not in the netlist yet: in this prototype only the divider is wired and solved.</p>`;
  } else if (v.selected?.kind === 'node') {
    const node = v.selected.node;
    const words = v.sol?.status === 'ok' ? v.sol.nodes.find((n) => n.node === node) : undefined;
    const mentions = v.explains.flatMap((ex) =>
      ex.fields.filter((fl) => /node/.test(fl.label) && fl.text.toLowerCase() === node).map((fl) => `<li><b>${esc(ex.heading.split(':')[0] ?? '')}</b>: ${esc(fl.meaning)}</li>`),
    );
    selected = `
      <p class="ex-kicker">Node</p>
      <h3 class="ex-head">${node === '0' ? 'Ground (node 0)' : esc(node)}${words ? ` · ${esc(words.text)}` : ''}</h3>
      ${mentions.length ? `<ul class="ex-list">${mentions.join('')}</ul>` : ''}`;
  } else {
    selected = `
      <p class="ex-kicker">One part at a time</p>
      <p class="ex-empty">Select a part on the drawing to see its netlist line explained, field by field.</p>
      <div class="part-list">${v.parts.map((p) => `<button class="part-chip" type="button" data-select="${esc(p.id)}"><span class="hand">${esc(p.id)}</span>${esc(p.label)}</button>`).join('')}</div>`;
  }
  return `
    ${head('explain', 'Explain', 'in plain words', 'Close the explanations')}
    <div class="card__body">
      <section class="ex-section" aria-label="${v.selected ? 'The selected part' : 'Choose a part'}">${selected}</section>
      <section class="ex-section" aria-labelledby="ex-words">
        <p class="ex-kicker" id="ex-words">The whole circuit in words</p>
        <p class="ex-words">${esc(v.describeText)}</p>
      </section>
    </div>`;
}
