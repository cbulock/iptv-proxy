import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

// Exercise the component's actual action handler with Nuxt's network boundary mocked.
const source=readFileSync(new URL('../app/components/PlexSetup.vue',import.meta.url),'utf8').split('<script setup lang="ts">')[1].split('</script>')[0];
function fixture(result:any,failure?:Error){
 const state={value:{user:{plex_id:'42'},plexSetup:{state:'ready'}}};
 const context:any={ref:(value:any)=>({value}),computed:(get:any)=>({get value(){return get();}}),useRoute:()=>({fullPath:'/guides'}),onMounted:()=>{},errorText:(e:Error)=>e.message,usePortal:()=>({state,send:async()=>{if(failure)throw failure;return result;},refresh:async()=>state.value})};
 runInNewContext(ts.transpile(source+'\n globalThis.testApi={run,message,error,busy};'),context);
 return context.testApi;
}
test('checking unchanged ready access gives visible confirmation',async()=>{
 const ui=fixture({state:'ready'});await ui.run('check');
 assert.match(ui.message.value,/Access confirmed/);assert.equal(ui.busy.value,false);
});
test('pending access check reports invitation still awaiting acceptance',async()=>{
 const ui=fixture({state:'pending'});await ui.run('check');
 assert.match(ui.message.value,/still waiting/i);assert.doesNotMatch(ui.message.value,/Access confirmed/);
});
test('failed check shows its error without a success message',async()=>{
 const ui=fixture(null,new Error('Plex is unavailable'));await ui.run('check');
 assert.equal(ui.message.value,'');assert.equal(ui.error.value,'Plex is unavailable');assert.equal(ui.busy.value,false);
});
