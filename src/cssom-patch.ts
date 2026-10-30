type BrowserWindow = Window & typeof globalThis;

export interface CssomHooks {
  /** Rules created by `insertRule` (sheet or grouping rule). */
  rules(rules: CSSRuleList): void;
  /** A sheet was filled or assigned; `replaced` means its rule list was rewritten. */
  sheet(sheet: CSSStyleSheet, replaced?: boolean): void;
  /** A rule was deleted; its cached registration is no longer reachable. */
  removed(rule: CSSRule): void;
  /** A shadow root was attached at runtime. */
  shadow(root: ShadowRoot): void;
}

export interface CssomPatch {
  restore(): void;
}

type RuleSink = (rules: CSSRuleList) => void;
type SheetSink = (sheet: CSSStyleSheet, replaced?: boolean) => void;
type RuleRemoved = (rule: CSSRule) => void;

/** `insertRule` reports the rule it created. */
function patchInsertRule(proto: { insertRule: CSSStyleSheet['insertRule'] }, sink: RuleSink, isActive: () => boolean) {
  const native = proto.insertRule;
  if (typeof native !== 'function') return () => {};
  const patched = function insertRule(this: CSSStyleSheet, ...args: Parameters<CSSStyleSheet['insertRule']>) {
    const index = Reflect.apply(native, this, args);
    const inserted = isActive() ? this.cssRules[index] : undefined;
    if (inserted) sink([inserted] as unknown as CSSRuleList);
    return index;
  } as CSSStyleSheet['insertRule'];
  proto.insertRule = patched;
  return () => {
    if (proto.insertRule === patched) proto.insertRule = native;
  };
}

/** `deleteRule` reports the rule it removed, so no cache keeps writing to it. */
function patchDeleteRule(proto: { deleteRule: CSSStyleSheet['deleteRule'] }, sink: RuleRemoved, isActive: () => boolean) {
  const native = proto.deleteRule;
  if (typeof native !== 'function') return () => {};
  const patched = function deleteRule(this: CSSStyleSheet, ...args: Parameters<CSSStyleSheet['deleteRule']>) {
    const removed = isActive() ? this.cssRules[args[0]] : undefined;
    Reflect.apply(native, this, args);
    if (removed) sink(removed);
  } as CSSStyleSheet['deleteRule'];
  proto.deleteRule = patched;
  return () => {
    if (proto.deleteRule === patched) proto.deleteRule = native;
  };
}

/** Async `replace` rewrites the whole rule list of an existing sheet. */
function patchReplace(proto: { replace: CSSStyleSheet['replace'] }, sink: SheetSink, isActive: () => boolean) {
  const native = proto.replace;
  if (typeof native !== 'function') return () => {};
  const patched = function replace(this: CSSStyleSheet, ...args: Parameters<CSSStyleSheet['replace']>) {
    return Reflect.apply(native, this, args).then((sheet: CSSStyleSheet) => {
      if (isActive()) sink(sheet, true);
      return sheet;
    });
  } as CSSStyleSheet['replace'];
  proto.replace = patched;
  return () => {
    if (proto.replace === patched) proto.replace = native;
  };
}

/** Sync `replaceSync` rewrites the whole rule list of an existing sheet. */
function patchReplaceSync(proto: { replaceSync: CSSStyleSheet['replaceSync'] }, sink: SheetSink, isActive: () => boolean) {
  const native = proto.replaceSync;
  if (typeof native !== 'function') return () => {};
  const patched = function replaceSync(this: CSSStyleSheet, ...args: Parameters<CSSStyleSheet['replaceSync']>) {
    Reflect.apply(native, this, args);
    if (isActive()) sink(this, true);
  } as CSSStyleSheet['replaceSync'];
  proto.replaceSync = patched;
  return () => {
    if (proto.replaceSync === patched) proto.replaceSync = native;
  };
}

const MUTATORS = new Set<PropertyKey>(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'copyWithin', 'fill']);

/** In-place `push`/`splice` on the observable array never reaches the property setter. */
function wrapAdopted(value: CSSStyleSheet[], sink: SheetSink, isActive: () => boolean): CSSStyleSheet[] {
  return new Proxy(value, {
    get(target, property, receiver) {
      const member = Reflect.get(target, property, receiver);
      if (typeof member !== 'function' || !MUTATORS.has(property)) return member;
      return (...args: unknown[]) => {
        const result = Reflect.apply(member, target, args);
        if (isActive()) for (const sheet of target) sink(sheet);
        return result;
      };
    },
  });
}

