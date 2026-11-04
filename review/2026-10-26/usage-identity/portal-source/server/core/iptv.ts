import {Store} from './db.ts';
import {token,hash,seal,unseal,Fault} from './crypto.ts';
import {iptvPhrase} from './iptv-words.ts';
export class Iptv {
  db:Store;key:string;now:()=>number;
  constructor(db:Store,key:string,now=Date.now){this.db=db;this.key=key;this.now=now;}
  request(id:string){this.db.transaction(()=>{
    const grant=this.db.get('SELECT grants.iptv FROM users JOIN grants ON grants.user_id=users.id WHERE users.id=? AND users.disabled=0',id);
    if(!grant)throw new Fault('User unavailable.',403);
    if(grant.iptv==='revoked')throw new Fault('Live TV access was revoked. Ask an administrator to restore it.',403);
    if(grant.iptv==='approved')return;
    const changed=this.db.run("UPDATE grants SET iptv='approved' WHERE user_id=? AND iptv IN ('none','pending')",id);
    if(!changed.changes)throw new Fault('Live TV access is unavailable.',403);
    this.db.audit(id,'iptv.enable',id);
  });}
  approve(id:string,actor:string){if(!this.db.get('SELECT id FROM users WHERE id=? AND disabled=0',id))throw new Fault('User unavailable.');this.db.run("UPDATE grants SET iptv='approved' WHERE user_id=?",id);this.rotate(id);this.db.audit(actor,'iptv.approve',id);}
  revoke(id:string,actor:string){this.db.transaction(()=>{this.db.run("UPDATE grants SET iptv='revoked',token_hash=NULL,token_cipher=NULL,phrase_hash=NULL,phrase_cipher=NULL WHERE user_id=?",id);this.db.run('DELETE FROM viewer_sessions WHERE user_id=?',id);this.db.run('UPDATE handoffs SET used=1 WHERE user_id=?',id);this.db.audit(actor,'iptv.revoke',id);});}
  allowed(id:string){return Boolean(this.db.get("SELECT users.id FROM users JOIN grants ON grants.user_id=users.id WHERE users.id=? AND users.disabled=0 AND grants.iptv='approved'",id));}
  credentials(id:string){if(!this.allowed(id))throw new Fault('Live TV access is not active.',403);const row=this.db.get('SELECT token_cipher FROM grants WHERE user_id=?',id);if(!row?.token_cipher)return this.rotate(id);return {token:unseal(row.token_cipher,this.key)};}
  rotate(id:string){if(!this.allowed(id))throw new Fault('Live TV access is not active.',403);const value=token();this.db.transaction(()=>{this.db.run('UPDATE grants SET token_hash=?,token_cipher=?,phrase_hash=NULL,phrase_cipher=NULL WHERE user_id=?',hash(value,this.key),seal(value,this.key),id);this.db.run('DELETE FROM viewer_sessions WHERE user_id=?',id);this.db.run('UPDATE handoffs SET used=1 WHERE user_id=?',id);this.db.audit(id,'iptv.rotate',id);});return {token:value};}
  appCredentials(id:string):{token:string;phrase:string}{
    return this.db.transaction(()=>{
      if(!this.allowed(id))throw new Fault('Live TV access is not active.',403);
      const row=this.db.get('SELECT token_cipher,phrase_cipher FROM grants WHERE user_id=?',id);
      const native=row.token_cipher?unseal(row.token_cipher,this.key):token();
      if(!row.token_cipher){
        this.db.run('UPDATE grants SET token_hash=?,token_cipher=? WHERE user_id=?',hash(native,this.key),seal(native,this.key),id);
        this.db.audit(id,'iptv.issue',id);
      }
      if(row.phrase_cipher)return {token:native,phrase:unseal(row.phrase_cipher,this.key)};
      for(let attempt=0;attempt<10;attempt++){
        const phrase=iptvPhrase(),digest=hash(phrase,this.key);
        if(this.db.get('SELECT user_id FROM grants WHERE phrase_hash=?',digest))continue;
        this.db.run('UPDATE grants SET phrase_hash=?,phrase_cipher=? WHERE user_id=?',digest,seal(phrase,this.key),id);
        return {token:native,phrase};
      }
      throw new Fault('Could not create app links. Please try again.',503);
    });
  }
  resolveAlias(phrase:string):{allowed:boolean;token?:string;retryAfter?:number}{
    // The budget is committed even for malformed/unknown phrases and throttled calls.
    // BEGIN IMMEDIATE serializes the counter across portal processes.
    return this.db.transaction(()=>{
      const now=this.now(),limit=this.db.get("SELECT count,expires FROM limits WHERE key='iptv:alias'");
      if(limit&&limit.expires>now&&limit.count>=60)return {allowed:false,retryAfter:Math.ceil((limit.expires-now)/1000)};
      this.db.run("INSERT INTO limits(key,count,expires) VALUES('iptv:alias',1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN limits.expires<=? THEN 1 ELSE limits.count+1 END,expires=CASE WHEN limits.expires<=? THEN excluded.expires ELSE limits.expires END",now+60000,now,now);
      if(!/^[a-z]{3,7}-[a-z]{3,7}-[a-z]{3,7}$/.test(phrase))return {allowed:false};
      const row=this.db.get('SELECT user_id,token_cipher FROM grants WHERE phrase_hash=?',hash(phrase,this.key));
      if(!row?.token_cipher||!this.allowed(row.user_id))return {allowed:false};
      return {allowed:true,token:unseal(row.token_cipher,this.key)};
    });
  }
  verify(value:string,kind='native'):{allowed:boolean;userId?:string;userName?:string}{const row=kind==='viewer'?this.db.get('SELECT viewer_sessions.user_id,users.name AS user_name FROM viewer_sessions JOIN users ON users.id=viewer_sessions.user_id WHERE viewer_sessions.hash=? AND viewer_sessions.expires>?',hash(value,this.key),this.now()):this.db.get('SELECT grants.user_id,users.name AS user_name FROM grants JOIN users ON users.id=grants.user_id WHERE grants.token_hash=?',hash(value,this.key));return row&&this.allowed(row.user_id)?{allowed:true,userId:row.user_id,userName:row.user_name}:{allowed:false};}
  handoff(id:string){if(!this.allowed(id))throw new Fault('Live TV access is not active.',403);const value=token();this.db.run('INSERT INTO handoffs(hash,user_id,expires) VALUES(?,?,?)',hash(value,this.key),id,this.now()+60000);return value;}
  exchange(code:string){return this.db.transaction(()=>{const row=this.db.get('SELECT * FROM handoffs WHERE hash=? AND used=0 AND expires>?',hash(code,this.key),this.now());if(!row||!this.allowed(row.user_id))throw new Fault('Launch link expired. Open Live TV from the portal again.',403);this.db.run('UPDATE handoffs SET used=1 WHERE hash=?',row.hash);const value=token();this.db.run('INSERT INTO viewer_sessions VALUES(?,?,?)',hash(value,this.key),row.user_id,this.now()+8*3600000);return {token:value,expiresIn:28800};});}
}
