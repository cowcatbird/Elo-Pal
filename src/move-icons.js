const SVG_NS = 'http://www.w3.org/2000/svg';

// Geometry stays legible at badge size; punctuation dots are filled circles.
const ICONS = {
  brilliant: [
    ['path', { d: 'M8.5 5.2v8.3m7-8.3v8.3', 'stroke-width': 2.7 }],
    ['circle', { cx: 8.5, cy: 18.2, r: 1.55, fill: 'currentColor', stroke: 'none' }],
    ['circle', { cx: 15.5, cy: 18.2, r: 1.55, fill: 'currentColor', stroke: 'none' }],
  ],
  great: [
    ['path', { d: 'M12 4.8v8.7', 'stroke-width': 2.9 }],
    ['circle', { cx: 12, cy: 18.3, r: 1.65, fill: 'currentColor', stroke: 'none' }],
  ],
  book: [
    ['path', { d: 'M12 6.1C9.2 4.2 6 4 2.8 4.8v13.3c3.2-.8 6.4-.5 9.2 1.4 2.8-1.9 6-2.2 9.2-1.4V4.8c-3.2-.8-6.4-.6-9.2 1.3Z' }],
    ['path', { d: 'M12 6.1v13.4' }],
  ],
  best: [
    ['path', { d: 'm12 2.5 3.05 6.18 6.82.99-4.94 4.81 1.17 6.8L12 18.07l-6.1 3.21 1.17-6.8-4.94-4.81 6.82-.99Z', fill: 'currentColor', stroke: 'none' }],
  ],
  excellent: [
    ['path', { d: 'm2.5 12.3 4.3 4.3L15 7.4m-3.5 6.8 2.4 2.4 7.6-9.2', 'stroke-width': 2.6 }],
  ],
  good: [
    ['path', { d: 'm4.2 12.3 5.2 5.1L20 6.8', 'stroke-width': 2.9 }],
  ],
  inaccuracy: [
    ['path', { d: 'M4.1 7.5c0-1.9 1.4-3.1 3.4-3.1s3.4 1.2 3.4 3c0 1.6-.9 2.5-2.5 3.5-.8.5-1.1 1.2-1.1 2.5m10.6-8.3v8.3', 'stroke-width': 2.4 }],
    ['circle', { cx: 7.3, cy: 18.2, r: 1.45, fill: 'currentColor', stroke: 'none' }],
    ['circle', { cx: 17.9, cy: 18.2, r: 1.45, fill: 'currentColor', stroke: 'none' }],
  ],
  mistake: [
    ['path', { d: 'M8.2 7.6c0-2 1.6-3.3 3.8-3.3s3.8 1.3 3.8 3.4c0 1.6-.8 2.6-2.7 3.7-.8.5-1.1 1.2-1.1 2.1', 'stroke-width': 2.7 }],
    ['circle', { cx: 12, cy: 18.3, r: 1.6, fill: 'currentColor', stroke: 'none' }],
  ],
  blunder: [
    ['path', { d: 'M3.5 7.5c0-1.9 1.4-3.1 3.3-3.1s3.3 1.2 3.3 3c0 1.6-.9 2.5-2.4 3.5-.8.5-1.1 1.2-1.1 2.5m7.3-5.9c0-1.9 1.4-3.1 3.3-3.1s3.3 1.2 3.3 3c0 1.6-.9 2.5-2.4 3.5-.8.5-1.1 1.2-1.1 2.5', 'stroke-width': 2.3 }],
    ['circle', { cx: 6.6, cy: 18.2, r: 1.4, fill: 'currentColor', stroke: 'none' }],
    ['circle', { cx: 17, cy: 18.2, r: 1.4, fill: 'currentColor', stroke: 'none' }],
  ],
  forced: [
    ['path', { d: 'M4 12h16m-6-6 6 6-6 6', 'stroke-width': 2.6 }],
  ],
  variation: [
    ['path', { d: 'm5.5 18.5 13-13m-10 0h10v10', 'stroke-width': 2.6 }],
  ],
  neutral: [
    ['path', { d: 'M12 3.2c1.3 5.7 3.1 7.5 8.8 8.8-5.7 1.3-7.5 3.1-8.8 8.8C10.7 15.1 8.9 13.3 3.2 12 8.9 10.7 10.7 8.9 12 3.2Z', fill: 'currentColor', stroke: 'none' }],
  ],
};

/** Create a decorative move-quality symbol. Its surrounding badge supplies the label. */
export function createMoveIcon(kind) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const attributes = {
    xmlns: SVG_NS,
    viewBox: '0 0 24 24',
    width: '24',
    height: '24',
    class: 'move-icon',
    'aria-hidden': 'true',
    focusable: 'false',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2.3',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  };
  for (const [name, value] of Object.entries(attributes)) svg.setAttribute(name, value);
  const shapes = Object.hasOwn(ICONS, kind) ? ICONS[kind] : ICONS.neutral;
  for (const [tag, properties] of shapes) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(properties)) shape.setAttribute(name, String(value));
    svg.append(shape);
  }
  return svg;
}
