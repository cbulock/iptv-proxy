<script setup lang="ts">
import {ArrowRight,ArrowUpRight} from 'lucide-vue-next';
import type {LiveTvGuide} from '#shared/live-tv-guides';
defineProps<{guide?:LiveTvGuide}>();
const {state,send,refresh}=usePortal();
const access=computed(()=>state.value?.grants?.iptv||'none');
const approved=computed(()=>access.value==='approved');
const busy=ref(false),error=ref('');
async function request(){if(busy.value||approved.value||access.value==='revoked')return;busy.value=true;error.value='';try{await send('iptv/request');await refresh();}catch(e){error.value=errorText(e);}finally{busy.value=false;}}
async function launch(){if(busy.value||!approved.value)return;busy.value=true;error.value='';try{const result=await send('iptv/launch');window.location.assign(result.url);}catch(e){error.value=errorText(e);}finally{busy.value=false;}}
</script>
<template>
 <section class="panel live-tv-setup"><h2>Your Live TV access</h2>
  <template v-if="approved"><p>Live TV is enabled. Watch now, or set up a player app.</p><div class="actions"><CindorButton variant="solid" class="button primary" :disabled="busy" @click="launch">{{busy?'Opening…':'Open Live TV'}} <ArrowUpRight :size="16"/></CindorButton><NuxtLink to="/account#live-tv" class="inline-link">Get app links <ArrowRight :size="16"/></NuxtLink></div></template>
  <p v-else-if="access==='revoked'" role="status">Your Live TV access was revoked. Ask an administrator to restore it.</p>
  <template v-else><p>Enable Live TV for immediate access to browser playback and your personal app links.</p><CindorButton variant="solid" class="button primary" :disabled="busy" @click="request">{{busy?'Enabling…':'Enable Live TV'}}</CindorButton></template>
  <CindorAlert v-if="error" class="portal-alert" tone="danger">{{error}} <NuxtLink v-if="error.includes('sign in again')" to="/login">Sign in again</NuxtLink></CindorAlert>
  <p v-if="!approved" class="small muted">Live TV activation is separate from your Plex and Jellyfin access.</p>
 </section>
 <section v-if="guide" class="panel guide-panel"><h2>Watch on {{guide.name}}</h2>
  <template v-if="guide.mode==='alternative'">
   <ol class="steps plex-steps"><li><h3>Choose a supported way to watch</h3><p>{{guide.install}}</p><p class="small muted">App availability and support vary by TV model and region.</p></li>
    <li><h3>Open the guide for your player</h3><p>For an external streaming device, switch your TV to its HDMI input and follow that device’s guide.</p><div class="actions"><NuxtLink to="/guides?service=iptv&amp;device=google-tv" class="button">Google TV / Android TV</NuxtLink><NuxtLink to="/guides?service=iptv&amp;device=fire-tv" class="button">Fire TV</NuxtLink><NuxtLink to="/guides?service=iptv&amp;device=apple-tv" class="button">Apple TV</NuxtLink></div></li>
    <li><h3>Or watch in your browser</h3><p>Open Bulock Media on a phone or computer and follow the browser guide. You can also connect a computer to your TV with HDMI and choose that input.</p><NuxtLink to="/guides?service=iptv&amp;device=browser" class="button">Web browser guide <ArrowRight :size="16"/></NuxtLink></li></ol>
  </template>
  <ol v-else-if="guide.mode==='browser'" class="steps plex-steps">
   <li><h3>Open Live TV from Bulock Media</h3><p>{{guide.install}} Once Live TV is enabled, choose Open Live TV above or on the portal home page. This signs your browser into the player.</p><p class="small muted">Open Live TV again from the portal if a launch link expires. Bookmark the portal rather than the temporary launch link.</p></li>
   <li><h3>Choose a channel</h3><p>Wait for the channel list to load, then use Choose a channel to pick something to watch. Press Play in the video controls if playback does not start automatically.</p></li>
   <li><h3>Adjust playback if needed</h3><p>If a channel fails to start or plays without sound, try the Compatibility mode checkbox beneath the video. Browser playback support varies; if the browser says it cannot play the stream, try a different browser or a supported player app.</p></li>
   <li><h3>Return next time</h3><p>Choose another channel from the list to switch. Use Refresh channels if the list is out of date. If your viewing session has ended, return to Bulock Media and choose Open Live TV again.</p><p class="small muted">The browser player offers a channel selector. For a programme grid, use a player app with your XMLTV guide link.</p></li>
  </ol>
  <template v-else>
   <p class="small muted">These are third-party players. Their optional upgrades and purchases are separate from your Bulock Media access. Menu labels can change between versions.</p>
   <ol class="steps plex-steps">
    <li><h3>Install {{guide.app}}</h3><p>{{guide.install}}</p><a :href="guide.href" class="button primary" target="_blank" rel="noopener noreferrer">{{guide.link}} <ArrowUpRight :size="16"/></a></li>
    <li><h3>Get your personal app links</h3><p>After enabling Live TV, open Account → Live TV and choose Show app links. Copy the M3U playlist link for channels and the XMLTV guide link for programme listings. If asked to sign in again, return to Account afterward.</p><p>On a TV, type the three-word phrase and its hyphens exactly as shown. Both links use the same phrase: the playlist has /p/ before it, and the guide has /g/.</p><NuxtLink to="/account#live-tv" class="button">Open your Live TV account <ArrowRight :size="16"/></NuxtLink><p class="small muted">Keep both links private. Anyone with them can watch using your access. Enter them only into a player you trust; do not paste them into public playlist sites or share them in screenshots.</p></li>
    <li><h3>Add your channel playlist</h3><p>{{guide.playlist}}</p><p class="small muted">Copy the entire link, including https:// and the private part of the address. This setup uses an M3U URL, not a separate IPTV username, password, or Xtream Codes login. Your portal, Plex, and Jellyfin passwords do not belong in those fields.</p></li>
    <li><h3>{{guide.mode==='vlc'?'About the programme guide':'Add the programme guide'}}</h3><p>{{guide.epg}}</p><p v-if="guide.mode==='app'" class="small muted">The playlist and guide are different links. Use the XMLTV guide link in the EPG field; do not put it in the playlist field.</p></li>
    <li><h3>Pick a channel and watch</h3><p v-if="guide.mode==='vlc'">Open VLC’s playlist view to see the loaded channels, then double-click a channel to play it. Return to that list to switch channels. Reopen the M3U URL when you need to reload the current channel list.</p><p v-else>Open Bulock Live TV in {{guide.app}}, select a channel from the list or programme grid, and press Play or OK. Allow a few seconds for the live stream to start. Add frequently watched channels to Favorites if your player offers it.</p></li>
   </ol>
  </template>
  <div class="guide-troubleshooting"><h3>Having trouble?</h3>
   <CindorAccordion><span slot="summary">My Live TV access is not active</span><p>Choose Enable Live TV above for immediate access. If your access was revoked, an administrator must restore it; signing in again or installing another app will not restore access. Use Requests &amp; help below to get help.</p></CindorAccordion>
   <CindorAccordion v-if="guide.mode!=='browser'&&guide.mode!=='alternative'"><span slot="summary">The playlist won’t load or the app asks for a login</span><p>Check that Live TV is enabled and you selected M3U URL as the playlist type. Copy the full M3U playlist link from Account again, without extra spaces. If your links were replaced, update this app with the new links. Portal sign-in works in the browser; player apps use your personal links.</p></CindorAccordion>
   <CindorAccordion v-if="guide.mode==='app'"><span slot="summary">Channels work but the programme guide is empty or the times are wrong</span><p>Check that your XMLTV guide link is saved as the EPG source for this playlist, then refresh the guide. Set your device’s date, time, and time zone correctly. Some channels may have no programme data; missing listings do not necessarily mean the stream is unavailable.</p></CindorAccordion>
   <CindorAccordion><span slot="summary">A channel buffers, has no sound, or won’t play</span><p>Try another channel and check your internet connection. Close and reopen the player, and install any available app update. In the browser player, try Compatibility mode. If one channel still fails while others work, it may be unavailable at the source. Report the channel, device, approximate time, and error message using Requests &amp; help below.</p></CindorAccordion>
   <CindorAccordion><span slot="summary">The browser launch link or session expired</span><p>Return to the portal, sign in if asked, and choose Open Live TV again. Launch links are temporary and can be used only once; reopening an old link does not create a fresh viewing session.</p><NuxtLink to="/" class="inline-link">Return to Bulock Media <ArrowRight :size="16"/></NuxtLink></CindorAccordion>
   <CindorAccordion><span slot="summary">I replaced or accidentally shared my app links</span><p>On Account → Live TV, choose Replace links and confirm. This revokes the old links and disconnects existing apps and browser viewing sessions. Copy the new playlist and guide links into each of your apps, and reopen browser playback from the portal.</p><NuxtLink to="/account#live-tv" class="inline-link">Manage your Live TV links <ArrowRight :size="16"/></NuxtLink></CindorAccordion>
  </div>
 </section><p v-else class="guide-help">Choose a device above for setup instructions.</p>
</template>
