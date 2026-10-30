type BrowserWindow = Window & typeof globalThis;

/** Structural checks so rules from other realms and nested groups are handled. */
interface RuleLike extends CSSRule {
  style?: CSSStyleDeclaration;
  media?: MediaList;
  cssRules?: CSSRuleList;
  styleSheet?: CSSStyleSheet | null;
}

/** One shape for every optional member: absent, present-and-usable, or nothing. */
function readMember<K extends keyof RuleLike>(rule: CSSRule, key: K, usable: (value: unknown) => boolean): RuleLike[K] | undefined {
  const value = (rule as RuleLike)[key];
  if (value === undefined || value === null) return undefined;
  return usable(value) ? value : undefined;
}

export function ruleStyle(rule: CSSRule): CSSStyleDeclaration | undefined {
  return readMember(rule, 'style', (value) => typeof (value as CSSStyleDeclaration).getPropertyValue === 'function') as CSSStyleDeclaration | undefined;
}

export function ruleMedia(rule: CSSRule): MediaList | undefined {
  return readMember(rule, 'media', (value) => typeof (value as MediaList).mediaText === 'string') as MediaList | undefined;
}

export function ruleChildren(rule: CSSRule): CSSRuleList | undefined {
  return readMember(rule, 'cssRules', (value) => {
    const rules = value as CSSRuleList;
    return typeof rules.length === 'number' && typeof rules.item === 'function';
  }) as CSSRuleList | undefined;
}

export function ruleImportedSheet(rule: CSSRule): CSSStyleSheet | null | undefined {
  const candidate = rule as RuleLike;
  return 'styleSheet' in candidate ? candidate.styleSheet : undefined;
}

/** Container queries resolve against a container in design space, so they are not rewritten. */
export function isContainerRule(rule: CSSRule, window: BrowserWindow): boolean {
  const constructor = (window as unknown as { CSSContainerRule?: Function }).CSSContainerRule;
  if (constructor && rule instanceof (constructor as never)) return true;
  const candidate = rule as RuleLike & { containerQuery?: string; containerName?: string };
  return typeof candidate.containerQuery === 'string' || typeof candidate.containerName === 'string';
}
