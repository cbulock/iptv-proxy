import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/core/db.ts';
import {Auth} from '../server/core/auth.ts';
import {PlexSetup} from '../server/core/plex-setup.ts';

function fixture(){
 const db=new Store(':memory:'),auth=new Auth(db,'x'.repeat(64));
 auth.invite('viewer@example.com','admin');const c=auth.issueEmail('viewer@example.com')!;
 const {user}=auth.consumeEmail(c.id,c.code);auth.plexSignIn({id:'42',name:'Viewer',email:'different@example.com'},false,user.id);
 let remoteState:'none'|'pending'|'ready'='none',calls=0,fail=false;
 const api={libraries:async()=>[{id:'101',key:'1',name:'Movies'}],inspect:async()=>remoteState,invite:async()=>{calls++;if(fail)throw Error('uncertain');remoteState='pending';}};
 const emails:any[]=[];const setup=new PlexSetup(db,api,{queue:(...args:any[])=>emails.push(args)});
 return {db,auth,user,setup,emails,get calls(){return calls;},set remote(v:typeof remoteState){remoteState=v;},set fail(v:boolean){fail=v;}};
}

test('admin overview initializes and persists library names without repeated Plex calls',async()=>{
 const f=fixture();let calls=0;
 f.setup.api.libraries=async()=>{calls++;return [{id:'101',key:'1',name:'Movies'}];};
 const first=await f.setup.overview();assert.equal(first.catalog[0].name,'Movies');assert.ok(first.catalogUpdated);
 const reloaded=new PlexSetup(f.db,f.setup.api,{queue:()=>{}});
 assert.deepEqual((await reloaded.overview()).catalog,first.catalog);assert.equal(calls,1);
});

test('failed catalog updates preserve cached libraries and saved defaults',async()=>{
 const f=fixture();await f.setup.saveDefaults(['101'],'admin');
 await f.setup.overview();f.setup.api.libraries=async()=>{throw Error('offline');};
 await assert.rejects(()=>f.setup.refreshCatalog());
 const overview=await f.setup.overview();assert.equal(overview.catalog[0].name,'Movies');assert.deepEqual(overview.libraries,['101']);
});

test('first catalog load failure still returns the admin overview and can be retried',async()=>{
 const f=fixture();f.setup.api.libraries=async()=>{throw Error('offline');};
 const overview=await f.setup.overview();assert.deepEqual(overview.catalog,[]);assert.equal(overview.catalogUpdated,null);assert.ok(overview.catalogError);
 f.setup.api.libraries=async()=>[{id:'101',key:'1',name:'Movies'}];
 await f.setup.refreshCatalog();assert.equal((await f.setup.overview()).catalog[0].name,'Movies');
});
test('explicit defaults and proven identity are required; pending is not ready; duplicate enables reuse invitation',async()=>{
 const f=fixture();await f.setup.enable(f.user.id);assert.equal(f.calls,0);
 await f.setup.saveDefaults(['101'],'admin');await Promise.all([f.setup.enable(f.user.id),f.setup.enable(f.user.id)]);
 assert.equal(f.calls,1);assert.equal(f.setup.status(f.user.id).state,'pending');
 await f.setup.enable(f.user.id);assert.equal(f.calls,1);
 assert.deepEqual(JSON.parse(f.db.get('SELECT libraries FROM plex_setup WHERE user_id=?',f.user.id).libraries),['101']);
});
test('confirmed access survives history and removal never self restores',async()=>{
 const f=fixture();await f.setup.saveDefaults(['101'],'admin');f.remote='ready';await f.setup.check(f.user.id);
 assert.equal(f.setup.status(f.user.id).state,'ready');f.remote='none';await f.setup.check(f.user.id);await f.setup.enable(f.user.id);
 assert.equal(f.calls,0);assert.equal(f.setup.status(f.user.id).state,'help');
 await f.setup.enable(f.user.id,'admin');assert.equal(f.calls,1);
});
test('uncertain writes never repeat automatically; pending evidence recovers safely',async()=>{
 const f=fixture();await f.setup.saveDefaults(['101'],'admin');f.fail=true;await f.setup.enable(f.user.id);
 await f.setup.enable(f.user.id);assert.equal(f.calls,1);f.remote='pending';await f.setup.check(f.user.id);
 assert.equal(f.setup.status(f.user.id).state,'pending');
});
test('legacy provenance and stale libraries fail closed; disabled users cannot retry',async()=>{
 const f=fixture();await assert.rejects(()=>f.setup.saveDefaults(['stale'],'admin'));
 await f.setup.saveDefaults(['101'],'admin');f.db.run('UPDATE plex_setup SET eligible=0 WHERE user_id=?',f.user.id);
 await f.setup.enable(f.user.id);assert.equal(f.calls,0);
 f.auth.disable(f.user.id,'admin');await assert.rejects(()=>f.setup.enable(f.user.id,'admin'));assert.equal(f.calls,0);
});
test('help records deduplicate and use only the verified administrator email',()=>{
 const f=fixture();const admin=f.auth.create('Admin','admin@example.com',null);f.db.run("UPDATE users SET role='admin' WHERE id=?",admin.id);
 f.setup.help(f.user.id);f.setup.help(f.user.id);assert.equal(f.emails.length,1);assert.equal(f.emails[0][0],'admin@example.com');
 f.setup.resolve(f.user.id,'admin');f.db.run('UPDATE users SET email=NULL WHERE id=?',admin.id);f.setup.help(f.user.id);
 assert.equal(f.emails.length,1);assert.equal(f.setup.status(f.user.id).help.notification,'missing-email');
});
test('a changed default does not replace an uncertain invitation snapshot',async()=>{
 const f=fixture();await f.setup.saveDefaults(['101'],'admin');f.fail=true;await f.setup.enable(f.user.id);
 f.db.run("UPDATE portal_settings SET value='[\"999\"]' WHERE key='plex-libraries'");f.fail=false;
 await f.setup.enable(f.user.id,'admin');assert.equal(f.calls,2);assert.equal(f.setup.status(f.user.id).state,'pending');assert.deepEqual(f.setup.status(f.user.id).libraries,['101']);
});
test('an in-flight disable prevents creating the remote invitation',async()=>{
 const f=fixture();await f.setup.saveDefaults(['101'],'admin');
 f.setup.api.libraries=async()=>{f.auth.disable(f.user.id,'admin');return [{id:'101',key:'1',name:'Movies'}];};
 await assert.rejects(()=>f.setup.enable(f.user.id));assert.equal(f.calls,0);
});
test('a durable expired write lease is inspected, never blindly replayed',async()=>{
 const f=fixture();await f.setup.saveDefaults(['101'],'admin');f.db.run("UPDATE plex_setup SET attempted=1,state='sending',lease='old',lease_until=1,libraries='[\"101\"]' WHERE user_id=?",f.user.id);
 await f.setup.enable(f.user.id);assert.equal(f.calls,0);assert.equal(f.setup.status(f.user.id).state,'help');
});
test('a worker that loses its database lease cannot send an invitation',async()=>{
 const f=fixture();await f.setup.saveDefaults(['101'],'admin');
 f.setup.api.libraries=async()=>{f.db.run("UPDATE plex_setup SET lease='replacement' WHERE user_id=?",f.user.id);return [{id:'101',key:'1',name:'Movies'}];};
 await f.setup.enable(f.user.id);assert.equal(f.calls,0);
});
