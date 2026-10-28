'use client';
import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { mountViewport, type ViewportOptions, type ViewportController } from './index';

export function useStableViewport(options:ViewportOptions={}) {
  const controller=useRef<ViewportController|null>(null);
  const callback=useRef(options.onDiagnostic);callback.current=options.onDiagnostic;
  const {designWidth,enabled,mobile,document}=options;
  useEffect(()=>{
    const instance=mountViewport({designWidth,enabled,mobile,document,onDiagnostic:value=>callback.current?.(value)});
    controller.current=instance;
    return ()=>{instance.destroy();if(controller.current===instance) controller.current=null;};
  },[designWidth,enabled,mobile,document]);
  return controller;
}
export interface StableViewportProps extends ViewportOptions {children?:ReactNode}
export function StableViewport({children,...options}:StableViewportProps) {
  useStableViewport(options);
  return <Fragment>{children}</Fragment>;
}
