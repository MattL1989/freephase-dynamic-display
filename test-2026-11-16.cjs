// 16 Nov 2026, Matt's always-on plan (build always-on-v29): the Easee is on at full power at the peak rate (no day
// offer, no 22:54-23:00 cap); its own schedule stops it 06:00-06:30; the BYD's own schedule starts the car at 23:00
// and the Pi checks at 23:05; the day guard pauses a car charging at the peak rate by day until 23:00
// (live_state.day_guard). Checks: the hero banner and pill (with and without the guard, UK time incl. BST), the
// peak-rate warning, the Easee card's guard line, no day-offer line when it is off, and the heartbeat's text.
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
at('2026-11-16T12:00:00Z');
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
run(slice('function renderTariff(t)', '// PIN-GATED CONTROL WRITES'));      // with the PEAK RATE PLAN block
run(slice('async function loadLiveState', '// IMMERSION USAGE'));

const TARIFF = {period: 'peak', price_p: 29.759, offpeak_price_p: 6.66, peak_price_p: 29.759, standing_charge_p: 56.868,
                offpeak_start_hour: 23, offpeak_end_hour: 6};
const ON = ['Peak rate — the Easee is on; the BYD\'s own schedule starts at 23:00 (the Pi checks at 23:05)',
            'Easee on · BYD starts 23:00'];
const OFF_OFFER = {on: false, stopped_at: null, why: null, kwh: 0};
const WHY = 'a car started charging at 7.1 kW at the peak rate';
const GUARD = {held_until: '2026-11-16T23:00:00+00:00', at: '2026-11-16T14:05:12.345678+00:00', why: WHY};
// UK summer time: 14:05 BST and 23:00 BST
const GUARD_BST = {held_until: '2026-07-01T22:00:00+00:00', at: '2026-07-01T13:05:40+00:00', why: WHY};
const OLD_WORDS = /1\.4 kW|on offer|full from|full charging|capped|3 kW|[Hh>]old(ing)? until|22:5[45]|23:01/;

