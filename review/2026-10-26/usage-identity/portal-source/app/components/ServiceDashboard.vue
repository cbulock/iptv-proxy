<script setup lang="ts">
import {ArrowUpRight,ArrowRight,Monitor,Play,Triangle,LifeBuoy} from 'lucide-vue-next';
const props=defineProps<{data:any;preview?:boolean}>();
const {send,refresh}=usePortal();const error=ref(''),busy=ref(false);
const plexLinked=computed(()=>!!props.data.user?.plex_id);
const connectingPlex=ref(false);
async function connectPlex(){if(props.preview||connectingPlex.value)return;connectingPlex.value=true;error.value='';try{const result=await send('auth/plex/start',{link:true,returnTo:'/'});window.location.assign(result.url);}catch(e){error.value=errorText(e);}finally{connectingPlex.value=false;}}
async function live(){if(props.preview||busy.value||props.data.grants.iptv==='revoked')return;busy.value=true;error.value='';try{if(props.data.grants.iptv==='approved'){const result=await send('iptv/launch');window.location.assign(result.url);}else{await send('iptv/request');await refresh();}}catch(e){error.value=errorText(e);}finally{busy.value=false;}}
const liveState=computed(()=>props.data.grants?.iptv||'none');
const jellyReady=computed(()=>props.data.grants?.jellyfin_state==='ready');
</script>
<template>
  <main>
    <div v-if="preview" class="preview-label">Preview · Sample account</div>
    <section class="hero"><h1>What’s on tonight?</h1><NuxtLink v-if="!preview&&data.user?.plex_id&&!data.user?.email" to="/account" class="inline-link">Add email sign-in <ArrowRight :size="16"/></NuxtLink></section>
    <CindorAlert v-if="error" class="portal-alert" tone="danger">{{error}}</CindorAlert>
    <section class="services" aria-label="Your services">
      <CindorCard class="service-card"><div class="card-art plex-art"><Play :size="63" :stroke-width="1.3"/><div class="orbit"/></div><div class="card-content"><p class="status"><span class="status-dot"/>{{!plexLinked?'Connect your account':data.plexSetup?.state==='ready'?'Ready to watch':data.plexSetup?.state==='pending'?'Accept your invitation':'Set up Plex access'}}</p><h2>Plex</h2><CindorButton variant="solid" v-if="!plexLinked" class="button primary" :disabled="preview||connectingPlex" @click="connectPlex">{{connectingPlex?'Connecting…':'Connect Plex account'}} <ArrowRight :size="17"/></CindorButton><a v-else :href="preview?undefined:data.services.plex" class="button primary" :aria-disabled="preview||undefined">Open Plex <ArrowUpRight :size="17"/></a><NuxtLink :to="preview?'/preview':'/guides?service=plex'" class="sub-action">Set up a device</NuxtLink></div></CindorCard>
      <CindorCard class="service-card"><div class="card-art jelly-art"><Triangle :size="67" :stroke-width="1.3"/><div class="orbit"/></div><div class="card-content"><p class="status"><span class="status-dot purple"/>{{jellyReady?'Ready to watch':data.grants?.jellyfin_state==='needs-review'?'Setup needs attention':'Ready to set up'}}</p><h2>Jellyfin</h2><a v-if="jellyReady" :href="preview?undefined:data.services.jellyfin" class="button">Open Jellyfin <ArrowUpRight :size="17"/></a><NuxtLink v-else :to="preview?'/preview':'/account#jellyfin'" class="button">Set up Jellyfin <ArrowRight :size="17"/></NuxtLink><NuxtLink :to="preview?'/preview':'/guides?service=jellyfin'" class="sub-action">Set up a device</NuxtLink></div></CindorCard>
      <CindorCard class="service-card"><div class="card-art tv-art"><Monitor :size="67" :stroke-width="1.3"/><div class="orbit"/></div><div class="card-content"><p class="status"><span class="status-dot teal"/>{{liveState==='approved'?'Ready to watch':liveState==='revoked'?'Access revoked':'Ready to enable'}}</p><h2>Live TV</h2><p v-if="liveState==='revoked'" class="small">Ask an administrator to restore your Live TV access.</p><CindorButton variant="ghost" class="button" :disabled="busy||liveState==='revoked'||preview" @click="live">{{busy?'Please wait…':liveState==='approved'?'Open Live TV':liveState==='revoked'?'Access revoked':'Enable Live TV'}}<ArrowRight :size="17"/></CindorButton><NuxtLink :to="preview?'/preview':'/guides?service=iptv'" class="sub-action">{{liveState==='approved'?'Set up an app':'How it works'}}</NuxtLink></div></CindorCard>
    </section>
    <a class="help-row" :href="preview?undefined:data.services.seerr" :aria-disabled="preview||undefined"><LifeBuoy :size="25" aria-hidden="true"/><div><h3>Request a title or report a problem</h3></div><span class="help-action">Requests &amp; help <ArrowUpRight :size="17" aria-hidden="true"/></span></a>
    <ServiceStatusPanel v-if="!preview"/>
    <NewsFeed v-if="!preview" compact/>
  </main>
</template>
