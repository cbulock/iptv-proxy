import {existsSync,readFileSync,writeFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {parseEnv} from 'node:util';
import {XMLParser} from 'fast-xml-parser';
import nodemailer from 'nodemailer';

// Local operator tool, never an HTTP endpoint. Never print account or SMTP tokens.
mkdirSync('data',{recursive:true});
const envPath='.env', pendingPath='data/plex-setup.json';
function save(values){let source=existsSync(envPath)?readFileSync(envPath,'utf8'):readFileSync('.env.example','utf8');for(const [key,value] of Object.entries(values)){const line=`${key}=${JSON.stringify(String(value))}`;const pattern=new RegExp(`^${key}=.*$`,'m');source=pattern.test(source)?source.replace(pattern,()=>line):source+'\n'+line+'\n';}writeFileSync(envPath,source,{mode:0o600});}
async function request(url,headers={},method='GET'){const r=await fetch(url,{method,headers,redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`Service returned HTTP ${r.status}.`);return r.json();}
try{
  const mode=process.argv[2];
  if(mode==='start'){
    if(existsSync(pendingPath))throw new Error('A setup flow already exists. Finish it or remove data/plex-setup.json to start again.');
    const identity=await fetch('https://plex.bulock.house/identity',{redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!identity.ok)throw new Error('Could not identify the configured Plex server.');
    const server=new XMLParser({ignoreAttributes:false,attributeNamePrefix:''}).parse(await identity.text()).MediaContainer?.machineIdentifier;
    if(!server)throw new Error('The Plex server did not return its machine identifier.');
    const client='bulock-media-'+server;
    const headers={'Accept':'application/json','X-Plex-Product':'Bulock Media','X-Plex-Version':'1.0','X-Plex-Client-Identifier':client};
    const pin=await request('https://plex.tv/api/v2/pins?strong=true',headers,'POST');
    writeFileSync(pendingPath,JSON.stringify({server,client,pin:pin.id,expires:Date.now()+600000}),{mode:0o600});
    const key=existsSync('data/local-secret')?readFileSync('data/local-secret','utf8'):randomBytes(32).toString('hex');
    const current=existsSync(envPath)?parseEnv(readFileSync(envPath,'utf8')):{};
    save({APP_SECRET:current.APP_SECRET||key,PLEX_SERVER_ID:server});
    console.log('Authorize using the account that owns this Plex server:');
    console.log('https://app.plex.tv/auth#?'+new URLSearchParams({clientID:client,code:pin.code,'context[device][product]':'Bulock Media'}));
  }else if(mode==='finish'){
    const pending=JSON.parse(readFileSync(pendingPath,'utf8'));
    if(Date.now()>pending.expires)throw new Error('Setup expired. Remove data/plex-setup.json and start again.');
    const headers={'Accept':'application/json','X-Plex-Product':'Bulock Media','X-Plex-Version':'1.0','X-Plex-Client-Identifier':pending.client};
    const pin=await request('https://plex.tv/api/v2/pins/'+pending.pin,headers);
    if(!pin.authToken)throw new Error('Complete Plex authorization in the browser first.');
    headers['X-Plex-Token']=pin.authToken;
    const profile=await request('https://plex.tv/api/v2/user',headers);
    const resources=await request('https://plex.tv/api/v2/resources?includeHttps=1',headers);
    if(!profile.id||profile.restricted||profile.guest||!resources.some(r=>r.clientIdentifier===pending.server&&(r.owned===true||r.owned===1)))throw new Error('This account is not the owner of the configured Plex server. Configuration was not changed.');
    const current=parseEnv(readFileSync(envPath,'utf8'));
    if(current.ADMIN_PLEX_ID&&current.ADMIN_PLEX_ID!==String(profile.id))throw new Error('A different administrator is already configured. Review it manually.');
    save({ADMIN_PLEX_ID:profile.id,PLEX_OWNER_TOKEN:pin.authToken});unlinkSync(pendingPath);
    console.log('Plex owner and server verified. Local configuration saved; restart the portal.');
  }else if(mode==='verify-smtp'){
    const cfg=parseEnv(readFileSync(envPath,'utf8'));
    const password=cfg.SMTP_PASSWORD_FILE?readFileSync(cfg.SMTP_PASSWORD_FILE,'utf8').trim():cfg.SMTP_PASSWORD;
    if(!password)throw new Error('Set SMTP_PASSWORD or SMTP_PASSWORD_FILE in .env first.');
    if(!cfg.SMTP_HOST||!cfg.SMTP_USER)throw new Error('Set SMTP_HOST and SMTP_USER in .env first.');
    const smtp=nodemailer.createTransport({host:cfg.SMTP_HOST,port:Number(cfg.SMTP_PORT||587),secure:Number(cfg.SMTP_PORT)===465,requireTLS:true,auth:{user:cfg.SMTP_USER,pass:password},connectionTimeout:10000,socketTimeout:15000});
    try{await smtp.verify();console.log('SMTP TLS and authentication verified. No email sent.');}finally{smtp.close();}
  }else throw new Error('Use start, finish, or verify-smtp.');
}catch(error){console.error(error?.code?.startsWith('E')?'Connection or local-file check failed. Check configuration and connectivity.':error.message);process.exitCode=1;}
