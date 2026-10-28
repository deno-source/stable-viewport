import {ViewportBootstrap,StableViewport} from 'stable-viewport/next';
export default function Layout({children}:{children:React.ReactNode}) {
  return <html lang="en" suppressHydrationWarning><body style={{margin:0}}><ViewportBootstrap/><StableViewport>{children}</StableViewport></body></html>;
}
