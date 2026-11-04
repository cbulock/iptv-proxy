<script setup lang="ts">
import {ArrowUpRight,ChevronRight,LogOut} from 'lucide-vue-next';
import {CindorProvider} from 'cindor-ui-vue';
const {state,refresh,send}=usePortal();
const route=useRoute();
const startupError=ref('');
try{await refresh();}catch(e){startupError.value=errorText(e);}
const serviceStatus=useServiceStatus(true);
if(state.value?.user)await serviceStatus.refresh();
async function logout(){await send('auth/logout');await refresh();await navigateTo('/login');}
</script>
<template>
  <CindorProvider theme="dark" theme-family="default" primary-color="#d5ed92">
  <div class="portal-layout">
  <AuroraBackground/>
  <div class="shell">
    <header class="site-header">
      <NuxtLink class="brand" to="/"><span class="brand-mark"><ChevronRight :size="24"/></span>Bulock Media</NuxtLink>
      <nav aria-label="Main navigation">
        <NuxtLink to="/" :class="{active:route.path==='/'}">Home</NuxtLink>
        <NuxtLink v-if="state?.user" to="/guides" :class="{active:route.path==='/guides'}">Setup guides</NuxtLink>
        <NuxtLink v-if="state?.user" to="/news" :class="{active:route.path.startsWith('/news')}">News</NuxtLink>
        <NuxtLink v-if="state?.user" to="/account">Account</NuxtLink>
        <NuxtLink v-if="state?.user?.role==='admin'" to="/admin">Admin</NuxtLink>
        <CindorButton variant="ghost" v-if="state?.user" class="icon-button" aria-label="Sign out" @click="logout"><LogOut :size="17"/></CindorButton>
        <NuxtLink v-else-if="route.path!=='/login'" to="/login" class="nav-signin">Sign in <ArrowUpRight :size="14"/></NuxtLink>
      </nav>
    </header>
    <CindorAlert v-if="startupError" class="portal-alert" tone="danger">{{startupError}}</CindorAlert>
    <OutageNotices v-if="state?.user&&route.path!=='/preview'"/>
    <NuxtPage/>
    <footer><span>Bulock Media</span></footer>
  </div>
  </div>
  </CindorProvider>
</template>

<style scoped>
.portal-layout{position:relative;isolation:isolate;min-height:100svh}
.shell{position:relative;z-index:1}
</style>
