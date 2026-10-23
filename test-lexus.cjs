const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname+'/index.html','utf8');
const elements = new Map();
const el = id => {
  if(!elements.has(id)) elements.set(id,{textContent:'',hidden:false,dataset:{},value:0});
  return elements.get(id);
};
const now = Date.now();
const context = vm.createContext({Date,Number,JSON,Array,String,Error,
  document:{getElementById:el},SUPABASE_URL:'https://example.invalid',SUPABASE_KEY:'fixture',now,
  fetchJSON:async()=>[]});
const run = code=>vm.runInContext(code,context);
run(html.slice(html.indexOf('// LEXUS VEHICLE.'),html.indexOf('// END LEXUS VEHICLE.')));
run('renderLexus(null,now,false)');
assert.equal(el('lexus-values').hidden,true);
context.state={schema:1,status:'ok',battery_pct:0,reported_battery_pct:32,electric_range_miles:0,
  charging_status:'disconnected',vehicle_updated_at:new Date(now-60000).toISOString(),checked_at:new Date(now).toISOString(),
  charge_check:{status:'waiting_window',checked_at:new Date(now).toISOString(),energy_kwh:0}};
run('renderLexus(state,now,false)');
assert.equal(el('lexus-battery').textContent,'0');
assert.equal(el('lexus-range').textContent,'0');
assert.equal(el('lexus-meter').hidden,false);
assert.equal(el('lexus-status').textContent,'Not connected');
assert.match(el('lexus-check').textContent,/automatic/);
run('renderLexus({...state,battery_pct:null},now,false)');
assert.equal(el('lexus-battery').textContent,'—');
assert.equal(el('lexus-meter').hidden,true);
run('renderLexus({...state,charging_status:"plugged_in",charge_check:{...state.charge_check,status:"missed_charge"}},now,false)');
assert.equal(el('lexus-check').dataset.alert,'true');
assert.match(el('lexus-check').textContent,/20 minutes/);
run('renderLexus({...state,charge_check:{...state.charge_check,status:"missed_charge"}},now+31*60000,false)');
assert.equal(el('lexus-tag').textContent,'Last known');
assert.equal(el('lexus-check').dataset.alert,'false');
assert.match(el('lexus-check').textContent,/fresh data/);
run('renderLexus({...state,vehicle_updated_at:null,charge_check:{...state.charge_check,status:"missed_charge"}},now,false)');
assert.equal(el('lexus-check').dataset.alert,'false');
run('renderLexus({...state,charge_check:{...state.charge_check,status:"missed_charge",checked_at:new Date(now-6*60000).toISOString()}},now,false)');
assert.equal(el('lexus-check').dataset.alert,'false');
run('renderLexus({...state,vehicle_updated_at:new Date(now-86400000).toISOString()},now,false)');
assert.equal(el('lexus-tag').textContent,'Last known');
assert.equal(el('lexus-battery').textContent,'0');
run('renderLexus({...state,charging_status:"<script>"},now,false)');
assert.equal(el('lexus-status').textContent,'Cable status not reported');
(async()=>{
  context.fetchJSON=async()=>[{value:JSON.stringify(context.state)}];
  await run('loadLexusState()');
  assert.equal(el('lexus-tag').textContent,'From Lexus');
  context.fetchJSON=async()=>{throw new Error('network');};
  await run('loadLexusState()');
  assert.equal(el('lexus-battery').textContent,'0');
  assert.equal(el('lexus-tag').textContent,'Last known');
  context.fetchJSON=async()=>[{value:'{"schema":99}'}];
  await run('loadLexusState()');
  assert.equal(el('lexus-battery').textContent,'0');
  console.log('Lexus telemetry UI tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
