// Audit 3 Nov 2026, fixed 4 Nov: B1 - while POWER16 is kept on for the Puma, Auto asks first, a one-shot window is
// refused (the Pi would skip it) and cancelling a running window asks first; C1 - the pre-heat's "Next:" is the BYD
// service's own next heating start once it has taken up the saved leave time; C3 - the panel says the car charges at
// the peak rate during the window if it isn't full.
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
let confirmAnswer = true, confirmAsked = [];
const ctx = vm.createContext({console, Intl, Date, JSON, Number, Math, Object, Array, String, Set,
  localStorage: {getItem: () => null},
  document: {getElementById: el, createElement: () => ({children:[], appendChild(x){this.children.push(x)}})},
  writeControl: async (key, value) => { writes.push([key, value]); return {ok: true}; },
  reasonText: r => 'failed ' + r, setTimeout: () => 0,
  confirm: text => { confirmAsked.push(text); return confirmAnswer; }});
const run = code => vm.runInContext(code, ctx);
run(slice('function fmtClock', 'function freeDay'));
run(slice('let currentEaseeOverride', '// SCROLL-WHEEL'));
run('function paintOverride(){}');
run('var SCHED_KEY = { easee:"easee_schedule", breaker:"breaker_schedule" }; var schedState = { easee:null, breaker:null }; var schedLoaded = true;');
run('function renderSchedState(){}');
run('var wheels = {"breaker-start-h":"01","breaker-start-m":"00","breaker-end-h":"05","breaker-end-m":"00"}; function wheelValue(id){ return wheels[id]; }');
run(slice('async function saveSchedule', '// PRE-HEAT TOP-UP.'));
run(slice('function preheatSeenRecently', 'const PREHEAT_DAYS'));
run(slice('function preheatNextText', 'function preheatColderText'));

(async () => {
  // ---- B1: Auto while POWER16 is kept on for the Puma asks first; a "no" changes nothing
  run('currentBreakerOverride = "on"');
  confirmAnswer = false;
  await run('setOverride("breaker", "auto")');
  assert.equal(confirmAsked.length, 1);
  assert.match(confirmAsked[0], /kept on for the Puma.*faults if its power is cut.*Unplug the Puma first/);
  assert.equal(writes.length, 0, 'not saved without a yes');
  confirmAnswer = true;
  await run('setOverride("breaker", "auto")');
  assert.deepEqual(writes.at(-1), ['breaker_override', 'auto']);
  run('currentBreakerOverride = "auto"');
  await run('setOverride("breaker", "on")');
  assert.equal(confirmAsked.length, 2, 'On needs no confirmation');
  run('currentEaseeOverride = "on"');
  await run('setOverride("easee", "auto")');
  assert.equal(confirmAsked.length, 2, 'the Easee is not the Puma');

  // ---- B1: no one-shot POWER16 window while it is kept on (the Pi would skip it)
  run('currentBreakerOverride = "on"');
  const n = writes.length;
  await run('armSchedule("breaker")');
  assert.equal(writes.length, n, 'not armed');
  assert.match(el('breaker-sched-status').textContent, /kept on for the Puma, so the Pi would skip this window/);
  run('currentBreakerOverride = "auto"');
  await run('armSchedule("breaker")');
  assert.equal(JSON.parse(writes.at(-1)[1]).enabled, true, 'on Auto (the Lexus) a window is armed as before');

  // ---- B1: cancelling a window that is running asks first (it hands POWER16 back to Auto)
  run('schedState.breaker = {enabled:true, start:"01:00", end:"05:00", fired:true}');
  confirmAnswer = false;
  const m = writes.length;
  await run('cancelSchedule("breaker")');
  assert.equal(writes.length, m, 'not cancelled without a yes');
  assert.match(confirmAsked.at(-1), /hands POWER16 back to Auto/);
  confirmAnswer = true;
  await run('cancelSchedule("breaker")');
  assert.equal(JSON.parse(writes.at(-1)[1]).enabled, false);
  const asked = confirmAsked.length;
  run('schedState.breaker = {enabled:true, start:"01:00", end:"05:00", fired:false}');
  await run('cancelSchedule("breaker")');
  assert.equal(confirmAsked.length, asked, 'an armed window that has not started: nothing to cut, no question');

  // ---- C1: "Next:" is the BYD service's own next heating start once it has the saved leave time
  const now = new Date();
  const st = {status: 'ready', checked_at: now.toISOString(), next_start: '2026-11-03T17:15:00+00:00',
              next_depart: '2026-11-03T17:30:00+00:00'};
  const cfg = {enabled: true}, live = {next_start: '2026-11-10T05:30:00+00:00'};
  const text = (car, s) => run(`preheatNextText(${JSON.stringify(cfg)}, ${JSON.stringify(car)}, ${JSON.stringify(live)}, ${JSON.stringify(s)}, "06:15")`);
  assert.equal(text({depart: '17:30'}, st), 'Next: Tue 3 Nov, heating 17:15–17:30. ', 'today 17:15, not next week');
  assert.equal(text({depart: '06:30'}, st), 'Next: Tue 10 Nov, heating 06:15–06:30. ',
               'the Pi has not taken up the new leave time yet: its Easee window');
  assert.equal(text({depart: '17:30'}, Object.assign({}, st, {checked_at: '2026-10-01T00:00:00Z'})),
               'Next: Tue 10 Nov, heating 06:15–17:30. ', 'an old BYD service report is not used');
  assert.equal(run(`preheatNextText({enabled:false}, {depart:"17:30"}, {}, null, "17:15")`), '');

  // ---- C3: the panel says it charges at the peak rate during the window
  assert.ok(html.includes("if the battery isn't full, the car charges during that time at the peak rate, so it is full when you leave"));
  assert.ok(html.includes("If the battery isn't full, the car also charges while the window is open, at up to 7 kW"));
  assert.ok(!html.includes('tops the battery back up after the heating'), 'the old wording is gone');
  console.log('audit 4 Nov dashboard tests OK');
})().catch(e => { console.error(e); process.exit(1); });
