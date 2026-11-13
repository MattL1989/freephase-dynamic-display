// Audit 13 Nov 2026: C3 - the dashboard shows the BYD service's car check (live_state.easee.car): another car on the
// Easee is "Not the BYD" with the fix, "Checking which car this is..." while pending, and no BYD "Ready." or "the BYD
// is not charging" for another car; C10 - the POWER16 Auto warning still asks when the overrides read failed (the
// Pi's live_state value stands in); C2 - the heartbeat does not report "BYD service stopped" while the car on the
// Easee is another car, or still being checked (for 30 minutes after the plug-in). Review: the public-charge alert
// ended by the BYD service (B1) says so, and its "Armed" line says when it ends.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
const slice = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));
const elements = new Map();
const el = id => {
  if (!elements.has(id)) elements.set(id, {id, hidden: false, textContent: '', innerHTML: '', className: '', open: false,
    disabled: false, value: 0, dataset: {}, style: {}, children: [], appendChild(x){this.children.push(x)},
    querySelectorAll: () => [], classList: {toggle(){}, add(){}, contains(){ return false; }}});
  return elements.get(id);
};
const writes = [];
let confirmAnswer = true, confirmAsked = [], liveRows = [];
const ctx = vm.createContext({console: {log: console.log, error(){}}, Intl, Date, JSON, Number, Math, Object, Array,
  String, Set, Error, localStorage: {getItem: () => null},
  document: {getElementById: el, querySelector: () => null, createElement: () => ({children:[], appendChild(x){this.children.push(x)}})},
  SUPABASE_URL: 'https://example.invalid', SUPABASE_KEY: 'fixture', fetchJSON: async () => liveRows,
  writeControl: async (key, value) => { writes.push([key, value]); return {ok: true}; },
  reasonText: r => 'failed ' + r, setTimeout: () => 0,
  confirm: text => { confirmAsked.push(text); return confirmAnswer; }});
const run = code => vm.runInContext(code, ctx);
run(slice('// POWER PERKS.', '// END POWER PERKS.'));
run(slice('function fmtClock', 'function freeDay'));
run(slice('// BYD VEHICLE.', '// END BYD VEHICLE.'));
run(slice('// DEVICES AT A GLANCE', '\nfunction renderImmersionUsage'));
run(slice('let currentEaseeOverride', '// SCROLL-WHEEL'));
run('var SCHED_KEY = { easee:"easee_schedule", breaker:"breaker_schedule" }; var schedState = { easee:null, breaker:null }; var currentTariff = {peak_price_p: 29.759}; var schedLoaded = true;');
run('function renderSchedState(){} function setWheelTo(){} function wheelValue(id){ return {"preheat-leave-h":"06","preheat-leave-m":"30"}[id]; }');
run(slice('async function saveSchedule', 'async function armSchedule'));
run(slice('// PRE-HEAT TOP-UP.', '// END PRE-HEAT.'));
run(slice('async function loadLiveState', '// IMMERSION USAGE'));

