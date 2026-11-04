import {Store} from './db.ts';
import {Fault,token} from './crypto.ts';
import {remote} from './http-client.ts';
import type {PlexAccess} from './plex.ts';
export function resolvePolicy(access:PlexAccess,mappings:{plex_id:string;jellyfin_id:string}[]){if(access.restricted)throw new Fault('Plex restrictions need administrator review before Jellyfin can be enabled.',409);const result=access.libraries.map(id=>{const match=mappings.find(m=>m.plex_id===id);if(!match)throw new Fault('A Plex library has not been mapped to Jellyfin yet.',409);return match.jellyfin_id;});if(!result.length)throw new Fault('No approved Jellyfin libraries. Ask the administrator for access.',409);return [...new Set(result)];}
export class JellyfinApi {
  base:string;key:string;
  constructor(base:string,key:string){this.base=base.replace(/\/$/,'');this.key=key;}
  call(path:string,method='GET',body?:unknown){if(!this.key)throw new Fault('Jellyfin is not configured.',503);return remote(this.base+path,{method,headers:{Authorization:`MediaBrowser Token="${this.key}"`,'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});}
  create(name:string){return this.call('/Users/New','POST',{Name:name,Password:token()});}
  policy(id:string,policy:unknown){return this.call(`/Users/${encodeURIComponent(id)}/Policy`,'POST',policy);}
  password(id:string,password:string){return this.call(`/Users/${encodeURIComponent(id)}/Password`,'POST',{ResetPassword:false,NewPw:password});}
  libraries(){return this.call('/Library/VirtualFolders');}
}
export function policy(libraries:string[],disabled=false){return {IsAdministrator:false,IsDisabled:disabled,IsHidden:true,EnableAllFolders:false,EnabledFolders:libraries,EnableRemoteAccess:true,EnableMediaPlayback:true,EnableAudioPlaybackTranscoding:true,EnableVideoPlaybackTranscoding:true,EnablePlaybackRemuxing:true,EnableContentDeletion:false,EnableContentDownloading:false,EnableAllDevices:true,EnableLiveTvAccess:false,EnableLiveTvManagement:false,EnableSharedDeviceControl:false,EnableRemoteControlOfOtherUsers:false,EnableUserPreferenceAccess:true};}
export class JellyfinService {
  db:Store;api:any;access:(id:string)=>Promise<PlexAccess>;locks:Set<string>=new Set();
  constructor(db:Store,api:any,access:(id:string)=>Promise<PlexAccess>){this.db=db;this.api=api;this.access=access;}
  async librariesFor(id:string){const row=this.db.get('SELECT grants.*,users.plex_id,users.disabled FROM grants JOIN users ON users.id=grants.user_id WHERE user_id=?',id);if(!row||row.disabled)throw new Fault('Account unavailable.',403);if(row.policy_source==='blocked')throw new Fault('Ask the administrator to restore your Jellyfin access.',403);if(row.policy_source==='manual'){const libs=JSON.parse(row.libraries);if(!libs.length)throw new Fault('Ask the administrator to choose your Jellyfin libraries.',409);return libs;}if(!row.plex_id)throw new Fault('Ask the administrator to choose your Jellyfin libraries.',409);return resolvePolicy(await this.access(row.plex_id),this.db.all('SELECT * FROM mappings'));}
  fingerprint(id:string){return JSON.stringify({grant:this.db.get('SELECT libraries,policy_source FROM grants WHERE user_id=?',id),user:this.db.get('SELECT disabled,plex_id FROM users WHERE id=?',id),mappings:this.db.all('SELECT * FROM mappings ORDER BY plex_id')});}
  async applyCurrent(id:string,remoteId:string){for(let attempt=0;attempt<3;attempt++){const before=this.fingerprint(id);const libraries=await this.librariesFor(id);if(before!==this.fingerprint(id))continue;await this.api.policy(remoteId,policy(libraries));if(before===this.fingerprint(id))return;}throw new Fault('Access changed during setup. Please try again.',409);}
  async provision(id:string,name:string,password:string){if(this.locks.has(id))throw new Fault('Setup is already running.',409);this.locks.add(id);try{
    if(!/^[a-zA-Z0-9_.-]{3,40}$/.test(name)||password.length<12||password.length>128)throw new Fault('Use a 3–40 character username and a password of at least 12 characters.');
    const libraries=await this.librariesFor(id);let row=this.db.get('SELECT * FROM grants WHERE user_id=?',id);
    if(!row.jellyfin_id){if(['creating','needs-review'].includes(row.jellyfin_state))throw new Fault('A previous setup needs administrator review before retrying.',409);
      this.db.run("UPDATE grants SET jellyfin_state='creating',jellyfin_name=? WHERE user_id=?",name,id);
      try {const result=await this.api.create(name);if(!result?.Id)throw Error('No ID');this.db.run("UPDATE grants SET jellyfin_id=?,jellyfin_state='setup' WHERE user_id=?",result.Id,id);row={...row,jellyfin_id:result.Id};}catch{this.db.run("UPDATE grants SET jellyfin_state='needs-review' WHERE user_id=?",id);throw new Fault('Account creation could not be confirmed. Ask the administrator to review it before retrying.',409);}
    }
    await this.api.policy(row.jellyfin_id,policy([],true));
    await this.api.password(row.jellyfin_id,password);
    // Re-read state after remote calls: an administrator may have disabled the user.
    await this.applyCurrent(id,row.jellyfin_id);
    if(this.db.get('SELECT disabled FROM users WHERE id=?',id)?.disabled){await this.disable(id);throw new Fault('Account disabled.',403);}
    this.db.run("UPDATE grants SET jellyfin_state='ready' WHERE user_id=?",id);this.db.run("DELETE FROM jobs WHERE kind='jellyfin-disable' AND user_id=?",id);this.db.audit(id,'jellyfin.setup',id);
  }catch(e){const row=this.db.get('SELECT jellyfin_id FROM grants WHERE user_id=?',id);if(row?.jellyfin_id){this.db.run("UPDATE grants SET jellyfin_state='setup' WHERE user_id=?",id);this.db.job('jellyfin-disable',id);}throw e;}finally{this.locks.delete(id);}}
  async reset(id:string,password:string){if(password.length<12||password.length>128)throw new Fault('Use a password of 12–128 characters.');const row=this.db.get("SELECT jellyfin_id FROM grants WHERE user_id=? AND jellyfin_state='ready'",id);if(!row?.jellyfin_id)throw new Fault('Finish Jellyfin setup first.');await this.api.password(row.jellyfin_id,password);this.db.audit(id,'jellyfin.password',id);}
  async disable(id:string){if(this.locks.has(id))throw new Fault('Account update is already running.',409);this.locks.add(id);try{const row=this.db.get('SELECT jellyfin_id FROM grants WHERE user_id=?',id);if(row?.jellyfin_id)await this.api.policy(row.jellyfin_id,policy([],true));this.db.run("UPDATE grants SET jellyfin_state=CASE WHEN jellyfin_id IS NULL THEN jellyfin_state ELSE 'disabled' END WHERE user_id=?",id);}finally{this.locks.delete(id);}}
  async reconcile(id:string){if(this.locks.has(id))throw new Fault('Account update is already running.',409);const row=this.db.get('SELECT * FROM grants WHERE user_id=?',id);if(!row?.jellyfin_id||!['ready','suspended'].includes(row.jellyfin_state))return;this.locks.add(id);try{await this.applyCurrent(id,row.jellyfin_id);this.db.run("UPDATE grants SET jellyfin_state='ready' WHERE user_id=?",id);}catch(e){await this.api.policy(row.jellyfin_id,policy([],true));this.db.run("UPDATE grants SET jellyfin_state='suspended' WHERE user_id=?",id);throw e;}finally{this.locks.delete(id);}}
}
