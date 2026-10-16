const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
const slice = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));
const elements = new Map();
const el = id => {
  if (!elements.has(id)) elements.set(id, {hidden: false, textContent: '', innerHTML: '', children: [], appendChild(x){this.children.push(x)}});
  return elements.get(id);
};
const ctx = vm.createContext({console, Intl, Date, JSON, Number, Math, Object, Array,
  localStorage: {getItem: () => null},
  document: {getElementById: el, createElement: () => ({children:[], appendChild(x){this.children.push(x)}})}});
vm.runInContext(slice('const HIST_SERIES =', 'function renderHistoryBoundary'), ctx);
vm.runInContext(slice('function applyHistoryCorrections', 'function buildPeriods'), ctx);
vm.runInContext(slice('function fmtPence', 'function renderChargeCost'), ctx);
vm.runInContext(slice('function renderHistoryDay', 'function valOf'), ctx);
vm.runInContext(slice('function valOf', 'function niceMax'), ctx);
const run = code => vm.runInContext(code, ctx);
ctx.corrections = JSON.parse(fs.readFileSync(__dirname + '/history-corrections.json', 'utf8'));
run('histCorrections = corrections');
ctx.data = {days: {'2026-10-01': {easee:[49.390859,1469.82], breaker:[3,20], immersion:[2,13], est:['breaker','immersion'],
  pricing:{easee:{source:'Easee hourly measured energy', cost_complete:true, energy_complete:true, coverage_complete:true,
    cost_p:1469.82, rates:[{band:'peak', price_p:29.759, kwh:49.390859, cost_p:1469.82}]}}}}};
run('histData = applyHistoryCorrections(data)');
assert.equal(run('histData.days["2026-10-01"].easee[1]'),1543, 'app correction survives a measured ledger refresh');
assert.equal(run('histData.days["2026-10-01"].pricing.easee.cost_p'),1469.82, 'published rate comparison preserved');
assert.equal(run('historyCostEstimated(histData.days["2026-10-01"], "easee")'),false);
assert.equal(run('historyCostEstimated(histData.days["2026-10-01"], "breaker")'),true);
assert.equal(run('historyCostInfo(histData.days["2026-10-01"], "missing").missing'),true);
assert.equal(run('buildHistoryPeriod(parseYmd("2026-10-01"), "day").costPartial'),false);
assert.equal(run('buildHistoryPeriod(parseYmd("2026-10-01"), "day").hasEstimates'),true);
run('histSelectedDay = "2026-10-01"; renderHistoryDay()');
assert.match(el('hist-day-detail').innerHTML,/£15.43/);
assert.doesNotMatch(el('hist-day-detail').innerHTML,/Unverified/);
assert.match(el('hist-day-detail').innerHTML,/≈20\.0p/);
assert.match(el('hist-day-detail').innerHTML,/≈£15\.76/);
assert.equal(run('periodValueText(buildHistoryPeriod(parseYmd("2026-10-01"), "day"), "breaker")'), '≈20.0p');
assert.equal(run('chargeCostText({cost_complete:false, rates:[], cost_p:0})'), 'Pending');
assert.equal(run('chargeCostText({cost_complete:true, rates:[], cost_p:340.17})'), '£3.40');
assert.equal(run('chargeCostText({cost_complete:false, rates:[], cost_p:0, cost_estimate_p:167.43})'), '≈£1.67');
run('currentTariff = {offpeak_price_p:6.66, peak_price_p:29.759}; renderChargeRates("test", {kwh:1,rates:[{band:"peak",price_p:31.24695,kwh:1,cost_p:31.24695}]})');
assert.doesNotMatch(el('test').innerHTML,/Other recorded/,'historic band comes from the record');
assert.equal(run('periodNext(parseYmd("2026-10-25"),"day").toISOString().slice(0,10)'), '2026-10-26');
// A mismatched day total cannot overwrite an additional measured session.
ctx.data.days['2026-10-01'].easee[0] = 70;
assert.equal(run('applyHistoryCorrections(data).days["2026-10-01"].easee[0]'),70);
ctx.data.days['2026-10-01'].easee = [49.390859,1469.82];
ctx.data.days['2026-10-01'].pricing.easee.edf_bill_verified = true;
assert.equal(run('applyHistoryCorrections(data).days["2026-10-01"].easee[1]'),1469.82);
run('histData.days["2026-10-01"].breaker = [0, 0]; histData.days["2026-10-01"].est = ["immersion"]');
assert.equal(run('periodValueText(buildHistoryPeriod(parseYmd("2026-10-01"), "day"), "breaker")'), '0p');
run('delete histData.days["2026-10-01"].breaker');
assert.equal(run('periodValueText(buildHistoryPeriod(parseYmd("2026-10-01"), "day"), "breaker")'), '—');
assert.match(run('periodTotalText(buildHistoryPeriod(parseYmd("2026-10-01"), "day"), 1556)'), /≈£15\.56 \+ missing/);
console.log('Dashboard syntax and estimate/total/missing-data rendering assertions passed.');
