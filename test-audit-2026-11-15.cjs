// Audit 15 Nov 2026 (the day offer): C5 - no "charging at the peak rate ... Set the charger to Auto" for the BYD's own
// start on the capped Easee 22:54-23:00 in Auto, and "set it to Auto" only when the Easee is set to On; C6 - the peak
// hero says the Easee offers 1.4 kW while the day offer is on (a hold only when it is not); C10 - the Easee card shows
// the day offer (on / stopped at HH:MM: why / nothing); C7 / C8 - the 21:00 line and the BYD read times; C4 / C12 - the
// heartbeat's "Home Pi offline" text, and an old BYD reading while the Easee is offline reported as the Easee offline.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
const slice = (a, b) => {
  const i = html.indexOf(a), j = html.indexOf(b, i);
  assert.ok(i >= 0 && j > i, `slice ${a} .. ${b} not found`);
  return html.slice(i, j);
};
const elements = new Map();
const el = id => {
  if (!elements.has(id)) elements.set(id, {id, hidden: false, textContent: '', innerHTML: '', className: '', open: false,
    disabled: false, value: 0, dataset: {}, style: {}, children: [], appendChild(x){this.children.push(x)},
    querySelectorAll: () => [], classList: {toggle(){}, add(){}, contains(){ return false; }}});
  return elements.get(id);
};
class TestDate extends Date { static now(){ return TestDate.timestamp; } }
const at = iso => { TestDate.timestamp = Date.parse(iso); };
at('2026-11-15T12:00:00Z');
let liveRows = [];
const ctx = vm.createContext({console: {log: console.log, error(){}}, Intl, Date: TestDate, JSON, Number, Math, Object,
  Array, String, Set, Error, localStorage: {getItem: () => null},
  document: {getElementById: el, querySelector: () => null, createElement: () => ({children:[], appendChild(x){this.children.push(x)}})},
  SUPABASE_URL: 'https://example.invalid', SUPABASE_KEY: 'fixture', fetchJSON: async () => liveRows,
  setTimeout: () => 0, staleSince: 0, lastKnownClock: () => '', fmtAge: () => '',
  confirmPerksSave(){}, renderHistoryBoundary(){}, STANDING_CHARGE_FALLBACK: 59.71});
const run = code => vm.runInContext(code, ctx);
run(slice('// POWER PERKS.', '// END POWER PERKS.'));
run(slice('function fmtClock', 'function lastKnownClock'));
run(slice('// BYD VEHICLE.', '// END BYD VEHICLE.'));
run(slice('// DEVICES AT A GLANCE', '\nfunction renderImmersionUsage'));
run(slice('let currentEaseeOverride', '// SCROLL-WHEEL'));
run(slice('function renderTariff(t)', '// PIN-GATED CONTROL WRITES'));      // with the DAY OFFER block
run(slice('async function loadLiveState', '// IMMERSION USAGE'));

const TARIFF = {period: 'peak', price_p: 29.759, offpeak_price_p: 6.66, peak_price_p: 29.759, standing_charge_p: 56.868,
                offpeak_start_hour: 23, offpeak_end_hour: 6};
const OFFER_ON = {on: true, stopped_at: null, why: null, kwh: 0.0};
const STOPPED = {on: false, stopped_at: '2026-11-15T14:05:12.123456+00:00', why: 'a car started charging at 1.4 kW', kwh: 0.05};

