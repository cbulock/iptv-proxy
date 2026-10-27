// Read-only integration check. Never prints tokens, email addresses, or raw responses.
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {XMLParser} from 'fast-xml-parser';
const env={...parseEnv(readFileSync('.env','utf8')),...process.env};
const setting=name=>env[name+'_FILE']?readFileSync(env[name+'_FILE'],'utf8').trim():env[name];
const token=setting('PLEX_OWNER_TOKEN'),server=setting('PLEX_SERVER_ID');
if(!token||!server)throw Error('Plex owner configuration unavailable.');
const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'',isArray:name=>['Server','Section','SharedServer','User'].includes(name)});
for(const path of [`/api/servers/${encodeURIComponent(server)}`,`/api/servers/${encodeURIComponent(server)}/shared_servers`,'/api/users']){
 const response=await fetch('https://plex.tv'+path,{headers:{'X-Plex-Token':token,Accept:'application/xml'},signal:AbortSignal.timeout(12000),redirect:'error'});
 if(!response.ok){console.log(JSON.stringify({endpoint:path.replace(server,'[server]'),status:response.status}));continue;}
 const data=parser.parse(await response.text()).MediaContainer;
 const items=data?.Server||data?.SharedServer||data?.User||[];
 if(process.argv.includes('--libraries')&&path.endsWith(encodeURIComponent(server)))console.log(JSON.stringify({libraries:(items[0]?.Section||[]).map(l=>({id:String(l.id),name:l.title}))}));
 console.log(JSON.stringify({endpoint:path.replace(server,'[server]'),count:items.length,itemKeys:items[0]?Object.keys(items[0]):[],sectionKeys:items[0]?.Section?.[0]?Object.keys(items[0].Section[0]):[],serverKeys:items[0]?.Server?.[0]?Object.keys(items[0].Server[0]):[],pendingValues:[...new Set(items.flatMap(i=>(i.Server||[]).map(s=>String(s.pending))))]}));
}
