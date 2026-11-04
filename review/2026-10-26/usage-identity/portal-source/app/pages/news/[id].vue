<script setup lang="ts">
const {state}=usePortal(),route=useRoute();if(!state.value?.user)await navigateTo('/login?returnTo='+encodeURIComponent(route.fullPath));
const {data,error}=await useFetch<any>('/api/news/'+encodeURIComponent(String(route.params.id)));
</script>
<template><main v-if="state?.user" class="page news-article"><NuxtLink to="/news" class="inline-link">← All news</NuxtLink><p v-if="error" class="notice" role="alert">{{error.statusCode===404?'This post is no longer available.':'This post could not be loaded. Please try again.'}}</p><article v-else-if="data"><time :datetime="new Date(data.published).toISOString()">{{new Date(data.published).toLocaleDateString()}}</time><h1>{{data.title}}</h1><ContentView :content="data.content"/></article></main></template>
