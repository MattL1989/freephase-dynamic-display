// Audit fixes 2026-10-26: EDF import, rest-of-house with missing devices, partial periods,
// Power Perks pending/cancel/redraw, charge-start times, peak/voltage warnings, free-hours date.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
const slice = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));
const elements = new Map();
const el = id => {
  if (!elements.has(id)) elements.set(id, {id, hidden: false, textContent: '', innerHTML: '', className: '', open: false,
    children: [], appendChild(x){this.children.push(x)}, classList: {toggle(){}, add(){}}});
  return elements.get(id);
};
const ctx = vm.createContext({console, Intl, Date, JSON, Number, Math, Object, Array, String, Set,
  localStorage: {getItem: () => null},
  document: {getElementById: el, createElement: () => ({children:[], appendChild(x){this.children.push(x)}})}});
const run = code => vm.runInContext(code, ctx);
run(slice('// POWER PERKS.', '// END POWER PERKS.'));
run(slice('const HIST_SERIES =', 'function renderHistoryBoundary'));
run(slice('function applyHistoryCorrections', 'function buildPeriods'));
run(slice('function fmtPence', '// ENERGY HISTORY.'));
run(slice('function valOf', 'function niceMax'));
run(slice('function parseEdfCsv', 'let edfImportNote'));
run(slice('// DEVICES AT A GLANCE', '\nfunction renderImmersionUsage'));
run(slice('function freeDay', 'function untilText'));

// ---- EDF import: quotes, £, BOM; rows counted
const csv = '﻿Timestamp,Electricity consumption (kWh),Electricity cost (£)\n' +
  '"00:00:00 25/10/2026","1.5","£0.10"\n00:30:00 25/10/2026,2.5,£0.17\nnot a row\n10/2026,"1,234.5",£250.00\n';
const r = run(`parseEdfCsv(${JSON.stringify(csv)})`);
assert.equal(r.rowsRead, 3);
assert.equal(JSON.stringify(r.days['2026-10-25'].map(x => +x.toFixed(2))), '[4,0.27]');
assert.equal(r.months['2026-10'][0], 1234.5);
assert.equal(run(`parseEdfCsv("hello,world\\n").rowsRead`), 0);

// ---- rest of house only when every device has a full day
ctx.data = {days: {
  '2026-10-24': {easee:[10,66.6], breaker:[3,20], immersion:[2,13]},
  '2026-10-25': {breaker:[7.6,50], immersion:[0.3,2]},                       // Easee missing
  '2026-10-26': {easee:[5,33.3], breaker:[7.9,52.9], immersion:[3,20], pricing:{easee:{coverage_complete:false}}}}};
run('histData = applyHistoryCorrections(data)');
run('edfDays = {"2026-10-24":[30,6],"2026-10-25":[40,7],"2026-10-26":[35,6.5]}');
const p24 = run('buildHistoryPeriod(parseYmd("2026-10-24"), "day")');
assert.ok(Math.abs(p24.v.rest.kwh - 15) < 1e-9, 'complete day: rest = 30 - 15');
const p25 = run('buildHistoryPeriod(parseYmd("2026-10-25"), "day")');
assert.equal(p25.v.rest, null, 'a day missing the Easee must not put the car into rest of house');
assert.equal(p25.kwhMissing.easee, true);
const p26 = run('buildHistoryPeriod(parseYmd("2026-10-26"), "day")');
assert.equal(p26.v.rest, null, 'partial Easee coverage: no rest of house');
assert.equal(run('historyCostEstimated(histData.days["2026-10-26"], "easee")'), true, 'incomplete coverage is an estimate');
run('histUnit = "kwh"');
assert.match(run('periodValueText(buildHistoryPeriod(parseYmd("2026-10-25"), "day"), "easee")'), /—|missing/);

// ---- Power Perks: pending names, cancel by id, redraw only on change
ctx.event = {id:'ev-24', start:'2026-10-24T23:00:00+01:00', end:'2026-10-25T06:00:00+00:00', credit_expected_month:'2026-11',
  devices:{breaker:{status:'recorded',recorded_kwh:7.47,priced_kwh:7.47,expected_credit_p:49.75},
           immersion:{status:'recorded',recorded_kwh:2.35,priced_kwh:2.35,expected_credit_p:15.66},
           easee:{status:'waiting'}}};