(async () => {
  assert.match(html, /const BUILD = "2026-11-13 audit-v25";/);
  assert.match(html, /<p class="vehicle-check" id="byd-car-check" role="status" hidden><\/p>/);

  // ---- C3: the car check's words
  const fix = 'If it is the BYD: unplug, wait a minute, plug back in.';
  assert.equal(run('carCheckText({car: "other", why: "its cable is not plugged in"})'),
               "Not the BYD (its cable is not plugged in) - the Pi won't start or pre-heat it. " + fix);
  assert.equal(run('carCheckText({car: "other", why: null})'), "Not the BYD - the Pi won't start or pre-heat it. " + fix,
               'no reason in live_state: without it');
  assert.equal(run('carCheckText({car: "pending"})'), 'Checking which car this is...');
  assert.equal(run('carCheckText({car: "byd"})'), '');
  assert.equal(run('carCheckText({car: null})'), '', 'no verdict counts as the BYD');

  // ---- C3: live_state -> the BYD card (loadLiveState takes it up before anything else can fail)
  const live = (car, extra) => [{value: JSON.stringify({updated_at: new Date().toISOString(),
    easee: Object.assign({online: true, op_mode: 3, total_power_kw: 3.8, car}, extra || {}), breaker_override: 'on'})}];
  liveRows = live('other', {car_why: 'its cable is not plugged in'});
  await run('loadLiveState()');
  assert.equal(el('byd-car-check').hidden, false);
  assert.match(el('byd-car-check').textContent, /^Not the BYD \(its cable is not plugged in\) - the Pi won't start or pre-heat it\./);
  assert.equal(el('byd-car-check').dataset.alert, 'true');
  liveRows = live('pending');
  await run('loadLiveState()');
  assert.equal(el('byd-car-check').textContent, 'Checking which car this is...');
  assert.equal(el('byd-car-check').dataset.alert, 'false');
  liveRows = live('something-new');
  await run('loadLiveState()');
  assert.equal(el('byd-car-check').hidden, true, 'an unknown value is not shown');
  liveRows = live(null);
  await run('loadLiveState()');
  assert.equal(el('byd-car-check').hidden, true);

  // ---- C3: with another car on the Easee the BYD card never says "Not charging"
  const now = Date.now();
  ctx.byd = {schema: 1, status: 'ok', battery_pct: 64, range_miles: 200, charging: false,
             vehicle_updated_at: new Date(now - 60000).toISOString(), checked_at: new Date(now).toISOString()};
  run('easeeCar = {car: "other", why: null}; renderByd(byd, Date.now(), false)');
  assert.equal(el('byd-status').textContent, 'Not on the Easee · updates about every 10 minutes');
  assert.equal(el('byd-car-check').hidden, false, 'renderByd shows the car check too');
  run('easeeCar = {car: null, why: null}; renderByd(byd, Date.now(), false)');
  assert.equal(el('byd-status').textContent, 'Not charging · updates about every 10 minutes', 'the BYD: as before');

  // ---- C3: the Easee error banner and the pre-heat's "Ready."
  const alerts = st => { run(`renderDeviceAlerts(${JSON.stringify(Object.assign({tariff: {}, charge_sessions: {}, supply: {}}, st))})`); return el('device-alerts').innerHTML; };
  run('easeeCar = {car: "other", why: null}');
  assert.match(alerts({easee: {online: true, op_mode: 5}}), /Easee error: the car on it is not charging/);
  assert.doesNotMatch(alerts({easee: {online: true, op_mode: 5}}), /the BYD is not charging/);
  run('easeeCar = {car: "pending", why: null}');
  assert.match(alerts({easee: {online: true, op_mode: 5}}), /Easee error: the BYD is not charging/, 'pending counts as the BYD');
  run(`schedState.easee = {preheat: {enabled: true, days: [2], start: "05:30", end: "06:45", skip: null,
         car: {enabled: true, depart: "06:30", lead_min: 15, cabin_c: 20, seat: "high", wheel: true, below_c: 15}}};
       bydPreheat = {schema: 1, status: "ready", checked_at: new Date().toISOString()}; preheatLive = {}`);
  run('easeeCar = {car: "other", why: null}; renderPreheat(Date.now())');
  assert.match(el('preheat-car').textContent, /On hold: the car on the Easee is not the BYD\./);
  assert.doesNotMatch(el('preheat-car').textContent, /Ready\./);
  run('easeeCar = {car: "byd", why: null}; renderPreheat(Date.now())');
  assert.match(el('preheat-car').textContent, /Ready\./);
  run('bydPreheat.status = "pin_rejected"; easeeCar = {car: "other", why: null}; renderPreheat(Date.now())');
  assert.match(el('preheat-car').textContent, /BYD rejected the PIN/, 'a PIN problem is still said');

  // ---- C10: the overrides read failed - the Pi's live_state value stands in, so Auto still asks
  run('currentBreakerOverride = null; liveOverride.breaker = null');
  liveRows = live(null);                                  // its breaker_override is "on"
  await run('loadLiveState()');
  assert.equal(run('liveOverride.breaker'), 'on');
  assert.equal(run('currentOverride("breaker")'), 'on');
  confirmAnswer = false;
  await run('setOverride("breaker", "auto")');
  assert.equal(confirmAsked.length, 1, 'asked although the overrides read failed');
  assert.match(confirmAsked[0], /kept on for the Puma/);
  assert.equal(writes.length, 0, 'not saved without a yes');
  run('currentBreakerOverride = "auto"');                 // the overrides read worked: its value stands
  await run('setOverride("breaker", "auto")');
  assert.equal(confirmAsked.length, 1);
  run('currentBreakerOverride = null; liveOverride.breaker = null');
  await run('setOverride("breaker", "auto")');
  assert.equal(confirmAsked.length, 1, 'nothing known at all: as before');

  // ---- review: the public-charge alert ended by the BYD service (audit 13 Nov B1) is not "Reached the target"
  const sel = el('byd-dc-pct'); sel.options = []; sel.appendChild = function(o){ this.options.push(o); };
  const setAt = new Date(Date.now() - 30 * 60000).toISOString();
  run(`schedState.easee = Object.assign({}, schedState.easee, {byd_stop: {enabled: true, pct: 80, set_at: ${JSON.stringify(setAt)}}})`);
  const dc = extra => run(`bydDcStop = Object.assign({schema: 1, pct: 80, set_at: ${JSON.stringify(setAt.replace('Z', '+00:00'))},
    checked_at: new Date().toISOString()}, ${JSON.stringify(extra)}); renderBydDcStop()`);
  dc({status: 'done', last: {result: 'ended', at: '2026-11-13T09:40:00+00:00', target: 80, pct: 75, detail: 'the charge has stopped'}});
  assert.equal(el('byd-dc-status').textContent,
               'Ended at 09:40: the charge has stopped - no email. Arm it again once the car is charging.');
  dc({status: 'done', last: {result: 'ended', at: '2026-11-13T09:40:00+00:00', target: 80, pct: null}});
  assert.equal(el('byd-dc-status').textContent, 'Ended at 09:40 - no email. Arm it again once the car is charging.');
  dc({status: 'done', last: {result: 'notified', at: '2026-11-13T09:40:00+00:00', target: 80, pct: 81}});
  assert.match(el('byd-dc-status').textContent, /^Reached 81% at 09:40 - email sent/, 'as before');
  dc({status: 'armed', now_pct: 75, charging: true});
  assert.match(el('byd-dc-status').textContent, /^Armed: emails you at 80% - now 75%.*, charging\. It ends when the charge stops, if no charging is seen within about 20 minutes of arming, or 6 hours after arming\.$/);
  assert.ok(!html.includes('Lapses 6 hours after arming'), 'the old wording is gone');

  // ---- C2: the heartbeat (its Python run with a faked Supabase)
  const yml = fs.readFileSync(__dirname + '/.github/workflows/pi-heartbeat.yml', 'utf8');
  const body = yml.match(/python3 - <<'PY'\n([\s\S]*?)\n\s*PY\n/)[1].split('\n')
    .map(l => l.slice(Math.min(10, l.length - l.trimStart().length))).join('\n');
  const py = [['python3'], ['python'], ['py', '-3']].find(([cmd, ...args]) => {
    const r = spawnSync(cmd, [...args, '-c', 'import sys; print(sys.version_info[0])'], {encoding: 'utf8'});
    return !r.error && r.status === 0 && r.stdout.trim() === '3';
  });
  if (!py){ console.log('audit 13 Nov: heartbeat part skipped (no Python 3 here)'); }
  else {
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
    const heartbeat = (car, pluggedMin) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-'));
      try {
        fs.copyFileSync(__dirname + '/index.html', path.join(dir, 'index.html'));
        fs.writeFileSync(path.join(dir, 'hb.py'), body);
        fs.writeFileSync(path.join(dir, 'wrap.py'), wrapper);
        const easee = {op_mode: 3, car};
        if (pluggedMin != null) easee.plugged_at = iso(pluggedMin * 60000);
        const rows = {live_state: {updated_at: iso(60000), easee},
                      byd_vehicle: {checked_at: iso(5 * 3600000)}};          // not read for 5 hours
        const [cmd, ...args] = py;
        return spawnSync(cmd, [...args, 'wrap.py', 'hb.py'], {cwd: dir, encoding: 'utf8',
          env: Object.assign({}, process.env, {HB_ROWS: JSON.stringify(rows)})});
      } finally { fs.rmSync(dir, {recursive: true, force: true}); }
    };
    for (const [car, pluggedMin] of [['other', null], ['other', 300], ['pending', 5]]){
      const r = heartbeat(car, pluggedMin);
      assert.equal(r.status, 0, `car ${car}: ${r.stdout}${r.stderr}`);
      assert.doesNotMatch(r.stdout, /BYD service stopped/);
      assert.match(r.stdout, /so the BYD service is not reading the BYD - as it should/);
    }
    // a "pending" check lasts minutes: one still pending 45 minutes after the plug-in (or with no plug-in time) is stuck
    for (const [car, pluggedMin] of [['pending', 45], ['pending', null], ['byd', 5], [null, 5]]){
      const r = heartbeat(car, pluggedMin);
      assert.equal(r.status, 1, `car ${car}, plugged in ${pluggedMin} min ago: the BYD not read for 5 hours is reported`);
      assert.match(r.stdout, /::error title=BYD service stopped::/);
    }
  }
  console.log('audit 13 Nov dashboard tests OK');
})().catch(e => { console.error(e); process.exit(1); });
