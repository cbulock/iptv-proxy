<script setup lang="ts">
import {ArrowUpRight,Copy} from 'lucide-vue-next';
import type {JellyfinGuide} from '#shared/jellyfin-guides';
defineProps<{guide?:JellyfinGuide}>();
const {state}=usePortal();
const address=computed(()=>state.value?.services?.jellyfin);
const ready=computed(()=>state.value?.grants?.jellyfin_state==='ready');
const needsHelp=computed(()=>['creating','needs-review'].includes(state.value?.grants?.jellyfin_state));
const copied=ref(false),copyError=ref('');
watch(address,()=>{copied.value=false;copyError.value='';});
async function copy(){if(!address.value)return;try{await navigator.clipboard.writeText(address.value);copied.value=true;}catch{copyError.value='Select and copy the address manually; clipboard access is unavailable.';}}
</script>
<template>
 <section class="panel jellyfin-setup"><h2>Your Jellyfin account</h2>
  <template v-if="ready"><p>Your account is ready. Sign in to Jellyfin as <strong>{{state.grants.jellyfin_name}}</strong> using the password you chose on your Account page.</p><NuxtLink to="/account#jellyfin" class="inline-link">Manage your Jellyfin password <ArrowUpRight :size="16"/></NuxtLink></template>
  <template v-else-if="needsHelp"><p>Your Jellyfin setup needs attention. Open your Account page to check its status. If setup remains unfinished, use Requests &amp; help below.</p><NuxtLink to="/account#jellyfin" class="button">Check your account</NuxtLink></template>
  <template v-else><p>First, create your Jellyfin username and password on your Account page. Choose a username and a password with at least 12 characters, then select Set up Jellyfin. Return here when your account is ready.</p><NuxtLink to="/account#jellyfin" class="button primary">Set up your Jellyfin account</NuxtLink></template>
  <p class="small muted">Use the Jellyfin login you created here. Your Plex login or portal email sign-in does not sign you in to Jellyfin.</p>
 </section>
 <section v-if="guide" class="panel guide-panel"><h2>Watch on {{guide.name}}</h2>
  <ol class="steps plex-steps">
   <li><h3>{{guide.id==='browser'?'Open Jellyfin':`Install ${guide.app}`}}</h3><p>{{guide.install}}</p><a v-if="guide.id!=='browser'||address" :href="guide.id==='browser'?address:guide.href" class="button primary" target="_blank" rel="noopener noreferrer">{{guide.link}} <ArrowUpRight :size="16"/></a></li>
   <li><h3>{{guide.id==='browser'?'Check the server address':'Connect to Bulock Video'}}</h3><p v-if="guide.id==='browser'">The button above opens our Jellyfin server directly. You do not need to install or create a server of your own.</p><p v-else>Choose Add Server or the option to enter a server manually in {{guide.app}}. Enter the full address below, including https:// and any path. Keep any port already in the address; do not add a different one. Then choose Connect or continue.</p>
    <div v-if="address" class="copy-row server-address"><code>{{address}}</code><CindorButton variant="ghost" class="icon-button" :aria-label="copied?'Copied':'Copy Jellyfin server address'" @click="copy"><Copy :size="17"/>{{copied?'Copied':''}}</CindorButton></div><p v-else role="status">The Jellyfin server address is unavailable. Use Requests &amp; help below before continuing.</p><p v-if="copyError" role="status">{{copyError}}</p><p v-if="guide.id!=='browser'" class="small muted">Automatic server discovery may not find Bulock Video when you are away from home. Use the address above instead.</p>
   </li>
   <li><h3>Sign in to Jellyfin</h3><p>Enter your Jellyfin username{{ready?` (${state.grants.jellyfin_name})`:''}} and the password you created on your Account page. If the app shows a list of users and yours is missing, look for Manual Login or an option to enter your username.</p>
    <CindorAccordion v-if="guide.tv"><span slot="summary">Use Quick Connect if your app offers it</span><p>On your TV, choose Quick Connect and leave its code visible. On a phone or computer, open our Jellyfin server and sign in with your Jellyfin username and password. Open Settings, choose Quick Connect, enter the code from your TV, and confirm. Only approve a code from your own device. If Quick Connect is unavailable, use your username and password on the TV.</p><a v-if="address" :href="address" class="inline-link" target="_blank" rel="noopener noreferrer">Open Jellyfin to approve your device <ArrowUpRight :size="16"/></a></CindorAccordion>
   </li>
   <li><h3>Find your libraries and play something</h3><p>On the Jellyfin home screen, open a library available to your account, such as Movies or TV Shows. Pick a movie, or choose a show and an episode, then press Play. Your available libraries depend on your access.</p><p class="small muted">Next time, open {{guide.app}} and select this server if asked. The app may remember your sign-in on this device.</p></li>
  </ol>
  <div class="guide-troubleshooting"><h3>Having trouble?</h3>
   <CindorAccordion><span slot="summary">The app can’t find or connect to the server</span><p>Enter the full address shown above manually and check for typing errors or spaces. Try opening the same address in a browser on your phone or computer. Check your internet connection and restart the app. If the browser cannot open it either, use Requests &amp; help below and include the device and error message.</p></CindorAccordion>
   <CindorAccordion><span slot="summary">My username or password isn’t working</span><p>Check that Jellyfin is ready on your Account page and use the username shown there. Passwords are case-sensitive. You can set a new Jellyfin password on your Account page, then try signing in again. Your Plex password and portal email sign-in link are separate.</p><NuxtLink to="/account#jellyfin" class="inline-link">Open your Jellyfin account <ArrowUpRight :size="16"/></NuxtLink></CindorAccordion>
   <CindorAccordion v-if="guide.tv"><span slot="summary">Quick Connect isn’t working</span><p>Get a fresh code from the TV and keep that screen open. On your other device, sign in to the same Jellyfin server before opening Settings → Quick Connect. If the option is missing or the code still fails, use your Jellyfin username and password directly on the TV.</p></CindorAccordion>
   <CindorAccordion><span slot="summary">I’m signed in but don’t see any libraries</span><p>Check that you connected to the address above with your own Jellyfin username. Close and reopen the app. If your libraries are still missing, use Requests &amp; help below so your access can be checked.</p></CindorAccordion>
   <CindorAccordion v-if="guide.tv"><span slot="summary">I can’t find the app on my TV</span><p>App availability depends on your TV model, software version, and region. Check for a TV software update and review the Jellyfin client list. If no app is available, use a supported streaming device or choose Web browser in this guide.</p><a href="https://jellyfin.org/downloads/clients/all/" class="inline-link" target="_blank" rel="noopener noreferrer">Check compatible apps <ArrowUpRight :size="16"/></a></CindorAccordion>
   <CindorAccordion v-if="guide.id==='roku'"><span slot="summary">Roku says a subscription is required</span><p>The Roku listing may show a cable or satellite subscription notice because of a store limitation. Jellyfin does not require that subscription. Use the Jellyfin account you created here.</p></CindorAccordion>
   <CindorAccordion><span slot="summary">A title won’t play or keeps buffering</span><p>Try another title, check your connection, then close and reopen the app. Install any available app update. If the problem continues, use Requests &amp; help below and include the title, device, and exact error message. Seerr may ask you to sign in.</p></CindorAccordion>
  </div>
 </section><p v-else class="guide-help">Choose a device to see its app link and setup steps.</p>
</template>
