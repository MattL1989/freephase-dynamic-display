// Audit 2 Nov 2026, dashboard items fixed 3 Nov (TODO 7): a BYD holding at ~0.1 kW is not shown as "Charging";
// an override left on Off is announced; Off asks first and the page waits for the Pi to apply a change;
// no one-shot schedule save before the stored schedules are read; the 21:00 text has today's times.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
const slice = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));
const elements = new Map();
const el = id => {
  if (!elements.has(id)) elements.set(id, {id, hidden: false, textContent: '', innerHTML: '', className: '', open: false,
    disabled: false, children: [], appendChild(x){this.children.push(x)}, classList: {toggle(){}, add(){}, contains(){ return false; }}});
  return elements.get(id);
};
const writes = [];
let confirmAnswer = true, confirmAsked = 0;
const ctx = vm.createContext({console, Intl, Date, JSON, Number, Math, Object, Array, String, Set,
  localStorage: {getItem: () => null},
  document: {getElementById: el, createElement: () => ({children:[], appendChild(x){this.children.push(x)}})},
  writeControl: async (key, value) => { writes.push([key, value]); return {ok: true}; },
  reasonText: r => 'failed ' + r, setTimeout: () => 0,
  confirm: () => { confirmAsked++; return confirmAnswer; }});
const run = code => vm.runInContext(code, ctx);
run(slice('// POWER PERKS.', '// END POWER PERKS.'));
run(slice('function fmtClock', 'function freeDay'));
run(slice('function modeClass', 'function tuyaStatusFromLive'));
run(slice('// DEVICES AT A GLANCE', '\nfunction renderImmersionUsage'));
run(slice('let currentEaseeOverride', '// SCROLL-WHEEL'));
run('function paintOverride(){}');
run('var SCHED_KEY = { easee:"easee_schedule", breaker:"breaker_schedule" }; var schedState = { easee:null, breaker:null }; var schedLoaded = false;');
run('function renderSchedState(){}');
run(slice('async function saveSchedule', 'async function armSchedule'));

(async () => {
  // ---- dashboard-cloud-2: op 3 at ~0.1 kW is "plugged in, not drawing", not green "Charging"
  assert.deepEqual(JSON.parse(JSON.stringify(run('easeeStatusFromLive({online:true, op_mode:3, total_power_kw:0.07})'))),
                   {cls: 'idle', text: 'Plugged in · not drawing'});
  assert.equal(run('easeeStatusFromLive({online:true, op_mode:3, total_power_kw:7.1}).text'), 'Charging');
  assert.equal(run('easeeStatusFromLive({online:true, op_mode:3}).text'), 'Charging', 'no power reading: as before');
  assert.equal(run('easeeNotDrawing({online:false, op_mode:3, total_power_kw:0})'), false);
  assert.ok(html.includes('pill.textContent = "Plugged in · car not drawing"'), 'the big mode pill says it too');
  assert.ok(!/"Charging \\u00b7 Off-Peak"/.test(html), 'the top pill no longer claims charging');

  // ---- dashboard-cloud-8: an override that stops (or forces) charging is announced while it lasts
  const base = {tariff: {period: 'offpeak', price_p: 6.66, offpeak_price_p: 6.66}, charge_sessions: {}, supply: {}, easee: {}};
  const alerts = st => { run(`renderDeviceAlerts(${JSON.stringify(Object.assign({}, base, st))})`); return el('device-alerts').innerHTML; };
  assert.match(alerts({easee_override: 'off'}), /The Easee is set to OFF: the BYD will not charge, not even tonight/);
  assert.match(alerts({easee_override: 'on'}), /The Easee is set to ON: it charges at any price/);
  assert.match(alerts({breaker_override: 'off'}), /POWER16 is set to OFF: the car on it will not charge/);
  assert.doesNotMatch(alerts({easee_override: 'auto', breaker_override: 'on'}), /is set to/, 'Auto, and POWER16 kept on: normal');
  // ---- dashboard-cloud-9: the 21:00 problem line gives today's start times
  const chk = {at: new Date().toISOString(), easee: {result: 'problem', detail: "the BYD isn't plugged in"},
               breaker: {result: 'skipped', detail: 'kept on'}};
  assert.match(alerts({charger_check: chk}), /the Easee comes on at 22:58 and the Pi starts the BYD at 23:01/);

  // ---- Off asks first; a "no" changes nothing
  confirmAnswer = false;
  await run('setOverride("easee", "off")');
  assert.equal(confirmAsked, 1);
  assert.equal(writes.length, 0, 'not saved without a yes');
  confirmAnswer = true;
  await run('setOverride("easee", "off")');
  assert.deepEqual(writes.at(-1), ['easee_override', 'off']);
  assert.match(el('easee-override-status').textContent, /waiting for the Pi to apply it/);
  // ---- dashboard-cloud-7: "applied" only when the Pi reports using it
  run(`ackOverrides({updated_at: new Date(Date.now() - 60000).toISOString(), easee_override: "auto"})`);
  assert.match(el('easee-override-status').textContent, /waiting for the Pi/, 'an older report proves nothing');
  run(`ackOverrides({updated_at: new Date().toISOString(), easee_override: "off"})`);
  assert.match(el('easee-override-status').textContent, /^Easee One forced OFF · applied by the Pi at \d\d:\d\d$/);
  // a change the Pi never applies is called out after 2 minutes
  await run('setOverride("easee", "auto")');
  run('overrideSaved.easee.at = Date.now() - 180000');
  run(`ackOverrides({updated_at: new Date().toISOString(), easee_override: "off"})`);
  assert.match(el('easee-override-status').textContent, /saved, but the Pi has not applied it yet/);
  assert.equal(confirmAsked, 2, 'Auto needs no confirmation');

  // ---- dashboard-cloud-6: no schedule save before the stored schedules have been read
  const n = writes.length;
  await run('saveSchedule("easee", {enabled:false, start:"01:00", end:"03:00", fired:false}, "Schedule cancelled")');
  assert.equal(writes.length, n, 'nothing written');
  assert.match(el('easee-sched-status').textContent, /Still loading/);
  run('schedLoaded = true; schedState.easee = {enabled:false, start:"01:00", end:"05:00", fired:false, byd_stop:{enabled:true, pct:80, set_at:"x"}}');
  await run('saveSchedule("easee", {enabled:true, start:"01:00", end:"03:00", fired:false}, "Armed")');
  assert.equal(JSON.parse(writes.at(-1)[1]).byd_stop.pct, 80, 'once loaded, a save keeps the public-charge alert');

  // ---- init: live state is asked for before the settings reads that can be slow
  const init = slice('async function init(){', '\ninit();');
  assert.ok(init.indexOf('loadLiveState();') < init.indexOf('await loadOverrides();'));
  console.log('Audit 3 Nov: not-drawing status, override banners, Off confirmation, Pi acknowledgement, schedule guard passed');
})().catch(e => { console.error(e); process.exit(1); });
