import Link from 'next/link';
export default function Page(){return <main style={{padding:32}}><h1>Next.js SSR example</h1><div id="ssr-px" style={{width:120,height:40,background:'#2563eb'}}/><Link href="/second">Client navigation</Link></main>;}
