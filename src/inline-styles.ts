import { StyleChanges } from './changes';
import { transformValue } from './transforms';

/**
 * Rewrites viewport units inside inline `style` declarations. The root element
 * is owned by the runtime only for its zoom and `--sv-*` variables, so an
 * application custom property written inline on `<html>` still adapts.
 */
function isRuntimeProperty(property: string): boolean {
  return property === 'zoom' || property.startsWith('--sv-');
}

export function createInlineStyles(root: HTMLElement) {
  const changes = new StyleChanges();

  const adapt = (style: CSSStyleDeclaration | undefined) => {
    if (!style || style.length === 0) return;
    for (const property of Array.from(style)) {
      if (changes.owns(style, property)) continue;
      if (style === root.style && isRuntimeProperty(property)) continue;
      const value = style.getPropertyValue(property);
      const adapted = transformValue(value);
      if (adapted !== value) changes.set(style, property, adapted, style.getPropertyPriority(property));
    }
  };

  /** Restores one declaration set and drops the registration. */
  const release = (style: CSSStyleDeclaration | undefined) => {
    if (style) changes.release(style);
  };

  return {
    adapt,
    release,
    restore: () => changes.restore(),
    size: () => changes.size(),
  };
}
