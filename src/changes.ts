interface Property { before: string; priority: string; written: string; writtenPriority: string }
/** Restore only values still owned by this instance; respect later application writes. */
export class StyleChanges {
  private styles = new Map<CSSStyleDeclaration, Map<string, Property>>();
  set(style: CSSStyleDeclaration, property: string, value: string, priority = '') {
    const current = style.getPropertyValue(property);
    const currentPriority = style.getPropertyPriority(property);
    if (current === value && currentPriority === priority) return;
    let properties = this.styles.get(style);
    if (!properties) { properties = new Map(); this.styles.set(style, properties); }
    const previous = properties.get(property);
    const before = previous && current === previous.written && currentPriority === previous.writtenPriority
      ? previous : {before:current,priority:currentPriority};
    style.setProperty(property,value,priority);
    properties.set(property,{before:before.before,priority:before.priority,written:style.getPropertyValue(property),writtenPriority:style.getPropertyPriority(property)});
  }
  owns(style: CSSStyleDeclaration, property: string) {
    const entry=this.styles.get(style)?.get(property);
    return entry?.written===style.getPropertyValue(property) && entry.writtenPriority===style.getPropertyPriority(property);
  }
  restore() {
    for (const [style, properties] of this.styles) for (const [property, entry] of properties) {
      if (!this.owns(style,property)) continue;
      if (entry.before) style.setProperty(property,entry.before,entry.priority);
      else style.removeProperty(property);
    }
    this.styles.clear();
  }
}
