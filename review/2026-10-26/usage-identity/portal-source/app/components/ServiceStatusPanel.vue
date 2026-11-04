<script setup lang="ts">
import {CheckCircle2,AlertTriangle,Clock3,HelpCircle} from 'lucide-vue-next';
import {serviceNames,statusLabels} from '#shared/service-status';
const {services,failed}=useServiceStatus();
</script>
<template>
  <section class="service-status-panel" aria-labelledby="service-status-title">
    <div class="status-heading"><h2 id="service-status-title">Service status</h2><NuxtLink to="/guides">Need help?</NuxtLink></div>
    <ul class="service-status-list">
      <li v-for="service in services" :key="service.id" :class="service.state">
        <CheckCircle2 v-if="service.state==='responding'" :size="18" aria-hidden="true"/><AlertTriangle v-else-if="service.state==='unavailable'" :size="18" aria-hidden="true"/><Clock3 v-else-if="service.state==='checking'" :size="18" aria-hidden="true"/><HelpCircle v-else :size="18" aria-hidden="true"/>
        <span><strong>{{serviceNames[service.id]}}</strong><small>{{statusLabels[service.state]}}</small></span>
      </li>
    </ul>
    <p class="small muted">{{failed?'Status updates are temporarily unavailable.':'Checks run every minute.'}} Service response checks do not test every title or channel.</p>
  </section>
</template>
<style scoped>
.service-status-panel{margin:1.6rem 0 2rem;padding:1.3rem 1.5rem;border:1px solid var(--line,#ffffff1a);border-radius:16px;background:#1018209c}
.status-heading{display:flex;justify-content:space-between;gap:1rem;align-items:center;margin-bottom:1rem}.status-heading h2{font-size:1rem;margin:0}.status-heading a{font-size:.8rem;color:#b9c6ce}
.service-status-list{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1rem;list-style:none;padding:0;margin:0 0 1rem}.service-status-list li{display:flex;align-items:center;gap:.65rem;min-width:0;color:#aab6c1}.service-status-list strong,.service-status-list small{display:block}.service-status-list strong{color:#eef2ee;font-size:.9rem}.service-status-list small{font-size:.78rem;margin-top:.2rem}.responding>svg{color:#c7e892}.unavailable>svg{color:#f4a493}.checking>svg{color:#e3c78b}.service-status-panel>p{margin:0;font-size:.75rem}
@media(max-width:640px){.service-status-list{grid-template-columns:repeat(2,minmax(0,1fr));gap:1.25rem .7rem}.service-status-panel{padding:1.1rem}}
</style>
