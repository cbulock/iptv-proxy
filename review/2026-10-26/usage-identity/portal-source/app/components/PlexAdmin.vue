<script setup lang="ts">
type Library={id:string;name:string};
const {send}=usePortal(),requestFetch=useRequestFetch();
const data=ref<any>(null),selected=ref<string[]>([]),active=ref(''),error=ref(''),message=ref(''),confirm=ref(''),signIn=ref(false);
const feedback=ref<{userId:string;text:string}|null>(null);
const busy=computed(()=>!!active.value);
const catalog=computed<Library[]>(()=>data.value?.catalog||[]);
const dirty=computed(()=>!!data.value&&(selected.value.length!==data.value.libraries.length||selected.value.some(id=>!data.value.libraries.includes(id))));
const unavailable=computed<string[]>(()=>data.value?.catalogUpdated?[...new Set<string>([...(data.value?.libraries||[]),...selected.value])].filter(id=>!catalog.value.some(l=>l.id===id)):[]);
const canSave=computed(()=>dirty.value&&selected.value.length>0&&!selected.value.some(id=>!catalog.value.some(l=>l.id===id)));
async function load(reset=false){data.value=await requestFetch('/api/admin/plex');if(reset)selected.value=[...data.value.libraries];}
function failed(e:any){error.value=errorText(e);if(error.value==='Server Error')error.value='Plex could not complete this request. Try again in a moment.';signIn.value=(e?.statusCode||e?.status||e?.response?.status)===401;}
try{await load(true);}catch(e){failed(e);}
function clear(){error.value='';message.value='';feedback.value=null;signIn.value=false;}
async function catalogLoad(){
 if(busy.value)return;active.value='libraries';clear();
 try{const snapshot=await send('admin/plex/libraries');if(data.value)Object.assign(data.value,snapshot,{catalogError:''});else await load(true);message.value='Library list updated from Plex. Saved defaults are unchanged.';}
 catch(e){failed(e);if(!signIn.value)error.value='Could not update the library list from Plex. Saved defaults and unsaved selections are unchanged. Try again later.';}finally{active.value='';}
}
const labels:Record<string,string>={unchecked:'Not checked',eligible:'Ready for invitation',sending:'Sending invitation',pending:'Invitation pending',ready:'Ready to watch',help:'Needs help'};
async function run(action:string,userId?:string){
 if(busy.value)return;active.value=action+':'+(userId||'');clear();
 try{
  const result=await send('admin/plex/'+action,action==='defaults'?{libraries:selected.value}:{userId});
  await load(action==='defaults');
  if(action==='defaults')message.value='Default Plex libraries saved. Future invitations will use this selection.';
  else if(userId)feedback.value={userId,text:action==='check'?(result.state==='ready'?'Access confirmed. This person is ready to watch.':result.state==='pending'?'The invitation is still waiting for acceptance in Plex.':result.state==='eligible'?'No current access found. This person is eligible for an invitation.':result.error||labels[result.state]||'Access checked.'):action==='resolve'?'Help request marked resolved.':labels[result.state]||'Plex setup updated.'};
  confirm.value='';
 }catch(e){failed(e);}finally{active.value='';}
}
function selectLibrary(id:string,checked:boolean){selected.value=checked?[...new Set([...selected.value,id])]:selected.value.filter(value=>value!==id);}
function libraryNames(ids:string[]){return ids.map(id=>catalog.value.find(l=>l.id===id)?.name||`Library ${id}${data.value?.catalogUpdated?' (unavailable)':''}`).join(', ');}
function timestamp(value:number){return new Date(value).toISOString().slice(0,16).replace('T',' ')+' UTC';}
</script>
<template>
 <section class="panel plex-admin" aria-labelledby="plex-defaults-title" :aria-busy="busy">
  <h2 id="plex-defaults-title">Default Plex libraries</h2>
  <p>Choose the libraries shared with new viewers. Changes apply to future invitations; existing access stays the same.</p>
  <CindorAlert v-if="error" class="portal-alert" tone="danger">{{error}} <NuxtLink v-if="signIn" to="/login?returnTo=/admin">Sign in to continue</NuxtLink></CindorAlert>
  <p v-if="message" role="status" class="notice">{{message}}</p>
  <template v-if="data">
   <div class="plex-library-summary"><strong>{{data.libraries.length?libraryNames(data.libraries):'No default libraries selected'}}</strong><span class="small muted">Saved defaults</span></div>
   <div class="plex-catalog-tools"><p class="small muted">{{data.catalogUpdated?'Library list updated '+timestamp(data.catalogUpdated):'No cached library list yet.'}}<br>Update only when libraries are added, renamed, or removed in Plex.</p><CindorButton variant="ghost" class="text-button" :disabled="busy" @click="catalogLoad">{{active==='libraries'?'Updating…':'Update from Plex'}}</CindorButton></div>
   <CindorAlert v-if="data.catalogError" class="portal-alert" tone="warning">{{data.catalogError}}</CindorAlert>
   <form v-if="catalog.length||unavailable.length" @submit.prevent="run('defaults')">
    <fieldset :disabled="busy"><legend>Share with new viewers</legend>
     <div class="plex-library-options"><CindorCheckbox v-for="library in catalog" :key="library.id" class="check-label" :model-value="selected.includes(library.id)" :disabled="busy" @update:model-value="selectLibrary(library.id,$event)">{{library.name}}</CindorCheckbox>
     <CindorCheckbox v-for="id in unavailable" :key="id" class="check-label" :model-value="selected.includes(id)" :disabled="busy" @update:model-value="selectLibrary(id,$event)">Library {{id}} (unavailable — remove from defaults)</CindorCheckbox></div>
    </fieldset>
    <div class="actions plex-save-actions"><CindorButton type="submit" variant="solid" class="button primary" :disabled="busy||!canSave">{{active==='defaults:'?'Saving…':'Save default libraries'}}</CindorButton><button v-if="dirty" type="button" class="text-button plex-discard" :disabled="busy" @click="selected=[...data.libraries]">Discard changes</button><span v-if="dirty" class="small muted">Unsaved changes</span></div>
    <p v-if="!selected.length" class="small">Select at least one library to enable automatic invitations.</p>
    <p v-if="selected.some(id=>unavailable.includes(id))" class="small">Remove unavailable libraries and select an available library before saving.</p>
   </form>
   <p v-else-if="data.catalogUpdated" class="small">Plex returned no libraries. Add libraries in Plex, then update the list.</p>
  </template>
  <CindorButton v-else variant="ghost" class="button" :disabled="busy" @click="catalogLoad">{{busy?'Loading…':'Try again'}}</CindorButton>
 </section>
 <section v-if="data" class="panel plex-admin" aria-labelledby="plex-access-title">
  <h2 id="plex-access-title">Plex access &amp; help</h2><p>Review each viewer’s status or check for changes in Plex.</p>
  <p v-if="!data.users.length" class="small muted">No Plex setup activity yet. Viewers appear here when they start setup.</p>
  <ul class="plain-list plex-people"><li v-for="person in data.users" :key="person.user_id"><div>
   <div class="plex-person-heading"><strong>{{person.name}}</strong><span class="plex-status" :class="{'plex-status-ready':person.state==='ready','plex-status-help':person.state==='help'}">{{person.disabled?'Disabled':!person.plex_id?'Plex not connected':labels[person.state]||person.state}}</span></div>
   <small>Plex account: {{person.plex_id||'Not connected'}} · {{person.checked?'Last checked '+timestamp(person.checked):'Access has not been checked'}}</small>
   <small v-if="person.libraries!=='[]'">Invitation libraries: {{libraryNames(JSON.parse(person.libraries))}}</small>
   <p v-if="person.error" class="small">{{person.error}}</p><p v-if="person.help_created" class="small">Help requested · {{person.notification==='queued'?'Email queued':person.notification==='missing-email'?'Administrator needs a verified email':'Email unavailable — check mail configuration'}}</p>
   <p v-if="feedback?.userId===person.user_id" role="status" class="notice">{{feedback?.text}}</p>
   <div class="actions"><CindorButton variant="ghost" class="text-button" :disabled="busy||!!person.disabled||!person.plex_id" @click="run('check',person.user_id)">{{active==='check:'+person.user_id?'Checking…':'Check access'}}</CindorButton><CindorButton v-if="person.plex_id&&person.state!=='ready'&&person.state!=='pending'" variant="ghost" class="text-button" :disabled="busy||!!person.disabled" @click="confirm=person.user_id">Review invitation…</CindorButton><CindorButton v-if="person.help_created" variant="ghost" class="text-button" :disabled="busy" @click="run('resolve',person.user_id)">Mark help resolved</CindorButton></div>
   <div v-if="confirm===person.user_id" class="notice"><p>Confirm that this person should have access. Check Plex for an existing invitation before retrying. This may restore previously removed access.</p><CindorButton variant="ghost" class="button" :disabled="busy||!!person.disabled" @click="run('retry',person.user_id)">{{active==='retry:'+person.user_id?'Sending…':'Send or recover invitation'}}</CindorButton><CindorButton variant="ghost" class="text-button" :disabled="busy" @click="confirm=''">Cancel</CindorButton></div>
  </div></li></ul>
 </section>
</template>
<style scoped>
.plex-library-summary{display:flex;flex-direction:column;gap:6px;padding:16px;background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow-wrap:anywhere}.plex-catalog-tools{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:12px}.plex-catalog-tools p{margin:0;line-height:1.7}.plex-catalog-tools button{flex-shrink:0}.plex-library-options{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px}.plex-discard{font:inherit;background:transparent;border:0;color:var(--accent);padding:12px;cursor:pointer}.plex-save-actions{flex-wrap:wrap;align-items:center}.plex-person-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.plex-status{font-size:12px;border:1px solid var(--border);border-radius:20px;padding:5px 10px;color:var(--muted)}.plex-status-ready{color:var(--accent)}.plex-status-help{color:#f4c78a}.plex-people small{line-height:1.7;overflow-wrap:anywhere}@media(max-width:600px){.plex-catalog-tools{align-items:flex-start;flex-direction:column}.plex-library-options{grid-template-columns:1fr}}
</style>
