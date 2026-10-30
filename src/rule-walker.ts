import { isContainerRule, ruleChildren, ruleImportedSheet, ruleMedia, ruleStyle } from './css-om';

type BrowserWindow = Window & typeof globalThis;

export interface RuleHandlers {
  media(rule: CSSMediaRule): void;
  style(style: CSSStyleDeclaration): void;
  container(rule: CSSRule): void;
  sheet(sheet: CSSStyleSheet): void;
}

/**
 * Walks a rule list depth-first. Rules are matched structurally, so rules from
 * other realms and nested grouping rules (@supports, @layer, @container) are
 * handled without relying on one engine's constructors.
 */
function visitRule(rule: CSSRule, window: BrowserWindow, handlers: RuleHandlers, isActive: () => boolean) {
  if (ruleMedia(rule)) handlers.media(rule as CSSMediaRule);
  const style = ruleStyle(rule);
  if (style) handlers.style(style);
  if (isContainerRule(rule, window)) handlers.container(rule);
  const imported = ruleImportedSheet(rule);
  if (imported) handlers.sheet(imported);
  const children = ruleChildren(rule);
  if (children) visitRules(children, window, handlers, isActive);
}

export function visitRules(rules: CSSRuleList, window: BrowserWindow, handlers: RuleHandlers, isActive: () => boolean) {
  for (const rule of Array.from(rules)) {
    if (!isActive()) return;
    visitRule(rule, window, handlers, isActive);
  }
}
