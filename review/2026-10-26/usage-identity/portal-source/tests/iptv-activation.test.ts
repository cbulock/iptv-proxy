import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/core/db.ts';
import {Auth} from '../server/core/auth.ts';
import {Iptv} from '../server/core/iptv.ts';

test('activation immediately enables playback and repeated activation preserves credentials and sessions',()=>{
  const db=new Store(':memory:');try{
    const auth=new Auth(db,'key'),iptv=new Iptv(db,'key');
    const user=auth.plexSignIn({id:'person',name:'Person'},true).user;
    iptv.request(user.id);
    assert.equal(iptv.allowed(user.id),true);
    const credentials=iptv.credentials(user.id),viewer=iptv.exchange(iptv.handoff(user.id));
    iptv.request(user.id);
    assert.equal(iptv.credentials(user.id).token,credentials.token);
    assert.equal(iptv.verify(viewer.token,'viewer').allowed,true);
    assert.equal(db.get("SELECT count(*) n FROM audit WHERE action='iptv.enable' AND target=?",user.id).n,1);
  }finally{db.close();}
});

test('revoked access rejects self activation until an administrator restores it',()=>{
  const db=new Store(':memory:');try{
    const auth=new Auth(db,'key'),iptv=new Iptv(db,'key');
    const user=auth.plexSignIn({id:'person',name:'Person'},true).user;
    iptv.approve(user.id,'admin');const old=iptv.credentials(user.id);
    iptv.revoke(user.id,'admin');
    assert.throws(()=>iptv.request(user.id),/administrator/);
    assert.equal(db.get('SELECT iptv FROM grants WHERE user_id=?',user.id).iptv,'revoked');
    assert.equal(iptv.verify(old.token).allowed,false);
    iptv.approve(user.id,'admin');assert.equal(iptv.allowed(user.id),true);
    assert.notEqual(iptv.credentials(user.id).token,old.token);
  }finally{db.close();}
});

test('activation rejects disabled and missing accounts and can finish a legacy pending request',()=>{
  const db=new Store(':memory:');try{
    const auth=new Auth(db,'key'),iptv=new Iptv(db,'key');
    const user=auth.plexSignIn({id:'person',name:'Person'},true).user;
    db.run("UPDATE grants SET iptv='pending' WHERE user_id=?",user.id);
    iptv.request(user.id);assert.equal(iptv.allowed(user.id),true);
    db.run('UPDATE users SET disabled=1 WHERE id=?',user.id);
    db.run("UPDATE grants SET iptv='none' WHERE user_id=?",user.id);
    assert.throws(()=>iptv.request(user.id));
    assert.equal(db.get('SELECT iptv FROM grants WHERE user_id=?',user.id).iptv,'none');
    assert.throws(()=>iptv.request('missing'));
  }finally{db.close();}
});

test('startup migration activates only enabled pending grants and does not repeat',()=>{
  const dir=mkdtempSync(join(tmpdir(),'iptv-migration-')),path=join(dir,'db.sqlite');
  let db=new Store(path);
  try{
    const auth=new Auth(db,'key');
    for(const [id,status,disabled] of [['pending','pending',0],['disabled','pending',1],['revoked','revoked',0],['none','none',0],['approved','approved',0]] as const){
      const user=auth.plexSignIn({id,name:id},true).user;
      db.run('UPDATE users SET disabled=? WHERE id=?',disabled,user.id);
      db.run('UPDATE grants SET iptv=? WHERE user_id=?',status,user.id);
    }
    // Simulate the previous schema version without depending on a production database.
    db.run('DELETE FROM migrations WHERE version=8');db.close();db=new Store(path);
    const rows=db.all('SELECT users.plex_id,grants.iptv FROM users JOIN grants ON grants.user_id=users.id');
    assert.deepEqual(Object.fromEntries(rows.map(row=>[row.plex_id,row.iptv])),{pending:'approved',disabled:'pending',revoked:'revoked',none:'none',approved:'approved'});
    const user=db.get("SELECT id FROM users WHERE plex_id='pending'");
    const iptv=new Iptv(db,'key');assert.equal(iptv.verify(iptv.credentials(user.id).token).allowed,true);
    assert.equal(db.get("SELECT count(*) n FROM audit WHERE action='iptv.enable' AND actor='system'").n,1);
    db.run("UPDATE grants SET iptv='pending' WHERE user_id=?",user.id);
    db.close();db=new Store(path);
    assert.equal(db.get('SELECT iptv FROM grants WHERE user_id=?',user.id).iptv,'pending');
    assert.equal(db.get("SELECT count(*) n FROM audit WHERE action='iptv.enable' AND actor='system'").n,1);
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
