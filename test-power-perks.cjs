const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/index.html','utf8');
const elements = new Map();
const el = id => {
  if (!elements.has(id)) elements.set(id,{hidden:false,textContent:'',innerHTML:''});
  return elements.get(id);
};
const ctx = vm.createContext({Date,Number,JSON,Array,Object,String,document:{getElementById:el}});
const run = code => vm.runInContext(code,ctx);
run(html.slice(html.indexOf('// POWER PERKS.'),html.indexOf('// END POWER PERKS.')));
ctx.event = {id:'fixture',start:'2026-10-24T23:00:00+01:00',end:'2026-10-25T06:00:00+00:00',credit_expected_month:'2026-11',devices:{}};
run('currentPowerPerks={schema:1,status:"ok",updated_at:"2026-10-24T12:00:00Z",events:[event]}');
run('renderPowerPerks(Date.parse("2026-10-24T13:00:00Z"))');
assert.match(el('power-perks').innerHTML,/8 hours/);
assert.match(el('power-perks').innerHTML,/November/);
assert.match(el('power-perks').innerHTML,/23:00 BST/);
assert.match(el('power-perks').innerHTML,/06:00 GMT/);
assert.doesNotMatch(el('power-perks').innerHTML,/£0\.00/);
assert.match(el('hist-perks-note').textContent,/before Power Perks/);
assert.equal(run('!!powerPerksActive(Date.parse("2026-10-24T21:59:59Z"))'),false);
for (const stamp of ['2026-10-24T22:00:00Z','2026-10-25T00:30:00Z','2026-10-25T01:30:00Z','2026-10-25T05:59:59Z'])
  assert.equal(run(`!!powerPerksActive(Date.parse('${stamp}'))`),true);
assert.equal(run('!!powerPerksActive(Date.parse("2026-10-25T06:00:00Z"))'),false);
run('renderPowerPerks(Date.parse("2026-10-25T01:30:00Z"))');
assert.match(el('power-perks').innerHTML,/Awaiting readings/);
assert.doesNotMatch(el('power-perks').innerHTML,/£0\.00/,'missing data is not a zero credit');
ctx.event.devices = {easee:{status:'recorded',recorded_kwh:16,priced_kwh:16,expected_credit_p:106.56},
  breaker:{status:'recorded',recorded_kwh:7,priced_kwh:7,expected_credit_p:46.62,boundary_kwh:.01},
  immersion:{status:'recorded',recorded_kwh:4,priced_kwh:4,expected_credit_p:26.64}};
run('renderPowerPerks(Date.parse("2026-10-25T08:00:00Z"))');
assert.match(el('power-perks').innerHTML,/≈£1\.80/);
assert.match(el('power-perks').innerHTML,/event ended/);
assert.match(el('power-perks').innerHTML,/partial/);
assert.equal(run('powerPerksSessionNote({started:"2026-10-24T20:00:00Z",ended:"2026-10-24T22:00:00Z"})'),'');
assert.match(run('powerPerksSessionNote({started:"2026-10-24T22:00:00Z",ended:"2026-10-25T02:00:00Z"})'),/Before Power Perks credit/);
assert.equal(run('powerPerksSessionNote({started:"2026-10-25T06:00:00Z",ended:"2026-10-25T07:00:00Z"})'),'');
assert.match(run('powerPerksSessionNote({started:"2026-10-24T22:00:00Z",active:true},Date.parse("2026-10-24T22:30:00Z"))'),/Before Power Perks credit/);
run('currentPowerPerks=null; renderPowerPerks()');
assert.equal(el('power-perks').innerHTML,'');
assert.equal(el('hist-perks-note').hidden,true);
// At the event boundaries, the hero switches net rate without changing the tariff.
class TestDate extends Date { static now(){return TestDate.timestamp;} }
TestDate.timestamp = Date.parse('2026-10-24T22:00:00Z');
ctx.Date=TestDate; ctx.staleSince=0; ctx.rateCard=()=>{}; ctx.lastKnownClock=()=>''; ctx.fmtAge=()=>'';
ctx.tariff={period:'offpeak',price_p:6.66,offpeak_price_p:6.66,peak_price_p:29.759,standing_charge_p:56.868};
run(html.slice(html.indexOf('function renderTariff(t)'),html.indexOf('// PIN-GATED CONTROL WRITES')));
run('currentPowerPerks={schema:1,status:"ok",events:[event]}; renderTariff(tariff)');
assert.equal(el('now-price').textContent,'0.00');
assert.equal(el('now-band-name').textContent,'FREE AFTER CREDIT');
assert.match(el('now-context').innerHTML,/6.66p\/kWh credited later/);
assert.equal(ctx.tariff.price_p,6.66);
TestDate.timestamp=Date.parse('2026-10-25T06:00:00Z');
run('renderTariff(tariff)');
assert.equal(el('now-price').textContent,'6.66');
assert.equal(el('now-band-name').textContent,'OFF-PEAK');
run('staleSince=5; renderTariff(tariff)');
assert.equal(el('now-band-name').textContent,'STALE');
console.log('Power Perks UI: DST, event boundaries, missing reads and separate credit passed');
