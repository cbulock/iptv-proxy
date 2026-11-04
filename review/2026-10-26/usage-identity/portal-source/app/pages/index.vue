<script setup lang="ts">
const {state}=usePortal();
if(!state.value?.user)await navigateTo('/login');
</script>
<template><ServiceDashboard v-if="state?.user" :data="state"/></template>
