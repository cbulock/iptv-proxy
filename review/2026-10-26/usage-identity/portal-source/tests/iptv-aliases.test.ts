import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {Store} from '../server/core/db.ts';
import {Auth} from '../server/core/auth.ts';
import {Iptv} from '../server/core/iptv.ts';
import {hash} from '../server/core/crypto.ts';
import {invalidateRestored} from '../server/core/restore.ts';
import {iptvWords,iptvPhrase} from '../server/core/iptv-words.ts';

test('phrase inventory is distinct, short and large enough for online aliases',()=>{
 assert.ok(iptvWords.length>=4096);assert.equal(new Set(iptvWords).size,iptvWords.length);
 assert.ok(iptvWords.every(word=>/^[a-z]{3,7}$/.test(word)));
 const phrase=iptvPhrase();assert.equal(phrase.split('-').length,3);assert.ok(phrase.split('-').every(word=>iptvWords.includes(word)));
});

function setup(db=new Store(':memory:'),now=()=>1000){const iptv=new Iptv(db,'key',now),auth=new Auth(db,'key');const user=auth.plexSignIn({id:'phrase-viewer',name:'Viewer'},true).user;iptv.request(user.id);return {db,iptv,user};}

test('phrase issuance is stable, encrypted and preserves native credentials and viewers',()=>{
 const {db,iptv,user}=setup();try{
  const native=iptv.credentials(user.id),viewer=iptv.exchange(iptv.handoff(user.id));
  const first=iptv.appCredentials(user.id);assert.match(first.phrase,/^[a-z]+-[a-z]+-[a-z]+$/);
  assert.equal(first.token,native.token);assert.deepEqual(iptv.appCredentials(user.id),first);
  assert.equal(iptv.verify(viewer.token,'viewer').allowed,true);
  const stored=db.get('SELECT phrase_hash,phrase_cipher FROM grants WHERE user_id=?',user.id);
  assert.equal(stored.phrase_hash,hash(first.phrase,'key'));assert.ok(!stored.phrase_cipher.includes(first.phrase));
  assert.deepEqual(iptv.resolveAlias(first.phrase),{allowed:true,token:native.token});
 }finally{db.close();}
});

test('first app setup preserves a browser viewer even when no native token exists yet',()=>{
 const {db,iptv,user}=setup();try{
  const viewer=iptv.exchange(iptv.handoff(user.id));assert.equal(db.get('SELECT token_hash FROM grants WHERE user_id=?',user.id).token_hash,null);
  const app=iptv.appCredentials(user.id);assert.equal(iptv.verify(viewer.token,'viewer').allowed,true);
  assert.equal(iptv.verify(app.token).allowed,true);
 }finally{db.close();}
});

test('concurrent first issuance in separate processes returns one stable phrase and native token',{timeout:10000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'iptv-phrase-concurrent-')),path=join(dir,'db.sqlite');
 const {db,user}=setup(new Store(path));db.close();
 const code=`import {Store} from ${JSON.stringify(pathToFileURL(resolve('server/core/db.ts')).href)};
 import {Iptv} from ${JSON.stringify(pathToFileURL(resolve('server/core/iptv.ts')).href)};
 process.once('message',()=>{const db=new Store(process.argv[1]);try{process.send(new Iptv(db,'key').appCredentials(process.argv[2]));}finally{db.close();process.disconnect();}});process.send('ready');`;
 const workers=Array.from({length:2},()=>{
  const child=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',code,path,user.id],{stdio:['ignore','ignore','pipe','ipc']});
  let errors='';child.stderr!.on('data',chunk=>errors+=chunk);
  const ready=new Promise<void>((resolve,reject)=>{child.once('message',message=>message==='ready'?resolve():reject(new Error('Unexpected worker message')));child.once('error',reject);child.once('close',()=>reject(new Error(errors||'Worker exited before readiness')));});
  const exited=new Promise<void>(resolve=>child.once('close',()=>resolve()));
  return {child,ready,exited,error:()=>errors};
 });
 try{
  await Promise.all(workers.map(w=>w.ready));
  const results=workers.map(w=>new Promise<any>((resolve,reject)=>{w.child.once('message',resolve);w.child.once('error',reject);w.child.once('close',()=>reject(new Error(w.error()||'Worker exited before issuing credentials')));}));
  workers.forEach(w=>w.child.send('issue'));
  const values=await Promise.all(results);assert.deepEqual(values[0],values[1]);
  assert.match(values[0].phrase,/^[a-z]+-[a-z]+-[a-z]+$/);
  await Promise.all(workers.map(w=>w.exited));
 }finally{workers.forEach(w=>w.child.kill());await Promise.all(workers.map(w=>w.exited));rmSync(dir,{recursive:true,force:true});}
});

