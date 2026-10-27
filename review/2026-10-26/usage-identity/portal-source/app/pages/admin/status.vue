<script setup lang="ts">
import {ArrowLeft,RefreshCw} from 'lucide-vue-next';
import {freshMeasurement,measurementTime,serviceIds,serviceNames,statusLabels} from '#shared/service-status';
import type {ServiceId,ServiceNotice,StatusSnapshot} from '#shared/service-status';
const {state,send}=usePortal();
if(state.value?.user?.role!=='admin')await navigateTo('/');
const request=useRequestFetch(),publicStatus=useServiceStatus();
const overview=ref<StatusSnapshot|null>(null),error=ref(''),message=ref(''),busy=ref(false),now=ref(Date.now());
const receivedAt=ref(now.value);
const empty=()=>({id:undefined as string|undefined,services:[] as ServiceId[],type:'outage' as 'outage'|'maintenance',title:'',message:''});
const form=ref(empty()),editingPublished=ref(false);
const noticeLimitError=computed(()=>form.value.title.length>120?'Keep the title to 120 characters or fewer.':form.value.message.length>2000?'Keep the message to 2,000 characters or fewer.':'');
function selectService(id:ServiceId,checked:boolean){form.value.services=checked?[...new Set([...form.value.services,id])]:form.value.services.filter(value=>value!==id);}
const serviceList=(ids:ServiceId[])=>ids.map(id=>serviceNames[id]).join(', ');
const measurements=computed(()=>overview.value?.services.map(s=>freshMeasurement(s,measurementTime(overview.value!.serverTime,receivedAt.value,now.value)))??[]);
const history=computed(()=>overview.value?.history??[]);
const diagnosticNames:Record<string,string>={ok:'Responding',timeout:'Request timed out',unreachable:'Could not connect','http-error':'HTTP error','unexpected-response':'Unexpected response',configuration:'Check configuration needed','component-failure':'A delivery component failed','not-applicable':'Not used (built-in landing page)'};
const date=(value:number|null)=>value?new Date(value).toISOString().replace('T',' ').slice(0,19)+' UTC':'Not yet';
async function load(){overview.value=await request<StatusSnapshot>('/api/admin/status');receivedAt.value=now.value=Date.now();}
if(state.value?.user?.role==='admin')try{await load();}catch(e){error.value=errorText(e);}
async function run(action:()=>Promise<unknown>,success:string){busy.value=true;error.value='';message.value='';try{await action();await load();await publicStatus.refresh();message.value=success;}catch(e){error.value=errorText(e);}finally{busy.value=false;}}
function edit(notice:ServiceNotice){form.value={id:notice.id,services:[...notice.services],type:notice.type,title:notice.title,message:notice.message};editingPublished.value=notice.state==='published';message.value='';}
function reset(){form.value=empty();editingPublished.value=false;}
async function save(){if(noticeLimitError.value){error.value=noticeLimitError.value;return;}await run(async()=>{await send('admin/status/notices/save',form.value);reset();},editingPublished.value?'Published notice updated.':'Draft saved. Publish it when ready.');}
async function noticeAction(action:string,id:string){await run(async()=>{await send('admin/status/notices/'+action,{id});if(form.value.id===id)reset();},action==='publish'?'Notice published.':action==='resolve'?'Notice resolved.':'Draft deleted.');}
let timer:ReturnType<typeof setInterval>|undefined;
const refreshVisible=()=>{now.value=Date.now();if(document.visibilityState==='visible'&&!busy.value)void load().catch(()=>{error.value='Status updates are temporarily unavailable.';});};
onMounted(()=>{timer=setInterval(refreshVisible,30000);document.addEventListener('visibilitychange',refreshVisible);});
onBeforeUnmount(()=>{clearInterval(timer);document.removeEventListener('visibilitychange',refreshVisible);});
</script>
<template>
  <main v-if="state?.user?.role==='admin'" class="page status-admin">
    <NuxtLink to="/admin" class="inline-link"><ArrowLeft :size="15"/> Admin</NuxtLink>
    <div class="page-title"><h1>Service status</h1><p>Live checks and outage notices.</p></div>
    <CindorAlert v-if="error" class="portal-alert" tone="danger">{{error}} <NuxtLink v-if="error.includes('sign in again')" to="/login">Sign in again</NuxtLink></CindorAlert>
    <p v-if="message" class="notice" role="status">{{message}}</p>
    <section class="panel" aria-labelledby="live-checks-title">
      <div class="section-heading"><h2 id="live-checks-title">Live checks</h2><CindorButton class="button" variant="ghost" :disabled="busy" @click="run(()=>send('admin/status/check'),'Checks refreshed. Repeated checks are limited to once every 15 seconds.')"><RefreshCw :size="16"/> {{busy?'Please wait…':'Check now'}}</CindorButton></div>
      <p class="small muted">Checked from the portal every minute. Two failures at least a minute apart confirm an outage. Results expire after three minutes.</p>
      <div class="monitor-grid">
        <article v-for="service in measurements" :key="service.id" class="monitor-card" :class="service.state">
          <div class="monitor-title"><h3>{{serviceNames[service.id]}}</h3><span class="measurement-state">{{statusLabels[service.state]}}</span></div>
          <dl><dt>Last check</dt><dd>{{date(service.checkedAt)}}</dd><dt>Last response</dt><dd>{{date(service.lastSuccess)}}</dd><template v-if="service.outageSince"><dt>Outage since</dt><dd>{{date(service.outageSince)}}</dd></template><template v-if="service.recoveredAt"><dt>Recovered</dt><dd>{{date(service.recoveredAt)}}</dd></template></dl>
          <p class="small">{{diagnosticNames[service.diagnostic?.code||'configuration']||'Unexpected response'}}<span v-if="service.diagnostic?.http"> ({{service.diagnostic.http}})</span></p>
          <ul v-if="service.diagnostic?.components?.length" class="component-checks"><li v-for="component in service.diagnostic.components" :key="component.name">{{component.name==='lineup'?'Channel lineup':component.name==='viewer'?'Browser viewer':'Public gateway'}}: {{diagnosticNames[component.code]||'Unexpected response'}}</li></ul>
        </article>
      </div>
      <p class="small muted">A response check does not test every title, channel, or device. Account access and integration configuration are managed separately.</p>
    </section>
    <div class="notice-layout">
      <section class="panel notice-editor" aria-labelledby="notice-editor-title">
        <h2 id="notice-editor-title">{{form.id?'Edit notice':'New notice'}}</h2>
        <p class="small muted">Published notices appear throughout the signed-in portal. They remain visible until you resolve them.</p>
        <form @submit.prevent="save">
          <fieldset :disabled="busy"><legend>Affected services</legend><div class="service-choices"><CindorCheckbox v-for="id in serviceIds" :key="id" :model-value="form.services.includes(id)" :disabled="busy" @update:model-value="selectService(id,$event)">{{serviceNames[id]}}</CindorCheckbox></div></fieldset>
          <label for="notice-type">Type</label><CindorSelect id="notice-type" v-model="form.type" :value.attr="form.type" :disabled="busy"><option value="outage">Outage</option><option value="maintenance">Maintenance</option></CindorSelect>
          <label for="notice-title">Title</label><CindorInput id="notice-title" v-model="form.title" required :disabled="busy" aria-describedby="notice-title-limit"/><p id="notice-title-limit" class="small muted">{{form.title.length}} / 120 characters</p>
          <label for="notice-message">Message</label><CindorTextarea id="notice-message" v-model="form.message" :rows="5" required :disabled="busy" aria-describedby="notice-message-limit" placeholder="Explain what is affected and what people should expect."/><p id="notice-message-limit" class="small muted">{{form.message.length}} / 2,000 characters</p>
          <p v-if="noticeLimitError" class="notice" role="alert">{{noticeLimitError}}</p>
          <div v-if="form.title||form.message" class="notice-preview"><p class="eyebrow">PREVIEW</p><strong>{{form.title}}</strong><p>{{form.message}}</p><small>{{serviceList(form.services)}}</small></div>
          <div class="actions"><CindorButton type="submit" class="button primary" variant="solid" :disabled="busy||!form.services.length||!!noticeLimitError">{{editingPublished?'Save published notice':'Save draft'}}</CindorButton><CindorButton v-if="form.id" type="button" variant="ghost" class="text-button" :disabled="busy" @click="reset">Cancel editing</CindorButton></div>
        </form>
      </section>
      <section class="panel notice-history" aria-labelledby="notice-history-title"><h2 id="notice-history-title">Notices &amp; history</h2><p v-if="!history.length" class="small muted">No notices yet.</p>
        <article v-for="notice in history" :key="notice.id" class="history-item">
          <div class="history-meta"><span>{{notice.state==='published'?'Published':notice.state==='draft'?'Draft':'Resolved'}}</span><span>{{notice.type==='maintenance'?'Maintenance':'Outage'}}</span></div>
          <h3>{{notice.title}}</h3><p class="small muted">{{serviceList(notice.services)}}</p><p class="history-message">{{notice.message}}</p><small>Updated {{date(notice.updated)}}</small>
          <div v-if="notice.state!=='resolved'" class="actions"><CindorButton variant="ghost" class="text-button" :disabled="busy" @click="edit(notice)">Edit</CindorButton><CindorButton v-if="notice.state==='draft'" variant="solid" class="button primary" :disabled="busy" @click="noticeAction('publish',notice.id)">Publish</CindorButton><CindorButton v-if="notice.state==='published'" variant="ghost" class="button" :disabled="busy" @click="noticeAction('resolve',notice.id)">Resolve</CindorButton><CindorButton v-if="notice.state==='draft'" variant="ghost" class="text-button" :disabled="busy" @click="noticeAction('delete',notice.id)">Delete draft</CindorButton></div>
        </article>
      </section>
    </div>
  </main>
