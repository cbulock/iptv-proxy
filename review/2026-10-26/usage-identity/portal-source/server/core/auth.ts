import { randomInt, randomUUID } from 'node:crypto';
import {z} from 'zod';
import { Store } from './db.ts';
import { token,hash,equal,Fault } from './crypto.ts';
export interface User {id:string;name:string;email:string|null;plex_id:string|null;role:string;disabled:number;created:number}
export class Auth {
  db:Store;key:string;now:()=>number;owner:string;
  constructor(db:Store,key:string,now=Date.now,owner=''){this.db=db;this.key=key;this.now=now;this.owner=owner;}
  email(value:string){const email=value.trim().toLowerCase();if(!z.email().safeParse(email).success||email.length>254)throw new Fault('Enter a valid email address.');return email;}
  limit(key:string,max=10,window=600000){const now=this.now();this.db.run('DELETE FROM limits WHERE expires<=?',now);this.db.run('INSERT INTO limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',key,now+window);if(this.db.get('SELECT count FROM limits WHERE key=?',key).count>max)throw new Fault('Too many attempts. Please try again later.',429);}
  invite(raw:string,actor:string){const email=this.email(raw);this.db.run('INSERT INTO invites VALUES(?,?,?) ON CONFLICT(email) DO UPDATE SET expires=excluded.expires,actor=excluded.actor',email,this.now()+7*86400000,actor);this.db.audit(actor,'invite',email);return email;}
  issueEmail(raw:string,userId?:string){
    const email=this.email(raw);const existing=this.db.get('SELECT * FROM users WHERE email=?',email);
    if(userId){const current=this.db.get('SELECT * FROM users WHERE id=? AND disabled=0',userId);if(!current)throw new Fault('Sign in again.',401);if(existing&&existing.id!==userId)throw new Fault('This address is already linked to another account.');}
    else if(existing?.disabled||(!existing&&!this.db.get('SELECT email FROM invites WHERE email=? AND expires>?',email,this.now())))return null;
    const id=token(),code=String(randomInt(100000,1000000)),link=token();
    this.db.transaction(()=>{this.db.run('UPDATE challenges SET used=1 WHERE email=?',email);this.db.run('INSERT INTO challenges(id,email,user_id,code_hash,link_hash,expires) VALUES(?,?,?,?,?,?)',id,email,userId||null,hash(code,this.key),hash(link,this.key),this.now()+600000);});
    return {id,code,link,email};
  }
  consumeEmail(id:string,proof:string,linkUserId?:string){
    // Persist failures outside the consumption transaction so rollback cannot undo lockout.
    const c=this.db.get('SELECT * FROM challenges WHERE id=?',id);
    if(!c||c.used||c.expires<=this.now()||c.attempts>=5)throw new Fault('This sign-in has expired or was already used.');
    if(c.user_id&&c.user_id!==linkUserId)throw new Fault('Use the browser where you started linking your email.');
    if(!equal(hash(proof,this.key),c.code_hash)&&!equal(hash(proof,this.key),c.link_hash)){this.db.run('UPDATE challenges SET attempts=attempts+1 WHERE id=?',id);throw new Fault('The code is incorrect.');}
    return this.db.transaction(()=>{
      const changed=this.db.run('UPDATE challenges SET used=1 WHERE id=? AND used=0 AND expires>? AND attempts<5',id,this.now());if(!changed.changes)throw new Fault('This sign-in was already used.');
      let user:User;
      if(c.user_id){const conflict=this.db.get('SELECT id FROM users WHERE email=? AND id<>?',c.email,c.user_id);if(conflict)throw new Fault('Email is already linked.');user=this.db.get('SELECT * FROM users WHERE id=? AND disabled=0',c.user_id);if(!user)throw new Fault('Account unavailable.',403);this.db.run('UPDATE users SET email=? WHERE id=?',c.email,user.id);this.db.audit(user.id,'email.link',user.id);user={...user,email:c.email};}
      else {user=this.db.get('SELECT * FROM users WHERE email=?',c.email);if(!user){if(!this.db.get('SELECT * FROM invites WHERE email=? AND expires>?',c.email,this.now()))throw new Fault('An invitation is required.',403);user=this.create(c.email.split('@')[0],c.email,null);this.db.run('INSERT OR IGNORE INTO plex_setup(user_id,eligible) VALUES(?,1)',user.id);this.db.run('DELETE FROM invites WHERE email=?',c.email);}if(user.disabled)throw new Fault('Account disabled.',403);}
      return this.newSession(user);
    });
  }
  create(name:string,email:string|null,plexId:string|null):User{const id=randomUUID();this.db.run('INSERT INTO users(id,name,email,plex_id,role,created) VALUES(?,?,?,?,?,?)',id,name,email,plexId,plexId&&plexId===this.owner?'admin':'user',this.now());this.db.run('INSERT INTO grants(user_id) VALUES(?)',id);return this.db.get('SELECT * FROM users WHERE id=?',id);}
  plexSignIn(profile:{id:string;name:string;email?:string},hasAccess:boolean,linkUserId?:string){
    return this.db.transaction(()=>{let user:User=this.db.get('SELECT * FROM users WHERE plex_id=?',profile.id);
      if(linkUserId){if(user&&user.id!==linkUserId)throw new Fault('This Plex account is already linked to another person.');user=this.db.get('SELECT * FROM users WHERE id=? AND disabled=0',linkUserId);if(!user||user.plex_id&&user.plex_id!==profile.id)throw new Fault('Cannot link this Plex account.');this.db.run('UPDATE users SET plex_id=?,role=? WHERE id=?',profile.id,profile.id===this.owner?'admin':user.role,user.id);user=this.db.get('SELECT * FROM users WHERE id=?',user.id);this.db.audit(user.id,'plex.link',profile.id);}
      if(!user){if(!hasAccess&&profile.id!==this.owner)throw new Fault('You need server access or an email invitation.',403);user=this.create(profile.name,null,profile.id);}
      if(user.disabled)throw new Fault('Account disabled.',403);
      if(hasAccess){this.db.run('INSERT OR IGNORE INTO plex_setup(user_id) VALUES(?)',user.id);this.db.run("UPDATE plex_setup SET ever_ready=1,state='ready',checked=? WHERE user_id=?",this.now(),user.id);}
      let suggestedEmail:string|null=null;try{if(profile.email)suggestedEmail=this.email(profile.email);}catch{/* An unusable provider address must not block Plex sign-in. */}
      this.db.run('UPDATE users SET plex_email=? WHERE id=?',suggestedEmail,user.id);
      user=this.db.get('SELECT * FROM users WHERE id=?',user.id);return this.newSession(user);
    });
  }
  newSession(user:User){const value=token();this.db.run('INSERT INTO sessions VALUES(?,?,?,?)',hash(value,this.key),user.id,this.now()+30*86400000,this.now());return {token:value,user};}
  session(value:string): (User & {fresh:number})|null{return this.db.get('SELECT users.*,sessions.fresh FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.hash=? AND sessions.expires>? AND users.disabled=0',hash(value,this.key),this.now())||null;}
  logout(value:string){this.db.run('DELETE FROM sessions WHERE hash=?',hash(value,this.key));}
  recent(user:User&{fresh:number}){if(this.now()-user.fresh>600000)throw new Fault('Please sign in again before changing account security.',401);}
  disable(id:string,actor:string){this.db.transaction(()=>{this.db.run('UPDATE users SET disabled=1 WHERE id=?',id);this.db.run('DELETE FROM sessions WHERE user_id=?',id);this.db.run('DELETE FROM viewer_sessions WHERE user_id=?',id);this.db.run('UPDATE grants SET token_hash=NULL,token_cipher=NULL,iptv=\'revoked\',policy_source=\'blocked\' WHERE user_id=?',id);this.db.run('UPDATE handoffs SET used=1 WHERE user_id=?',id);this.db.job('jellyfin-disable',id);this.db.audit(actor,'user.disable',id);});}
}