test('phrase generation retries a collision without changing the native token',()=>{
 const {db,iptv,user}=setup();try{
  const native=iptv.credentials(user.id),read=db.get.bind(db);let collided='';
  const lookup=mock.method(db,'get',(sql:string,...args:any[])=>{
   if(sql==='SELECT user_id FROM grants WHERE phrase_hash=?'&&!collided){collided=args[0];return {user_id:'another-user'};}
   return read(sql,...args);
  });
  const app=iptv.appCredentials(user.id);lookup.mock.restore();
  assert.ok(collided);assert.notEqual(hash(app.phrase,'key'),collided);assert.equal(app.token,native.token);
  assert.equal(iptv.resolveAlias(app.phrase).allowed,true);
 }finally{db.close();}
});

test('rotation, revocation, disablement and restoration cannot resurrect an old phrase',()=>{
 const {db,iptv,user}=setup();try{
  const old=iptv.appCredentials(user.id);db.run('UPDATE users SET disabled=1 WHERE id=?',user.id);
  assert.equal(iptv.resolveAlias(old.phrase).allowed,false);assert.throws(()=>iptv.appCredentials(user.id));
  db.run('UPDATE users SET disabled=0 WHERE id=?',user.id);iptv.rotate(user.id);
  const next=iptv.appCredentials(user.id);assert.notEqual(next.phrase,old.phrase);assert.notEqual(next.token,old.token);
  assert.equal(iptv.resolveAlias(old.phrase).allowed,false);iptv.revoke(user.id,'admin');
  assert.equal(iptv.resolveAlias(next.phrase).allowed,false);assert.equal(db.get('SELECT phrase_cipher FROM grants WHERE user_id=?',user.id).phrase_cipher,null);
  iptv.approve(user.id,'admin');const restored=iptv.appCredentials(user.id);assert.notEqual(restored.phrase,next.phrase);
  invalidateRestored(db);assert.equal(iptv.resolveAlias(restored.phrase).allowed,false);
  assert.equal(db.get('SELECT phrase_hash FROM grants WHERE user_id=?',user.id).phrase_hash,null);
 }finally{db.close();}
});

test('alias lookup budget counts all attempts before lookup, persists and resets after a minute',()=>{
 const dir=mkdtempSync(join(tmpdir(),'iptv-phrase-')),path=join(dir,'db.sqlite');let now=1000;
 let db=new Store(path);try{
  let {iptv,user}=setup(db,()=>now);const creds=iptv.appCredentials(user.id);
  for(let i=0;i<59;i++)assert.equal(iptv.resolveAlias(i%2?'malformed':creds.phrase).allowed,i%2===0);
  db.close();db=new Store(path);iptv=new Iptv(db,'key',()=>now);
  assert.equal(iptv.appCredentials(user.id).phrase,creds.phrase);assert.equal(iptv.resolveAlias(creds.phrase).allowed,true);
  const blocked=iptv.resolveAlias(creds.phrase);assert.equal(blocked.allowed,false);assert.equal(blocked.retryAfter,60);
  assert.equal(iptv.verify(creds.token).allowed,true);now+=59000;assert.equal(iptv.resolveAlias(creds.phrase).retryAfter,1);
  now+=1000;assert.equal(iptv.resolveAlias(creds.phrase).allowed,true);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('startup migration adds aliases without changing existing grants or native credentials',()=>{
 const dir=mkdtempSync(join(tmpdir(),'iptv-phrase-migration-')),path=join(dir,'db.sqlite');let db=new Store(path);
 try{
  const {iptv,user}=setup(db);const native=iptv.credentials(user.id);
  db.db.exec('DROP INDEX grants_phrase_hash; ALTER TABLE grants DROP COLUMN phrase_hash; ALTER TABLE grants DROP COLUMN phrase_cipher; DELETE FROM migrations WHERE version=9;');
  db.close();db=new Store(path);assert.ok(db.get('SELECT version FROM migrations WHERE version=9'));
  const alias=new Iptv(db,'key').appCredentials(user.id);assert.equal(alias.token,native.token);
  assert.equal(db.get('SELECT iptv FROM grants WHERE user_id=?',user.id).iptv,'approved');
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
