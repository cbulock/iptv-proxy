import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHmac} from 'node:crypto';
import assert from 'node:assert/strict';
const db=new DatabaseSync(process.env.DATABASE_PATH),key=process.env.APP_SECRET;
const hash=value=>createHmac('sha256',key).update(value).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
const id='integration-check-'+token(),native=token(),handoff=token();
const base='http://iptv-gateway:3400';
const fetchTimed=(url,options={})=>fetch(url,{...options,signal:AbortSignal.timeout(45000)});
try{
  db.prepare('INSERT INTO users(id,name,role,created) VALUES(?,?,?,?)').run(id,'Temporary IPTV integration check','user',Date.now());
  db.prepare('INSERT INTO grants(user_id,iptv,token_hash) VALUES(?,?,?)').run(id,'approved',hash(native));
  db.prepare('INSERT INTO handoffs(hash,user_id,expires) VALUES(?,?,?)').run(hash(handoff),id,Date.now()+60000);
  assert.equal((await fetchTimed(base+'/media/v/invalid/lineup.m3u')).status,403);
  const lineup=await fetchTimed(base+'/media/v/'+native+'/lineup.m3u');assert.equal(lineup.status,200);
  const urls=(await lineup.text()).split(/\r?\n/).filter(x=>x&&!x.startsWith('#'));
  assert.ok(urls.length);assert.ok(urls.every(x=>x.startsWith('https://iptv.bulock.house/media/v/'+native+'/')));
  console.log('Protected playlist:',urls.length,'channels; invalid credentials rejected.');
  const headers={Origin:'https://iptv.bulock.house','X-Bulock-Request':'1','Content-Type':'application/json'};
  const exchange=await fetchTimed(base+'/portal-launch',{method:'POST',headers,body:JSON.stringify({code:handoff})});assert.equal(exchange.status,200);
  const cookie=exchange.headers.get('set-cookie').split(';')[0];assert.ok(exchange.headers.get('set-cookie').includes('Secure'));
  assert.notEqual((await fetchTimed(base+'/portal-launch',{method:'POST',headers,body:JSON.stringify({code:handoff})})).status,200);
  assert.equal((await fetchTimed(base+'/',{headers:{Cookie:cookie}})).status,200);
  assert.equal((await fetchTimed(base+'/api/fetch-playlist',{headers:{Cookie:cookie}})).status,403);
  assert.equal((await fetchTimed(base+'/media/stream/a/b?upstream=http://example.com',{headers:{Cookie:cookie}})).status,403);
  console.log('Browser handoff is single-use; viewer loads; arbitrary URL fetch is blocked.');
  const chosen=urls.find(x=>x.includes('/Antenna/'))||urls.find(x=>x.includes('/Tunarr/'))||urls[0];
  const path=new URL(chosen).pathname;
  const stream=await fetchTimed(base+path);assert.equal(stream.status,200);
  const reader=stream.body.getReader();const chunk=await reader.read();assert.ok(chunk.value?.length);
  console.log('Live stream delivered media bytes. Revoking access...');
  const start=Date.now();db.prepare("UPDATE grants SET iptv='revoked',token_hash=NULL WHERE user_id=?").run(id);
  let ended=false;try{while(true){const next=await reader.read();if(next.done){ended=true;break;}}}catch{ended=true;}
  assert.ok(ended);assert.ok(Date.now()-start<60000);
  assert.equal((await fetchTimed(base+'/media/lineup.m3u',{headers:{Cookie:cookie}})).status,403);
  console.log('Revocation closed active playback in',Math.round((Date.now()-start)/1000),'seconds; viewer access revoked.');
}finally{
  db.prepare('DELETE FROM handoffs WHERE user_id=?').run(id);db.prepare('DELETE FROM viewer_sessions WHERE user_id=?').run(id);db.prepare('DELETE FROM grants WHERE user_id=?').run(id);db.prepare('DELETE FROM users WHERE id=?').run(id);db.close();
}