(async () => {
  assert.match(html, /const BUILD = "2026-11-16 always-on-v29";/);
  assert.match(html, /<p class="lc-starts day-guard" id="easee-day-guard" role="status" hidden><\/p>/);
  for (const old of ['full charging from', 'capped at about 3 kW', '1.4 kW on offer · full', 'Holding until',
                     'chargers hold until', 'starts the BYD at 23:01', 'the Easee comes on at 22:54', '22:55', '23:01',
                     'from the day offer', 'Day offer stopped at']){
    assert.ok(!html.includes(old), `the old plan's words are gone: ${old}`);
  }

  // ---- the hero banner and pill at the peak rate
  const hero = (state, iso) => {
    at(iso); run(`livePlan = livePlanFrom(${JSON.stringify(state)}); staleSince = 0; renderTariff(${JSON.stringify(TARIFF)})`);
    const out = [el('now-context').innerHTML.replace(/<[^>]+>/g, ''), el('charging-pill').textContent];
    assert.doesNotMatch(out.join(' | '), OLD_WORDS, JSON.stringify(state));
    return out;
  };
  const auto = extra => Object.assign({easee_override: 'auto', last_state: 'peak_off', day_offer: OFF_OFFER, day_guard: null}, extra);
  assert.deepEqual(hero(auto(), '2026-11-16T12:00:00Z'), ON, 'Auto, no guard: the Easee is on');
  assert.equal(el('now-band-name').textContent, 'PEAK');
  assert.match(el('now-context').innerHTML, /^<span class="delta above">/);
  assert.equal(el('charging-pill').className, 'charging-pill off');
  assert.deepEqual(hero(auto({day_offer: null}), '2026-11-16T12:00:00Z'), ON, 'day_offer null');
  assert.deepEqual(hero(auto({day_offer: undefined, day_guard: undefined}), '2026-11-16T12:00:00Z'), ON, 'older data');
  assert.deepEqual(hero(auto(), '2026-11-16T21:30:00Z'), ON, 'the evening: the same');
  assert.deepEqual(hero(auto({last_state: 'charger_check'}), '2026-11-16T21:00:30Z'), ON, 'the 21:00 check');
  assert.deepEqual(hero(auto({last_state: 'charger_prestart'}), '2026-11-16T22:56:00Z'), ON, 'charger_prestart: harmless');
  assert.deepEqual(hero(auto({day_offer: {on: true, stopped_at: null, why: null, kwh: 0}}), '2026-11-16T12:00:00Z'), ON,
    'an older Pi build\'s offer: no old words in the hero');
  assert.deepEqual(hero({easee_override: 'on', last_state: 'peak_off'}, '2026-11-16T12:00:00Z'), ON, 'On: on');
  assert.deepEqual(hero({easee_override: ' Auto ', last_state: 'peak_off'}, '2026-11-16T12:00:00Z'), ON, 'spacing/case');

  // the day guard holds: "Paused until 23:00 - a car charged at the peak rate at HH:MM" (UK time)
  const PAUSED = ['Paused until 23:00 — a car charged at the peak rate at 14:05', 'Paused until 23:00'];
  assert.deepEqual(hero(auto({day_guard: GUARD}), '2026-11-16T14:06:00Z'), PAUSED);
  assert.deepEqual(hero(auto({day_guard: GUARD}), '2026-11-16T22:59:00Z'), PAUSED, 'until the last minute');
  assert.deepEqual(hero(auto({day_guard: GUARD_BST}), '2026-07-01T14:00:00Z'), PAUSED, 'BST: 14:05 and 23:00 UK time');
  assert.deepEqual(hero(auto({day_guard: Object.assign({}, GUARD, {held_until: '2026-11-16T23:00:00Z', at: '2026-11-16T09:30:00Z'})}),
    '2026-11-16T12:00:00Z'), ['Paused until 23:00 — a car charged at the peak rate at 09:30', 'Paused until 23:00'], 'Z times');
  assert.deepEqual(hero(auto({day_guard: {held_until: GUARD.held_until}}), '2026-11-16T15:00:00Z'),
    ['Paused until 23:00 — a car charged at the peak rate', 'Paused until 23:00'], 'no "at": no time');
  assert.deepEqual(hero(auto({day_guard: GUARD}), '2026-11-16T23:00:00Z'), ON, 'held_until reached: no guard (if still peak)');
  assert.deepEqual(hero(auto({day_guard: Object.assign({}, GUARD, {held_until: '2026-11-16T13:00:00+00:00'})}),
    '2026-11-16T14:00:00Z'), ON, 'held_until in the past: not held');
  assert.deepEqual(hero({easee_override: 'on', last_state: 'peak_off', day_guard: GUARD}, '2026-11-16T15:00:00Z'), ON,
    'On wins over the guard (the Pi\'s rule)');
  for (const bad of ['nonsense', [], {}, {held_until: 'soon'}, {held_until: null}, 42, true]){
    assert.deepEqual(hero(auto({day_guard: bad}), '2026-11-16T15:00:00Z'), ON, 'unexpected day_guard: ' + JSON.stringify(bad));
  }

  // Off; the Easee's own stop 06:00-06:30 in Auto (not on a pre-heat morning); the override not known
  const OFF = ['Peak rate — the Easee is set to Off', 'Easee set to Off'];
  assert.deepEqual(hero({easee_override: 'off', last_state: 'peak_off'}, '2026-11-16T12:00:00Z'), OFF);
  assert.deepEqual(hero({easee_override: 'off', last_state: 'peak_off', day_guard: GUARD}, '2026-11-16T15:00:00Z'), OFF,
    'Off: said as Off, guard or not');
  const OWN = ['Peak rate — the Easee\'s own schedule pauses it until 06:30', 'Paused until 06:30'];
  assert.deepEqual(hero(auto(), '2026-11-16T06:00:00Z'), OWN, '06:00 GMT');
  assert.deepEqual(hero(auto(), '2026-11-16T06:29:00Z'), OWN, '06:29');
  assert.deepEqual(hero(auto(), '2026-11-16T06:30:00Z'), ON, 'from 06:30: on');
  assert.deepEqual(hero(auto(), '2026-07-01T05:15:00Z'), OWN, '06:15 BST');
  assert.deepEqual(hero(auto(), '2026-07-01T06:15:00Z'), ON, '07:15 BST');
  assert.deepEqual(hero(auto({easee_preheat: {active: true, end: '06:45'}}), '2026-11-16T06:15:00Z'), ON,
    'a pre-heat morning: its own stop is released');
  assert.deepEqual(hero({easee_override: 'on', last_state: 'peak_off'}, '2026-11-16T06:15:00Z'), ON, 'On: released too');
  assert.deepEqual(hero({}, '2026-11-16T12:00:00Z'), ['Peak rate — off-peak from 23:00', 'Off-peak from 23:00'],
    'override not known: no claim either way');

  // off-peak, free and Power Perks: unchanged
  run(`livePlan = livePlanFrom(${JSON.stringify(auto({day_guard: GUARD}))})`);
  at('2026-11-16T23:30:00Z');
  run(`renderTariff(${JSON.stringify(Object.assign({}, TARIFF, {period: 'offpeak', price_p: 6.66}))})`);
  assert.equal(el('charging-pill').textContent, 'Off-peak · chargers on');
  assert.equal(el('now-context').innerHTML, '<span class="delta below">Off-peak window 23:00–06:00</span>');

  // ---- the Easee card's lines
  const guardText = (state, iso) => { at(iso); return run(`dayGuardText(livePlanFrom(${JSON.stringify(state)}))`); };
  assert.equal(guardText(auto({day_guard: GUARD}), '2026-11-16T15:00:00Z'), 'Paused at 14:05 until 23:00: ' + WHY);
  assert.equal(guardText(auto({day_guard: GUARD_BST}), '2026-07-01T14:00:00Z'), 'Paused at 14:05 until 23:00: ' + WHY, 'BST');
  assert.equal(guardText(auto({day_guard: {held_until: GUARD.held_until, why: WHY}}), '2026-11-16T15:00:00Z'),
    'Paused until 23:00: ' + WHY, 'no "at"');
  assert.equal(guardText(auto({day_guard: {held_until: GUARD.held_until, at: GUARD.at, why: '  '}}), '2026-11-16T15:00:00Z'),
    'Paused at 14:05 until 23:00: a car charged at the peak rate', 'no "why"');
  assert.equal(guardText(auto({day_guard: GUARD}), '2026-11-16T23:00:00Z'), '', 'held_until reached');
  assert.equal(guardText(auto({day_guard: null}), '2026-11-16T15:00:00Z'), '', 'null: nothing');
  assert.equal(guardText({easee_override: 'on', day_guard: GUARD}, '2026-11-16T15:00:00Z'), '', 'On: not held');
  assert.equal(guardText({easee_override: 'off', day_guard: GUARD}, '2026-11-16T15:00:00Z'), '', 'Off: not the guard');
  assert.equal(run('dayGuardText(null)'), '');
  // no day-offer line while it is off (the new Pi's {on: false, ...}, or null), even with an old stop time
  const offerText = (d, iso) => { at(iso); return run(`dayOfferText(${JSON.stringify(d)})`); };
  for (const d of [OFF_OFFER, null, {on: false, stopped_at: '2026-11-16T09:00:00+00:00', why: 'a car started charging at 7.1 kW', kwh: 0.2},
                   {on: 'true'}, 'nonsense', []]){
    assert.equal(offerText(d, '2026-11-16T12:00:00Z'), '', JSON.stringify(d));
  }

  // ... and through loadLiveState (what the dashboard really does every 15 s)
  const live = extra => [{value: JSON.stringify(Object.assign({updated_at: new Date(TestDate.now()).toISOString(),
    easee: {online: true, op_mode: 4, total_power_kw: 0}, easee_override: 'auto', breaker_override: 'on',
    last_state: 'peak_off', tariff: TARIFF, day_offer: OFF_OFFER, day_guard: null}, extra))}];
  at('2026-11-16T12:00:00Z');
  liveRows = live({});
  await run('loadLiveState()');
  assert.equal(el('easee-day-offer').hidden, true, 'no day-offer line');
  assert.equal(el('easee-day-offer').textContent, '');
  assert.equal(el('easee-day-guard').hidden, true, 'no guard line');
  assert.equal(el('now-context').innerHTML, '<span class="delta above">' + ON[0] + '</span>');
  assert.equal(el('charging-pill').textContent, ON[1]);
  at('2026-11-16T15:00:00Z');
  liveRows = live({day_guard: GUARD});
  await run('loadLiveState()');
  assert.equal(el('easee-day-guard').hidden, false);
  assert.equal(el('easee-day-guard').textContent, 'Paused at 14:05 until 23:00: ' + WHY);
  assert.equal(el('easee-day-offer').hidden, true);
  assert.equal(el('now-context').innerHTML, '<span class="delta above">' + PAUSED[0] + '</span>');
  assert.equal(el('charging-pill').textContent, PAUSED[1]);
  liveRows = live({day_guard: null});                  // the Pi lets go
  await run('loadLiveState()');
  assert.equal(el('easee-day-guard').hidden, true);
  assert.equal(el('easee-day-guard').textContent, '');
  assert.equal(el('charging-pill').textContent, ON[1]);
  liveRows = live({day_guard: 'nonsense', day_offer: 'nonsense'});
  await run('loadLiveState()');
  assert.equal(el('easee-day-guard').hidden, true, 'an unexpected value is not shown');
  assert.equal(el('easee-day-offer').hidden, true);

  // ---- the peak-rate warning (a car drawing at the peak rate)
  at('2026-11-16T12:00:00Z');
  const base = {tariff: TARIFF, charge_sessions: {}, supply: {}, breaker_override: 'on', day_offer: OFF_OFFER, day_guard: null};
  const alerts = st => { run(`renderDeviceAlerts(${JSON.stringify(Object.assign({}, base, st))})`); return el('device-alerts').innerHTML; };
  const ez = kw => ({easee: {online: true, op_mode: 3, total_power_kw: kw}});
  let a = alerts(Object.assign(ez(7.1), {easee_override: 'auto', last_state: 'peak_off'}));
  assert.match(a, /Easee is charging at the peak rate \(29\.76p\/kWh\)\.<small>Overnight is 6\.66p\. The Pi pauses the Easee until 23:00 after about a minute\. If it carries on, pause the Easee in the Easee app\.<\/small>/);
  assert.doesNotMatch(a, /day offer|0\.3 kWh|to Auto|will stop it/);
  a = alerts(Object.assign(ez(7.1), {easee_override: 'auto', last_state: 'peak_off', day_guard: GUARD}));
  assert.match(a, /The Pi pauses the Easee until 23:00 after about a minute/, 'still drawing while held: the same');
  a = alerts(Object.assign(ez(0.8), {easee_override: 'auto', last_state: 'peak_off'}));
  assert.match(a, /The Pi pauses the Easee until 23:00 after about a minute/, '0.8 kW: the guard acts');
  a = alerts(Object.assign(ez(0.5), {easee_override: 'auto', last_state: 'peak_off'}));
  assert.match(a, /A car is taking a little power: the Pi pauses the Easee until 23:00 only if it draws 0\.8 kW or more for about a minute\. Pause it in the Easee app if you need to\./);
  a = alerts(Object.assign(ez(0.1), {easee_override: 'auto', last_state: 'peak_off'}));
  assert.doesNotMatch(a, /peak rate/, 'a BYD holding itself (~0.1 kW): no warning');
  a = alerts(Object.assign(ez(7.1), {easee_override: 'on', last_state: 'peak_off'}));
  assert.match(a, /The Easee is set to On: set it to Auto to wait for 23:00, or use Scheduled charge for a timed top-up\./);
  assert.doesNotMatch(a, /pauses the Easee until/);
  a = alerts(Object.assign(ez(7.1), {easee_override: 'off', last_state: 'peak_off'}));
  assert.match(a, /The Pi will stop it within a minute\. If it carries on, pause the Easee in the Easee app\./);
  a = alerts(Object.assign(ez(7.1), {easee_override: 'auto', last_state: 'peak_off', easee_preheat: {active: true, end: '06:45'}}));
  assert.doesNotMatch(a, /charging at the peak rate/, 'a pre-heat window: wanted');
  a = alerts(Object.assign(ez(7.1), {easee_override: 'auto', last_state: 'charger_check'}));
  assert.doesNotMatch(a, /charging at the peak rate/, 'the 21:00 check: wanted');
  a = alerts(Object.assign(ez(7.1), {easee_override: 'auto', last_state: 'offpeak_on',
                                     tariff: Object.assign({}, TARIFF, {period: 'offpeak', price_p: 6.66})}));
  assert.doesNotMatch(a, /peak rate/, 'off-peak: no warning');
  // the 21:00 check's problem line
  const chk = {at: new Date(TestDate.now() - 30 * 60000).toISOString(), easee: {result: 'problem', detail: "the BYD isn't plugged in"},
               breaker: {result: 'skipped', detail: 'kept on'}};
  a = alerts({easee: {}, charger_check: chk});
  assert.match(a, /Fix it before bed if you can: the BYD's own schedule starts it at 23:00, and the Pi starts it at 23:05 if it hasn't; POWER16 is on from 23:00\./);

  // ---- the heartbeat's "Home Pi offline" text (its Python run with a faked Supabase)
  const ymlPath = __dirname + '/.github/workflows/pi-heartbeat.yml';
  const yml = fs.readFileSync(ymlPath, 'utf8');
  assert.doesNotMatch(yml, /1\.4 kW|23:01|day offer|peak block/, 'the old plan is gone from the workflow');
  const body = yml.match(/python3 - <<'PY'\n([\s\S]*?)\n\s*PY\n/)[1].split('\n')
    .map(l => l.slice(Math.min(10, l.length - l.trimStart().length))).join('\n');
  const py = [['python3'], ['python'], ['py', '-3']].find(([cmd, ...args]) => {
    const r = spawnSync(cmd, [...args, '-c', 'import sys; print(sys.version_info[0])'], {encoding: 'utf8'});
    return !r.error && r.status === 0 && r.stdout.trim() === '3';
  });
  if (!py){ console.log('16 Nov: heartbeat part skipped (no Python 3 here)'); }
  else {
    const [cmd, ...args] = py;
    const parsed = spawnSync(cmd, [...args, '-c', 'import sys, yaml; yaml.safe_load(open(sys.argv[1])); print("ok")', ymlPath], {encoding: 'utf8'});
    if (parsed.status === 0) assert.equal(parsed.stdout.trim(), 'ok');
    else console.log('16 Nov: YAML parse check skipped (no PyYAML here)');
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
    const heartbeat = (easee, bydMin, liveMin) => {
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
    let r = heartbeat({online: true, op_mode: 3, car: null}, 30, 45);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const pi = (r.stdout.match(/::error title=Home Pi offline::(.*)/) || [])[1] || '';
    assert.equal(pi, 'The Pi has not updated the dashboard for 45 minutes, so nothing is controlling the chargers. ' +
      'By day the Easee stays on at full power (its own schedule stops it only 06:00-06:30), so a car plugged in by day ' +
      'would charge at the peak rate - pause it in the Easee app if needed. At night the BYD\'s own 23:00 schedule ' +
      'should start it, but there is no 23:05 check: after 23:00, resume the Easee if you paused it, and if the BYD ' +
      'isn\'t charging, open the BYD app and tap Charge. Check the Pi has power and its network connection; it also ' +
      'restarts itself every day at 13:03.');
    r = heartbeat({online: true, op_mode: 3, car: null}, 30, 5);
    assert.equal(r.status, 0, 'a live Pi: nothing to report\n' + r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /Home Pi offline/);
    r = heartbeat({online: true, op_mode: 3, car: null}, 300, 1);       // its other logic: as before, with 23:05
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /::error title=BYD service stopped::.*It runs the 23:05 check and the night recovery: check freephase-byd on the Pi\./);
  }
  console.log('16 Nov always-on dashboard tests OK');
})().catch(e => { console.error(e); process.exit(1); });
