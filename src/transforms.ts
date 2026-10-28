import valueParser from 'postcss-value-parser';

const units: Record<string,string> = {vw:'vw',svw:'vw',dvw:'vw',lvw:'vw',vh:'vh',svh:'vh',dvh:'vh',lvh:'vh',vmin:'vmin',vmax:'vmax'};
export function transformValue(value: string): string {
  const tree = valueParser(value);
  tree.walk(node => {
    if (node.type === 'function' && node.value.toLowerCase() === 'url') return false;
    if (node.type !== 'word') return;
    const dimension = valueParser.unit(node.value);
    const unit = dimension && units[dimension.unit.toLowerCase()];
    if (dimension && unit) node.value = `calc(${dimension.number} * var(--sv-${unit}))`;
  });
  return tree.toString();
}
export function transformMedia(query: string, scale: number): string {
  // Operate on parsed feature groups, leaving non-size queries and quoted strings alone.
  const tree = valueParser(query);
  tree.walk(node => {
    if (node.type !== 'function' || node.value) return;
    const isSizeFeature=node.nodes.some(child=>child.type==='word' && /^(min-|max-)?(width|height)$/i.test(child.value));
    if (!isSizeFeature) return;
    const feature=valueParser(valueParser.stringify(node.nodes));
    feature.walk(child => {
      if (child.type !== 'word') return;
      const dimension = valueParser.unit(child.value);
      if (dimension && /^(px|em|rem)$/i.test(dimension.unit)) child.value = `${Number((Number(dimension.number)*scale).toFixed(8))}${dimension.unit}`;
    });
    node.nodes=feature.nodes;
    return false;
  });
  return tree.toString();
}
