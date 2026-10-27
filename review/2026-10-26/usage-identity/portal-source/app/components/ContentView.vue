<script setup lang="ts">
import {renderContent} from '#shared/content';
const props=defineProps<{content:unknown}>();
const html=computed(()=>{try{return renderContent(props.content);}catch{return '';}});
</script>
<template><div class="formatted-content" v-html="html"/></template>
