// Small hand-rolled SVG chart helpers (pie + progress meter) — no charting
// library, consistent with the rest of the site's no-build-step approach.
// Colors are deepened, CVD-validated variants of the site's brand hues (the
// soft pastel theme palette fails contrast/chroma checks for small identity
// marks — see CLAUDE.md). Order is fixed per chart, never data-dependent.

function polarToCartesian(cx, cy, r, angle) {
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

function slicePath(cx, cy, r, startAngle, endAngle) {
  const [x1, y1] = polarToCartesian(cx, cy, r, startAngle);
  const [x2, y2] = polarToCartesian(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
}

/**
 * Build a pie chart card: SVG + legend + a collapsible table view.
 * slices: [{ label, value, color }] — a fixed, meaningful order (not sorted
 * by value), so color always maps to the same category chart-to-chart.
 */
export function buildPieCard({ title, slices, unit = '' }) {
  const card = document.createElement('div');
  card.className = 'chart-card';

  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const heading = document.createElement('h3');
  heading.textContent = title;
  card.appendChild(heading);

  if (total === 0) {
    const empty = document.createElement('p');
    empty.className = 'rsvp-hint';
    empty.textContent = 'No data yet.';
    card.appendChild(empty);
    return card;
  }

  const size = 180;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;
  const gap = 0.035; // radians of visual gap between slices

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${title}: ${slices.map((s) => `${s.label} ${s.value}`).join(', ')}`);

  let angle = -Math.PI / 2;
  const visible = slices.filter((s) => s.value > 0);
  visible.forEach((s) => {
    // A single slice covering the whole pie is a full 360° sweep, where the
    // arc's start and end points coincide — an SVG arc can't represent that
    // (it reads as zero sweep and renders nothing), so draw a plain circle.
    if (visible.length === 1) {
      const circle = document.createElementNS(svgNS, 'circle');
      circle.setAttribute('cx', cx);
      circle.setAttribute('cy', cy);
      circle.setAttribute('r', r);
      circle.setAttribute('fill', s.color);
      svg.appendChild(circle);
      return;
    }
    const sweep = (s.value / total) * Math.PI * 2;
    const hasGap = sweep > gap * 2;
    const start = angle + (hasGap ? gap / 2 : 0);
    const end = angle + sweep - (hasGap ? gap / 2 : 0);
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', slicePath(cx, cy, r, start, end));
    path.setAttribute('fill', s.color);
    svg.appendChild(path);
    angle += sweep;
  });

  const chartBody = document.createElement('div');
  chartBody.className = 'chart-card__body';
  chartBody.appendChild(svg);

  const legend = document.createElement('ul');
  legend.className = 'chart-legend';
  slices.forEach((s) => {
    const pct = total ? Math.round((s.value / total) * 100) : 0;
    const li = document.createElement('li');
    li.innerHTML = `<span class="chart-legend__swatch" style="background:${s.color}"></span>
      <span class="chart-legend__label">${s.label}</span>
      <span class="chart-legend__value">${s.value}${unit} (${pct}%)</span>`;
    legend.appendChild(li);
  });
  chartBody.appendChild(legend);
  card.appendChild(chartBody);

  card.appendChild(buildTableToggle(slices, unit));
  return card;
}

/**
 * Build a single-ratio progress meter (e.g. "% responded") — the correct
 * form for a 2-state ratio, rather than a 2-slice pie.
 */
export function buildMeterCard({ title, value, total, color, trackColor }) {
  const card = document.createElement('div');
  card.className = 'chart-card';

  const heading = document.createElement('h3');
  heading.textContent = title;
  card.appendChild(heading);

  const pct = total > 0 ? value / total : 0;
  const size = 180;
  const strokeWidth = 16;
  const r = size / 2 - strokeWidth;
  const circumference = 2 * Math.PI * r;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${title}: ${value} of ${total}`);

  const track = document.createElementNS(svgNS, 'circle');
  track.setAttribute('cx', size / 2);
  track.setAttribute('cy', size / 2);
  track.setAttribute('r', r);
  track.setAttribute('fill', 'none');
  track.setAttribute('stroke', trackColor);
  track.setAttribute('stroke-width', strokeWidth);
  svg.appendChild(track);

  const fill = document.createElementNS(svgNS, 'circle');
  fill.setAttribute('cx', size / 2);
  fill.setAttribute('cy', size / 2);
  fill.setAttribute('r', r);
  fill.setAttribute('fill', 'none');
  fill.setAttribute('stroke', color);
  fill.setAttribute('stroke-width', strokeWidth);
  fill.setAttribute('stroke-linecap', 'round');
  fill.setAttribute('stroke-dasharray', `${circumference * pct} ${circumference}`);
  fill.setAttribute('transform', `rotate(-90 ${size / 2} ${size / 2})`);
  svg.appendChild(fill);

  const text = document.createElementNS(svgNS, 'text');
  text.setAttribute('x', '50%');
  text.setAttribute('y', '50%');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('dominant-baseline', 'central');
  text.setAttribute('class', 'chart-meter__label');
  text.textContent = `${Math.round(pct * 100)}%`;
  svg.appendChild(text);

  const chartBody = document.createElement('div');
  chartBody.className = 'chart-card__body';
  chartBody.appendChild(svg);

  const caption = document.createElement('p');
  caption.className = 'rsvp-hint';
  caption.textContent = `${value} of ${total} invited guests have responded`;
  chartBody.appendChild(caption);
  card.appendChild(chartBody);

  return card;
}

function buildTableToggle(slices, unit) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const details = document.createElement('details');
  details.className = 'chart-table-toggle';
  const summary = document.createElement('summary');
  summary.textContent = 'View as table';
  details.appendChild(summary);

  const table = document.createElement('table');
  table.className = 'admin-table';
  table.innerHTML = `
    <thead><tr><th>Category</th><th>Count</th><th>Share</th></tr></thead>
    <tbody>
      ${slices
        .map((s) => {
          const pct = total ? Math.round((s.value / total) * 100) : 0;
          return `<tr><td>${s.label}</td><td>${s.value}${unit}</td><td>${pct}%</td></tr>`;
        })
        .join('')}
    </tbody>
  `;
  details.appendChild(table);
  return details;
}