run('currentPowerPerks={schema:1,status:"ok",updated_at:"2026-10-25T07:00:00Z",events:[event]}');
run('renderPowerPerks(Date.parse("2026-10-26T08:00:00Z"))');
let card = el('power-perks').innerHTML;
assert.match(card, /≈£0\.65 so far/);
assert.match(card, /Easee One still pending/);
el('power-perks').innerHTML = 'SENTINEL';
run('renderPowerPerks(Date.parse("2026-10-26T08:00:30Z"))');
assert.equal(el('power-perks').innerHTML, 'SENTINEL', 'unchanged card is not redrawn (keeps open sections)');
ctx.event.devices.easee = {status:'recorded',recorded_kwh:15.5,priced_kwh:15.5,expected_credit_p:103.2};
run('renderPowerPerks(Date.parse("2026-10-26T08:01:00Z"))');
card = el('power-perks').innerHTML;
assert.match(card, /≈£1\.69</); assert.doesNotMatch(card, /pending/);
// boundary energy is left out of the credit on purpose: it must not leave a device 'pending' forever
ctx.event.devices.breaker = {status:'recorded',recorded_kwh:7.61,priced_kwh:7.47,expected_credit_p:49.75,boundary_kwh:0.14};
run('renderPowerPerks(Date.parse("2026-10-26T08:02:00Z"))');
assert.doesNotMatch(el('power-perks').innerHTML, /POWER16 still pending|so far/);
// a breaker fault is shown at the top, not hidden in folded readings
run(`renderDeviceAlerts({tariff:{period:"offpeak"},easee:{},charge_sessions:{},supply:{},tuya:{faults:["over_current"]}})`);
assert.match(el('device-alerts').innerHTML, /POWER16 breaker fault: over current/);
run('currentPowerPerks={schema:1,status:"ok",updated_at:"x",events:[{id:"up",start:"2026-11-01T12:00:00Z",end:"2026-11-01T14:00:00Z",devices:{}}]}');
run('renderPowerPerks(Date.parse("2026-10-30T12:00:00Z"))');
assert.match(el('power-perks').innerHTML, /data-perks-cancel="up"/, 'cancel button identifies the event by id');
run('currentPowerPerks={schema:1,status:"ok",events:"oops"}');
run('renderPowerPerks(Date.parse("2026-10-30T12:00:00Z"))');                 // must not throw

// ---- charge-start times (last night's real values)
run(`renderChargeStarts({easee:{switched_on_at:"2026-10-25T22:59:03+00:00",power_available_at:"2026-10-25T22:59:03+00:00",
  drawing_at:"2026-10-25T23:00:08+00:00",full_power_at:"2026-10-25T23:00:14+00:00",full_power_kw:7.09},
  breaker:{switched_on_at:"2026-10-25T22:59:03+00:00",drawing_by:"2026-10-25T23:04:53+00:00"}})`);
assert.match(el('easee-lc-starts').innerHTML, /22:59:03.*23:00:08.*23:00:14.*7\.1 kW/);
assert.match(el('breaker-lc-starts').innerHTML, /22:59:03.*drawing by <b>23:04:53/);
assert.equal(el('easee-lc-starts').hidden, false);

// ---- warnings
run(`renderDeviceAlerts({tariff:{period:"peak",price_p:29.759,offpeak_price_p:6.66},easee:{online:true,total_power_kw:7.2},
  charge_sessions:{breaker:{active:null}}, supply:{low_since:"2026-10-25T00:05:00Z",min_v:91}})`);
const alerts = el('device-alerts').innerHTML;
assert.match(alerts, /Easee is charging at the peak rate \(29\.76p\/kWh\)/);
assert.match(alerts, /Supply voltage low since 01:05 \(lowest 91 V/);
assert.match(alerts, /105/);
run(`renderDeviceAlerts({tariff:{period:"offpeak"},easee:{online:true,total_power_kw:7.2},charge_sessions:{},supply:{}})`);
assert.equal(el('device-alerts').innerHTML, '', 'off-peak charging is not a warning');

// ---- free-hours banner names the day when it is not today
assert.equal(run('freeDay(new Date().toISOString())'), '');
assert.match(run('freeDay("2030-01-02T12:00:00Z")'), /Wed 2 Jan · /);

console.log('Audit fixes: EDF import, rest of house, partial days, Power Perks, start times, warnings, free-hours date passed');
