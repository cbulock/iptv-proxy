<template>
  <div class="tab-panel">
    <n-space align="center" wrap style="margin-bottom: 0.5rem">
      <n-button type="primary" secondary @click="addProvider">Add Source</n-button>
      <n-button type="primary" @click="saveProviders" :loading="savingProviders">{{
        savingProviders ? 'Saving...' : 'Save Sources'
      }}</n-button>
      <n-button @click="loadEPGValidation" :loading="loadingEPGValidation">{{
        loadingEPGValidation ? 'Validating...' : 'Validate EPG'
      }}</n-button>
    </n-space>
    <div
      v-if="epgValidation"
      style="
        margin-bottom: 1rem;
        padding: 0.75rem;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 4px;
      "
    >
      <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem">
        <span style="font-weight: 600; font-size: 1.1em">EPG Validation:</span>
        <span v-if="epgValidation.valid" style="color: var(--success); font-weight: 600"
          >✓ Valid</span
        >
        <span v-else style="color: var(--danger); font-weight: 600">✗ Invalid</span>
      </div>
      <div
        style="
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        "
      >
        <div>
          <span style="opacity: 0.7">Channels:</span>
          {{ epgValidation.summary?.channels || 0 }}
          <span
            v-if="epgValidation.summary?.validChannels !== epgValidation.summary?.channels"
            style="color: var(--warning)"
            >({{ epgValidation.summary?.validChannels || 0 }} valid)</span
          >
        </div>
        <div>
          <span style="opacity: 0.7">Programmes:</span>
          {{ epgValidation.summary?.programmes || 0 }}
          <span
            v-if="epgValidation.summary?.validProgrammes !== epgValidation.summary?.programmes"
            style="color: var(--warning)"
            >({{ epgValidation.summary?.validProgrammes || 0 }} valid)</span
          >
        </div>
        <div>
          <span style="opacity: 0.7">Errors:</span>
          <span
            :style="{
              color: epgValidation.summary?.errorCount > 0 ? 'var(--danger)' : 'var(--success)',
            }"
            >{{ epgValidation.summary?.errorCount || 0 }}</span
          >
        </div>
        <div>
          <span style="opacity: 0.7">Warnings:</span>
          <span
            :style="{
              color: epgValidation.summary?.warningCount > 0 ? 'var(--warning)' : 'var(--success)',
            }"
            >{{ epgValidation.summary?.warningCount || 0 }}</span
          >
        </div>
      </div>
      <div
        v-if="epgValidation.coverage"
        style="
          margin-top: 0.5rem;
          padding: 0.5rem;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 4px;
        "
      >
        <div style="font-weight: 600; margin-bottom: 0.25rem">Coverage:</div>
        <div>
          <span style="opacity: 0.7">Total Channels:</span>
          {{ epgValidation.coverage.total }}
        </div>
        <div>
          <span style="opacity: 0.7">With EPG:</span>
          {{ epgValidation.coverage.withEPG }} ({{ epgValidation.coverage.percentage }}%)
        </div>
        <div v-if="epgValidation.coverage.withoutEPG > 0" style="margin-top: 0.25rem">
          <span style="opacity: 0.7">Missing EPG ({{ epgValidation.coverage.withoutEPG }}):</span>
          <div
            v-for="(channel, idx) in epgValidation.coverage.channelsWithoutEPG"
            :key="idx"
            style="padding-left: 1rem; opacity: 0.7; font-size: 0.9em"
          >
            • {{ channel.name }}
            <span style="opacity: 0.6">({{ channel.tvg_id || 'no tvg-id' }})</span>
          </div>
        </div>
      </div>
      <div
        v-if="epgValidation.errors && epgValidation.errors.length > 0"
        style="margin-top: 0.5rem; color: var(--danger)"
      >
        <div style="font-weight: 600; margin-bottom: 0.25rem">Errors:</div>
        <div
          v-for="(error, idx) in epgValidation.errors.slice(0, 10)"
          :key="idx"
          style="padding-left: 1rem; font-size: 0.9em"
        >
          • {{ error }}
        </div>
        <div
          v-if="epgValidation.errors.length > 10"
          style="padding-left: 1rem; opacity: 0.7; font-size: 0.9em"
        >
          ... and {{ epgValidation.errors.length - 10 }} more
        </div>
      </div>
      <div
        v-if="epgValidation.warnings && epgValidation.warnings.length > 0"
        style="margin-top: 0.5rem; color: var(--warning)"
      >
        <div style="font-weight: 600; margin-bottom: 0.25rem">Warnings:</div>
        <div
          v-for="(warning, idx) in epgValidation.warnings.slice(0, 10)"
          :key="idx"
          style="padding-left: 1rem; font-size: 0.9em"
        >
          • {{ warning }}
        </div>
        <div
          v-if="epgValidation.warnings.length > 10"
          style="padding-left: 1rem; opacity: 0.7; font-size: 0.9em"
        >
          ... and {{ epgValidation.warnings.length - 10 }} more
        </div>
      </div>
    </div>
    <n-data-table
      v-if="Array.isArray(providers) && providers.length"
      :columns="providerColumns"
      :data="providers"
      :bordered="false"
      :row-key="rowKeyFn"
    />
    <div v-else style="margin-top: 1rem; opacity: 0.7">No sources configured yet.</div>
    <div class="foot">
      Configure source playlists and optional guide URLs here, then reload channels to refresh the
      merged lineup.
    </div>
  </div>
</template>

<script setup>
import { NButton, NDataTable, NSpace } from 'naive-ui';

defineProps({
  providers: { type: Array, required: true },
  epgValidation: { type: Object, default: null },
  providerColumns: { type: Array, required: true },
  rowKeyFn: { type: Function, required: true },
  savingProviders: { type: Boolean, required: true },
  loadingEPGValidation: { type: Boolean, required: true },
  addProvider: { type: Function, required: true },
  saveProviders: { type: Function, required: true },
  loadEPGValidation: { type: Function, required: true },
});
</script>

<style scoped>
.tab-panel {
  padding: 28px 32px 32px;
}

@media (max-width: 900px) {
  .tab-panel {
    padding: 20px 20px 20px;
  }
}
</style>
