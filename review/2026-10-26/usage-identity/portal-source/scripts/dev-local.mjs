import {mkdirSync,existsSync,writeFileSync,readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
mkdirSync('data',{recursive:true});const path='data/local-secret';if(!existsSync(path))writeFileSync(path,randomBytes(32).toString('hex'),{mode:0o600});
const child=spawn(process.execPath,['node_modules/nuxt/bin/nuxt.mjs','dev','--host','127.0.0.1','--port','3000'],{stdio:'inherit',env:{...process.env,APP_URL:'http://localhost:3000',APP_SECRET:readFileSync(path,'utf8')}});child.on('exit',code=>process.exit(code||0));
