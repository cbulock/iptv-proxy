<template>
  <div class="tab-panel">
    <CindorStack direction="horizontal" align="center" wrap gap="sm" style="margin-bottom: 0.5rem">
      <CindorButton variant="ghost" @click="addProvider">Add Source</CindorButton>
      <CindorButton :disabled="savingProviders" @click="saveProviders">
        {{ savingProviders ? 'Saving...' : 'Save Sources' }}
      </CindorButton>
      <CindorButton variant="ghost" :disabled="loadingEPGValidation" @click="loadEPGValidation">
        {{ loadingEPGValidation ? 'Validating...' : 'Validate EPG' }}
      </CindorButton>
    </CindorStack>
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
        <span v-if="epgValidation.valid" style="color: var(--success); font-weight: 600">✓ Valid</span>
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
            >({{ epgValidation.summary?.validChannels || 0 }} valid)</span>
        </div>
        <div>
          <span style="opacity: 0.7">Programmes:</span>
          {{ epgValidation.summary?.programmes || 0 }}
          <span
            v-if="epgValidation.summary?.validProgrammes !== epgValidation.summary?.programmes"
            style="color: var(--warning)"
            >({{ epgValidation.summary?.validProgrammes || 0 }} valid)</span>
        </div>
        <div>
          <span style="opacity: 0.7">Errors:</span>
          <span
            :style="{
              color: epgValidation.summary?.errorCount > 0 ? 'var(--danger)' : 'var(--success)',
            }"
            >{{ epgValidation.summary?.errorCount || 0 }}</span>
        </div>
        <div>
          <span style="opacity: 0.7">Sources:</span>
          <span
            :style="{
              color: epgValidation.sources?.failed > 0 ? 'var(--danger)' : 'var(--success)',
            }"
            >{{ epgValidation.sources?.valid || 0 }}/{{ epgValidation.sources?.total || 0 }} loaded</span>
        </div>
        <div>
          <span style="opacity: 0.7">Warnings:</span>
          <span
            :style="{
              color: epgValidation.summary?.warningCount > 0 ? 'var(--warning)' : 'var(--success)',
            }"
            >{{ epgValidation.summary?.warningCount || 0 }}</span>
        </div>
      </div>
      <div
        v-if="epgValidation.sources?.failed > 0"
        style="
          margin-top: 0.5rem;
          padding: 0.5rem;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 4px;
        "
      >
        <div style="font-weight: 600; margin-bottom: 0.25rem; color: var(--danger)">
          Failed Sources:
        </div>
        <div
          v-for="(source, idx) in epgValidation.sources.results.filter(result => result.status === 'error')"
          :key="idx"
          style="padding-left: 1rem; font-size: 0.9em; margin-bottom: 0.35rem"
        >
          <div>• {{ source.source }} — {{ source.error }}</div>
          <div style="opacity: 0.65; padding-left: 0.85rem">{{ source.url }}</div>
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
    <CindorDataTable
      v-if="Array.isArray(providers) && providers.length"
      row-id-key="_id"
      :columns="providerColumns"
      :rows="providers"
      @cell-edit="$emit('cell-edit', $event)"
      @row-action="$emit('row-action', $event)"
    />
    <div v-else style="margin-top: 1rem; opacity: 0.7">No sources configured yet.</div>
  </div>
</template>

<script setup>
import { CindorButton, CindorDataTable, CindorStack } from 'cindor-ui-vue';

defineProps({
  providers: { type: Array, required: true },
  epgValidation: { type: Object, default: null },
  providerColumns: { type: Array, required: true },
  savingProviders: { type: Boolean, required: true },
  loadingEPGValidation: { type: Boolean, required: true },
  addProvider: { type: Function, required: true },
  saveProviders: { type: Function, required: true },
  loadEPGValidation: { type: Function, required: true },
});

defineEmits(['cell-edit', 'row-action']);
</script>

<style scoped>
.tab-panel {
  padding: 28px 32px 32px;
}

@media (max-width: 900px) {
  .tab-panel {
    padding: 20px 20px 20px;
  }

  .tab-panel :deep(cindor-button),
  .tab-panel :deep(cindor-data-table) {
    width: 100%;
  }

  .tab-panel :deep(cindor-data-table) {
    display: block;
    overflow-x: auto;
  }
}
</style>
