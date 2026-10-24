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
vm.runInContext(slice('// POWER PERKS.', '// END POWER PERKS.'), ctx);
vm.runInContext(slice('const HIST_SERIES =', 'function renderHistoryBoundary'), ctx);
vm.runInContext(slice('function applyHistoryCorrections', 'function buildPeriods'), ctx);
vm.runInContext(slice('function fmtPence', '// ENERGY HISTORY.'), ctx);
vm.runInContext(slice('function fmtMins', '// CHARGE COST.'), ctx);
vm.runInContext(slice('function immersionSummary', '// PER-DEVICE MANUAL OVERRIDE'), ctx);
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
run('currentTariff = {offpeak_price_p:6.66, peak_price_p:29.759}; renderChargeRates("test", {kwh:1,cost_p:31.24695,rates:[{band:"peak",price_p:31.24695,kwh:1,cost_p:31.24695}]})');
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
// Reproduce both user screenshots: one summary, no partial breakdown beside a full estimate.
ctx.easee = {active:{started:'2026-10-16T23:00:12+01:00',last_charging_at:'2026-10-17T01:09:32+01:00',kwh:12.183,
  cost_p:48.45,cost_estimate_p:81.14,cost_complete:false,charging:false,unplugged:true},
  last:{started:'2026-10-16T22:00:15Z',ended:'2026-10-17T00:09:57Z',kwh:12.183408,cost_p:81.1415,
    cost_complete:true,reconciled:true,duration_seconds:5981,rates:[{band:'offpeak',price_p:6.66,kwh:12.183408,cost_p:81.1415}]}};
run('renderChargeCost("easee", easee, true)');
assert.equal(el('easee-lc-title').textContent, 'Last charge');
assert.equal(el('easee-lc-cost').textContent, '£0.81');
assert.equal(el('easee-lc-kwh').textContent, '12.18 kWh');
assert.equal(el('easee-lc-dur').textContent, '1h 40m charging');
assert.match(el('easee-last-rates').innerHTML, /£0\.81/);
assert.doesNotMatch(html, /id="easee-active-rates"|Unplugged · finalising|Costs are a minimum/);
ctx.breaker = {last:{started:'2026-10-16T23:00:12+01:00',ended:'2026-10-17T01:53:41+01:00',kwh:7.81,
  cost_p:48.62,cost_estimate_p:52.0146,cost_low_p:52.0146,cost_high_p:52.0146,cost_complete:false,
  rates:[{band:'offpeak',price_p:6.66,kwh:7.3,cost_p:48.62}]}};
run('renderChargeCost("breaker", breaker, true)');
assert.equal(el('breaker-lc-cost').textContent, '≈£0.52');
assert.equal(el('breaker-last-rates').hidden, true);
assert.equal(el('breaker-last-rates').innerHTML, '');
run('breaker.last.cost_p = 52.0146; breaker.last.cost_complete = true; breaker.last.rates = [{band:"offpeak",price_p:6.66,kwh:7.81,cost_p:52.0146}]; renderChargeCost("breaker", breaker, true)');
assert.equal(el('breaker-lc-cost').textContent, '£0.52');
assert.equal(el('breaker-last-rates').hidden, false);
assert.match(el('breaker-last-rates').innerHTML, /£0\.52/);
assert.equal(el('breaker-lc-dur').textContent, '2h 53m elapsed');
// A genuine later charge is still displayed, with its own totals and status.
run('easee.active = {...easee.active, started:"2026-10-17T08:00:00Z",last_charging_at:"2026-10-17T08:10:00Z",charging:true,unplugged:false,kwh:1}; renderChargeCost("easee", easee, true)');
assert.equal(el('easee-lc-title').textContent, 'Charging now');
assert.equal(el('easee-lc-kwh').textContent, '1.00 kWh');
assert.equal(el('easee-last-rates').hidden, true);
run('renderChargeCost("easee", null, false)');
assert.equal(el('easee-lc-cost').textContent, '—');
assert.equal(el('easee-cost-details').hidden, true);
// The heater uses the same concise card, with an explicitly estimated, reconciled breakdown.
ctx.heater = {last_window:{started:'2026-10-17T03:00:07+01:00',ended:'2026-10-17T06:00:17+01:00',
  window_start:'2026-10-17T03:00:00+01:00',window_end:'2026-10-17T06:00:00+01:00',measured:true,
  kwh:4.348789,measured_kwh:4.348,metered_pct:99,element_minutes:78.7,element_last_at:'2026-10-17T05:20:16+01:00',
  cost_p:28.9629,cost_complete:true,cost_estimated:true,reconciled:true,
  rates:[{band:'offpeak',price_p:6.66,kwh:4.348789,cost_p:28.9629}]}};
run('renderImmersionUsage(heater)');
assert.equal(el('imm-lc-cost').textContent, '≈£0.29');
assert.equal(el('imm-lc-kwh').textContent, '≈4.35 kWh');
assert.equal(el('imm-lc-time').textContent, '1h 19m');
assert.match(el('imm-last-rates').innerHTML, /≈£0\.29/);
assert.match(el('imm-last-rates').innerHTML, /£0\.00/);
assert.equal(el('imm-last-rates').hidden, false);
assert.match(el('imm-usage-note').textContent, /Readings cover 99%/);
assert.doesNotMatch(el('imm-usage-note').textContent, /split is not|split not measured|element 3377|tariff range/);
// An old controller payload still provides a useful total, without fabricating rate buckets.
run('heater.last_window.cost_complete = false; heater.last_window.rates = []; heater.last_window.cost_estimate_p = 28.96; renderImmersionUsage(heater)');
assert.equal(el('imm-lc-cost').textContent, '≈£0.29');
assert.equal(el('imm-last-rates').hidden, true);
run('renderImmersionUsage({session_active:true,session_started:"2026-10-17T03:00:00+01:00",live_power_w:3000,session_measured_kwh:1,session_element_minutes:20,session_on_minutes:22,session_metered_pct:99,session_pricing:{cost_p:6.66,cost_complete:true,rates:[{band:"offpeak",price_p:6.66,kwh:1,cost_p:6.66}]}})');
assert.equal(el('imm-usage-title').textContent, 'Heating now');
assert.equal(el('imm-lc-cost').textContent, '≈£0.07');
assert.equal(el('imm-lc-kwh').textContent, '≈1.00 kWh');
run('renderImmersionUsage(null)');
assert.equal(el('imm-lc-cost').textContent, '—');
assert.equal(el('imm-last-rates').hidden, true);
assert.equal(el('imm-cost-details').hidden, true);
console.log('Dashboard syntax, history, charger and immersion summary regressions passed.');
