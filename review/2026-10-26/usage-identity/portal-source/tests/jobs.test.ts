import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/core/db.ts';
import {Auth} from '../server/core/auth.ts';
import {Jobs} from '../server/core/jobs.ts';
test('re-enqueuing a policy change while the worker runs preserves the newer job',async()=>{const db=new Store(':memory:'),auth=new Auth(db,'key');const u=auth.plexSignIn({id:'p',name:'p'},true).user;db.job('jellyfin-sync',u.id);const jobs=new Jobs(db,{async reconcile(){db.job('jellyfin-sync',u.id);}} as any,{} as any);jobs.lastSync=Date.now();await jobs.tick();assert.equal(db.get("SELECT generation FROM jobs WHERE kind='jellyfin-sync'").generation,1);});
