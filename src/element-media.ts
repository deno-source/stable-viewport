import { hasSizeFeatures, transformMedia, unsupportedMediaUnits } from './transforms';
import type { Diagnostic } from './model';

type ElementWithMedia = HTMLElement | SVGElement;
type Report = (diagnostic: Diagnostic) => void;

interface Entry {
  before: string;
  written: string;
  scale: number;
  sizeFeature: boolean;
}

interface State {
  entries: Map<ElementWithMedia, Entry>;
  getScale: () => number;
  report: Report;
}

function hasQuery(value: string | null): value is string {
  return value !== null && value.trim() !== '';
}

/** Nothing to do when our text is intact and the scale has not moved. */
function isStale(previous: Entry | undefined, current: string, scale: number): boolean {
  return !previous || previous.written !== current || previous.scale !== scale;
}

/** The author's value: unchanged unless we wrote it and nobody touched it since. */
function authorText(previous: Entry | undefined, current: string): string {
  return previous && previous.written === current ? previous.before : current;
}

function reportUnits(state: State, query: string) {
  for (const unit of unsupportedMediaUnits(query)) {
    state.report({
      code: 'unsupported-media-unit',
      message: `Breakpoint unit "${unit}" cannot be projected onto the design canvas and keeps its native meaning`,
      detail: { unit, on: 'media attribute' },
    });
  }
}

function adaptElement(state: State, element: ElementWithMedia) {
  const current = element.getAttribute('media');
  if (!hasQuery(current)) return;
  const scale = state.getScale();
  const previous = state.entries.get(element);
  if (!isStale(previous, current, scale)) return;
  const dirty = !previous || previous.written !== current;
  const before = authorText(previous, current);
  if (dirty) reportUnits(state, before);
  const sizeFeature = dirty ? hasSizeFeatures(before) : previous.sizeFeature;
  if (!sizeFeature) {
    state.entries.delete(element);
    return;
  }
  const adapted = transformMedia(before, scale);
  if (adapted !== current) element.setAttribute('media', adapted);
  state.entries.set(element, { before, written: element.getAttribute('media') ?? current, scale, sizeFeature });
}

function isAlive(element: ElementWithMedia): boolean {
  return element.isConnected;
}

/**
 * `media="(max-width: …)"` on `<link>`/`<style>` is a breakpoint too, evaluated
 * by the engine exactly like `@media`. It is projected the same way and the
 * author's value is restored on teardown.
 */
export function createElementMedia(getScale: () => number, report: Report) {
  const state: State = { entries: new Map(), getScale, report };

  const refresh = () => {
    for (const element of Array.from(state.entries.keys())) {
      if (!isAlive(element)) state.entries.delete(element);
      else adaptElement(state, element);
    }
  };

  const restore = () => {
    for (const [element, entry] of state.entries) {
      if (element.getAttribute('media') === entry.written) element.setAttribute('media', entry.before);
    }
    state.entries.clear();
  };

  return {
    adapt: (element: ElementWithMedia) => adaptElement(state, element),
    refresh,
    restore,
    size: () => state.entries.size,
  };
}
