// Fail-safes 2026-11-01: Easee fault / POWER16 lock-out alerts, automatic-restart notes, the pre-heat
// window replacing the peak warning, and the weekly pre-heat control (saving keeps the one-shot and
// a one-shot save keeps the pre-heat).
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
const ctx = vm.createContext({console, Intl, Date, JSON, Number, Math, Object, Array, String, Set,
  localStorage: {getItem: () => null},
  document: {getElementById: el, createElement: () => ({children:[], appendChild(x){this.children.push(x)}})},
  writeControl: async (key, value) => { writes.push([key, JSON.parse(value)]); return {ok: true}; },
  reasonText: r => 'failed ' + r});
const run = code => vm.runInContext(code, ctx);
run(slice('// POWER PERKS.', '// END POWER PERKS.'));
run(slice('function fmtClock', 'function freeDay'));
run(slice('// DEVICES AT A GLANCE', '\nfunction renderImmersionUsage'));
run('var SCHED_KEY = { easee:"easee_schedule", breaker:"breaker_schedule" }; var schedState = { easee:null, breaker:null }; var currentTariff = {peak_price_p: 29.759}; var schedLoaded = true;');
run('function renderSchedState(){} function setWheelTo(){} function wheelValue(id){ return {"preheat-start-h":"07","preheat-start-m":"15","preheat-end-h":"08","preheat-end-m":"45"}[id]; }');
run(slice('async function saveSchedule', 'async function armSchedule'));
run(slice('// PRE-HEAT TOP-UP.', '// END PRE-HEAT.'));

const base = {tariff: {period: 'peak', price_p: 29.759, offpeak_price_p: 6.66}, charge_sessions: {}, supply: {}};
const alerts = st => { run(`renderDeviceAlerts(${JSON.stringify(Object.assign({}, base, st))})`); return el('device-alerts').innerHTML; };

// ---- Easee in error (31 Oct), with the charger's own message and the restarts so far
let a = alerts({easee: {online: true, op_mode: 5, total_power_kw: 0},
  easee_fault: {kind: 'error', since: '2026-10-31T22:59:05Z', text: '[ERROR] Charger: EV requires ventilation',
                restarts: ['2026-10-31T23:00:06Z', '2026-10-31T23:15:06Z']}});
assert.match(a, /Easee error since 22:59: the BYD is not charging/);
assert.match(a, /EV requires ventilation/);
assert.match(a, /restarted it automatically at 23:00 and 23:15/);
assert.match(a, /Unplug the cable from the car/);
// op_mode 5 alone (fault record not yet published) still warns
assert.match(alerts({easee: {online: true, op_mode: 5}}), /Easee error: the BYD is not charging/);
// pilot warning before the start
a = alerts({easee: {online: true, op_mode: 2}, easee_fault: {kind: 'pilot', detail: 'ventilation required', since: '2026-10-31T22:45:10Z'}});
assert.match(a, /charge signal shows a fault \(ventilation required\) since 22:45/);
a = alerts({easee: {online: true, op_mode: 2}, easee_fault: {kind: 'blocked', detail: 'its circuit limit has been set to 0 A from outside the Pi', since: '2026-11-01T04:00:10Z'}});
assert.match(a, /should be charging but its circuit limit has been set to 0 A/);

// ---- POWER16 lock-out replaces the plain fault line
a = alerts({easee: {}, tuya: {faults: ['leakage_current_alarm']}, breaker_status: {lock: {since: '2026-11-02T01:00:30Z', reason: 'safety alarm: leakage current alarm'}}});
assert.match(a, /POWER16 locked off since 01:00: safety alarm: leakage current alarm/);
assert.match(a, /set POWER16 to Off and wait for this warning to clear/);
assert.doesNotMatch(a, /POWER16 breaker fault/);

// ---- pre-heat window: no peak warning for the Easee, an info line instead; the POWER16 still warns
a = alerts({easee: {online: true, total_power_kw: 2.4}, easee_preheat: {active: true, end: '08:30'}});
assert.doesNotMatch(a, /charging at the peak rate/);
assert.match(a, /Pre-heat top-up on until 08:30: the Easee is available at 29\.76p\/kWh and drawing 2\.4 kW/);
a = alerts({easee: {online: true, total_power_kw: 2.4}, easee_preheat: {active: true, end: '08:30'},
  charge_sessions: {breaker: {active: {charging: true}}}});
