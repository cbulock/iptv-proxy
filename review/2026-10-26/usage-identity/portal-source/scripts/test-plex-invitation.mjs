// Explicit opt-in live test. Uses an isolated journal, never the portal database.
// Usage: node scripts/test-plex-invitation.mjs EMAIL [--send]
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {Plex} from '../server/core/plex.ts';
import {Store} from '../server/core/db.ts';
import {Auth} from '../server/core/auth.ts';
import {PlexSetup} from '../server/core/plex-setup.ts';
const email=process.argv[2];if(!email||!email.includes('@'))throw Error('Specify the designated test email.');
const env={...parseEnv(readFileSync('.env','utf8')),...process.env};
const setting=name=>env[name+'_FILE']?readFileSync(env[name+'_FILE'],'utf8').trim():env[name];
const api=new Plex(setting('PLEX_SERVER_ID'),setting('PLEX_OWNER_TOKEN'),'bulock-media-live-test');
const profile=JSON.parse(readFileSync('data/plex-test-identity.json','utf8'));
if(!profile?.id||String(profile.email).toLowerCase()!==email.toLowerCase())throw Error('Complete the designated test account sign-in first.');
if(String(profile.id)===setting('ADMIN_PLEX_ID'))throw Error('The designated account owns this server; choose a separate test account.');
const catalog=await api.libraries();const libraries=['Movies','TV Shows'].map(name=>{const matches=catalog.filter(l=>l.name===name);if(matches.length!==1)throw Error('Test library selection is ambiguous.');return matches[0].id;});
const before=await api.inspect(String(profile.id));console.log(JSON.stringify({identityVerified:true,state:before,libraries:['Movies','TV Shows']}));
const db=new Store('data/plex-live-test.sqlite');
try{
 const auth=new Auth(db,'isolated-test-journal-not-an-authentication-server');
 let user=db.get('SELECT * FROM users WHERE plex_id=?',String(profile.id));
 if(!user){user=auth.create('Designated test account',null,String(profile.id));db.run('INSERT INTO plex_setup(user_id,eligible) VALUES(?,1)',user.id);}
 const service=new PlexSetup(db,api,{queue(){throw Error('Notifications are disabled in the live test.');}});
 await service.saveDefaults(libraries,'test-administrator');
 if(process.argv.includes('--send'))await service.enable(user.id);
 const status=await service.check(user.id);console.log(JSON.stringify({state:status.state,error:status.error,invitationAttempted:!!service.row(user.id).attempted}));
}finally{db.close();}
