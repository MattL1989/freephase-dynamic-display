const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const elements = new Map();
const el = id => {
  if (!elements.has(id)) elements.set(id, {textContent:'', hidden:false, dataset:{}, value:0});
  return elements.get(id);
};
const now = Date.now();
const context = vm.createContext({Date, Number, JSON, Array, String, Error,
  document:{getElementById:el}, SUPABASE_URL:'https://example.invalid', SUPABASE_KEY:'fixture',
  now, fetchJSON:async () => []});
const run = code => vm.runInContext(code, context);
run(html.slice(html.indexOf('// BYD VEHICLE.'), html.indexOf('// END BYD VEHICLE.')));
run('renderByd(null, now, false)');
assert.equal(el('byd-tag').textContent,'Not connected');
assert.equal(el('byd-values').hidden,true);
assert.equal(el('byd-battery').textContent,'—');
context.state = {schema:1,status:'ok',battery_pct:94,range_miles:305,charging:false,
  vehicle_updated_at:new Date(now-60000).toISOString(), checked_at:new Date(now).toISOString()};
run('renderByd(state, now, false)');
assert.equal(el('byd-battery').textContent,'94');
assert.equal(el('byd-range').textContent,'305');
assert.equal(el('byd-tag').textContent,'From BYD');
assert.match(el('byd-status').textContent,/Not charging/);
assert.equal(el('byd-meter').value,94);
run('renderByd({...state,battery_pct:0,range_miles:0}, now, false)');
assert.equal(el('byd-battery').textContent,'0');
assert.equal(el('byd-meter').hidden,false);
run('renderByd({...state,battery_pct:-1,range_miles:null}, now, false)');
assert.equal(el('byd-battery').textContent,'—');
assert.equal(el('byd-values').hidden,true);
// New polling time must never make an old vehicle reading look current.
run('renderByd({...state,vehicle_updated_at:new Date(now-86400000).toISOString()}, now, false)');
assert.equal(el('byd-tag').textContent,'Last known');
assert.equal(el('byd-card').dataset.stale,'true');
run('renderByd({...state,vehicle_updated_at:null}, now, false)');
assert.equal(el('byd-tag').textContent,'Last known');
run('renderByd(state, now+31*60000, false)');
assert.equal(el('byd-tag').textContent,'Last known');
run('renderByd(state, now, true)');
assert.equal(el('byd-battery').textContent,'94');
assert.match(el('byd-status').textContent,/interrupted/);
run('renderByd({...state,status:"sign_in_required"}, now, false)');
assert.match(el('byd-status').textContent,/Reconnect/);
run('renderByd({...state,status:"paused"}, now, false)');
assert.equal(el('byd-tag').textContent,'Updates paused');
assert.equal(el('byd-battery').textContent,'94');
assert.match(el('byd-status').textContent,/separate BYD account/);
// Cloud errors retain last good data; an absent row is an unconnected state.
(async () => {
  context.fetchJSON = async () => [{value:JSON.stringify(context.state)}];
  await run('loadBydState()');
  assert.equal(el('byd-battery').textContent,'94');
  context.fetchJSON = async () => {throw new Error('network');};
  await run('loadBydState()');
  assert.equal(el('byd-battery').textContent,'94');
  assert.equal(el('byd-tag').textContent,'Last known');
  context.fetchJSON = async () => [{value:'{"schema":99}'}];
  await run('loadBydState()');
  assert.equal(el('byd-battery').textContent,'94');
  context.fetchJSON = async () => [];
  await run('loadBydState()');
  assert.equal(el('byd-tag').textContent,'Not connected');
  assert.equal(el('byd-values').hidden,true);
  console.log('BYD telemetry UI tests passed');
})().catch(e => {console.error(e); process.exitCode=1;});
