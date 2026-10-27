import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {Store} from '../../server/core/db.ts';
import {Auth} from '../../server/core/auth.ts';
import {Iptv} from '../../server/core/iptv.ts';

test('IPTV links can be shown and replaced throughout a valid session',async()=>{
  const probe=createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));
  const port=(probe.address() as any).port;await new Promise<void>(r=>probe.close(()=>r()));
  const base=`http://127.0.0.1:${port}`,dir=mkdtempSync(join(tmpdir(),'bulock-iptv-session-'));
  const path=join(dir,'test.sqlite'),key='isolated-iptv-session-key-at-least-32-characters';
  const db=new Store(path),auth=new Auth(db,key),iptv=new Iptv(db,key);
  const session=auth.plexSignIn({id:'iptv-session-test',name:'Test viewer'},true);
  iptv.request(session.user.id);db.run('UPDATE sessions SET fresh=0 WHERE user_id=?',session.user.id);
  const child=spawn(process.execPath,[resolve('.output/server/index.mjs')],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),APP_URL:base,APP_SECRET:key,DATABASE_PATH:path,PLEX_OWNER_TOKEN:'',PLEX_OWNER_TOKEN_FILE:'',SMTP_HOST:'',JELLYFIN_API_KEY:'',JELLYFIN_API_KEY_FILE:'',IPTV_INTERNAL_KEY:'alias-integration-key',IPTV_INTERNAL_KEY_FILE:''},stdio:'ignore'});
  const headers={cookie:'bulock='+session.token,Origin:base,'Content-Type':'application/json','X-Bulock-Request':'1'};
  const post=(body={},requestHeaders:Record<string,string>=headers)=>fetch(base+'/api/iptv/credentials',{method:'POST',headers:requestHeaders,body:JSON.stringify(body)});
  try{
    let ready=false;for(let i=0;i<80;i++){try{ready=(await fetch(base+'/api/health')).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,100));}assert.ok(ready,'isolated server starts');
    const shown=await post();assert.equal(shown.status,200,'showing links accepts a sign-in older than ten minutes');
    const links=await shown.json();assert.match(links.playlist,/\/p\/[a-z]+-[a-z]+-[a-z]+$/);assert.equal(links.guide,links.playlist.replace('/p/','/g/'));
    assert.equal(shown.headers.get('cache-control'),'no-store');
    const alias=links.playlist.split('/').pop();
    const resolveAlias=(phrase=alias,authorization='Bearer alias-integration-key')=>fetch(base+'/api/internal/iptv/alias',{method:'POST',headers:{authorization,'Content-Type':'application/json'},body:JSON.stringify({phrase})});
    assert.equal((await resolveAlias(alias,'')).status,401);
    const resolved=await resolveAlias();assert.equal(resolved.status,200);assert.equal((await resolved.json()).allowed,true);
    const oldToken=iptv.credentials(session.user.id).token;
    const replaced=await post({rotate:true});assert.equal(replaced.status,200,'replacing links accepts the same valid session');
    const newLinks=await replaced.json();assert.notEqual(newLinks.playlist,links.playlist);assert.equal(iptv.verify(oldToken).allowed,false);
    assert.equal((await (await resolveAlias()).json()).allowed,false);
    assert.deepEqual(await (await post()).json(),newLinks);
    assert.equal((await post({}, {...headers,Origin:'https://untrusted.example'})).status,403);
    assert.equal((await post({}, {...headers,cookie:''})).status,401);
    db.run("UPDATE grants SET iptv='revoked' WHERE user_id=?",session.user.id);
    assert.equal((await post()).status,403);assert.equal((await post({rotate:true})).status,403);
    db.run('UPDATE sessions SET expires=0 WHERE user_id=?',session.user.id);
    assert.equal((await post()).status,401,'expired sessions still require sign-in');
    for(let i=0;i<60;i++)await resolveAlias('bad');
    const throttled=await resolveAlias(newLinks.playlist.split('/').pop());assert.equal(throttled.status,200);
    const denial=await throttled.json();assert.equal(denial.allowed,false);assert.ok(denial.retryAfter>0);
  }finally{
    child.kill();await new Promise<void>(r=>{child.once('exit',()=>r());setTimeout(r,1500).unref();});
    db.close();rmSync(dir,{recursive:true,force:true});
  }
});
