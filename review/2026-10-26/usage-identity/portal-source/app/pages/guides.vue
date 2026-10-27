<script setup lang="ts">
import {ArrowUpRight,Copy} from 'lucide-vue-next';
import {plexGuides,plexGuide} from '#shared/plex-guides';
import {jellyfinGuides,jellyfinGuide} from '#shared/jellyfin-guides';
import {liveTvGuides,liveTvGuide} from '#shared/live-tv-guides';
const {state}=usePortal();const route=useRoute();
if(!state.value?.user)await navigateTo({path:'/login',query:{returnTo:route.fullPath}});
const services=[{id:'plex',name:'Plex'},{id:'jellyfin',name:'Jellyfin'},{id:'iptv',name:'Live TV'}];
const service=computed(()=>services.some(s=>s.id===route.query.service)?String(route.query.service):'plex');
const guide=computed(()=>plexGuide(route.query.device));
const jellyGuide=computed(()=>jellyfinGuide(route.query.device));
const liveGuide=computed(()=>liveTvGuide(route.query.device));
const deviceGuides=computed(()=>service.value==='jellyfin'?jellyfinGuides:service.value==='iptv'?liveTvGuides:plexGuides);
const device=computed({get:()=>service.value==='plex'?guide.value?.id||'':service.value==='jellyfin'?jellyGuide.value?.id||'':liveGuide.value?.id||'',set:(value:string)=>{void navigateTo({path:'/guides',query:{service:service.value,...(value?{device:value}:{})}});}});
const copied=ref(false),copyError=ref('');
watch(()=>route.fullPath,()=>{copied.value=false;copyError.value='';});
const address=computed(()=>service.value==='jellyfin'?state.value?.services?.jellyfin:state.value?.services?.plex);
async function copy(){try{await navigator.clipboard.writeText(address.value);copied.value=true;}catch{copyError.value='Select and copy the address manually; clipboard access is unavailable.';}}
</script>
<template><main v-if="state?.user" class="page"><div class="page-title"><h1>Setup guides</h1></div>
 <div class="guide-controls"><div class="tabs" aria-label="Choose service"><CindorButton variant="ghost" v-for="s in services" :key="s.id" :class="{selected:service===s.id}" :aria-pressed="service===s.id" @click="navigateTo({path:'/guides',query:{service:s.id}})">{{s.name}}</CindorButton></div>
 <label class="device-choice">Where will you watch?<CindorSelect v-model="device" :value.attr="device"><option value="">Choose your device</option><optgroup v-for="group in ['TV','Phone / tablet','Computer']" :key="group" :label="group"><option v-for="g in deviceGuides.filter(g=>g.group===group)" :key="g.id" :value="g.id">{{g.name}}</option></optgroup></CindorSelect></label></div>
 <template v-if="service==='plex'">
  <PlexSetup/>
  <section v-if="guide" class="panel guide-panel"><h2>Watch on {{guide.name}}</h2><p class="small muted">Use your connected Plex account. Bulock Video’s Plex Pass covers ordinary streaming, so you don’t need your own paid subscription.</p>
   <ol class="steps plex-steps">
    <li><h3>{{guide.id==='browser'?'Open Plex':'Install Plex'}}</h3><p>{{guide.install}}</p><a :href="guide.id==='browser'?address:guide.href" class="button primary" target="_blank" rel="noopener noreferrer">{{guide.link}} <ArrowUpRight :size="16"/></a>
     <div v-if="guide.id==='browser'&&address" class="copy-row server-address"><code>{{address}}</code><CindorButton variant="ghost" class="icon-button" :aria-label="copied?'Copied':'Copy Plex browser address'" @click="copy"><Copy :size="17"/>{{copied?'Copied':''}}</CindorButton></div><p v-if="copyError" role="status">{{copyError}}</p>
    </li>
    <li><h3>Sign in to Plex</h3><p v-if="guide.id==='roku'">Choose Sign In in the Roku app and follow its on-screen prompts using your connected Plex account. Roku uses on-device sign-in; you do not need to look for a TV link code.</p><template v-else-if="guide.tv"><p>Choose Sign In on your TV. Scan the QR code shown, or open Link your TV on a phone or computer. Sign in to your connected Plex account and enter the code displayed on the TV. Leave Plex open on the TV while it connects.</p><a href="https://plex.tv/link" target="_blank" rel="noopener noreferrer" class="button">Link your TV <ArrowUpRight :size="16"/></a></template><p v-else>Choose Sign In and use the Plex account you connected above, including the same Google, Apple, or email sign-in method. If the app opens a browser to finish signing in, return to the app afterward.</p></li>
    <li><h3>Find Bulock Video</h3><p>{{guide.find}}</p><p class="small muted">Choose libraries under Bulock Video. Plex’s own free movies, shows, and live channels are a separate catalog.</p></li>
    <li><h3>Play something</h3><p>Choose a movie or show from a shared library. For a show, choose an episode, then press Play.</p><p class="small muted">{{guide.pin}}</p></li>
   </ol>
   <div class="guide-troubleshooting"><h3>Having trouble?</h3>
    <CindorAccordion><span slot="summary">I can’t find Bulock Video</span><p>Check that Plex is signed in to the same account you connected above. Check access above and accept any pending invitation. Look under Libraries or More for the libraries shared with you.</p></CindorAccordion>
    <CindorAccordion><span slot="summary">I’m signed in to the wrong account</span><p>Sign out in the Plex app and sign back in with the connected account. Signing into User Center with email does not automatically sign your devices into Plex.</p></CindorAccordion>
    <CindorAccordion v-if="guide.tv&&guide.id!=='roku'"><span slot="summary">My TV code isn’t working</span><p>Return to Sign In on the TV to get a new code. On your phone or computer, check that the linking page is signed in to the right Plex account, then enter the new code.</p></CindorAccordion>
    <CindorAccordion><span slot="summary">I only see Plex’s free movies and shows</span><p>Open Libraries or the sidebar’s More option and select Bulock Video. Its shared libraries are separate from Plex’s free catalog and Discover.</p></CindorAccordion>
    <CindorAccordion><span slot="summary">Plex asks me to pay</span><p>You don’t need your own paid subscription for ordinary streaming from Bulock Video. Check that you selected this server and the correct account. Rentals, downloads, and other optional features can have separate requirements.</p></CindorAccordion>
    <CindorAccordion><span slot="summary">A title won’t play</span><p>Try another title, then close and reopen Plex. Check for an app update. If the problem continues, use Requests &amp; help below and include the title, device, and error message. It may ask you to sign in.</p></CindorAccordion>
   </div>
  </section><p v-else class="guide-help">Choose a device to see its app link and setup steps.</p>
 </template>
 <JellyfinGuide v-else-if="service==='jellyfin'" :guide="jellyGuide"/>
 <LiveTvGuide v-else :guide="liveGuide"/>
 <p class="guide-help">Still stuck? <a :href="state.services.seerr">Open Requests &amp; help</a>. Seerr may ask you to sign in.</p>
</main></template>
