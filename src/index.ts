import { normalizeOptions, type Diagnostic, type ViewportController, type ViewportOptions, type ViewportState, type ViewportStatus } from './model';
import { adoptBootstrapLease, acquire, assertUpdateable, release, type Session } from './session';
import { checkCapability, findHostConflicts } from './capability';

export type { Diagnostic, ViewportController, ViewportOptions, ViewportState, ViewportStatus } from './model';
export { normalizeOptions, viewportMetrics, isMobile } from './model';
export { transformMedia, transformValue, hasSizeFeatures, unsupportedMediaUnits } from './transforms';
export { checkCapability, findHostConflicts } from './capability';

interface Lease {
  options: ReturnType<typeof normalizeOptions>;
  session?: Session;
  status?: ViewportStatus;
  diagnostics: Diagnostic[];
}

interface Mount {
  lease: Lease;
  owner: symbol;
  document: Document | undefined;
  destroyed: boolean;
}

function currentDocument(document: Document | undefined): Document | undefined {
  return document ?? (typeof globalThis.document === 'undefined' ? undefined : globalThis.document);
}

/** Capability first, then host conflicts, then the shared session. */
function installLease(mount: Mount) {
  const { lease, owner, document } = mount;
  lease.session = undefined;
  const capability = checkCapability(document, lease.options);
  lease.status = capability.status;
  lease.diagnostics = capability.diagnostics;
  if (capability.status) {
    capability.diagnostics.forEach((diagnostic) => lease.options.onDiagnostic?.(diagnostic));
    return;
  }
  const conflicts = document ? findHostConflicts(document, lease.options) : [];
  if (conflicts.length) {
    lease.status = 'unsupported';
    lease.diagnostics = conflicts;
    conflicts.forEach((diagnostic) => lease.options.onDiagnostic?.(diagnostic));
    return;
  }
  if (document) lease.session = acquire(document, lease.options, owner);
}

function readState({ lease, destroyed }: Mount): ViewportState {
  return {
    status: destroyed ? 'destroyed' : lease.status ?? 'active',
    scale: lease.session?.runtime?.state().scale ?? 1,
    designWidth: lease.options.designWidth,
    diagnostics: lease.session ? lease.session.diagnostics.slice() : lease.diagnostics.slice(),
  };
}

/** The fields that decide layout, document ownership and whether we install at all. */
function layoutChanged(previous: ReturnType<typeof normalizeOptions>, next: ReturnType<typeof normalizeOptions>, document: Document | undefined, previousDocument: Document | undefined): boolean {
  return previous.designWidth !== next.designWidth ||
    previous.enabled !== next.enabled ||
    previous.mobile !== next.mobile ||
    document !== previousDocument;
}

/** Validates the next options completely before touching the live document. */
function updateLease(mount: Mount, patch: Partial<ViewportOptions>) {
  const next = normalizeOptions({ ...mount.lease.options, ...patch });
  const nextDocument = currentDocument(next.document);
  assertUpdateable(nextDocument, mount.owner, next.designWidth);
  if (!layoutChanged(mount.lease.options, next, nextDocument, mount.document)) {
    // Nothing that affects layout or ownership moved: only re-register callbacks.
    mount.lease.options = next;
    mount.lease.session?.callbacks.set(mount.owner, next.onDiagnostic);
    return;
  }
  release(mount.document, mount.lease.session, mount.owner);
  mount.lease.options = next;
  mount.document = nextDocument;
  installLease(mount);
}

function destroyLease(mount: Mount) {
  if (mount.destroyed) return;
  mount.destroyed = true;
  release(mount.document, mount.lease.session, mount.owner);
  mount.lease.session = undefined;
  mount.lease.status = 'destroyed';
}

/**
 * Per-call lease. No side effects at import time; every call is independently
 * disposable, and `destroy` is idempotent.
 */
export function mountViewport(input: ViewportOptions = {}): ViewportController {
  const mount: Mount = {
    lease: { options: normalizeOptions(input), diagnostics: [] },
    owner: Symbol('stable-viewport-owner'),
    document: undefined,
    destroyed: false,
  };
  mount.document = currentDocument(mount.lease.options.document);
  installLease(mount);
  if (mount.lease.session) adoptBootstrapLease(mount.document);

  return {
    refresh: () => {
      if (!mount.destroyed) mount.lease.session?.runtime?.refresh();
    },
    getState: () => readState(mount),
    update: (patch) => {
      if (mount.destroyed) throw new Error('Cannot update a destroyed viewport controller');
      updateLease(mount, patch);
    },
    destroy: () => destroyLease(mount),
  };
}
