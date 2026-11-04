import {readFileSync,writeFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {Plex} from '../server/core/plex.ts';
const env=parseEnv(readFileSync('.env','utf8'));
const api=new Plex(env.PLEX_SERVER_ID,'','bulock-media-live-test');
if(process.argv[2]==='start'){
 const pin=await api.pin();writeFileSync('data/plex-test-pin.json',JSON.stringify({id:String(pin.id),email:process.argv[3],created:Date.now()}));
 console.log('https://app.plex.tv/auth#?'+new URLSearchParams({clientID:api.clientId,code:pin.code,'context[device][product]':'Bulock Media setup test'}));
}else{
 const pin=JSON.parse(readFileSync('data/plex-test-pin.json','utf8'));if(Date.now()-pin.created>600000)throw Error('Test sign-in expired.');
 const result=await api.poll(pin.id);if(!result.authToken){console.log('Waiting for test-account sign-in.');process.exit(0);}
 const identity=await api.identity(result.authToken);if(identity.email?.toLowerCase()!==pin.email.toLowerCase())throw Error('Signed-in account differs from designated test email.');
 writeFileSync('data/plex-test-identity.json',JSON.stringify({id:identity.id,email:identity.email}));console.log(JSON.stringify({verified:true,id:identity.id}));
}
