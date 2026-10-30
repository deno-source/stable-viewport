interface Property {
  before: string;
  beforePriority: string;
  written: string;
  writtenPriority: string;
}

const PLAIN_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

/** CSSOM serializes `0.6666666666666666` as `0.666667`; the same value must not be rewritten. */
function sameNumber(left: string, right: string): boolean {
  if (!PLAIN_NUMBER.test(left) || !PLAIN_NUMBER.test(right)) return false;
  return Math.abs(Number(left) - Number(right)) < 1e-6;
}

/** A declaration is already at the target value, allowing CSSOM rounding. */
function isEqual(current: string, currentPriority: string, value: string, priority: string): boolean {
  if (currentPriority !== priority) return false;
  return current === value || sameNumber(current, value);
}

/**
 * Tracks CSS declarations written by the library so teardown can restore the
 * exact previous value, and so a value the application replaced afterwards is
 * left alone. `set` is idempotent for a declaration already at the target.
 */
export class StyleChanges {
  private readonly styles = new Map<CSSStyleDeclaration, Map<string, Property>>();

  set(style: CSSStyleDeclaration, property: string, value: string, priority = '') {
    const current = style.getPropertyValue(property);
    const currentPriority = style.getPropertyPriority(property);
    if (isEqual(current, currentPriority, value, priority)) return;
    const properties = this.properties(style);
    const previous = properties.get(property);
    // Still ours: carry the original `before` forward so intermediate writes
    // never overwrite the value the application really had.
    const before = previous && current === previous.written && currentPriority === previous.writtenPriority
      ? previous
      : { before: current, beforePriority: currentPriority, written: value, writtenPriority: priority };
    style.setProperty(property, value, priority);
    properties.set(property, {
      before: before.before,
      beforePriority: before.beforePriority,
      written: style.getPropertyValue(property),
      writtenPriority: style.getPropertyPriority(property),
    });
  }

  owns(style: CSSStyleDeclaration, property: string): boolean {
    const entry = this.styles.get(style)?.get(property);
    return entry !== undefined &&
      entry.written === style.getPropertyValue(property) &&
      entry.writtenPriority === style.getPropertyPriority(property);
  }

  /** Restores one declaration set and forgets it, so a removed element is reclaimable. */
  release(style: CSSStyleDeclaration) {
    const properties = this.styles.get(style);
    if (!properties) return;
    this.restoreProperties(style, properties);
    this.styles.delete(style);
  }

  restore() {
    for (const [style, properties] of this.styles) this.restoreProperties(style, properties);
    this.styles.clear();
  }

  size(): number {
    return this.styles.size;
  }

  private restoreProperties(style: CSSStyleDeclaration, properties: Map<string, Property>) {
    for (const [property, entry] of properties) {
      if (!this.owns(style, property)) continue;
      if (entry.before) style.setProperty(property, entry.before, entry.beforePriority);
      else style.removeProperty(property);
    }
  }

  private properties(style: CSSStyleDeclaration): Map<string, Property> {
    let properties = this.styles.get(style);
    if (!properties) {
      properties = new Map();
      this.styles.set(style, properties);
    }
    return properties;
  }
}
