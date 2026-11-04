import {remote} from './http-client.ts';
import {Fault} from './crypto.ts';
export interface PlexAccess {libraries:string[];restricted:boolean}
export class Plex {
  serverId:string;ownerToken:string;clientId:string;
  constructor(serverId:string,ownerToken:string,clientId:string){this.serverId=serverId;this.ownerToken=ownerToken;this.clientId=clientId;}
  headers(value?:string){return {'Accept':'application/json','X-Plex-Product':'Bulock Media','X-Plex-Version':'1.0','X-Plex-Client-Identifier':this.clientId,...(value?{'X-Plex-Token':value}:{})};}
  async pin(){return remote('https://plex.tv/api/v2/pins?strong=true',{method:'POST',headers:this.headers()});}
  async poll(id:string){return remote(`https://plex.tv/api/v2/pins/${encodeURIComponent(id)}`,{headers:this.headers()});}
  async identity(value:string){const p=await remote('https://plex.tv/api/v2/user',{headers:this.headers(value)});if(p.restricted||p.guest||!p.id)throw new Fault('Use an independent Plex account, not a managed profile.',403);return {id:String(p.id),name:p.username||p.title||'Plex user',email:typeof p.email==='string'?p.email:undefined};}
  async hasAccess(value:string){if(!this.serverId)throw new Fault('Plex server has not been configured.',503);const list=await remote('https://plex.tv/api/v2/resources?includeHttps=1',{headers:this.headers(value)});return Array.isArray(list)&&list.some((r:any)=>r.clientIdentifier===this.serverId&&String(r.provides).includes('server'));}
  async shares(){if(!this.ownerToken||!this.serverId)throw new Fault('Plex library synchronization is not configured.',503);const result=await remote(`https://plex.tv/api/servers/${encodeURIComponent(this.serverId)}/shared_servers`,{headers:this.headers(this.ownerToken)});const list=result?.MediaContainer?.SharedServer??result?.sharedServers??(String(result?.MediaContainer?.size)==='0'?[]:result);if(!Array.isArray(list))throw new Fault('Plex sharing data needs administrator review.',503);return list;}
  async libraries():Promise<{id:string;key:string;name:string}[]>{
    if(!this.ownerToken||!this.serverId)throw new Fault('Plex sharing is not configured.',503);
    const result=await remote(`https://plex.tv/api/servers/${encodeURIComponent(this.serverId)}`,{headers:this.headers(this.ownerToken)});
    const servers=result?.MediaContainer?.Server;const server=Array.isArray(servers)?servers.find((s:any)=>s.machineIdentifier===this.serverId):servers;
    const sections=server?.Section;
    if(!Array.isArray(sections)||sections.some((l:any)=>!l.id||!l.key||!l.title))throw new Fault('Plex library catalog needs administrator review.',503);
    return sections.map((l:any)=>({id:String(l.id),key:String(l.key),name:l.title}));
  }
  async inspect(id:string):Promise<'none'|'pending'|'ready'>{
    const shares=await this.shares();const share=shares.find((s:any)=>String(s.userID??s.userId)===id);
    if(!share)return 'none';
    // A share alone is not proof that its invitation was accepted. The owner's
    // users endpoint supplies the server-specific pending flag and library count.
    const result=await remote('https://plex.tv/api/users',{headers:this.headers(this.ownerToken)});
    const users=result?.MediaContainer?.User;if(!Array.isArray(users))throw new Fault('Plex users could not be verified.',503);
    const user=users.find((u:any)=>String(u.id)===id);const servers=user?.Server;
    const server=Array.isArray(servers)?servers.find((s:any)=>s.machineIdentifier===this.serverId):servers?.machineIdentifier===this.serverId?servers:null;
    if(server&&[false,0,'0'].includes(server.pending)&&Number(server.numLibraries)>0)return 'ready';
    return 'pending';
  }
  async invite(id:string,libraries:string[]){
    if(!this.ownerToken||!this.serverId||!/^\d+$/.test(id)||!libraries.length||libraries.some(l=>!/^\d+$/.test(l)))throw new Fault('Plex invitation configuration needs review.');
    return remote(`https://plex.tv/api/servers/${encodeURIComponent(this.serverId)}/shared_servers`,{method:'POST',headers:{...this.headers(this.ownerToken),'Content-Type':'application/json'},body:JSON.stringify({server_id:this.serverId,shared_server:{library_section_ids:libraries,invited_id:id},sharing_settings:{allowSync:'0',allowCameraUpload:'0',allowChannels:'0',allowTuners:'0'}})});
  }
  async access(id:string):Promise<PlexAccess>{const list=await this.shares();const share=list.find((s:any)=>String(s.userID??s.userId)===id);if(!share)return {libraries:[],restricted:false};const sections=share.Section??share.sections;if(!Array.isArray(sections))throw new Fault('Plex library access could not be verified.',503);const restrictive=['filterMovies','filterTelevision','filterMusic','filterPhotos'];const restricted=restrictive.some(k=>Boolean(share[k]))||Boolean(share.restricted)||Boolean(share.allLibraries);return {libraries:sections.filter((s:any)=>s.shared===true||s.shared===1||s.shared==='1').map((s:any)=>String(s.key??s.id)),restricted};}
}
