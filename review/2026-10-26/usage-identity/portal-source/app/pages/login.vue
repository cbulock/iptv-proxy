<script setup lang="ts">
import {ArrowRight,Mail,Play} from 'lucide-vue-next';
import {returnPath} from '#shared/return-path';
const {state,send,refresh}=usePortal();const route=useRoute();
const destination=computed(()=>returnPath(route.query.returnTo));
const email=ref(''),code=ref(''),challenge=ref(''),proof=ref(''),busy=ref(false),error=ref(''),sent=ref(false),notice=ref('');
async function action(fn:()=>Promise<void>){busy.value=true;error.value='';try{await fn();}catch(e){error.value=errorText(e);}finally{busy.value=false;}}
async function request(){await action(async()=>{const result=await send('auth/email/send',{email:email.value,returnTo:destination.value});notice.value=result.message;sent.value=!!result.queued;challenge.value=result.id||'';});}
async function verify(){await action(async()=>{await send('auth/email/verify',{id:challenge.value,proof:proof.value||code.value});await refresh();await navigateTo(destination.value);});}
function submitOtpOnEnter(event:KeyboardEvent){if((event.target as HTMLElement).localName==='cindor-otp-input')(event.currentTarget as HTMLFormElement).requestSubmit();}
async function plex(){await action(async()=>{const result=await send('auth/plex/start',{returnTo:destination.value});window.location.assign(result.url);});}
onMounted(()=>{const params=new URLSearchParams(window.location.hash.slice(1));if(params.has('challenge')){challenge.value=params.get('challenge')||'';proof.value=params.get('proof')||'';window.history.replaceState(null,'',window.location.pathname+window.location.search);}
if(route.query.plex)void action(async()=>{const result=await send('auth/plex/finish');await refresh();const next=returnPath(result.returnTo);await navigateTo(!state.value?.user?.email?{path:'/account',query:{verifyEmail:'1',returnTo:next}}:next);});});
</script>
<template>
  <main class="login-layout login-compact">
    <section class="login-form"><div class="login-heading"><h1>{{proof?'Confirm sign-in':sent?'Enter your code':'Sign in'}}</h1><p v-if="sent&&!proof">Use the email link or enter its code below.</p></div>
      <p v-if="notice&&!sent&&!proof" class="notice" role="status">{{notice}}</p>
      <CindorAlert v-if="error" class="portal-alert" tone="danger">{{error}}</CindorAlert>
      <template v-if="proof"><CindorButton variant="solid" class="button primary" :disabled="busy" @click="verify">{{busy?'Signing in…':'Confirm sign-in'}}<ArrowRight :size="18"/></CindorButton></template>
      <form v-else-if="sent" @submit.prevent="verify" @keydown.enter="submitOtpOnEnter"><label id="code-label" for="code">Six-digit code</label><CindorOtpInput id="code" v-model="code" class="code-input" aria-labelledby="code-label" :length="6" mode="numeric" required :disabled="busy"/><p class="small muted" role="status">{{notice}}</p><CindorButton type="submit" variant="solid" class="button primary" :disabled="busy">{{busy?'Signing in…':'Sign in'}}<ArrowRight :size="17"/></CindorButton><CindorButton variant="ghost" class="text-button" type="button" :disabled="busy" @click="request">Send a new email</CindorButton><CindorButton variant="ghost" class="text-button" type="button" @click="sent=false">Use another address</CindorButton></form>
      <template v-else><CindorButton variant="ghost" class="button plex-login" :disabled="busy||!state?.configured?.plex" @click="plex"><Play :size="18"/>Continue with Plex<ArrowRight :size="17"/></CindorButton><p v-if="!state?.configured?.plex&&state?.configured?.email" class="small muted">Plex sign-in is unavailable.</p><div class="divider">or</div><form @submit.prevent="request"><label for="email">Email address</label><CindorInput id="email" v-model="email" type="email" autocomplete="email" placeholder="you@example.com" required/><CindorButton type="submit" variant="solid" class="button primary" :disabled="busy||!state?.configured?.email"><Mail :size="17"/>{{busy?'Sending…':'Send link & code'}}</CindorButton><p v-if="!state?.configured?.email" class="small muted">{{!state?.configured?.plex?'Sign-in is temporarily unavailable.':'Email sign-in is unavailable.'}}</p></form></template>
      <CindorAccordion v-if="sent&&!proof"><span slot="summary">Didn’t get an email?</span><p class="small">Email sign-in works with a verified address or an invitation. If you joined with Plex, sign in with Plex and add your email in Account first.</p><p class="small">Already linked? Check spam, confirm the address, or send a new email.</p><CindorButton variant="ghost" type="button" class="text-button" :disabled="busy||!state?.configured?.plex" @click="plex">Continue with Plex</CindorButton></CindorAccordion>
    </section>
  </main>
</template>