(async () => {
  assert.match(html, /const BUILD = "2026-11-15 audit-v28";/);
  assert.match(html, /<p class="lc-starts day-offer" id="easee-day-offer" role="status" hidden><\/p>/);

  // ---- C10: the day offer's line on the Easee card
  const text = (d, iso) => { at(iso); return run(`dayOfferText(${JSON.stringify(d)})`); };
  assert.equal(text(null, '2026-11-15T12:00:00Z'), '', 'no field (older data): nothing');
  assert.equal(text(undefined, '2026-11-15T12:00:00Z'), '');
  assert.equal(text(OFFER_ON, '2026-11-15T12:00:00Z'), 'Day offer: 1.4 kW on offer until 22:54');
  assert.equal(text(OFFER_ON, '2026-11-15T06:10:00Z'), 'Day offer: 1.4 kW on offer until 22:54', 'from 06:10');
  assert.equal(text(OFFER_ON, '2026-11-15T06:09:00Z'), '', 'before 06:10: nothing');
  assert.equal(text(OFFER_ON, '2026-11-15T22:54:00Z'), '', 'from 22:54: nothing');
  assert.equal(text(OFFER_ON, '2026-11-15T23:30:00Z'), '');
  assert.equal(text(OFFER_ON, '2026-07-01T05:15:00Z'), 'Day offer: 1.4 kW on offer until 22:54', 'UK summer time: 06:15 BST');
  assert.equal(text(OFFER_ON, '2026-07-01T05:05:00Z'), '', '06:05 BST');
  assert.equal(text({on: false, stopped_at: null, why: null, kwh: 0}, '2026-11-15T12:00:00Z'), '', 'off, not stopped');
  assert.equal(text(STOPPED, '2026-11-15T15:00:00Z'), 'Day offer stopped at 14:05: a car started charging at 1.4 kW');
  assert.equal(text(STOPPED, '2026-11-15T23:30:00Z'), 'Day offer stopped at 14:05: a car started charging at 1.4 kW',
               'stopped today: still said after 22:54');
  assert.equal(text(STOPPED, '2026-11-16T09:00:00Z'), '', 'a stop from yesterday is not today\'s');
  assert.equal(text({on: false, stopped_at: '2026-11-15T14:05:00+00:00', why: null}, '2026-11-15T15:00:00Z'),
               'Day offer stopped at 14:05');
  assert.equal(text({on: false, stopped_at: '2026-11-15T16:40:00+00:00', why: 'cars had taken 0.31 kWh from it today'},
               '2026-11-15T17:00:00Z'), 'Day offer stopped at 16:40: cars had taken 0.31 kWh from it today');

  // ---- C10 through loadLiveState (taken up before anything else can fail)
  const live = extra => [{value: JSON.stringify(Object.assign({updated_at: new Date(TestDate.now()).toISOString(),
    easee: {online: true, op_mode: 6, total_power_kw: 0}, easee_override: 'auto', breaker_override: 'on',
    last_state: 'peak_off', tariff: TARIFF}, extra))}];
  at('2026-11-15T12:00:00Z');
  liveRows = live({day_offer: OFFER_ON});
  await run('loadLiveState()');
  assert.equal(el('easee-day-offer').hidden, false);
  assert.equal(el('easee-day-offer').textContent, 'Day offer: 1.4 kW on offer until 22:54');
  // ---- C6: the hero, from the same live_state
  assert.equal(el('now-band-name').textContent, 'PEAK');
  assert.equal(el('now-context').innerHTML,
    '<span class="delta above">Peak rate — the Easee offers 1.4 kW for the BYD\'s own schedule; full charging from 23:00</span>');
  assert.equal(el('charging-pill').textContent, '1.4 kW on offer · full from 23:00');

  at('2026-11-15T15:00:00Z');
  liveRows = live({day_offer: STOPPED});
  await run('loadLiveState()');
  assert.equal(el('easee-day-offer').textContent, 'Day offer stopped at 14:05: a car started charging at 1.4 kW');
  assert.equal(el('easee-day-offer').hidden, false);
  assert.equal(el('now-context').innerHTML, '<span class="delta above">Peak rate — chargers hold until 23:00</span>',
               'stopped: a hold');
  assert.equal(el('charging-pill').textContent, 'Holding until 23:00');

  liveRows = live({});                                   // older data: no day_offer field
  await run('loadLiveState()');
  assert.equal(el('easee-day-offer').hidden, true);
  assert.equal(el('easee-day-offer').textContent, '');
  assert.equal(el('charging-pill').textContent, 'Holding until 23:00');
  liveRows = live({day_offer: 'nonsense'});
  await run('loadLiveState()');
  assert.equal(el('easee-day-offer').hidden, true, 'an unexpected value is not shown');

  // ---- C6: the hero's peak words, case by case
  const hero = (state, iso) => {
    at(iso); run(`livePlan = livePlanFrom(${JSON.stringify(state)}); staleSince = 0; renderTariff(${JSON.stringify(TARIFF)})`);
    return [el('now-context').innerHTML.replace(/<[^>]+>/g, ''), el('charging-pill').textContent];
  };
  const HOLD = ['Peak rate — chargers hold until 23:00', 'Holding until 23:00'];
  assert.deepEqual(hero({easee_override: 'auto', last_state: 'peak_off', day_offer: OFFER_ON}, '2026-11-15T12:00:00Z'),
    ['Peak rate — the Easee offers 1.4 kW for the BYD\'s own schedule; full charging from 23:00', '1.4 kW on offer · full from 23:00']);
  assert.deepEqual(hero({easee_override: 'on', last_state: 'peak_off', day_offer: {on: false}}, '2026-11-15T12:00:00Z'), HOLD,
    'override not Auto: the Pi reports the offer off');
  assert.deepEqual(hero({easee_override: 'auto', last_state: 'peak_off', day_offer: OFFER_ON}, '2026-11-15T06:05:00Z'), HOLD,
    '06:00-06:10: paused');
  assert.deepEqual(hero({easee_override: 'auto', last_state: 'charger_prestart', day_offer: {on: false}}, '2026-11-15T22:56:00Z'),
    ['Peak rate — the Easee is on, capped at about 3 kW; full charging from 23:00', 'About 3 kW · full from 23:00']);
  assert.deepEqual(hero({easee_override: 'off', last_state: 'charger_prestart'}, '2026-11-15T22:56:00Z'), HOLD, 'Off: no cap');
  assert.deepEqual(hero({}, '2026-11-15T12:00:00Z'), HOLD, 'nothing known: as before');
  run(`livePlan = livePlanFrom({easee_override: 'auto', day_offer: ${JSON.stringify(OFFER_ON)}})`);
  at('2026-11-15T23:30:00Z');
  run(`renderTariff(${JSON.stringify(Object.assign({}, TARIFF, {period: 'offpeak', price_p: 6.66}))})`);
  assert.equal(el('charging-pill').textContent, 'Off-peak · chargers on', 'off-peak: unchanged');
  assert.ok(!html.includes("'Peak rate \\u2014 chargers hold until ' + startH"), 'the old fixed hold line is gone');

  // ---- C5: the peak-rate warning
  at('2026-11-15T12:00:00Z');
  const base = {tariff: TARIFF, charge_sessions: {}, supply: {}, breaker_override: 'on'};
  const alerts = st => { run(`renderDeviceAlerts(${JSON.stringify(Object.assign({}, base, st))})`); return el('device-alerts').innerHTML; };
  const ez = kw => ({easee: {online: true, op_mode: 3, total_power_kw: kw}});
  let a = alerts(Object.assign(ez(3.1), {easee_override: 'auto', last_state: 'charger_prestart'}));
  assert.doesNotMatch(a, /peak rate/, '22:54-23:00 in Auto: the BYD starting on the capped Easee is wanted');
  a = alerts(Object.assign(ez(7.1), {easee_override: 'on', last_state: 'charger_prestart'}));
  assert.match(a, /Easee is charging at the peak rate \(29\.76p\/kWh\)/, 'On: still warned in 22:54-23:00');
  assert.match(a, /The Easee is set to On: set it to Auto to wait for 23:00, or use Scheduled charge for a timed top-up\./);
  a = alerts(Object.assign(ez(1.4), {easee_override: 'auto', last_state: 'peak_off', day_offer: OFFER_ON}));
  assert.match(a, /Easee is charging at the peak rate/);
  assert.match(a, /6\.66p\. The Pi will stop it within a minute\. If it carries on, pause the Easee in the Easee app\./);
  assert.doesNotMatch(a, /to Auto/, 'already on Auto: no "set it to Auto"');
  a = alerts(Object.assign(ez(0.5), {easee_override: 'auto', last_state: 'peak_off', day_offer: OFFER_ON}));
  assert.match(a, /the Pi stops the offer once cars have taken 0\.3 kWh today \(about 9p\)/, 'a little power: the kWh limit');
  assert.doesNotMatch(a, /to Auto/);
  a = alerts(Object.assign(ez(7.1), {easee_override: 'auto', last_state: 'peak_off', day_offer: STOPPED}));
  assert.match(a, /The Pi will stop it within a minute/, 'offer stopped (paused): the Pi pauses it');
  a = alerts(Object.assign(ez(7.1), {easee_override: 'auto', last_state: 'peak_off'}));
  assert.match(a, /The Pi will stop it within a minute/, 'no day_offer field: the same');
  a = alerts(ez(7.1));
  assert.match(a, /Easee is charging at the peak rate/, 'override not known: still warned');
  assert.doesNotMatch(a, /to Auto|will stop it/, '... with no advice that may be wrong');
  assert.ok(!html.includes('Set the charger to Auto to wait for 23:00'), 'the old advice is gone');
  // POWER16 at the peak rate: kept on for the Puma (its own timer decides), or on Auto (the Pi switches it off)
  const brk = {charge_sessions: {breaker: {active: {charging: true}}}};
  a = alerts(Object.assign({easee: {online: true, total_power_kw: 0}}, brk));
  assert.match(a, /POWER16 is charging at the peak rate/);
  assert.match(a, /POWER16 is kept on, so the car's own timer decides: check it is set for 23:00\./);
  a = alerts(Object.assign({easee: {online: true, total_power_kw: 0}, breaker_override: 'auto'}, brk));
  assert.match(a, /The Pi switches POWER16 off within 2 minutes\./);
  a = alerts(Object.assign(ez(3.1), {easee_override: 'auto', last_state: 'charger_prestart'}, brk));
  assert.match(a, /POWER16 is charging at the peak rate/, 'the cap window hides the Easee only');
  assert.doesNotMatch(a, /Easee and POWER16|Easee is charging/);
  a = alerts(Object.assign(ez(7.1), {easee_override: 'on', breaker_override: 'auto'}, brk));
  assert.match(a, /Easee and POWER16 are charging at the peak rate/);
  assert.match(a, /set it to Auto to wait for 23:00.*The Pi switches POWER16 off within 2 minutes/);

  // ---- C7: the 21:00 problem line does not say the car's own schedule starts it
  const chk = {at: new Date(TestDate.now() - 30 * 60000).toISOString(), easee: {result: 'problem', detail: "the BYD isn't plugged in"},
               breaker: {result: 'skipped', detail: 'kept on'}};
  a = alerts({easee: {}, charger_check: chk});
  assert.match(a, /Fix it before bed if you can: the Easee comes on at 22:54 and the Pi starts the BYD at 23:01; POWER16 is on from 23:00\./);
  assert.doesNotMatch(a, /own schedule/);

  // ---- C8: the BYD card's read times
  ctx.byd = {schema: 1, status: 'ok', battery_pct: 64, range_miles: 200, charging: true,
             vehicle_updated_at: new Date(TestDate.now() - 60000).toISOString(), checked_at: new Date(TestDate.now()).toISOString()};
  run('easeeCar = {car: null, why: null}; renderByd(byd, Date.now(), false)');
  assert.equal(el('byd-status').textContent, 'Charging · updates hourly while parked, every 10 minutes while charging');
  assert.ok(!html.includes('updates about every 10 minutes'));

  // ---- C4 / C12: the heartbeat (its Python run with a faked Supabase)
  const ymlPath = __dirname + '/.github/workflows/pi-heartbeat.yml';
  const yml = fs.readFileSync(ymlPath, 'utf8');
  const body = yml.match(/python3 - <<'PY'\n([\s\S]*?)\n\s*PY\n/)[1].split('\n')
    .map(l => l.slice(Math.min(10, l.length - l.trimStart().length))).join('\n');
  const py = [['python3'], ['python'], ['py', '-3']].find(([cmd, ...args]) => {
    const r = spawnSync(cmd, [...args, '-c', 'import sys; print(sys.version_info[0])'], {encoding: 'utf8'});
    return !r.error && r.status === 0 && r.stdout.trim() === '3';
  });
  if (!py){ console.log('audit 15 Nov: heartbeat part skipped (no Python 3 here)'); }
  else {
    const [cmd, ...args] = py;
    const parsed = spawnSync(cmd, [...args, '-c', 'import sys, yaml; yaml.safe_load(open(sys.argv[1])); print("ok")', ymlPath], {encoding: 'utf8'});
    if (parsed.status === 0) assert.equal(parsed.stdout.trim(), 'ok');
    else console.log('audit 15 Nov: YAML parse check skipped (no PyYAML here)');
    const wrapper = `import io, json, os, sys, urllib.request
ROWS = json.loads(os.environ["HB_ROWS"])
class Reply(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *a): return False
def urlopen(req, timeout=None):
    key = req.full_url.split("key=eq.", 1)[1].split("&", 1)[0]
    return Reply(json.dumps([{"value": json.dumps(ROWS[key])}] if key in ROWS else []).encode())
urllib.request.urlopen = urlopen
exec(compile(open(sys.argv[1]).read(), "pi-heartbeat", "exec"), {"__name__": "__main__"})
`;
    const iso = ms => new Date(Date.now() - ms).toISOString().replace('Z', '+00:00');
    const heartbeat = (easee, bydMin, liveMin = 1) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-'));
      try {
        fs.copyFileSync(__dirname + '/index.html', path.join(dir, 'index.html'));
        fs.writeFileSync(path.join(dir, 'hb.py'), body);
        fs.writeFileSync(path.join(dir, 'wrap.py'), wrapper);
        const rows = {live_state: {updated_at: iso(liveMin * 60000), easee},
                      byd_vehicle: {checked_at: iso(bydMin * 60000)}};
        return spawnSync(cmd, [...args, 'wrap.py', 'hb.py'], {cwd: dir, encoding: 'utf8',
          env: Object.assign({}, process.env, {HB_ROWS: JSON.stringify(rows)})});
      } finally { fs.rmSync(dir, {recursive: true, force: true}); }
    };
    // C12: the Easee offline, the BYD last read 5 hours ago - the Easee is reported, not the BYD service
    let r = heartbeat({online: false, op_mode: 3, car: null}, 300);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /::error title=Easee offline::The Easee is offline .*reads the car only every 6 hours/);
    assert.doesNotMatch(r.stdout, /BYD service stopped/);
    r = heartbeat({online: false, op_mode: 3, car: null}, 30);
    assert.equal(r.status, 0, 'the Easee offline with a recent BYD reading: nothing to report\n' + r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /::error/);
    r = heartbeat({online: false, op_mode: 1, car: null}, 300);
    assert.equal(r.status, 0, 'no car on it when it went offline: as before\n' + r.stdout + r.stderr);
    for (const easee of [{online: true, op_mode: 3, car: null}, {op_mode: 3, car: null}]){
      r = heartbeat(easee, 300);
      assert.equal(r.status, 1, JSON.stringify(easee) + ': ' + r.stdout + r.stderr);
      assert.match(r.stdout, /::error title=BYD service stopped::/, 'the Easee online (or not said): as before');
      assert.doesNotMatch(r.stdout, /Easee offline/);
    }
    r = heartbeat({online: false, op_mode: 3, car: 'other'}, 300);
    assert.equal(r.status, 0, 'another car on the Easee: as before\n' + r.stdout + r.stderr);
    // C4: a dead Pi - what it means by day and at night
    r = heartbeat({online: true, op_mode: 3, car: null}, 30, 60);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const pi = (r.stdout.match(/::error title=Home Pi offline::(.*)/) || [])[1] || '';
    assert.match(pi, /not updated the dashboard for 60 minutes/);
    assert.match(pi, /By day the Easee may be left offering about 1\.4 kW with its own peak block off/);
    assert.match(pi, /could charge at the peak rate - pause the Easee in the Easee app/);
    assert.match(pi, /At night the Pi's 23:01 start won't happen: after 23:00, resume the Easee if you paused it, then open the BYD app and tap Charge/);
    assert.doesNotMatch(pi, /will not be started at 22:54/);
  }
  console.log('audit 15 Nov dashboard tests OK');
})().catch(e => { console.error(e); process.exit(1); });
