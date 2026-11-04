<script setup lang="ts">
import {AlertTriangle,Wrench} from 'lucide-vue-next';
import {serviceNames,statusLabels} from '#shared/service-status';
import type {ServiceId} from '#shared/service-status';
const serviceList=(ids:ServiceId[])=>ids.map(id=>serviceNames[id]).join(', ');
const {data,services}=useServiceStatus();
const notices=computed(()=>data.value?.notices??[]);
const uncovered=computed(()=>services.value.filter(s=>s.state==='unavailable'&&!notices.value.some(n=>n.services.includes(s.id))));
const time=(value:number)=>new Date(value).toISOString().replace('T',' ').slice(0,16)+' UTC';
</script>
<template>
  <aside v-if="notices.length||uncovered.length" class="outage-notices" aria-label="Service notices" aria-live="polite">
    <article v-for="notice in notices" :key="notice.id" class="outage-notice" :class="notice.type">
      <Wrench v-if="notice.type==='maintenance'" :size="20" aria-hidden="true"/><AlertTriangle v-else :size="20" aria-hidden="true"/>
      <div><p class="notice-kind">{{notice.type==='maintenance'?'Maintenance':'Outage'}} · {{serviceList(notice.services)}}</p><h2>{{notice.title}}</h2><p class="notice-message">{{notice.message}}</p><p class="notice-measurements"><span v-for="service in services.filter(s=>notice.services.includes(s.id))" :key="service.id">{{serviceNames[service.id]}}: {{statusLabels[service.state]}}</span></p><small>Updated {{time(notice.updated)}}</small></div>
    </article>
    <article v-for="service in uncovered" :key="service.id" class="outage-notice outage"><AlertTriangle :size="20" aria-hidden="true"/><div><h2>{{serviceNames[service.id]}} is currently unavailable</h2><p>Our checks could not reach this service. Please try again later.</p></div></article>
  </aside>
</template>
<style scoped>
.outage-notices{display:grid;gap:.75rem;margin:1rem 0}.outage-notice{display:flex;align-items:flex-start;gap:.9rem;padding:1.1rem 1.3rem;border:1px solid #e8bc6c55;background:#30281bd9;border-radius:14px;color:#f0d29b}.outage-notice.outage{border-color:#ee9a8055;background:#30221fd9;color:#f0b5a1}.outage-notice>svg{flex-shrink:0;margin-top:.15rem}.outage-notice>div{min-width:0}.outage-notice h2{margin:0 0 .35rem;font-size:1rem;color:#fff2e4}.outage-notice p{margin:.25rem 0;font-size:.88rem}.notice-kind{font-size:.72rem!important;font-weight:600;letter-spacing:.03em}.notice-message{white-space:pre-wrap;overflow-wrap:anywhere}.notice-measurements{display:flex;gap:.4rem 1rem;flex-wrap:wrap}.notice-measurements span,.outage-notice small{font-size:.73rem;color:#dccbb4}
</style>
