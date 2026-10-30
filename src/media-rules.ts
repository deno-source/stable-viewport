import { ruleMedia } from './css-om';
import { hasSizeFeatures, transformMedia, unsupportedMediaUnits } from './transforms';
import type { Diagnostic } from './model';

interface Entry {
  before: string;
  written: string;
  /** Parsed once per author text: is it a size query, which units can't be projected. */
  sizeFeature: boolean;
  units: string[];
  /** Scale the current `written` text belongs to; equal scale means nothing to do. */
  scale: number;
}

interface Facts {
  sizeFeature: boolean;
  units: string[];
  /** Bounded: only a handful of scales occur in one page's lifetime. */
  adapted: Map<number, string>;
}

interface MediaRulesState {
  entries: Map<CSSMediaRule, Entry>;
  facts: Map<string, Facts>;
  getScale: () => number;
  report: (diagnostic: Diagnostic) => void;
}

const MAX_FACTS = 512;
const MAX_SCALES = 16;

function reportUnits(state: MediaRulesState, units: string[]) {
  for (const unit of units) {
    state.report({
      code: 'unsupported-media-unit',
      message: `Breakpoint unit "${unit}" cannot be projected onto the design canvas and keeps its native meaning`,
      detail: { unit },
    });
  }
}

/** Everything that depends only on the author's text, computed once. */
function facts(state: MediaRulesState, query: string): Facts {
  const cached = state.facts.get(query);
  if (cached) return cached;
  // Author texts repeat heavily (2320 rules, 29 distinct queries); a bounded
  // cache keeps the parse count proportional to the distinct inputs.
  if (state.facts.size >= MAX_FACTS) state.facts.clear();
  const created: Facts = {
    sizeFeature: hasSizeFeatures(query),
    units: unsupportedMediaUnits(query),
    adapted: new Map(),
  };
  state.facts.set(query, created);
  return created;
}

function transform(state: MediaRulesState, query: string, scale: number, cache: Facts): string {
  const cached = cache.adapted.get(scale);
  if (cached !== undefined) return cached;
  if (cache.adapted.size >= MAX_SCALES) cache.adapted.clear();
  const adapted = transformMedia(query, scale);
  cache.adapted.set(scale, adapted);
  return adapted;
}

function adaptRule(state: MediaRulesState, rule: CSSMediaRule) {
  const list = ruleMedia(rule);
  if (!list) return;
  const current = list.mediaText;
  const scale = state.getScale();
  const previous = state.entries.get(rule);
  // Our text is intact and the scale has not moved: nothing to redo.
  if (previous && previous.written === current && previous.scale === scale) return;
  const dirty = !previous || previous.written !== current;
  const before = dirty ? current : previous.before;
  const parsed = dirty ? facts(state, before) : previous;
  if (dirty) reportUnits(state, parsed.units);
  if (!parsed.sizeFeature) {
    if (dirty) state.entries.set(rule, { before, written: current, sizeFeature: false, units: parsed.units, scale });
    return;
  }
  const adapted = transform(state, before, scale, facts(state, before));
  if (adapted !== current) list.mediaText = adapted;
  state.entries.set(rule, { before, written: list.mediaText, sizeFeature: true, units: parsed.units, scale });
}

/** A rule deleted from its list, or a sheet detached from the document, is dead weight. */
function isDetached(rule: CSSMediaRule): boolean {
  const sheet = rule.parentStyleSheet;
  if (!sheet) return true;
  const owner = sheet.ownerNode;
  return !!owner && !owner.isConnected;
}

function refreshRules(state: MediaRulesState) {
  for (const rule of Array.from(state.entries.keys())) {
    if (isDetached(rule)) state.entries.delete(rule);
    else adaptRule(state, rule);
  }
}

function restoreRules(state: MediaRulesState) {
  for (const [rule, entry] of state.entries) {
    const list = ruleMedia(rule);
    if (list && list.mediaText === entry.written) list.mediaText = entry.before;
  }
  state.entries.clear();
  state.facts.clear();
}

/** `replace`/`replaceSync` discarded the old rule list of this sheet. */
function forgetSheet(state: MediaRulesState, sheet: CSSStyleSheet) {
  for (const rule of Array.from(state.entries.keys())) {
    if (!rule.parentStyleSheet || rule.parentStyleSheet === sheet) state.entries.delete(rule);
  }
}

/**
 * Owns `@media` conditions: projects design breakpoints onto the engine
 * viewport, remembers the author's text, and restores it on teardown.
 */
export function createMediaRules(getScale: () => number, report: (diagnostic: Diagnostic) => void) {
  const state: MediaRulesState = { entries: new Map(), facts: new Map(), getScale, report };
  return {
    adapt: (rule: CSSMediaRule) => adaptRule(state, rule),
    /** A deleted rule never needs to be projected again. */
    forget: (rule: CSSRule) => { state.entries.delete(rule as CSSMediaRule); },
    forgetSheet: (sheet: CSSStyleSheet) => forgetSheet(state, sheet),
    /** Re-projects every known breakpoint; the only work a resize needs. */
    refresh: () => refreshRules(state),
    restore: () => restoreRules(state),
    size: () => state.entries.size,
  };
}
