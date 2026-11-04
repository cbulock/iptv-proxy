import {z} from 'zod';
import {returnPath} from '../../shared/return-path';
import {runtime} from '../utils/runtime';
import {Fault,token,hash,equal} from '../core/crypto';
import {Communications} from '../core/communications';
const text=z.string().trim().min(1).max(254), id=z.string().min(1).max(128);
export default defineEventHandler(async event=>{
  try{
    const r=runtime(),{cfg,db,auth,iptv,plex,plexSetup,jellyfin,jellyfinApi,mail}=r;
    const communications=new Communications(db,cfg.key);
    const path=getRouterParam(event,'path')||'',method=event.method;
    const cookieName=cfg.base.startsWith('https:')?'__Host-bulock':'bulock';
    const sessionToken=getCookie(event,cookieName)||'',user=auth.session(sessionToken);
    const requireUser=()=>{if(!user)throw new Fault('Sign in to continue.',401);return user;};
    const admin=()=>{const u=requireUser();if(u.role!=='admin')throw new Fault('Administrator access required.',403);return u;};
    const session=(result:any)=>{setCookie(event,cookieName,result.token,{httpOnly:true,secure:cfg.base.startsWith('https:'),sameSite:'lax',path:'/',maxAge:30*86400});return {ok:true,user:result.user};};
    let body:any={};
    if(!['GET','HEAD'].includes(method)){
      if(!path.startsWith('internal/')){const origin=getRequestHeader(event,'origin');if(origin!==new URL(cfg.base).origin||getRequestHeader(event,'x-bulock-request')!=='1')throw new Fault('Request origin is not allowed.',403);}
      const raw=await readRawBody(event);if(raw&&Buffer.byteLength(raw)>(/^admin\/(news|alerts)(\/|$)/.test(path)?65536:16384))throw new Fault('Request too large.',413);try{body=raw?JSON.parse(raw):{};}catch{throw new Fault('Invalid request.');}
    }
    if(path.startsWith('internal/')){if(!cfg.internalKey||!equal(getRequestHeader(event,'authorization')||'',`Bearer ${cfg.internalKey}`))throw new Fault('Unauthorized.',401);
      setHeader(event,'Cache-Control','no-store');
      if(method==='POST'&&path==='internal/iptv/check'){const input=z.object({token:id,kind:z.enum(['native','viewer']).default('native')}).parse(body);return iptv.verify(input.token,input.kind);}
      if(method==='POST'&&path==='internal/iptv/alias')return iptv.resolveAlias(typeof body?.phrase==='string'&&body.phrase.length<=128?body.phrase:'');
      if(method==='POST'&&path==='internal/iptv/exchange')return iptv.exchange(z.object({code:id}).parse(body).code);
      throw new Fault('Not found.',404);
    }
    if(method==='GET'&&path==='health')return {ok:true};
    if(method==='GET'&&path==='status'){requireUser();return r.serviceStatus.snapshot();}
    if(method==='GET'&&path==='me'){const grants=user?db.get('SELECT iptv,jellyfin_state,jellyfin_name,policy_source,libraries FROM grants WHERE user_id=?',user.id):null;return {user,grants,plexSetup:user?plexSetup.status(user.id):null,services:{plex:cfg.plexUrl,jellyfin:cfg.jellyfinUrl,iptv:cfg.iptvUrl,seerr:cfg.seerrUrl},configured:{plex:Boolean(cfg.plexServer&&cfg.owner),email:Boolean(cfg.smtpHost&&cfg.smtpUser&&cfg.smtpPassword)}};}
    if(method==='POST'&&path==='auth/email/send'){auth.limit('ip:'+getRequestIP(event),20);const input=z.object({email:text,link:z.boolean().default(false)}).parse(body);auth.limit('email:'+hash(auth.email(input.email),cfg.key),5);if(!cfg.smtpHost||!cfg.smtpUser||!cfg.smtpPassword)throw new Fault('Email delivery is not configured. Please use Plex or contact the administrator.',503);const current=input.link?requireUser():null;if(current)auth.recent(current);const challenge=auth.issueEmail(input.email,current?.id);if(!challenge)return {queued:false,message:'No email was sent. Use an invited or verified address. New here? Ask for an invitation, or sign in with Plex to verify your email.'};mail.login(challenge,body.returnTo);return {queued:true,id:challenge.id,message:'Email queued. Delivery may take a moment. The link and code expire in 10 minutes.'};}
    if(method==='POST'&&path==='auth/email/verify'){auth.limit('verify:'+getRequestIP(event),30);const input=z.object({id,proof:id}).parse(body);return session(auth.consumeEmail(input.id,input.proof,user?.id));}
    if(method==='POST'&&path==='auth/logout'){auth.logout(sessionToken);deleteCookie(event,cookieName,{path:'/'});return {ok:true};}
    if(method==='POST'&&path==='auth/plex/start'){auth.limit('plex:'+getRequestIP(event),20);const input=z.object({link:z.boolean().default(false)}).parse(body);const u=input.link?requireUser():null;if(u)auth.recent(u);if(!cfg.owner||!cfg.plexServer)throw new Fault('Plex sign-in has not been configured.',503);const pin=await plex.pin();const flow=token();db.run('INSERT INTO plex_flows(id,pin_id,code,user_id,expires,return_to) VALUES(?,?,?,?,?,?)',hash(flow,cfg.key),String(pin.id),pin.code,u?.id||null,Date.now()+600000,returnPath(body.returnTo));setCookie(event,'bulock-plex-flow',flow,{httpOnly:true,sameSite:'lax',secure:cfg.base.startsWith('https:'),maxAge:600,path:'/'});const params=new URLSearchParams({clientID:plex.clientId,code:pin.code,forwardUrl:cfg.base+'/login?plex=1','context[device][product]':'Bulock Media'});return {url:'https://app.plex.tv/auth#?'+params};}
    if(method==='POST'&&path==='auth/plex/finish'){const flow=getCookie(event,'bulock-plex-flow')||'';const stored=db.get('SELECT * FROM plex_flows WHERE id=? AND expires>?',hash(flow,cfg.key),Date.now());if(!stored)throw new Fault('Plex sign-in expired. Please try again.');if(stored.user_id!==null&&stored.user_id!==user?.id)throw new Fault('Return to the browser where you linked Plex.',403);const pin=await plex.poll(stored.pin_id);if(!pin.authToken)throw new Fault('Finish signing in with Plex first.',409);const profile=await plex.identity(pin.authToken);const access=await plex.hasAccess(pin.authToken);const result=auth.plexSignIn(profile,access,stored.user_id||undefined);db.run('DELETE FROM plex_flows WHERE id=?',stored.id);deleteCookie(event,'bulock-plex-flow',{path:'/'});return {...session(result),returnTo:returnPath(stored.return_to)};}
    if(method==='POST'&&path==='jellyfin/setup'){const u=requireUser();auth.recent(u);const input=z.object({username:text,password:z.string().min(12).max(128)}).parse(body);await jellyfin.provision(u.id,input.username,input.password);return {ok:true};}
    if(method==='POST'&&path==='jellyfin/password'){const u=requireUser();auth.recent(u);await jellyfin.reset(u.id,z.object({password:z.string().min(12).max(128)}).parse(body).password);return {ok:true};}
    if(method==='POST'&&path==='iptv/request'){iptv.request(requireUser().id);return {ok:true};}
    if(method==='POST'&&path==='iptv/credentials'){const u=requireUser();setHeader(event,'Cache-Control','no-store');if(body.rotate)iptv.rotate(u.id);const value=iptv.appCredentials(u.id),base=cfg.iptvUrl.replace(/\/$/,'');return {playlist:base+'/p/'+value.phrase,guide:base+'/g/'+value.phrase};}
    if(method==='POST'&&path==='iptv/launch'){const code=iptv.handoff(requireUser().id);return {url:cfg.iptvUrl.replace(/\/$/,'')+'/portal-launch#code='+encodeURIComponent(code)};}
    if(method==='POST'&&path==='plex/check'){const u=requireUser();auth.limit('plex-check:'+u.id,30);return plexSetup.check(u.id);}
    if(method==='POST'&&path==='plex/enable'){const u=requireUser();auth.limit('plex-enable:'+u.id,10);return plexSetup.enable(u.id);}
    if(method==='POST'&&path==='plex/help'){const u=requireUser();auth.limit('plex-help:'+u.id,10);return plexSetup.help(u.id);}
    if(method==='GET'&&path==='news'){requireUser();const q=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(20).default(10)}).parse(getQuery(event));return communications.news(q.page,q.limit);}
    if(method==='GET'&&path.startsWith('news/')){requireUser();return communications.published(path.slice(5));}
    if(path.startsWith('admin/')){const actor=admin();if(method!=='GET'&&!(method==='POST'&&['admin/plex/check','admin/plex/libraries','admin/status/check'].includes(path)))auth.recent(actor);
      if(method==='GET'&&path==='admin/status')return r.serviceStatus.snapshot(true);
      if(method==='POST'&&path==='admin/status/check'){auth.limit('status-check:'+actor.id,20);await r.serviceStatus.check(true);db.audit(actor.id,'status.check','all');return r.serviceStatus.snapshot(true);}
      if(method==='POST'&&path==='admin/status/notices/save')return r.serviceStatus.saveNotice(body,actor.id);
      if(method==='POST'&&path==='admin/status/notices/publish')return r.serviceStatus.publishNotice(z.object({id}).parse(body).id,actor.id);
      if(method==='POST'&&path==='admin/status/notices/resolve')return r.serviceStatus.resolveNotice(z.object({id}).parse(body).id,actor.id);
      if(method==='POST'&&path==='admin/status/notices/delete')return r.serviceStatus.deleteNotice(z.object({id}).parse(body).id,actor.id);
      const comm=path.match(/^admin\/(news|alerts)(?:\/([^/]+))?$/);
      if(comm){const kind=comm[1] as 'news'|'alerts',action=comm[2];
        if(method==='GET'&&!action)return communications.list(kind);
        if(method==='GET'&&kind==='alerts'&&action==='users')return communications.users();
        if(method==='GET'&&action==='detail')return communications.row(kind,z.string().min(1).parse(getQuery(event).id));
        if(method==='GET'&&kind==='alerts'&&action==='status')return communications.status(z.string().min(1).parse(getQuery(event).id));
        if(method==='POST'&&action==='save')return communications.save(kind,body,actor.id);
        if(method==='POST'&&action==='delete')return communications.remove(kind,z.object({id}).parse(body).id,actor.id);
        if(method==='POST'&&kind==='news'&&action==='publish'){const input=z.object({id,publish:z.boolean()}).parse(body);return communications.publish(input.id,input.publish,actor.id);}
        if(method==='POST'&&kind==='alerts'&&action==='preview')return communications.preview(z.object({id}).parse(body).id);
        if(method==='POST'&&kind==='alerts'&&action==='send'){if(!cfg.smtpHost||!cfg.smtpUser||!cfg.smtpPassword)throw new Fault('Configure email delivery first.',503);const input=z.object({id,token:id}).parse(body);return communications.send(input.id,input.token,actor.id);}
        if(method==='POST'&&kind==='alerts'&&action==='retry'){if(!cfg.smtpHost||!cfg.smtpUser||!cfg.smtpPassword)throw new Fault('Configure email delivery first.',503);const input=z.object({id,recipientId:id,acknowledge:z.boolean().default(false)}).parse(body);return communications.retry(input.id,input.recipientId,input.acknowledge,actor.id);}
      }
      if(method==='GET'&&path==='admin/plex')return plexSetup.overview();
      if(method==='GET'&&path==='admin/plex/libraries')return plexSetup.catalog().catalog;
      if(method==='POST'&&path==='admin/plex/libraries'){auth.limit('plex-catalog:'+actor.id,10);return plexSetup.refreshCatalog();}
      if(method==='POST'&&path==='admin/plex/defaults')return plexSetup.saveDefaults(z.object({libraries:z.array(id).min(1).max(100)}).parse(body).libraries,actor.id);
      if(method==='POST'&&path==='admin/plex/retry')return plexSetup.enable(z.object({userId:id}).parse(body).userId,actor.id);
      if(method==='POST'&&path==='admin/plex/resolve')return plexSetup.resolve(z.object({userId:id}).parse(body).userId,actor.id);
      if(method==='POST'&&path==='admin/plex/check'){auth.limit('plex-admin-check:'+actor.id,30);return plexSetup.check(z.object({userId:id}).parse(body).userId);}
      if(method==='GET'&&path==='admin/overview')return {users:db.all('SELECT users.*,grants.iptv,grants.jellyfin_state,grants.jellyfin_id,grants.jellyfin_name,grants.policy_source,grants.libraries FROM users JOIN grants ON users.id=grants.user_id ORDER BY created DESC'),invites:db.all('SELECT email,expires FROM invites ORDER BY expires DESC'),mappings:db.all('SELECT * FROM mappings'),jobs:db.all('SELECT id,kind,user_id,attempts,next,error FROM jobs ORDER BY next LIMIT 100'),audit:db.all('SELECT * FROM audit ORDER BY id DESC LIMIT 100'),health:{plex:Boolean(cfg.plexServer&&cfg.plexToken),jellyfin:Boolean(cfg.jellyfinKey),email:Boolean(cfg.smtpHost&&cfg.smtpUser&&cfg.smtpPassword),iptv:Boolean(cfg.internalKey)}};
      if(method==='GET'&&path==='admin/libraries')return {jellyfin:(await jellyfinApi.libraries()).map((l:any)=>({name:l.Name,id:l.ItemId})),plex:(await plex.shares()).map((s:any)=>({userId:s.userID??s.userId,libraries:(s.Section??s.sections??[]).map((l:any)=>({id:l.key??l.id,title:l.title,shared:l.shared}))}))};
      if(method==='POST'&&path==='admin/invite'){if(!cfg.smtpHost||!cfg.smtpUser||!cfg.smtpPassword)throw new Fault('Configure email delivery first.',503);const email=auth.invite(z.object({email:text}).parse(body).email,actor.id);mail.invite(email);return {ok:true};}
      if(method==='POST'&&path==='admin/invite/revoke'){const email=auth.email(body.email);db.run('DELETE FROM invites WHERE email=?',email);db.run('UPDATE challenges SET used=1 WHERE email=?',email);db.audit(actor.id,'invite.revoke',email);return {ok:true};}
      if(method==='POST'&&path==='admin/mapping/remove'){const input=z.object({plexId:id}).parse(body);db.run('DELETE FROM mappings WHERE plex_id=?',input.plexId);for(const grant of db.all("SELECT user_id FROM grants WHERE policy_source='plex' AND jellyfin_id IS NOT NULL"))db.job('jellyfin-sync',grant.user_id);db.audit(actor.id,'library.unmap',input.plexId);return {ok:true};}
      if(method==='POST'&&path==='admin/mapping'){const input=z.object({plexId:id,jellyfinId:id}).parse(body);db.run('INSERT INTO mappings VALUES(?,?) ON CONFLICT(plex_id) DO UPDATE SET jellyfin_id=excluded.jellyfin_id',input.plexId,input.jellyfinId);for(const grant of db.all("SELECT user_id FROM grants WHERE policy_source='plex' AND jellyfin_id IS NOT NULL"))db.job('jellyfin-sync',grant.user_id);db.audit(actor.id,'library.map',input.plexId);return {ok:true};}
      if(method==='POST'&&path==='admin/user'){const input=z.object({userId:id,action:z.enum(['disable','enable','approve-iptv','revoke-iptv','manual-libraries','plex-libraries','retry-jellyfin']),libraries:z.array(id).max(100).optional(),jellyfinId:id.optional()}).parse(body);if(!db.get('SELECT id FROM users WHERE id=?',input.userId))throw new Fault('Unknown person.',404);
        if(input.action==='disable'){if(input.userId===actor.id)throw new Fault('You cannot disable your own administrator account.');auth.disable(input.userId,actor.id);}
        if(input.action==='enable'){db.run('UPDATE users SET disabled=0 WHERE id=?',input.userId);db.audit(actor.id,'user.enable',input.userId);}
        if(input.action==='approve-iptv')iptv.approve(input.userId,actor.id);
        if(input.action==='revoke-iptv')iptv.revoke(input.userId,actor.id);
        if(input.action==='manual-libraries'||input.action==='plex-libraries'){db.run('UPDATE grants SET policy_source=?,libraries=? WHERE user_id=?',input.action==='manual-libraries'?'manual':'plex',JSON.stringify(input.libraries||[]),input.userId);db.job('jellyfin-sync',input.userId);db.audit(actor.id,'jellyfin.policy',input.userId);}
        if(input.action==='retry-jellyfin'){auth.recent(actor);if(!input.jellyfinId)throw new Fault('Enter the confirmed Jellyfin user ID.');const remoteUser=await jellyfinApi.call('/Users/'+encodeURIComponent(input.jellyfinId));if(remoteUser.Policy?.IsAdministrator)throw new Fault('An administrator account cannot be linked.');const current=db.get('SELECT * FROM grants WHERE user_id=?',input.userId);if(current.jellyfin_state!=='needs-review'&&current.jellyfin_state!=='creating')throw new Fault('This account does not need recovery.');if(remoteUser.Name!==current.jellyfin_name)throw new Fault('The remote username does not match the interrupted setup.');if(db.get('SELECT user_id FROM grants WHERE jellyfin_id=? AND user_id<>?',input.jellyfinId,input.userId))throw new Fault('That account is already linked.');db.run("UPDATE grants SET jellyfin_id=?,jellyfin_state='setup' WHERE user_id=?",input.jellyfinId,input.userId);await jellyfin.disable(input.userId);db.audit(actor.id,'jellyfin.recover',input.userId);}
        return {ok:true};}
      if(method==='POST'&&path==='admin/jobs/retry'){db.run("UPDATE jobs SET attempts=0,next=? WHERE id=? AND kind<>'alert-email'",Date.now(),z.object({id:text}).parse(body).id);return {ok:true};}
    }
    throw new Fault('Not found.',404);
  }catch(error){if(error instanceof Fault)throw createError({statusCode:error.status,message:error.message});if(error instanceof z.ZodError)throw createError({statusCode:400,message:'Check the entered values and try again.'});console.error('Portal operation failed. Request details and credentials withheld.');throw createError({statusCode:500,message:'The operation could not be completed. Please try again.'});}
});
