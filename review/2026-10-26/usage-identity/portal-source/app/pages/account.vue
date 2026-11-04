<script setup lang="ts">
import {Copy,ArrowUpRight,Check} from 'lucide-vue-next';
import {returnPath} from '#shared/return-path';
const {state,send,refresh}=usePortal();if(!state.value?.user)await navigateTo('/login');
const route=useRoute();
const liveTvError=ref('');
const liveTvSignIn={path:'/login',query:{returnTo:'/account#live-tv'}};
const busy=ref(false),error=ref(''),success=ref(''),username=ref(state.value?.grants?.jellyfin_name||''),password=ref(''),email=ref(state.value?.user?.email?'':state.value?.user?.plex_email||''),emailId=ref(''),emailCode=ref(''),credentials=ref<any>(null),copied=ref(''),confirmRotate=ref(false);
async function run(fn:()=>Promise<any>,message='Saved.'){busy.value=true;error.value='';success.value='';try{await fn();await refresh();success.value=message;}catch(e){error.value=errorText(e);}finally{password.value='';busy.value=false;}}
async function setup(){await run(()=>send('jellyfin/setup',{username:username.value,password:password.value}),'Jellyfin is ready. Use your username and password in the Jellyfin app.');}
async function reset(){await run(()=>send('jellyfin/password',{password:password.value}),'Jellyfin password updated.');}
async function linkEmail(){await run(async()=>{emailId.value=(await send('auth/email/send',{email:email.value,link:true,returnTo:route.query.verifyEmail?returnPath(route.query.returnTo):'/account'})).id;},'Verification email queued. Use its link or enter the code below.');}
async function verifyEmail(){await run(async()=>{await send('auth/email/verify',{id:emailId.value,proof:emailCode.value});emailId.value='';},'Email address verified.');if(!error.value&&route.query.verifyEmail)await navigateTo(returnPath(route.query.returnTo));}
function submitOtpOnEnter(event:KeyboardEvent){if((event.target as HTMLElement).localName==='cindor-otp-input')(event.currentTarget as HTMLFormElement).requestSubmit();}
async function linkPlex(){await run(async()=>{const result=await send('auth/plex/start',{link:true});window.location.assign(result.url);});}
async function requestLiveTv(){await run(()=>send('iptv/request'),'Live TV is enabled.');}
async function reveal(rotate=false){liveTvError.value='';await run(async()=>{credentials.value=await send('iptv/credentials',{rotate});confirmRotate.value=false;},rotate?'Old connection details are now revoked. Update your apps.':'App links ready.');liveTvError.value=error.value;}
async function copy(value:string,name:string){try{await navigator.clipboard.writeText(value);copied.value=name;}catch{error.value='Copy is unavailable in this browser. Select and copy the text manually.';}}
</script>
<template><main v-if="state?.user" class="page"><div class="page-title"><h1>Account</h1><p v-if="!state.user.email">{{state.user.plex_email?'Verify the email from Plex to enable email sign-in. You can use a different address.':'Verify an email to enable email sign-in.'}}</p><NuxtLink v-if="route.query.verifyEmail&&!state.user.email" :to="returnPath(route.query.returnTo)" class="inline-link">Skip for now</NuxtLink></div><CindorAlert v-if="error" class="portal-alert" tone="danger">{{error}} <NuxtLink v-if="error.includes('sign in again')" to="/login">Sign in again</NuxtLink></CindorAlert><div v-if="success" class="notice" role="status">{{success}}</div><PlexSetup/><div class="settings-grid">
  <section class="panel"><h2>Sign-in options</h2><dl><dt>Email</dt><dd>{{state.user.email||'Not linked'}}</dd><dt>Plex</dt><dd>{{state.user.plex_id?'Connected':'Not linked'}}</dd></dl><CindorAccordion :open="!state.user.email||!!emailId"><span slot="summary">{{state.user.email?'Change email':'Add email'}}</span><form v-if="!emailId" @submit.prevent="linkEmail"><label for="newemail">{{state.user.email?'Change email':'Add an email address'}}</label><CindorInput id="newemail" v-model="email" type="email" required autocomplete="email"/><CindorButton type="submit" variant="ghost" class="button" :disabled="busy">Verify email</CindorButton></form><form v-else @submit.prevent="verifyEmail" @keydown.enter="submitOtpOnEnter"><label id="emailcode-label" for="emailcode">Verification code for {{email}}</label><CindorOtpInput id="emailcode" v-model="emailCode" class="code-input" aria-labelledby="emailcode-label" :length="6" mode="numeric" required :disabled="busy"/><CindorButton type="submit" variant="solid" class="button primary" :disabled="busy">Confirm email</CindorButton></form></CindorAccordion></section>
  <section id="jellyfin" class="panel">
    <h2>Jellyfin</h2>
    <template v-if="state.grants.jellyfin_state==='ready'">
      <p>Your account is ready: <strong>{{state.grants.jellyfin_name}}</strong>.</p>
      <CindorAccordion>
        <span slot="summary">Change password</span>
        <form @submit.prevent="reset">
          <label for="jfpass">New password</label>
          <input id="jfpass" v-model="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password">
          <p class="small muted">At least 12 characters.</p>
          <CindorButton type="submit" variant="solid" class="button primary" :disabled="busy">{{busy?'Please wait…':'Update password'}}</CindorButton>
        </form>
      </CindorAccordion>
    </template>
    <template v-else>
      <p>Choose a login for the Jellyfin app.</p>
      <form @submit.prevent="setup">
        <label for="jfuser">Username</label>
        <input id="jfuser" v-model="username" required minlength="3" maxlength="40" pattern="[a-zA-Z0-9_.-]+" autocomplete="username" :readonly="!!state.grants.jellyfin_name">
        <label for="jfpass">Password</label>
        <input id="jfpass" v-model="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password">
        <p class="small muted">At least 12 characters.</p>
        <CindorButton type="submit" variant="solid" class="button primary" :disabled="busy">{{busy?'Please wait…':'Set up Jellyfin'}}</CindorButton>
      </form>
    </template>
    <NuxtLink to="/guides?service=jellyfin" class="inline-link">Jellyfin setup guide <ArrowUpRight :size="15"/></NuxtLink>
  </section>
  <section id="live-tv" class="panel full-width"><h2>Live TV</h2><NuxtLink to="/guides?service=iptv" class="inline-link">Live TV setup guide <ArrowUpRight :size="15"/></NuxtLink><template v-if="state.grants.iptv!=='approved'"><p v-if="state.grants.iptv==='revoked'" role="status">Live TV access was revoked. Ask an administrator to restore it.</p><CindorButton variant="ghost" v-else class="button" :disabled="busy" @click="requestLiveTv">{{busy?'Please wait…':'Enable Live TV'}}</CindorButton></template><template v-else><p>Keep these links private. Anyone with them can watch.</p><div class="actions"><CindorButton variant="ghost" class="button" :disabled="busy" @click="reveal()">{{busy?'Please wait…':'Show app links'}}</CindorButton><CindorButton variant="ghost" class="text-button" @click="confirmRotate=true">Replace links</CindorButton></div><CindorAlert v-if="liveTvError" class="portal-alert" tone="danger" role="alert">{{liveTvError}} <NuxtLink v-if="liveTvError.includes('sign in again')" :to="liveTvSignIn">Sign in again to show app links</NuxtLink></CindorAlert><div v-if="confirmRotate" class="notice"><p>This disconnects existing apps and web sessions. You’ll need to enter the new links on each device.</p><CindorButton variant="ghost" class="button" :disabled="busy" @click="reveal(true)">Replace and revoke old links</CindorButton><CindorButton variant="ghost" class="text-button" @click="confirmRotate=false">Cancel</CindorButton></div><div v-if="credentials"><p class="small muted">Your links share a three-word phrase for easier typing on a TV. Keep the words and hyphens exactly as shown. For the guide, only change /p/ to /g/.</p><div v-for="(value,name) in credentials" :key="name" class="credential"><label :for="String(name)">{{name==='playlist'?'M3U playlist':'XMLTV guide'}}</label><div class="copy-row"><input :id="String(name)" :value="value" readonly><CindorButton variant="ghost" class="icon-button" :aria-label="'Copy '+name" @click="copy(String(value),String(name))"><Check v-if="copied===name" :size="18"/><Copy v-else :size="18"/></CindorButton></div></div></div></template></section>
</div></main></template>