assert.match(a, /POWER16 is charging at the peak rate/);
assert.match(alerts({easee: {online: true, total_power_kw: 7.2}}), /Easee is charging at the peak rate/);

// ---- the 21:00 check: no peak warning while it runs; then its result for the evening
a = alerts({easee: {online: true, total_power_kw: 7.1}, last_state: 'charger_check', charge_sessions: {breaker: {active: {charging: true}}}});
assert.doesNotMatch(a, /peak rate/);
assert.match(a, /21:00 charger check: both chargers on briefly/);
const at = new Date(Date.now() - 30 * 60000).toISOString();
a = alerts({easee: {}, charger_check: {at, active: false, easee: {result: 'ok', detail: 'drawing 7.1 kW'},
  breaker: {result: 'problem', detail: 'no power drawn - the car may be full or not plugged in'}}});
assert.match(a, /device-alert volt/);
assert.match(a, /Easee \/ BYD: OK \(drawing 7\.1 kW\); POWER16: PROBLEM \(no power drawn/);
a = alerts({easee: {}, charger_check: {at, easee: {result: 'ok', detail: 'drawing 7.1 kW'}, breaker: {result: 'ok', detail: 'drawing power'}}});
assert.match(a, /device-alert info/);

// ---- nightly POWER16 restart that got the car going
a = alerts({easee: {}, breaker_status: {restart: {at: new Date(Date.now() - 3600000).toISOString(), result: 'charging'}}});
assert.match(a, /POWER16 was not charging, so the Pi switched it off and on/);

// ---- the pre-heat control
run('renderPreheat()');
assert.equal(el('preheat-state').textContent, 'Tue · 05:30 – 06:45', 'default before the Pi publishes');
run(`preheatLive = {enabled:true, days:[2], start:"07:00", end:"08:30", skip:null, active:false,
  next_start:"2026-11-03T07:00:00+00:00", next_end:"2026-11-03T08:30:00+00:00"}; renderPreheat(Date.parse("2026-11-01T19:00:00Z"))`);
assert.match(el('preheat-days').innerHTML, /data-day="2" aria-pressed="true">Tue/);
assert.match(el('preheat-note').textContent, /Next: Tue 3 Nov 07:00/);
assert.match(el('preheat-note').textContent, /≈£2\.08 an hour/);
assert.equal(el('preheat-skip').textContent, 'Skip next');

(async () => {
  // nothing is saved before the stored schedule has loaded (it would wipe an armed one-shot)
  run('schedLoaded = false');
  const before = writes.length;
  await run('preheatToggle()');
  assert.equal(writes.length, before);
  assert.match(el('preheat-status').textContent, /Still loading/);
  run('schedLoaded = true');
  // a stored one-shot is kept when the pre-heat is saved
  run('schedState.easee = {enabled:true, start:"01:00", end:"03:00", fired:false}');
  run('preheatDraft = [2, 4]');
  await run('preheatSave()');
  let [key, body] = writes.at(-1);
  assert.equal(key, 'easee_schedule');
  assert.equal(JSON.stringify(body), JSON.stringify({enabled:true, start:'01:00', end:'03:00', fired:false,
    preheat: {enabled:true, days:[2, 4], start:'07:15', end:'08:45', skip:null}}));
  assert.equal(el('preheat-state').textContent, 'Tue, Thu · 07:15 – 08:45');
  // skip the next one, then undo
  await run('preheatSkip()');
  assert.equal(writes.at(-1)[1].preheat.skip, '2026-11-03');
  assert.equal(writes.at(-1)[1].preheat.days.join(), '2,4', 'Skip right after a save keeps the new days (stored row first)');
  assert.match(el('preheat-status').textContent, /Skipping Tue 3 Nov/);
  // (render with a fixed 'now' so the skip date is in the future)
  run('renderPreheat(Date.parse("2026-11-01T19:00:00Z"))');
  assert.equal(el('preheat-skip').textContent, 'Undo skip');
  assert.match(el('preheat-note').textContent, /Skipping Tue 3 Nov/);
  // turning it off keeps the days and times
  await run('preheatToggle()');
  assert.equal(JSON.stringify(writes.at(-1)[1].preheat), JSON.stringify({enabled:false, days:[2, 4], start:'07:15', end:'08:45', skip:'2026-11-03'}));
  assert.equal(el('preheat-state').textContent, 'Off');
  // a one-shot save keeps the pre-heat
  await run('saveSchedule("easee", {enabled:false, start:"01:00", end:"03:00", fired:false}, "Schedule cancelled")');
  assert.equal(writes.at(-1)[1].preheat.days.join(), '2,4', 'cancelling the one-shot must not wipe the pre-heat');
  // invalid input is refused without a write
  const n = writes.length;
  run('preheatDraft = []'); await run('preheatSave()');
  assert.equal(writes.length, n);
  assert.match(el('preheat-status').textContent, /at least one day/);
  // ---- the car part (BYD service status + on/off)
  run(`schedState.easee = {enabled:false, start:"01:00", end:"05:00", fired:false,
        preheat:{enabled:true, days:[2], start:"05:30", end:"06:45", skip:null}}`);
  run('bydPreheat = {schema:1, status:"needs_pin"}; renderPreheat(Date.parse("2026-11-01T19:00:00Z"))');
  assert.match(el('preheat-car').textContent,
    /Car pre-heat: 06:15–06:30, cabin 20°C, driver's seat heat, steering wheel heat, when it is below 15°C outside\. Waiting for your BYD PIN/);
  run(`bydPreheat = {schema:1, status:"ready", last:{at:"2026-11-03T06:15:20Z", result:"started", outside_c:6, temp_source:"outside"}};
       renderPreheat(Date.parse("2026-11-03T07:00:00Z"))`);
  assert.match(el('preheat-car').textContent, /Ready\. Last: Tue 3 Nov 06:15, started \(6°C outside\)\./);
  assert.equal(el('preheat-car-toggle').textContent, 'Car pre-heat: on');
  await run('preheatCarToggle()');
  const car = writes.at(-1)[1].preheat.car;
  assert.equal(JSON.stringify(car), JSON.stringify({enabled:false, depart:"06:30", lead_min:15, cabin_c:20, seat:"high", wheel:true, below_c:15}));
  assert.match(el('preheat-car').textContent, /^Car pre-heat: off\./);
  await run('saveSchedule("easee", {enabled:false, start:"01:00", end:"03:00", fired:false}, "Schedule cancelled")');
  assert.equal(writes.at(-1)[1].preheat.car.enabled, false, 'a one-shot save keeps the car settings');
  // ---- stop a public charge at X%
  const sel = el('byd-dc-pct'); sel.options = []; sel.appendChild = function(o){ this.options.push(o); };
  run('renderBydDcStop()');
  assert.equal(sel.options.length, 17, '20-100% in 5% steps');
  assert.match(el('byd-dc-status').textContent, /^Not armed\. The car can't be stopped remotely, so the Pi emails you/);
  sel.value = '60';
  await run('dcStopArm()');
  let body2 = writes.at(-1)[1];
  assert.equal(JSON.stringify([body2.byd_stop.enabled, body2.byd_stop.pct]), '[true,60]');
  assert.ok(Date.parse(body2.byd_stop.set_at), 'arming time recorded');
  assert.ok(body2.preheat && body2.preheat.car, 'arming keeps the pre-heat and car settings');
  assert.match(el('byd-dc-status').textContent, /Armed: emails you at 60%/);
  const armedAt = body2.byd_stop.set_at;
  run(`bydDcStop = {schema:1, status:"armed", pct:60, now_pct:52, charging:true, set_at:${JSON.stringify(armedAt)}}; renderBydDcStop()`);
  assert.match(el('byd-dc-status').textContent, /now 52%, charging/);
  run(`bydDcStop = {schema:1, status:"done", pct:60, set_at:${JSON.stringify(armedAt.replace('Z', '+00:00'))},
        last:{result:"notified", pct:61, target:60, at:"2026-11-02T14:32:00Z"}}; renderBydDcStop()`);
  assert.match(el('byd-dc-status').textContent, /Reached 61% at 14:32 - email sent/);
  await run('dcStopCancel()');
  assert.equal(writes.at(-1)[1].byd_stop.enabled, false);
  assert.match(el('byd-dc-status').textContent, /^Not armed\./);
  console.log('Fail-safes: Easee fault / lock-out alerts, restarts, pre-heat window, car pre-heat, charge stop and control passed');
})().catch(e => { console.error(e); process.exit(1); });
