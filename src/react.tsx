'use client';
import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { mountViewport, type ViewportOptions, type ViewportController } from './index';

/**
 * Mounts one lease for the component lifetime. Strict Mode's
 * setup → cleanup → setup is equivalent to a single mount because the lease is
 * counted per controller instance and teardown is idempotent.
 */
export function useStableViewport(options: ViewportOptions = {}): React.RefObject<ViewportController | null> {
  const controller = useRef<ViewportController | null>(null);
  const callback = useRef(options.onDiagnostic);
  callback.current = options.onDiagnostic;
  const { designWidth, enabled, mobile, document } = options;
  useEffect(() => {
    const instance = mountViewport({ designWidth, enabled, mobile, document, onDiagnostic: (value) => callback.current?.(value) });
    controller.current = instance;
    return () => {
      instance.destroy();
      if (controller.current === instance) controller.current = null;
    };
  }, [designWidth, enabled, mobile, document]);
  return controller;
}

export interface StableViewportProps extends ViewportOptions {
  children?: ReactNode;
}

/** Renders children unchanged; the wrapper contributes no box and no DOM node. */
export function StableViewport({ children, ...options }: StableViewportProps) {
  useStableViewport(options);
  return <Fragment>{children}</Fragment>;
}
