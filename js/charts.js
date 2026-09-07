/* Chart builders on Apache ECharts 5. Palette follows the paper: light fills with thin black outlines
   (Gray #BFBFBF, Green #D9EAD3, Pink #EAD1DC, Blue #D4EBF2) and darker accents of the same hues for lines and points.
   Tier colors are fixed: recordable = blue, severe = green, fatal = pink. Text is black. One value axis per chart. */
'use strict';

const Charts = (() => {
  const FILL = { gray: '#BFBFBF', green: '#D9EAD3', pink: '#EAD1DC', blue: '#D4EBF2', white: '#FFFFFF' };
  const LINE = { gray: '#6B6B6B', green: '#4E8A3E', pink: '#B0507E', blue: '#3E86A0', black: '#000000' };
  const TIER_COLOR = { recordable: 'blue', severe: 'green', fatal: 'pink' };
  const FONT = 'Segoe UI, Helvetica Neue, Arial, sans-serif';
  const instances = new Map();

  window.addEventListener('resize', () => instances.forEach(c => c.resize()));

  function make(el, option, height) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (height) el.style.height = height + 'px';
    let ch = instances.get(el);
    if (ch) { ch.clear(); } else { ch = echarts.init(el, null, { renderer: 'canvas' }); instances.set(el, ch); }
    ch.setOption(Object.assign({ textStyle: { color: '#000', fontFamily: FONT, fontSize: 12 }, animationDuration: 350 }, option));
    return ch;
  }
  function resizeAll() { instances.forEach(c => c.resize()); }

  function tooltipBox() {
    return { backgroundColor: '#fff', borderColor: '#000', borderWidth: 1, textStyle: { color: '#000', fontSize: 12 }, extraCssText: 'box-shadow: none; border-radius: 0;' };
  }
  function axisStyle(extra) {
    return Object.assign({ axisLine: { lineStyle: { color: '#000' } }, axisTick: { lineStyle: { color: '#000' } },
      axisLabel: { color: '#000' }, splitLine: { lineStyle: { color: '#E6E6E6' } }, nameTextStyle: { color: '#000' } }, extra || {});
  }
  function valueAxis({ log, name, min, max, formatter, position }) {
    return axisStyle({ type: log ? 'log' : 'value', logBase: 10, name, nameLocation: 'middle', nameGap: 28, min, max, position,
      axisLabel: { color: '#000', formatter } });
  }
  function catAxis(categories, extra) {
    return axisStyle(Object.assign({ type: 'category', data: categories, axisLabel: { color: '#000', interval: 0 } }, extra || {}));
  }
  function legend(extra) {
    return Object.assign({ top: 0, left: 'center', icon: 'rect', itemWidth: 14, itemHeight: 10, textStyle: { color: '#000' } }, extra || {});
  }
  const barItem = (fill) => ({ color: FILL[fill] || fill, borderColor: '#000', borderWidth: 1 });
  const clampLog = (v, floor) => (v == null || !(v > floor)) ? floor : v;

  /* Grouped or stacked bars. series: [{name, data:[number], color:'blue', meta:[any]}] */
  function bars({ el, categories, series, horizontal = false, log = false, valueName = '', valueFormatter, tooltipFormatter, stack = false, height, min, max, gridLeft, markLine }) {
    const floor = log ? (min || 0.001) : undefined;
    const s = series.map(sr => ({
      name: sr.name, type: 'bar', stack: stack ? 'total' : undefined, barMaxWidth: 28, barGap: '10%', barCategoryGap: '30%',
      itemStyle: barItem(sr.color), emphasis: { itemStyle: { borderWidth: 2 } },
      data: sr.data.map((v, i) => ({ value: log ? clampLog(v, floor) : v, raw: v, meta: sr.meta ? sr.meta[i] : null })),
      markLine: markLine && sr === series[0] ? markLine : undefined,
    }));
    const vAxis = valueAxis({ log, name: valueName, min: log ? floor : (min ?? 0), max, formatter: valueFormatter });
    const cAxis = catAxis(categories, horizontal ? { inverse: true } : { axisLabel: { color: '#000', interval: 0, rotate: categories.length > 8 ? 30 : 0 } });
    return make(el, {
      tooltip: Object.assign({ trigger: 'item', formatter: tooltipFormatter }, tooltipBox()),
      legend: series.length > 1 ? legend() : undefined,
      grid: { left: gridLeft || (horizontal ? 170 : 60), right: 24, top: series.length > 1 ? 36 : 16, bottom: horizontal ? 44 : (categories.length > 8 ? 80 : 44) },
      xAxis: horizontal ? vAxis : cAxis, yAxis: horizontal ? cAxis : vAxis, series: s,
    }, height);
  }

  /* Point estimates with 95% intervals on a (usually log) axis. points: [{v, lo, hi, meta}] */
  function dotInterval({ el, categories, points, color = 'pink', log = true, valueName = '', min, max, refLine = 1, tooltipFormatter, height, horizontal = true, gridLeft }) {
    const floor = log ? (min || 0.001) : (min ?? 0);
    const c = LINE[color] || color;
    const pts = points.map((p, i) => ({ value: horizontal ? [clampLog(p.v, floor), i] : [i, clampLog(p.v, floor)], raw: p, name: categories[i] }));
    const bars = points.map((p, i) => [clampLog(p.lo, floor), clampLog(p.hi, floor), i]);
    const errSeries = {
      type: 'custom', name: '95% interval', silent: true, z: 2,
      renderItem(params, api) {
        const lo = api.value(0), hi = api.value(1), idx = api.value(2);
        const p1 = horizontal ? api.coord([lo, idx]) : api.coord([idx, lo]);
        const p2 = horizontal ? api.coord([hi, idx]) : api.coord([idx, hi]);
        const st = { stroke: c, fill: null, lineWidth: 1.5 };
        const cap = 4;
        const ch = [{ type: 'line', shape: { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] }, style: st }];
        if (horizontal) {
          ch.push({ type: 'line', shape: { x1: p1[0], y1: p1[1] - cap, x2: p1[0], y2: p1[1] + cap }, style: st });
          ch.push({ type: 'line', shape: { x1: p2[0], y1: p2[1] - cap, x2: p2[0], y2: p2[1] + cap }, style: st });
        } else {
          ch.push({ type: 'line', shape: { x1: p1[0] - cap, y1: p1[1], x2: p1[0] + cap, y2: p1[1] }, style: st });
          ch.push({ type: 'line', shape: { x1: p2[0] - cap, y1: p2[1], x2: p2[0] + cap, y2: p2[1] }, style: st });
        }
        return { type: 'group', children: ch };
      },
      data: bars, encode: horizontal ? { x: [0, 1], y: 2 } : { x: 2, y: [0, 1] },
    };
    const vAxis = valueAxis({ log, name: valueName, min: floor, max, formatter: log ? fmtLogTick : undefined });
    const cAxis = catAxis(categories, horizontal ? { inverse: true } : {});
    const ref = refLine != null ? { silent: true, symbol: 'none', lineStyle: { color: '#000', type: 'dashed', width: 1 }, label: { show: false },
      data: [horizontal ? { xAxis: refLine } : { yAxis: refLine }] } : undefined;
    return make(el, {
      tooltip: Object.assign({ trigger: 'item', formatter: tooltipFormatter }, tooltipBox()),
      grid: { left: gridLeft || (horizontal ? 170 : 60), right: 24, top: 16, bottom: 44 },
      xAxis: horizontal ? vAxis : cAxis, yAxis: horizontal ? cAxis : vAxis,
      series: [errSeries, { type: 'scatter', name: 'estimate', symbolSize: 11, z: 3, itemStyle: { color: c, borderColor: '#000', borderWidth: 1 }, data: pts, markLine: ref }],
    }, height);
  }

  /* Lines over an ordered x. series: [{name, data:[number], color, band:[[lo,hi],...], symbol}] */
  function lines({ el, x, series, valueName = '', min, max, log = false, valueFormatter, tooltipFormatter, height, xName, markLine, endLabels = false, legendShow = true }) {
    const out = [];
    series.forEach((sr, k) => {
      const c = LINE[sr.color] || sr.color;
      if (sr.band) {
        out.push({ name: sr.name + ' band low', type: 'line', stack: 'band' + k, data: sr.band.map(b => b[0]), lineStyle: { opacity: 0 }, symbol: 'none', silent: true, tooltip: { show: false }, stackStrategy: 'all' });
        out.push({ name: sr.name + ' band', type: 'line', stack: 'band' + k, data: sr.band.map(b => b[1] - b[0]), lineStyle: { opacity: 0 }, symbol: 'none', silent: true, tooltip: { show: false },
          areaStyle: { color: FILL[sr.color] || c, opacity: .7 }, stackStrategy: 'all' });
      }
      out.push({ name: sr.name, type: 'line', data: sr.data.map((v, i) => ({ value: v, meta: sr.meta ? sr.meta[i] : null })), symbol: sr.symbol || 'circle', symbolSize: 8, z: 3,
        lineStyle: { color: c, width: sr.width || 2, type: sr.dashed ? 'dashed' : 'solid' }, itemStyle: { color: c, borderColor: '#000', borderWidth: 1 },
        emphasis: { focus: 'series', lineStyle: { width: 3 } },
        endLabel: endLabels ? { show: true, formatter: p => p.seriesName, color: '#000', fontSize: 11, distance: 6 } : undefined,
        labelLayout: endLabels ? { moveOverlap: 'shiftY' } : undefined,
        markLine: markLine && k === 0 ? markLine : undefined });
    });
    const names = series.map(s => s.name);
    return make(el, {
      tooltip: Object.assign({ trigger: 'axis', formatter: tooltipFormatter, axisPointer: { type: 'line', lineStyle: { color: '#000' } } }, tooltipBox()),
      legend: legendShow && series.length > 1 ? legend({ data: names }) : undefined,
      grid: { left: 60, right: endLabels ? 150 : 24, top: legendShow && series.length > 1 ? 36 : 16, bottom: 48 },
      xAxis: catAxis(x, { boundaryGap: false, name: xName, nameLocation: 'middle', nameGap: 28 }),
      yAxis: valueAxis({ log, name: valueName, min: log ? (min || 0.001) : min, max, formatter: valueFormatter || (log ? fmtLogTick : undefined) }),
      series: out,
    }, height);
  }

  /* Scatter with per point labels. points: [{x, y, label, meta}] */
  function scatter({ el, points, xName, yName, logX = false, logY = false, color = 'blue', tooltipFormatter, height, refX }) {
    const c = LINE[color] || color;
    return make(el, {
      tooltip: Object.assign({ trigger: 'item', formatter: tooltipFormatter }, tooltipBox()),
      grid: { left: 60, right: 40, top: 20, bottom: 48 },
      xAxis: valueAxis({ log: logX, name: xName, min: logX ? 0.001 : 0, formatter: logX ? fmtLogTick : undefined }),
      yAxis: valueAxis({ log: logY, name: yName, min: logY ? 0.001 : 0, formatter: logY ? fmtLogTick : undefined }),
      series: [{ type: 'scatter', symbolSize: 12, itemStyle: { color: c, borderColor: '#000', borderWidth: 1 },
        data: points.map(p => ({ value: [logX ? clampLog(p.x, 0.001) : p.x, logY ? clampLog(p.y, 0.001) : p.y], name: p.label, raw: p })),
        label: { show: true, position: 'right', color: '#000', fontSize: 11, formatter: p => p.name }, labelLayout: { hideOverlap: true },
        markLine: refX != null ? { silent: true, symbol: 'none', lineStyle: { color: '#000', type: 'dashed' }, label: { show: false }, data: [{ xAxis: refX }] } : undefined }],
    }, height);
  }

  /* Heatmap with a diverging scale centred on `mid`. cells: [[xIndex, yIndex, value]] */
  function heatmap({ el, x, y, cells, mid = 1, span = .6, tooltipFormatter, height, valueName }) {
    return make(el, {
      tooltip: Object.assign({ trigger: 'item', formatter: tooltipFormatter }, tooltipBox()),
      grid: { left: 170, right: 24, top: 16, bottom: 70 },
      xAxis: catAxis(x, { splitArea: { show: false } }),
      yAxis: catAxis(y, { inverse: true }),
      visualMap: { min: mid - span, max: mid + span, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, text: [valueName || '', ''], textStyle: { color: '#000' },
        inRange: { color: [LINE.blue, '#F4F4F4', LINE.pink] } },
      series: [{ type: 'heatmap', data: cells.map(cl => ({ value: [cl[0], cl[1], cl[2] == null ? mid : Math.max(mid - span, Math.min(mid + span, cl[2]))], raw: cl[2] })),
        itemStyle: { borderColor: '#fff', borderWidth: 1 }, emphasis: { itemStyle: { borderColor: '#000', borderWidth: 1 } } }],
    }, height);
  }

  /* Several point series on a category axis (dot plot). series: [{name, data:[number], color, symbol, meta}] */
  function dots({ el, categories, series, log = true, valueName = '', min, max, refLine = 1, tooltipFormatter, height, horizontal = true, gridLeft }) {
    const floor = log ? (min || 0.001) : (min ?? 0);
    const s = series.map(sr => ({
      type: 'scatter', name: sr.name, symbol: sr.symbol || 'circle', symbolSize: 11, z: 3,
      itemStyle: { color: LINE[sr.color] || sr.color, borderColor: '#000', borderWidth: 1 },
      data: sr.data.map((v, i) => ({ value: horizontal ? [clampLog(v, floor), i] : [i, clampLog(v, floor)], raw: v, meta: sr.meta ? sr.meta[i] : null, name: categories[i] })),
    }));
    if (refLine != null) s[0].markLine = { silent: true, symbol: 'none', lineStyle: { color: '#000', type: 'dashed', width: 1 }, label: { show: false }, data: [horizontal ? { xAxis: refLine } : { yAxis: refLine }] };
    const vAxis = valueAxis({ log, name: valueName, min: floor, max, formatter: log ? fmtLogTick : undefined });
    const cAxis = catAxis(categories, horizontal ? { inverse: true } : {});
    return make(el, {
      tooltip: Object.assign({ trigger: 'item', formatter: tooltipFormatter }, tooltipBox()),
      legend: legend({ icon: 'circle' }),
      grid: { left: gridLeft || (horizontal ? 170 : 60), right: 24, top: 40, bottom: 44 },
      xAxis: horizontal ? vAxis : cAxis, yAxis: horizontal ? cAxis : vAxis, series: s,
    }, height);
  }

  function fmtLogTick(v) {
    if (v >= 1) return v >= 1000 ? (v / 1000) + 'k' : String(Math.round(v * 100) / 100).replace(/^0\./, '.');
    return String(v).replace(/^0\./, '.');
  }

  return { make, resizeAll, bars, dotInterval, dots, lines, scatter, heatmap, FILL, LINE, TIER_COLOR, clampLog, fmtLogTick };
})();