</template>
<style scoped>
.status-admin>.panel{margin-bottom:1.5rem}.monitor-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem;margin:1.3rem 0}.monitor-card{border:1px solid #ffffff1a;border-radius:12px;padding:1.1rem;min-width:0}.monitor-title{display:flex;justify-content:space-between;align-items:center;gap:.7rem;flex-wrap:wrap}.monitor-title h3{margin:0}.measurement-state{font-size:.75rem;color:#b8c5d0}.responding .measurement-state{color:#c7e892}.unavailable .measurement-state{color:#f4a493}.checking .measurement-state{color:#e3c78b}.monitor-card dl{display:grid;grid-template-columns:auto 1fr;gap:.4rem .7rem;font-size:.75rem}.monitor-card dt{color:#aab6c1}.monitor-card dd{margin:0;overflow-wrap:anywhere}.component-checks{font-size:.77rem;padding-left:1rem;color:#b8c5d0}.notice-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:1.5rem;align-items:start}.notice-editor fieldset{border:0;padding:0;margin:1rem 0}.notice-editor legend{font-size:.85rem;margin-bottom:.6rem}.service-choices{display:flex;gap:1rem;flex-wrap:wrap}.service-choices cindor-checkbox{font-size:.85rem}.notice-editor cindor-textarea{width:100%;--cindor-field-inline-size:100%}.notice-editor cindor-textarea::part(control){background:#10151a;border-color:#414a55;color:#f0f2ed;font-size:14px}.notice-preview{display:grid;gap:.65rem;padding:1rem;border:1px solid #e8bc6c55;border-radius:12px;margin:1rem 0;background:#30281b88}.notice-preview p,.history-message{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.85rem}.notice-preview .eyebrow{font-size:.65rem;margin:0}.notice-preview>strong{display:block;line-height:1.4;overflow-wrap:anywhere}.history-item{padding:1.1rem 0;border-bottom:1px solid #ffffff1a}.history-item:last-child{border-bottom:0}.history-item h3{margin:.5rem 0}.history-meta{display:flex;gap:.6rem;color:#c7d0d8;font-size:.7rem}.history-meta span{padding:.2rem .5rem;background:#ffffff0d;border-radius:20px}.history-item small{font-size:.7rem;color:#aab6c1}.history-item .actions{margin-top:.7rem}
@media(max-width:800px){.notice-layout{grid-template-columns:1fr}}@media(max-width:560px){.monitor-grid{grid-template-columns:1fr}.monitor-card dl{grid-template-columns:1fr;gap:.3rem}.monitor-card dd{margin-bottom:.4rem}.section-heading{flex-wrap:wrap}}
</style>
