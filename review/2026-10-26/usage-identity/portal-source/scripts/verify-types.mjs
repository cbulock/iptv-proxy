import {spawnSync} from 'node:child_process';
for(const project of ['app','server']){const result=spawnSync(process.execPath,['node_modules/vue-tsc/bin/vue-tsc.js','--noEmit','-p',`.nuxt/tsconfig.${project}.json`],{stdio:'inherit'});if(result.status)process.exit(result.status);}
