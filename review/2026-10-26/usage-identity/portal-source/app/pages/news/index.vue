<script setup lang="ts">
const {state}=usePortal();if(!state.value?.user)await navigateTo('/login?returnTo=/news');
</script>
<template><main v-if="state?.user" class="page"><div class="page-title"><h1>News</h1></div><p class="muted">The latest updates from Bulock Media.</p><NewsFeed/></main></template>
