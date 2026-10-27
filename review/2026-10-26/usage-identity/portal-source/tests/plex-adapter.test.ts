import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Plex} from '../server/core/plex.ts';
test('an explicitly empty share catalog permits first-time setup but malformed data does not',async(t)=>{
 let xml='<MediaContainer size="0"/>';t.mock.method(globalThis,'fetch',async()=>new Response(xml));const api=new Plex('server','secret','test');
 assert.equal(await api.inspect('42'),'none');xml='<Response status="ok"/>';await assert.rejects(()=>api.inspect('42'));
});
test('catalog uses Plex sharing IDs, and invites target the immutable identity with explicit limits',async(t)=>{
 const requests:any[]=[];
 t.mock.method(globalThis,'fetch',async(url:any,options:any)=>{requests.push({url,options});return new Response(options.method==='POST'?'<MediaContainer/>':'<MediaContainer><Server machineIdentifier="server"><Section id="101" key="1" title="Movies"/></Server></MediaContainer>');});
 const api=new Plex('server','secret','test');assert.deepEqual(await api.libraries(),[{id:'101',key:'1',name:'Movies'}]);
 await api.invite('42',['101']);const body=JSON.parse(requests[1].options.body);
 assert.deepEqual(body.shared_server,{library_section_ids:['101'],invited_id:'42'});
 assert.deepEqual(body.sharing_settings,{allowSync:'0',allowCameraUpload:'0',allowChannels:'0',allowTuners:'0'});
 await assert.rejects(()=>api.invite('42',[]));assert.equal(requests.length,2);
});
test('an invitation is pending until server-specific acceptance is confirmed',async(t)=>{
 let pending='1';t.mock.method(globalThis,'fetch',async(url:any)=>new Response(String(url).endsWith('/api/users')?`<MediaContainer><User id="42"><Server machineIdentifier="server" pending="${pending}" numLibraries="1"/></User></MediaContainer>`:'<MediaContainer><SharedServer userID="42"><Section key="1" shared="1"/></SharedServer></MediaContainer>'));
 const api=new Plex('server','secret','test');assert.equal(await api.inspect('42'),'pending');pending='0';assert.equal(await api.inspect('42'),'ready');assert.equal(await api.inspect('other'),'none');
});
