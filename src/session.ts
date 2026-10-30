import type { Diagnostic, NormalizedOptions, ViewportController, ViewportOptions } from './model';
import { createRuntime, type Runtime } from './runtime';
import { installStyles } from './styles';
import { installMedia } from './media';

type BrowserWindow = Window & typeof globalThis;

export interface Session {
  /** Absent while the first runtime is still being installed. */
  runtime?: Runtime;
  designWidth: number;
  owners: Set<symbol>;
  diagnostics: Diagnostic[];
  callbacks: Map<symbol, ViewportOptions['onDiagnostic']>;
  /** A nested mount during this window is rejected instead of joining half a session. */
  initializing: boolean;
}

const REGISTRY = Symbol.for('stable-viewport.sessions.v3');

interface RegistryHost {
  [REGISTRY]?: Session;
}

/** The owning Document decides the session, not the realm of the calling bundle. */
function lookup(document: Document): Session | undefined {
  return (document as Document & RegistryHost)[REGISTRY];
}

function store(document: Document, session: Session) {
  (document as Document & RegistryHost)[REGISTRY] = session;
}

function forget(document: Document, session: Session) {
  if (lookup(document) === session) delete (document as Document & RegistryHost)[REGISTRY];
}

/** One session per document, counted by owner. The last release destroys it. */
export function acquire(document: Document, options: NormalizedOptions, owner: symbol): Session {
  const existing = lookup(document);
  if (existing) {
    if (existing.initializing) {
      throw new Error('The document session is still initializing; mount after the outer controller is ready');
    }
    if (existing.designWidth !== options.designWidth) {
      throw new Error(`Conflicting designWidth for the same document: ${existing.designWidth} is already active`);
    }
    existing.owners.add(owner);
    existing.callbacks.set(owner, options.onDiagnostic);
    return existing;
  }
  return createSession(document, options, owner);
}

export function release(document: Document | undefined, session: Session | undefined, owner: symbol) {
  if (!document || !session) return;
  session.owners.delete(owner);
  session.callbacks.delete(owner);
  if (session.owners.size) return;
  // Drop the registry entry first: callbacks fired during teardown may mount a
  // replacement, which must start a fresh session instead of joining this one.
  forget(document, session);
  session.initializing = false;
  session.runtime?.destroy();
}

export function activeSession(document: Document | undefined) {
  return document ? lookup(document) : undefined;
}

function createSession(document: Document, options: NormalizedOptions, owner: symbol): Session {
  const window = document.defaultView as BrowserWindow;
  const session: Session = {
    designWidth: options.designWidth,
    owners: new Set([owner]),
    diagnostics: [],
    callbacks: new Map([[owner, options.onDiagnostic]]),
    initializing: true,
  };
  const report = (diagnostic: Diagnostic) => {
    session.diagnostics.push(diagnostic);
    for (const callback of session.callbacks.values()) callback?.(diagnostic);
  };
  // Provisional registration: a diagnostic callback that mounts the same
  // document during initialization hits a conflict instead of a half session.
  store(document, session);
  try {
    session.runtime = createRuntime(document, options, (getScale) => {
      const styles = installStyles(document, window, getScale, report);
      try {
        return { styles, media: installMedia(window, getScale) };
      } catch (error) {
        styles.destroy();
        throw error;
      }
    }, report);
  } catch (error) {
    forget(document, session);
    throw error;
  }
  session.initializing = false;
  return session;
}

/**
 * Releasing the conflict check for an in-place update: the other owners of the
 * document must already agree on the width.
 */
export function assertUpdateable(document: Document | undefined, owner: symbol, designWidth: number) {
  const other = activeSession(document);
  if (!other) return;
  if (other.initializing) {
    throw new Error('The document session is still initializing; wait for the outer controller');
  }
  const otherOwners = other.owners.size - (other.owners.has(owner) ? 1 : 0);
  if (otherOwners > 0 && other.designWidth !== designWidth) {
    throw new Error(`Conflicting designWidth for the same document: ${other.designWidth} is already active`);
  }
}

/** A pre-hydration `auto` bootstrap lease is handed to the first explicit controller. */
export function adoptBootstrapLease(document: Document | undefined) {
  if (!document) return;
  const key = Symbol.for('stable-viewport.auto.v1');
  const host = document.defaultView as (Window & Record<symbol, ViewportController | undefined>) | null;
  const bootstrap = host?.[key];
  if (!host || !bootstrap) return;
  bootstrap.destroy();
  delete host[key];
}