interface AdoptedCache {
  target: CSSStyleSheet[];
  proxy: CSSStyleSheet[];
}

/** `adoptedStyleSheets = [...]` and in-place array updates both report their sheets. */
function installAdopted(prototype: object, descriptor: PropertyDescriptor, sink: SheetSink, isActive: () => boolean) {
  const nativeGet = descriptor.get!;
  const nativeSet = descriptor.set!;
  const cache = new WeakMap<object, AdoptedCache>();
  const getter = function (this: Document | ShadowRoot) {
    const value = nativeGet.call(this);
    if (!isActive()) return value;
    const cached = cache.get(this);
    if (cached && cached.target === value) return cached.proxy;
    const entry: AdoptedCache = { target: value, proxy: wrapAdopted(value, sink, isActive) };
    cache.set(this, entry);
    return entry.proxy;
  };
  const setter = function (this: Document | ShadowRoot, value: CSSStyleSheet[]) {
    nativeSet.call(this, value);
    cache.delete(this);
    if (!isActive()) return;
    for (const sheet of value) sink(sheet);
  };
  Object.defineProperty(prototype, 'adoptedStyleSheets', { ...descriptor, get: getter, set: setter });
  return () => {
    const current = Object.getOwnPropertyDescriptor(prototype, 'adoptedStyleSheets');
    // Only restore when the descriptor is still ours: a host wrapper installed
    // afterwards keeps owning the property after we are destroyed.
    if (current?.get !== getter || current.set !== setter) return;
    Object.defineProperty(prototype, 'adoptedStyleSheets', descriptor);
  };
}

function patchAdopted(window: BrowserWindow, sink: SheetSink, isActive: () => boolean) {
  const restores: (() => void)[] = [];
  for (const prototype of [window.Document.prototype, window.ShadowRoot.prototype] as object[]) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'adoptedStyleSheets');
    if (!descriptor?.get || !descriptor.set) continue;
    restores.push(installAdopted(prototype, descriptor, sink, isActive));
  }
  return () => {
    for (const restore of restores) restore();
  };
}

/** A shadow root attached later is invisible to a light-DOM MutationObserver. */
function patchAttachShadow(window: BrowserWindow, onShadow: (root: ShadowRoot) => void) {
  const proto = window.Element.prototype as unknown as Record<'attachShadow', Element['attachShadow']>;
  const native = proto.attachShadow;
  if (typeof native !== 'function') return () => {};
  const patched = function attachShadow(this: Element, ...args: Parameters<Element['attachShadow']>) {
    const root = Reflect.apply(native, this, args);
    try {
      onShadow(root);
    } catch {
      // Adaptation of a fresh root must never break the caller's attachShadow.
    }
    return root;
  };
  proto.attachShadow = patched;
  return () => {
    if (proto.attachShadow === patched) proto.attachShadow = native;
  };
}

/**
 * Hooks the ways CSS enters a document at runtime. Each hook only reports what
 * changed and delegates adaptation to the caller, so this module never
 * transforms anything itself.
 */
export function patchCssom(window: BrowserWindow, hooks: CssomHooks): CssomPatch {
  let active = true;
  const isActive = () => active;
  const sheet = window.CSSStyleSheet.prototype;
  const grouping = (window as unknown as { CSSGroupingRule?: { prototype: { insertRule: CSSStyleSheet['insertRule']; deleteRule: CSSStyleSheet['deleteRule'] } } }).CSSGroupingRule?.prototype;
  const restores = [
    patchInsertRule(sheet, hooks.rules, isActive),
    patchDeleteRule(sheet, hooks.removed, isActive),
    patchReplace(sheet, hooks.sheet, isActive),
    patchReplaceSync(sheet, hooks.sheet, isActive),
    ...(grouping
      ? [patchInsertRule(grouping, hooks.rules, isActive), patchDeleteRule(grouping, hooks.removed, isActive)]
      : []),
    patchAdopted(window, hooks.sheet, isActive),
    patchAttachShadow(window, hooks.shadow),
  ];
  return {
    restore() {
      active = false;
      for (const restore of restores) restore();
    },
  };
}
