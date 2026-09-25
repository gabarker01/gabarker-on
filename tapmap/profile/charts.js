// Small SVG charts for TapMap profiles. One y-axis, thin marks, a legend (and
// direct labels) when there are two series, a hover/tap tooltip, and a table
// view for every chart. Colours are validated for the dark surface:
// "#b8862b" (you) and "#3d86d6" (them) pass the categorical checks.

export const YOU = "#b8862b";
export const THEM = "#3d86d6";

const NS = "http://www.w3.org/2000/svg";
const svgEl = (name, attrs = {}) => {
  const el = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

function frame(container, { title, height }) {
  container.replaceChildren();
  container.classList.add("chart");
  const heading = document.createElement("h3");
  heading.className = "chart-title";
  heading.textContent = title;
  const plot = document.createElement("div");
  plot.className = "chart-plot";
  plot.style.height = `${height}px`;
  const tip = document.createElement("div");
  tip.className = "chart-tip";
  tip.hidden = true;
  plot.append(tip);
  container.append(heading, plot);
  return { plot, tip };
}

function legend(container, series) {
  if (series.length < 2) return;
  const row = document.createElement("div");
  row.className = "chart-legend";
  for (const s of series) {
    const item = document.createElement("span");
    const key = document.createElement("span");
    key.className = "chart-key";
    key.style.background = s.colour;
    item.append(key, document.createTextNode(s.name));
    row.append(item);
  }
  container.insertBefore(row, container.querySelector(".chart-plot"));
}

function tableView(container, headers, rows) {
  const details = document.createElement("details");
  details.className = "chart-table";
  const summary = document.createElement("summary");
  summary.textContent = "Show as table";
  const table = document.createElement("table");
  const thead = document.createElement("tr");
  for (const h of headers) {
    const th = document.createElement("th");
    th.textContent = h;
    thead.append(th);
  }
  table.append(thead);
  for (const r of rows) {
    const tr = document.createElement("tr");
    for (const c of r) {
      const td = document.createElement("td");
      td.textContent = c;
      tr.append(td);
    }
    table.append(tr);
  }
  details.append(summary, table);
  container.append(details);
}

function showTip(tip, plot, x, y, html) {
  tip.replaceChildren(...html);
  tip.hidden = false;
  const w = tip.offsetWidth;
  const pw = plot.clientWidth;
  tip.style.left = `${Math.max(0, Math.min(pw - w, x - w / 2))}px`;
  tip.style.top = `${Math.max(0, y - tip.offsetHeight - 10)}px`;
}

const tipRow = (colour, label, value) => {
  const row = document.createElement("div");
  row.className = "chart-tip-row";
  if (colour) {
    const key = document.createElement("span");
    key.className = "chart-key";
    key.style.background = colour;
    row.append(key);
  }
  const l = document.createElement("span");
  l.textContent = label;
  const v = document.createElement("strong");
  v.textContent = value;
  row.append(l, v);
  return row;
};

// Line chart over dates. series: [{ name, colour, points: [{ x: "YYYY-MM-DD", y }] }]
export function lineChart(container, { title, series, yMax, height = 180, formatX, formatY = String }) {
  const { plot, tip } = frame(container, { title, height });
  legend(container, series);
  const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort();
  if (!dates.length) {
    plot.classList.add("is-empty");
    plot.textContent = "No games yet.";
    return;
  }

  const draw = () => {
    plot.querySelector("svg")?.remove();
    const width = plot.clientWidth || 320;
    const pad = { top: 12, right: series.length > 1 ? 44 : 12, bottom: 22, left: 36 };
    const iw = width - pad.left - pad.right;
    const ih = height - pad.top - pad.bottom;
    const xAt = (d) => pad.left + (dates.length === 1 ? iw / 2 : (dates.indexOf(d) / (dates.length - 1)) * iw);
    const yAt = (v) => pad.top + ih - (v / yMax) * ih;
    const svg = svgEl("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": title });

    // Recessive grid at quarters.
    for (let i = 0; i <= 4; i++) {
      const v = (yMax / 4) * i;
      const y = yAt(v);
      svg.append(svgEl("line", { x1: pad.left, x2: width - pad.right, y1: y, y2: y, class: "chart-grid" }));
      const label = svgEl("text", { x: pad.left - 6, y: y + 3, class: "chart-axis", "text-anchor": "end" });
      label.textContent = formatY(v);
      svg.append(label);
    }
    const first = svgEl("text", { x: xAt(dates[0]), y: height - 6, class: "chart-axis", "text-anchor": dates.length === 1 ? "middle" : "start" });
    first.textContent = formatX(dates[0]);
    svg.append(first);
    if (dates.length > 1) {
      const last = svgEl("text", { x: xAt(dates[dates.length - 1]), y: height - 6, class: "chart-axis", "text-anchor": "end" });
      last.textContent = formatX(dates[dates.length - 1]);
      svg.append(last);
    }

    for (const s of series) {
      const pts = s.points.slice().sort((a, b) => (a.x < b.x ? -1 : 1));
      if (pts.length > 1) {
        const d = pts.map((p, i) => `${i ? "L" : "M"}${xAt(p.x).toFixed(1)},${yAt(p.y).toFixed(1)}`).join("");
        svg.append(svgEl("path", { d, fill: "none", stroke: s.colour, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      }
      for (const p of pts) {
        svg.append(svgEl("circle", { cx: xAt(p.x), cy: yAt(p.y), r: pts.length > 20 ? 2.5 : 4, fill: s.colour, class: "chart-dot" }));
      }
    }

    // Direct labels at each line's end when comparing, nudged apart if close.
    if (series.length > 1) {
      const labels = series
        .map((s) => {
          const pts = s.points.slice().sort((a, b) => (a.x < b.x ? -1 : 1));
          const end = pts[pts.length - 1];
          return end ? { name: s.name, x: xAt(end.x) + 8, y: yAt(end.y) + 4 } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.y - b.y);
      for (let i = 1; i < labels.length; i++) {
        if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
      }
      for (const l of labels) {
        const label = svgEl("text", { x: l.x, y: l.y, class: "chart-direct" });
        label.textContent = l.name;
        svg.append(label);
      }
    }

    const cross = svgEl("line", { y1: pad.top, y2: pad.top + ih, class: "chart-cross", visibility: "hidden" });
    svg.append(cross);
    const hit = svgEl("rect", { x: pad.left - 8, y: 0, width: iw + 16, height, fill: "transparent" });
    const move = (event) => {
      const rect = svg.getBoundingClientRect();
      const px = (event.touches ? event.touches[0].clientX : event.clientX) - rect.left;
      let nearest = dates[0];
      for (const d of dates) if (Math.abs(xAt(d) - px) < Math.abs(xAt(nearest) - px)) nearest = d;
      const x = xAt(nearest);
      cross.setAttribute("x1", x);
      cross.setAttribute("x2", x);
      cross.setAttribute("visibility", "visible");
      const rows = [tipRow(null, formatX(nearest), "")];
      let top = height;
      for (const s of series) {
        const p = s.points.find((q) => q.x === nearest);
        rows.push(tipRow(s.colour, s.name, p ? formatY(p.y) : "–"));
        if (p) top = Math.min(top, yAt(p.y));
      }
      showTip(tip, plot, x, top, rows);
    };
    const leave = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); };
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", leave);
    svg.append(hit);
    plot.append(svg);
  };
  draw();
  new ResizeObserver(() => draw()).observe(plot);

  tableView(container, ["Date", ...series.map((s) => s.name)], dates.map((d) => [
    formatX(d), ...series.map((s) => { const p = s.points.find((q) => q.x === d); return p ? formatY(p.y) : "–"; }),
  ]));
}

// Vertical bar chart. series: [{ name, colour, values: [..] }] (grouped when 2),
// or one series with `colours` per category.
export function barChart(container, { title, categories, series, yMax, height = 170, formatY = String, colours }) {
  const { plot, tip } = frame(container, { title, height });
  legend(container, series);
  const draw = () => {
    plot.querySelector("svg")?.remove();
    const width = plot.clientWidth || 320;
    const pad = { top: 18, right: 8, bottom: 22, left: 36 };
    const iw = width - pad.left - pad.right;
    const ih = height - pad.top - pad.bottom;
    const max = yMax || Math.max(1, ...series.flatMap((s) => s.values));
    const yAt = (v) => pad.top + ih - (v / max) * ih;
    const svg = svgEl("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": title });
    for (let i = 0; i <= 2; i++) {
      const v = (max / 2) * i;
      svg.append(svgEl("line", { x1: pad.left, x2: width - pad.right, y1: yAt(v), y2: yAt(v), class: "chart-grid" }));
      const label = svgEl("text", { x: pad.left - 6, y: yAt(v) + 3, class: "chart-axis", "text-anchor": "end" });
      label.textContent = formatY(Math.round(v));
      svg.append(label);
    }
    const band = iw / categories.length;
    const gap = 2;
    const barW = Math.min(28, (band * 0.7 - gap * (series.length - 1)) / series.length);
    categories.forEach((cat, ci) => {
      const groupW = barW * series.length + gap * (series.length - 1);
      const x0 = pad.left + band * ci + (band - groupW) / 2;
      series.forEach((s, si) => {
        const v = s.values[ci] || 0;
        const x = x0 + si * (barW + gap);
        const y = yAt(v);
        const h = Math.max(0, pad.top + ih - y);
        const colour = colours ? colours[ci] : s.colour;
        // 4px rounded top, square at the baseline.
        const r = Math.min(4, h, barW / 2);
        const d = `M${x},${pad.top + ih}V${y + r}Q${x},${y} ${x + r},${y}H${x + barW - r}Q${x + barW},${y} ${x + barW},${y + r}V${pad.top + ih}Z`;
        svg.append(svgEl("path", { d, fill: colour }));
        const hit = svgEl("rect", { x: x - 2, y: pad.top, width: barW + 4, height: ih, fill: "transparent" });
        const show = () => showTip(tip, plot, x + barW / 2, y, [tipRow(null, cat, ""), tipRow(colour, s.name, formatY(v))]);
        hit.addEventListener("pointerenter", show);
        hit.addEventListener("pointerdown", show);
        hit.addEventListener("pointerleave", () => { tip.hidden = true; });
        svg.append(hit);
      });
      const label = svgEl("text", { x: pad.left + band * ci + band / 2, y: height - 6, class: "chart-axis", "text-anchor": "middle" });
      label.textContent = cat;
      svg.append(label);
    });
    plot.append(svg);
  };
  draw();
  new ResizeObserver(() => draw()).observe(plot);
  tableView(container, ["", ...series.map((s) => s.name)], categories.map((c, i) => [c, ...series.map((s) => formatY(s.values[i] || 0))]));
}
