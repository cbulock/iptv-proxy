import {createHash} from 'node:crypto';
import {parseRemote} from './http-client.ts';
import {getHealthText} from '../../integrations/iptv/health.mjs';
import type {StatusProbe,ProbeResult} from './service-status.ts';
import type {ServiceId} from '../../shared/service-status.ts';

interface MonitorConfig {plexUrl:string;plexServer:string;jellyfinUrl:string;seerrUrl:string;iptvUrl:string;iptvGatewayInternal:string;internalKey:string}
function validBase(value:string){try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash;}catch{return false;}}
const append=(base:string,path:string)=>base.replace(/\/$/,'')+path;
const fingerprint=(values:unknown[])=>createHash('sha256').update(JSON.stringify(values)).digest('hex');
async function jsonCheck(url:string,signal:AbortSignal,validate:(body:any)=>boolean,headers:Record<string,string>={}):Promise<ProbeResult>{
  const response=await getHealthText(url,signal,65536,headers);if(!response.ok)return response;
  try{return validate(parseRemote(response.text||''))?{ok:true,code:'ok'}:{ok:false,code:'unexpected-response'};}catch{return {ok:false,code:'unexpected-response'};}
}
export function createStatusProbes(cfg:MonitorConfig):Record<ServiceId,StatusProbe>{
  return {
    plex:{configured:validBase(cfg.plexUrl)&&!!cfg.plexServer,fingerprint:fingerprint([cfg.plexUrl,cfg.plexServer]),run:signal=>jsonCheck(append(cfg.plexUrl,'/identity'),signal,body=>body?.MediaContainer?.machineIdentifier===cfg.plexServer,{Accept:'application/json'})},
    jellyfin:{configured:validBase(cfg.jellyfinUrl),fingerprint:fingerprint([cfg.jellyfinUrl]),run:async signal=>{const r=await getHealthText(append(cfg.jellyfinUrl,'/health'),signal);return r.ok?{ok:r.text?.trim()==='Healthy',code:r.text?.trim()==='Healthy'?'ok':'unexpected-response'}:r;}},
    // Deployed Seerr 3.3 rejects checkUpdateAvailable as an unknown query parameter.
    seerr:{configured:validBase(cfg.seerrUrl),fingerprint:fingerprint([cfg.seerrUrl]),run:signal=>jsonCheck(append(cfg.seerrUrl,'/api/v1/status'),signal,body=>typeof body?.version==='string'&&body.version.length>0&&typeof body?.commitTag==='string')},
    iptv:{configured:validBase(cfg.iptvUrl)&&validBase(cfg.iptvGatewayInternal)&&!!cfg.internalKey,fingerprint:fingerprint([cfg.iptvUrl,cfg.iptvGatewayInternal,cfg.internalKey]),run:async signal=>{
      const [gateway,dependencies]=await Promise.all([
        jsonCheck(append(cfg.iptvUrl,'/health'),signal,body=>body?.ok===true),
        getHealthText(append(cfg.iptvGatewayInternal,'/internal/health'),signal,65536,{Authorization:'Bearer '+cfg.internalKey})
      ]);
      let components:NonNullable<ProbeResult['components']>=[{name:'gateway',ok:gateway.ok,code:gateway.code||'unreachable'}];
      if(!dependencies.ok)components.push({name:'lineup',ok:false,code:dependencies.code});
      else try{
        const body=JSON.parse(dependencies.text||'');
        if(typeof body.ok!=='boolean'||!Array.isArray(body.components)||body.components.length!==2||!['viewer','lineup'].every(name=>body.components.some((c:any)=>c.name===name&&typeof c.ok==='boolean'&&typeof c.code==='string')))throw Error();
        components.push(...body.components.map((c:any)=>({name:c.name,ok:c.ok,code:c.code})));
        if(body.ok!==body.components.every((c:any)=>c.ok))throw Error();
      }catch{components=[...components.slice(0,1),{name:'lineup',ok:false,code:'unexpected-response'}];}
      return {ok:components.every(c=>c.ok),code:components.every(c=>c.ok)?'ok':'component-failure',components};
    }}
  };
}
