import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

const source=readFileSync(new URL('../app/components/PlexAdmin.vue',import.meta.url),'utf8').split('<script setup lang="ts">')[1].split('</script>')[0];
async function fixture(fail=false){
 const overview={libraries:['101'],catalog:[{id:'101',name:'Movies'},{id:'102',name:'TV Shows'}],catalogUpdated:1,users:[]};
 const context:any={ref:(value:any)=>({value}),computed:(get:any)=>({get value(){return get();}}),errorText:(e:Error)=>e.message,
  useRequestFetch:()=>async()=>structuredClone(overview),usePortal:()=>({send:async(path:string)=>{if(fail)throw Error('Plex unavailable');return path.endsWith('libraries')?{catalog:[{id:'101',name:'Films'},{id:'102',name:'TV Shows'}],catalogUpdated:2}:{state:'pending'};}})};
 const script=ts.transpileModule('(async()=>{'+source+'\n globalThis.ui={selected,data,catalogLoad,run,error,message,feedback,canSave,selectLibrary};})()',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 await runInNewContext(script,context);
 return context.ui;
}
test('catalog update shows new names without discarding unsaved defaults',async()=>{
 const ui=await fixture();ui.selectLibrary('102',true);await ui.catalogLoad();
 assert.equal(ui.data.value.catalog[0].name,'Films');assert.deepEqual(Array.from(ui.selected.value),['101','102']);assert.deepEqual(ui.data.value.libraries,['101']);assert.equal(ui.canSave.value,true);
});
test('access checks preserve unsaved defaults and report the actual pending status',async()=>{
 const ui=await fixture();ui.selectLibrary('102',true);await ui.run('check','viewer');
 assert.deepEqual(Array.from(ui.selected.value),['101','102']);assert.equal(ui.feedback.value.userId,'viewer');assert.match(ui.feedback.value.text,/waiting/);
});
test('failed update keeps cached names and reports failure without success',async()=>{
 const ui=await fixture(true);await ui.catalogLoad();
 assert.equal(ui.data.value.catalog[0].name,'Movies');assert.match(ui.error.value,/Could not update/);assert.match(ui.error.value,/unchanged/);assert.equal(ui.message.value,'');
});
test('saving requires changed, nonempty and available defaults',async()=>{
 const ui=await fixture();assert.equal(ui.canSave.value,false);
 ui.selectLibrary('101',false);assert.equal(ui.canSave.value,false);
 ui.selectLibrary('missing',true);assert.equal(ui.canSave.value,false);
 ui.selectLibrary('missing',false);ui.selectLibrary('102',true);assert.equal(ui.canSave.value,true);
});
