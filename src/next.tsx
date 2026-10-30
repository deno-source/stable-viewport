'use client';
import Script from 'next/script';
export { StableViewport, useStableViewport } from './react';
export type { StableViewportProps } from './react';
export type { ViewportOptions, ViewportState, ViewportController, Diagnostic } from './model';

export interface ViewportBootstrapProps {
  /** Path of the pre-hydration bundle produced by this package. */
  src?: string;
  nonce?: string;
  designWidth?: number;
}

/**
 * Place in the Next.js root layout. It only paints the pre-hydration canvas;
 * keep `StableViewport` mounted so a failed bootstrap asset still recovers and
 * so the lease is released on client navigation.
 */
export function ViewportBootstrap({ src = '/stable-viewport.auto.js', nonce, designWidth = 1920 }: ViewportBootstrapProps) {
  return <Script id="stable-viewport-bootstrap" src={src} nonce={nonce} data-design-width={designWidth} strategy="beforeInteractive" />;
}
