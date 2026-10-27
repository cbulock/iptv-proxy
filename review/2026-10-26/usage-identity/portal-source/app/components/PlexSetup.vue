<script setup lang="ts">
const {state,send,refresh}=usePortal();const route=useRoute();
const busy=ref(false),activeAction=ref(''),error=ref(''),message=ref('');
const setup=computed(()=>state.value?.plexSetup);
const titles:Record<string,string>={connect:'Connect Plex account',unchecked:'Check your Plex access',eligible:'Enable Plex access',sending:'Sending invitation',pending:'Accept your invitation',ready:'Ready to watch',help:'Setup needs help'};
async function run(action:string){if(busy.value)return;busy.value=true;activeAction.value=action;error.value='';message.value='';try{
 if(action==='connect'){const result=await send('auth/plex/start',{link:true,returnTo:route.fullPath});window.location.assign(result.url);return;}
 const result=await send('plex/'+action);await refresh();if(action==='help')message.value='Your help request has been recorded.';
 if(action==='check'){
  const feedback:Record<string,string>={ready:'Access confirmed. You’re ready to watch Bulock Video.',pending:'Your invitation is still waiting to be accepted in Plex.',eligible:'Access checked. Select Enable Plex access to receive your invitation.',sending:'Your invitation is still being sent. Check again in a moment.',help:'Access checked. Setup needs help; review the message above.',connect:'Connect your Plex account before checking access.'};
  message.value=feedback[result.state]||'The access check is still in progress. Please check again in a moment.';
 }
 }catch(e){error.value=errorText(e);}finally{busy.value=false;activeAction.value='';}}
onMounted(()=>{if(state.value?.user?.plex_id)void run('check');});
</script>
<template><section v-if="setup" id="plex" class="panel plex-setup" aria-labelledby="plex-setup-title" :aria-busy="busy">
 <p class="eyebrow">Bulock Video</p><h2 id="plex-setup-title">{{titles[setup.state]||'Plex setup'}}</h2>
 <p v-if="setup.state==='connect'">New to Plex? Create a free Plex account first, then return here to connect it. Already have one? Connect that account. It can use a different email from your User Center account.</p>
 <p v-else-if="setup.state==='eligible'">Your portal invitation includes Plex access. Enable it to receive your Bulock Video invitation.</p>
 <p v-else-if="setup.state==='pending'">Open Plex invitations and accept the invitation to Bulock Video. Then return here and check access.</p>
 <p v-else-if="setup.state==='ready'">Sign in to Plex with your connected account and choose Bulock Video.</p>
 <p v-else-if="setup.state==='sending'">Your invitation is being sent. Check access in a moment.</p>
 <p v-else-if="setup.state==='help'">{{setup.error}}</p>
 <p v-else>Check whether your connected Plex account can watch Bulock Video.</p>
 <CindorAlert v-if="error" class="portal-alert" tone="danger">{{error}} <NuxtLink v-if="error.includes('sign in again')" :to="{path:'/login',query:{returnTo:route.fullPath}}">Sign in again</NuxtLink></CindorAlert>
 <p v-if="message||setup.help" class="notice" role="status">{{message||'Your help request has been recorded.'}}</p>
 <div class="actions">
  <a v-if="setup.state==='connect'" href="https://www.plex.tv/sign-up/" class="button" target="_blank" rel="noopener noreferrer">Create a free Plex account</a>
  <CindorButton variant="solid" v-if="setup.state==='connect'" class="button primary" :disabled="busy" @click="run('connect')">Connect Plex account</CindorButton>
  <CindorButton variant="solid" v-if="setup.canEnable" class="button primary" :disabled="busy" @click="run('enable')">{{activeAction==='enable'?'Sending invitation…':'Enable Plex access'}}</CindorButton>
  <a v-if="setup.state==='pending'" href="https://app.plex.tv/desktop/#!/settings/manage-library-access" target="_blank" rel="noopener noreferrer" class="button primary">Open Plex invitations</a>
  <CindorButton variant="ghost" v-if="setup.canCheck&&setup.state!=='ready'" class="button" :disabled="busy" @click="run('check')">{{activeAction==='check'?'Checking access…':'Check access'}}</CindorButton>
  <CindorButton variant="ghost" v-if="setup.canHelp&&!setup.help" class="button" :disabled="busy" @click="run('help')">Ask Cameron for help</CindorButton>
 </div>
</section></template>
