import valueParser, { type Node } from 'postcss-value-parser';

type UnitNode = Node & { value: string };

/** Dynamic viewport units collapse onto the stable design-canvas variables. */
const VIEWPORT_UNITS: Record<string, string> = {
  vw: 'vw', svw: 'vw', dvw: 'vw', lvw: 'vw',
  vh: 'vh', svh: 'vh', dvh: 'vh', lvh: 'vh',
  vmin: 'vmin', svmin: 'vmin', dvmin: 'vmin', lvmin: 'vmin',
  vmax: 'vmax', svmax: 'vmax', dvmax: 'vmax', lvmax: 'vmax',
};

/** Units a media query can compare against without knowing font metrics. */
const MEDIA_UNITS = new Set(['px', 'em', 'rem', 'pt', 'pc', 'in', 'cm', 'mm', 'q']);
/** Relative units whose media evaluation we cannot reproduce. */
const UNSUPPORTED_MEDIA_UNITS = new Set(['ch', 'ex', 'cap', 'ic', 'lh', 'rlh', 'vw', 'vh', 'vmin', 'vmax', 'vi', 'vb']);
const ABSOLUTE_PX: Record<string, number> = { px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6 };
const SIZE_FEATURE = /^(min-|max-)?(width|height)$/i;

/**
 * Cheap pre-filter. Parsing is the expensive part of a stylesheet walk, and the
 * overwhelming majority of declarations contain no viewport unit at all, so a
 * single regex decides whether the parser is worth invoking.
 */
const MAY_HAVE_VIEWPORT_UNIT = /(?:^|[^\w-])[-+]?\d*\.?\d*(?:s|d|l)?v(?:w|h|min|max)(?![\w-])/i;

function isUnitNode(node: Node): node is UnitNode {
  return node.type === 'word';
}

function round(value: number): number {
  return Number(value.toFixed(8));
}

/** Rewrites viewport units in a declaration value to design-canvas variables. */
export function transformValue(value: string): string {
  if (!MAY_HAVE_VIEWPORT_UNIT.test(value)) return value;
  const tree = valueParser(value);
  tree.walk((node) => {
    if (node.type === 'function' && node.value.toLowerCase() === 'url') return false;
    if (!isUnitNode(node)) return;
    const dimension = valueParser.unit(node.value);
    if (!dimension) return;
    const stable = VIEWPORT_UNITS[dimension.unit.toLowerCase()];
    if (stable) node.value = `calc(${dimension.number} * var(--sv-${stable}))`;
  });
  return tree.toString();
}

function isSizeGroup(node: Node): boolean {
  if (node.type !== 'function' || node.value !== '') return false;
  const children = (node as { nodes?: Node[] }).nodes ?? [];
  return children.some((child) => isUnitNode(child) && SIZE_FEATURE.test(child.value));
}

/** Converts a media length into the engine's viewport space, or keeps it native. */
function convertMediaLength(token: string, scale: number): string | undefined {
  const dimension = valueParser.unit(token);
  if (!dimension) return undefined;
  const unit = dimension.unit.toLowerCase();
  const perPx = ABSOLUTE_PX[unit];
  if (perPx !== undefined) {
    const px = Number(dimension.number) * perPx * scale;
    return `${round(px)}px`;
  }
  if (unit === 'em' || unit === 'rem') {
    return `${round(Number(dimension.number) * scale)}${dimension.unit}`;
  }
  return undefined;
}

/**
 * Media queries are evaluated against the engine viewport (innerWidth), so the
 * design breakpoints are projected onto it by mediaScale. Units whose media
 * meaning we cannot reproduce (ch, ex, lh, vw, ...) stay native and are
 * reported by unsupportedMediaUnits.
 */
/** Same pre-filter for breakpoints: only a size feature can change. */
const MAY_HAVE_SIZE_FEATURE = /(?:min-|max-)?(?:width|height)/i;

export function transformMedia(query: string, scale: number): string {
  if (!MAY_HAVE_SIZE_FEATURE.test(query)) return query;
  const tree = valueParser(query);
  tree.walk((node) => {
    if (!isSizeGroup(node)) return;
    for (const child of (node as { nodes?: Node[] }).nodes ?? []) {
      if (!isUnitNode(child)) continue;
      const converted = convertMediaLength(child.value, scale);
      if (converted !== undefined) child.value = converted;
    }
    return false;
  });
  return tree.toString();
}

/** True when the query is compared against the viewport width or height. */
export function hasSizeFeatures(query: string): boolean {
  let found = false;
  valueParser(query).walk((node) => {
    if (found || !isSizeGroup(node)) return;
    found = true;
  });
  return found;
}

/** Relative media units that cannot be projected onto the design canvas. */
export function unsupportedMediaUnits(query: string): string[] {
  const units = new Set<string>();
  valueParser(query).walk((node) => {
    if (!isUnitNode(node)) return;
    const dimension = valueParser.unit(node.value);
    if (!dimension) return;
    const unit = dimension.unit.toLowerCase();
    if (UNSUPPORTED_MEDIA_UNITS.has(unit)) units.add(unit);
  });
  return [...units];
}

export { MEDIA_UNITS, ABSOLUTE_PX };
