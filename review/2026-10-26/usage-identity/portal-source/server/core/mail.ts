import nodemailer from 'nodemailer';
import {randomUUID} from 'node:crypto';
import {Store} from './db.ts';
import {seal,unseal,Fault} from './crypto.ts';
import {loginEmail,invitationEmail} from './email-template.ts';
import {returnPath} from '../../shared/return-path.ts';
export class Mail {
  db:Store;cfg:any;
  constructor(db:Store,cfg:any){this.db=db;this.cfg=cfg;}
  queue(to:string,subject:string,text:string,challengeId?:string,html?:string){if(!this.cfg.smtpHost||!this.cfg.smtpUser||!this.cfg.smtpPassword)throw new Fault('Email delivery is not configured. Please use Plex or contact the administrator.',503);const id=randomUUID();this.db.run('INSERT INTO jobs(id,kind,payload,next) VALUES(?,?,?,?)',id,'email',seal(JSON.stringify({to,subject,text,html,challengeId}),this.cfg.key),Date.now());}
  login(c:{id:string;email:string;code:string;link:string},next:unknown='/'){const destination=returnPath(next);const url=`${this.cfg.base}/login${destination==='/'?'':'?returnTo='+encodeURIComponent(destination)}#challenge=${encodeURIComponent(c.id)}&proof=${encodeURIComponent(c.link)}`;const content=loginEmail(url,c.code);this.queue(c.email,'Sign in to Bulock Media',content.text,c.id,content.html);}
  invite(email:string){const content=invitationEmail(`${this.cfg.base}/login`);this.queue(email,'You’re invited to Bulock Media',content.text,undefined,content.html);}
  async deliver(payload:string){const message=JSON.parse(unseal(payload,this.cfg.key));if(message.challengeId&&!this.db.get('SELECT id FROM challenges WHERE id=? AND used=0 AND expires>?',message.challengeId,Date.now()))return;
    const transport=nodemailer.createTransport({host:this.cfg.smtpHost,port:this.cfg.smtpPort,secure:this.cfg.smtpPort===465,requireTLS:true,auth:{user:this.cfg.smtpUser,pass:this.cfg.smtpPassword},connectionTimeout:10000,socketTimeout:15000});
    const escaped=message.text.replace(/[&<>"']/g,(c:string)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
    // Preserve older queued messages while new messages use the structured template.
    const html=message.html||`<div style="font-family:Arial,sans-serif;line-height:1.7;padding:24px;max-width:560px">${escaped.replace(/(https?:\/\/[^\s]+)/g,'<a href="$1" style="color:#244f42">Continue to Bulock Media</a>').replace(/\n/g,'<br>')}</div>`;
    const result=await transport.sendMail({from:this.cfg.sender,to:{name:'',address:message.to},disableFileAccess:true,disableUrlAccess:true,subject:message.subject,text:message.text,html});
    if(message.recipientId&&!result.accepted?.length)throw Object.assign(new Error('Recipient not accepted.'),{code:'EENVELOPE'});
  }
}
