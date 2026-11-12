/**
 * The drawing's tools, in plain TypeScript (decision 0002): Select, Wire, the parts R C L V I and
 * the controlled sources E F G H, and Ground, with the key that chooses each and their names in
 * sentences. The parts toolbar (components/PartsToolbar.tsx) and the phone's Parts sheet show them;
 * the editor (editing.ts) and the hint line (words.ts) speak of them.
 */
import { t } from '../i18n/index.ts';
import type { PartLetter } from '../schematic/index.ts';
import { elementInfo } from '../spice/elements.ts';

export type Tool = 'select' | 'wire' | PartLetter | 'ground';
export type Controlled = 'E' | 'F' | 'G' | 'H';
export const CONTROLLED: readonly Controlled[] = ['E', 'F', 'G', 'H'];
export const isControlled = (tool: Tool): tool is Controlled => tool === 'E' || tool === 'F' || tool === 'G' || tool === 'H';

/** A tool that places something on the drawing: a part or a ground symbol. */
export type PartKind = PartLetter | 'ground';
export const isPartKind = (tool: Tool): tool is PartKind => tool !== 'select' && tool !== 'wire';

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** A part's name in the catalog's words: "Resistor", "Current-controlled current source". */
export const kindName = (letter: PartLetter): string => cap(elementInfo(letter)?.name ?? letter);

/**
 * What a controlled source does, in plain words, from the catalog: "makes a current: gain × the
 * current through a voltage source" (SPICE reads only that current: the ammeter trick, explain.ts).
 */
export function controlledLine(letter: Controlled): string {
  const makes = letter === 'E' || letter === 'H' ? t('wordVoltage') : t('wordCurrent');
  const follows = letter === 'E' || letter === 'G' ? t('controlledReadsVoltage') : t('controlledReadsCurrent');
  return t('controlledMakes', { makes, gain: elementInfo(letter)?.valueLabel ?? 'gain', follows });
}

/** The tool a key chooses (plain letters, no modifier), or undefined. */
export function toolForKey(key: string): Tool | undefined {
  const k = key.toUpperCase();
  if (k === 'W') return 'wire';
  if (k === '0') return 'ground';
  if (k.length === 1 && 'RCLVIEFGH'.includes(k)) return k as PartLetter;
  return undefined;
}

/** The key that chooses a tool, as the toolbar shows it. */
export function keyForTool(tool: Tool): string {
  if (tool === 'select') return 'Esc';
  if (tool === 'wire') return 'W';
  if (tool === 'ground') return '0';
  return tool;
}

/** What a tool is called in sentences ("a resistor", "an inductor", "a ground symbol"). */
export function toolPhrase(tool: Tool): string {
  if (tool === 'select') return t('toolSelect');
  if (tool === 'wire') return t('phraseWire');
  if (tool === 'ground') return t('phraseGround');
  const name = elementInfo(tool)?.name ?? tool;
  return t(/^[aeiou]/i.test(name) ? 'phraseAn' : 'phraseA', { name });
}

/** What a placed thing is called with "the": "the resistor", "the ground symbol". */
export function theTool(kind: PartKind): string {
  return kind === 'ground' ? t('theGround') : t('theName', { name: elementInfo(kind)?.name ?? kind });
}

/**
 * The other names a tool's Place command has in Ctrl+K, found and ranked as its own name: each
 * dependent source (E to H) has the tool's own name in the margin, "Dependent source" (the channel's
 * word and the examples'), its group's name in the margin's menu and the phone's Parts sheet,
 * "Dependent sources", and its textbook initials, read off its catalog name ("vcvs":
 * voltage-controlled voltage source, E). So "dependent", "dependent sources" or "cccs" puts a Place
 * command first, not an example that would replace the open circuit (final reviews, words W4).
 */
export function toolAliases(tool: Tool): string[] {
  if (!isControlled(tool)) return [];
  const initials = (elementInfo(tool)?.name ?? '')
    .split(/[^a-z]+/i)
    .filter(Boolean)
    .map((w) => w.charAt(0).toLowerCase())
    .join('');
  return [...new Set([t('toolControlled'), t('partsGroupControlled'), t('controlledMenu')])].concat(initials);
}
