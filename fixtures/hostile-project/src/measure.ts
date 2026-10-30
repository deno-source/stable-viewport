export function measure() {
  const width = window.innerWidth;
  const height = document.documentElement.clientHeight;
  return { width, height };
}
export function pinned() {
  const host = document.createElement('div');
  host.attachShadow({ mode: 'closed' });
  return host;
}
