import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/core/db.ts';

test('migration preserves legacy identities and flows; access history survives reopen',()=>{
 const dir=mkdtempSync(join(tmpdir(),'plex-migration-')),path=join(dir,'portal.sqlite');
 const old=new DatabaseSync(path);
 old.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE,plex_id TEXT UNIQUE,role TEXT NOT NULL DEFAULT 'user',disabled INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL);
 INSERT INTO users VALUES('legacy','Existing viewer','viewer@example.com','42','user',0,1);
 CREATE TABLE plex_flows(id TEXT PRIMARY KEY,pin_id TEXT NOT NULL,code TEXT NOT NULL,user_id TEXT,expires INTEGER NOT NULL);
 INSERT INTO plex_flows VALUES('flow','pin','code','legacy',9999999999999);`);old.close();
 try{
  let db=new Store(path);assert.equal(db.get('SELECT plex_id FROM users').plex_id,'42');assert.equal(db.get('SELECT eligible FROM plex_setup').eligible,0);
  assert.equal(db.get('SELECT return_to FROM plex_flows').return_to,'/');
  db.run("UPDATE plex_setup SET ever_ready=1,attempted=1,state='help',libraries='[\"101\"]' WHERE user_id='legacy'");db.close();
  db=new Store(path);assert.equal(db.get('SELECT ever_ready FROM plex_setup').ever_ready,1);assert.equal(db.get('SELECT attempted FROM plex_setup').attempted,1);assert.equal(db.all('SELECT * FROM plex_setup').length,1);db.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
