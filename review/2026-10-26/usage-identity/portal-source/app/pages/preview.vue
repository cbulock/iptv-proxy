<script setup lang="ts">
const data={user:{plex_id:'sample'},grants:{iptv:'none',jellyfin_state:'none'},services:{}};
const route=useRoute();
</script>
<template><div><div class="actions"><NuxtLink class="text-button" to="/preview">Desktop preview</NuxtLink><NuxtLink class="text-button" to="/preview?phone=1">Phone preview</NuxtLink></div><iframe v-if="route.query.phone" title="Phone-sized portal preview" src="/preview" style="display:block;width:390px;max-width:100%;height:850px;border:1px solid #30363e;border-radius:14px;margin:20px auto"/><ServiceDashboard v-else :data="data" preview/></div></template>
