import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/core/db.ts';
import {ServiceStatus} from '../server/core/service-status.ts';
import {invalidateRestored} from '../server/core/restore.ts';
import {measurementTime,freshMeasurement} from '../shared/service-status.ts';

test('stale display uses elapsed time even when a device clock differs from the server',()=>{
  const row={id:'plex' as const,state:'responding' as const,checkedAt:1_000_000,lastSuccess:1_000_000,outageSince:null,recoveredAt:null};
  for(const clientReceived of [10_000,80_000_000]){
    assert.equal(freshMeasurement(row,measurementTime(1_000_000,clientReceived,clientReceived+179_000)).state,'responding');
    assert.equal(freshMeasurement(row,measurementTime(1_000_000,clientReceived,clientReceived+181_000)).state,'unknown');
  }
});

function setup(){
  const db=new Store(':memory:');let now=1_000_000,ok=true,calls=0;
  const probe={fingerprint:'target-1',configured:true,run:async()=>{calls++;return {ok,code:ok?'ok':'timeout'};}};
  const status=new ServiceStatus(db,{plex:probe},()=>now);
  return {db,status,probe,time:(value:number)=>now=value,result:(value:boolean)=>ok=value,calls:()=>calls,row:()=>status.snapshot(true).services[0]};
}
test('outages need two spaced failures, manual clicks cannot accelerate them, and success recovers',async()=>{
  const f=setup();assert.equal(f.row().state,'unknown');
  await f.status.check();assert.equal(f.row().state,'responding');
  f.result(false);f.time(1_060_000);await f.status.check();assert.equal(f.row().state,'checking');
  f.time(1_075_000);await f.status.check(true);assert.equal(f.row().state,'checking');
  f.time(1_120_000);await f.status.check(true);assert.equal(f.row().state,'unavailable');assert.equal(f.row().outageSince,1_060_000);
  f.result(true);f.time(1_135_000);await f.status.check(true);assert.equal(f.row().state,'responding');assert.equal(f.row().outageSince,null);assert.equal(f.row().recoveredAt,1_135_000);
  f.db.close();
});
test('staleness, restart and changed targets discard old failure confirmation',async()=>{
  const f=setup();f.result(false);await f.status.check();
  f.time(1_180_001);assert.equal(f.row().state,'unknown');await f.status.check();assert.equal(f.row().state,'checking');
  const restarted=new ServiceStatus(f.db,{plex:f.probe},()=>1_240_001);assert.equal(restarted.snapshot().services[0].state,'unknown');await restarted.check();assert.equal(restarted.snapshot().services[0].state,'checking');
  f.probe.fingerprint='target-2';f.time(1_300_001);await f.status.check();assert.equal(f.row().state,'checking');
  f.db.close();
});
test('single-flight and cooldown bound manual probes and diagnostics never retain raw errors',async()=>{
  const f=setup();let release!:()=>void;f.probe.run=()=>new Promise(resolve=>{release=()=>resolve({ok:false,code:'timeout'});});
  const first=f.status.check(true);await f.status.check(true);release();await first;
  assert.equal(f.row().state,'checking');
  await f.status.check(true); // cooldown means this cannot start a second unresolved request
  f.probe.run=async()=>{throw Error('secret http://private/token');};f.time(1_060_000);await f.status.check();
  assert.equal(f.row().state,'unavailable');assert.doesNotMatch(JSON.stringify(f.status.snapshot(true)),/private|secret|fingerprint/);
  assert.equal('diagnostic' in f.status.snapshot().services[0],false);
  f.db.close();
});
test('unconfigured probes remain unknown and never produce an outage',async()=>{
  const f=setup();f.probe.configured=false;await f.status.check();f.time(1_060_000);await f.status.check();assert.equal(f.row().state,'unknown');assert.equal(f.calls(),0);f.db.close();
});
test('notices stay private until published, coexist with healthy checks, resolve to history, and restore to drafts',async()=>{
  const f=setup();const input={services:['plex'],type:'maintenance',title:'Maintenance',message:'Tonight <script>plain text</script>'};
  const draft=f.status.saveNotice(input,'admin');assert.equal(f.status.snapshot().notices.length,0);
  f.status.publishNotice(draft.id,'admin');await f.status.check();assert.equal(f.row().state,'responding');assert.equal(f.status.snapshot().notices[0].message,input.message);
  f.status.saveNotice({...input,id:draft.id,message:'Updated'},'admin');assert.equal(f.status.snapshot().notices[0].message,'Updated');
  f.status.resolveNotice(draft.id,'admin');assert.equal(f.status.snapshot().notices.length,0);assert.equal(f.status.snapshot(true).history[0].state,'resolved');
  assert.throws(()=>f.status.deleteNotice(draft.id,'admin'));
  const other=f.status.saveNotice(input,'admin');f.status.publishNotice(other.id,'admin');invalidateRestored(f.db);
  assert.equal(f.status.snapshot().notices.length,0);assert.equal(f.row().state,'unknown');assert.equal(f.status.snapshot(true).history.find((n:any)=>n.id===other.id).state,'draft');
  assert.throws(()=>f.status.saveNotice({...input,services:['http://evil']},'admin'));
  assert.throws(()=>f.status.saveNotice({...input,title:' '},'admin'));
  f.db.close();
});
