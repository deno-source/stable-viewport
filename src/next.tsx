'use client';
import Script from 'next/script';
export { StableViewport, useStableViewport } from './react';
export type { StableViewportProps } from './react';
export interface ViewportBootstrapProps {src?:string;nonce?:string;designWidth?:number}
/** Place in the Next.js root layout; retain StableViewport for client recovery. */
export function ViewportBootstrap({src='/stable-viewport.auto.js',nonce,designWidth=1920}:ViewportBootstrapProps) {
  return <Script id="stable-viewport-bootstrap" src={src} nonce={nonce} data-design-width={designWidth} strategy="beforeInteractive" />;
}
