<script setup lang="ts">
const {state}=usePortal();if(state.value?.user?.role!=='admin')await navigateTo('/');
</script>
<template><CommunicationsAdmin kind="news"/></template>
