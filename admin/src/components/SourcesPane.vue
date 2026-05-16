<template>
  <div class="tab-panel">
    <CindorStack
      class="sources-toolbar"
      direction="horizontal"
      align="center"
      wrap
      gap="sm"
      role="group"
      aria-label="Source actions"
    >
      <CindorButton variant="ghost" aria-describedby="sources-toolbar-summary" @click="addProvider">Add Source</CindorButton>
      <CindorButton
        :disabled="savingProviders || !providersCanSave"
        :aria-busy="savingProviders ? 'true' : undefined"
        aria-describedby="sources-toolbar-summary"
        @click="saveProviders"
      >
        {{ savingProviders ? 'Saving...' : 'Save Sources' }}
      </CindorButton>
      <CindorButton
        variant="ghost"
        :disabled="loadingEPGValidation"
        :aria-busy="loadingEPGValidation ? 'true' : undefined"
        aria-describedby="sources-toolbar-summary"
        @click="loadEPGValidation"
      >
        {{ loadingEPGValidation ? 'Validating...' : 'Validate EPG' }}
      </CindorButton>
    </CindorStack>
    <div id="sources-toolbar-summary" class="collection-summary" role="status" aria-live="polite">
      {{ sourceToolbarSummary }}
    </div>
    <div
      v-if="showGettingStarted"
      class="guide-panel"
      role="region"
      aria-labelledby="sources-guide-title"
      aria-describedby="sources-guide-copy"
    >
      <div id="sources-guide-title" class="guide-title">Getting started</div>
      <div id="sources-guide-copy" class="guide-copy">
        Add at least one source here, save it, then reload channels and validate guide data before
        tuning your output profiles.
      </div>
      <div class="guide-steps" role="list" aria-label="Source setup steps">
        <span role="listitem">1. Add an M3U or HDHomeRun source.</span>
        <span role="listitem">2. Save sources to write the config and trigger refreshes.</span>
        <span role="listitem">3. Use “Validate EPG” to catch missing or failing guide feeds.</span>
      </div>
    </div>
    <div
      v-if="providerValidation.issues.length"
      class="validation-panel"
      role="alert"
      aria-live="polite"
      aria-describedby="sources-validation-summary"
    >
      <div class="validation-title">Fix these source issues before saving:</div>
      <div id="sources-validation-summary" class="validation-summary">
        {{ providerValidationSummary }}
      </div>
      <div role="list" aria-label="Source validation issues">
        <div
          v-for="issue in providerValidation.issues"
          :key="`${issue.rowId}:${issue.field}`"
          class="validation-item"
          role="listitem"
        >
          {{ issue.rowLabel }}: {{ issue.message }}
        </div>
      </div>
    </div>
    <div
      v-if="epgValidation"
      class="epg-validation-card"
      role="region"
      aria-labelledby="sources-epg-validation-title"
      aria-describedby="sources-epg-validation-summary"
    >
      <div class="epg-validation-header">
        <span id="sources-epg-validation-title" class="epg-validation-title">EPG Validation:</span>
        <span v-if="epgValidation.valid" class="epg-validation-state success">✓ Valid</span>
        <span v-else class="epg-validation-state danger">✗ Invalid</span>
      </div>
      <div id="sources-epg-validation-summary" class="collection-summary" role="status" aria-live="polite">
        {{ epgValidationSummary }}
      </div>
      <div class="epg-validation-summary" role="list" aria-label="EPG validation summary">
        <div role="listitem">
          <span class="epg-validation-label">Channels:</span>
          {{ epgValidation.summary?.channels || 0 }}
          <span
            v-if="epgValidation.summary?.validChannels !== epgValidation.summary?.channels"
            class="epg-validation-state warning"
            >({{ epgValidation.summary?.validChannels || 0 }} valid)</span>
        </div>
        <div role="listitem">
          <span class="epg-validation-label">Programmes:</span>
          {{ epgValidation.summary?.programmes || 0 }}
          <span
            v-if="epgValidation.summary?.validProgrammes !== epgValidation.summary?.programmes"
            class="epg-validation-state warning"
            >({{ epgValidation.summary?.validProgrammes || 0 }} valid)</span>
        </div>
        <div role="listitem">
          <span class="epg-validation-label">Errors:</span>
          <span
            :class="[
              'epg-validation-metric-value',
              epgValidation.summary?.errorCount > 0 ? 'danger' : 'success',
            ]"
            >{{ epgValidation.summary?.errorCount || 0 }}</span>
        </div>
        <div role="listitem">
          <span class="epg-validation-label">Sources:</span>
          <span
            :class="[
              'epg-validation-metric-value',
              epgValidation.sources?.failed > 0 ? 'danger' : 'success',
            ]"
            >{{ epgValidation.sources?.valid || 0 }}/{{ epgValidation.sources?.total || 0 }} loaded</span>
        </div>
        <div role="listitem">
          <span class="epg-validation-label">Warnings:</span>
          <span
            :class="[
              'epg-validation-metric-value',
              epgValidation.summary?.warningCount > 0 ? 'warning' : 'success',
            ]"
            >{{ epgValidation.summary?.warningCount || 0 }}</span>
        </div>
      </div>
      <div
        v-if="epgValidation.sources?.failed > 0"
        class="epg-validation-section"
        role="region"
        aria-labelledby="epg-failed-sources-title"
        aria-describedby="epg-failed-sources-summary"
      >
        <div id="epg-failed-sources-title" class="epg-validation-section-title danger">
          Failed Sources:
        </div>
        <div id="epg-failed-sources-summary" class="validation-summary">
          {{ epgFailedSourcesSummary }}
        </div>
        <div
          role="list"
          aria-label="Failed EPG sources"
        >
          <div
          v-for="(source, idx) in epgValidation.sources.results.filter(result => result.status === 'error')"
          :key="idx"
          class="epg-validation-source"
          role="listitem"
        >
          <div>{{ source.source }} — {{ source.error }}</div>
          <div class="epg-validation-url">{{ source.url }}</div>
        </div>
        </div>
      </div>
      <div
        v-if="epgValidation.coverage"
        class="epg-validation-section"
        role="region"
        aria-labelledby="epg-coverage-title"
        aria-describedby="epg-coverage-summary"
      >
        <div id="epg-coverage-title" class="epg-validation-section-title">Coverage:</div>
        <div id="epg-coverage-summary" class="validation-summary">
          {{ epgCoverageSummary }}
        </div>
        <div>
          <span class="epg-validation-label">Total Channels:</span>
          {{ epgValidation.coverage.total }}
        </div>
        <div>
          <span class="epg-validation-label">With EPG:</span>
          {{ epgValidation.coverage.withEPG }} ({{ epgValidation.coverage.percentage }}%)
        </div>
        <div
          v-if="epgValidation.coverage.withoutEPG > 0"
          class="epg-validation-subsection"
          role="region"
          aria-labelledby="epg-missing-title"
          aria-describedby="epg-missing-summary"
        >
          <span id="epg-missing-title" class="epg-validation-label">
            Missing EPG ({{ epgValidation.coverage.withoutEPG }}):
          </span>
          <div id="epg-missing-summary" class="validation-summary">
            {{ epgMissingCoverageSummary }}
          </div>
          <div
            role="list"
            aria-label="Channels missing EPG"
          >
            <div
            v-for="(channel, idx) in epgValidation.coverage.channelsWithoutEPG"
            :key="idx"
            class="epg-validation-message"
            role="listitem"
          >
            {{ channel.name }}
            <span class="epg-validation-meta">({{ channel.tvg_id || 'no tvg-id' }})</span>
          </div>
          </div>
        </div>
      </div>
      <div
        v-if="epgValidation.errors && epgValidation.errors.length > 0"
        class="epg-validation-list danger"
        role="region"
        aria-labelledby="epg-errors-title"
        aria-describedby="epg-errors-summary"
      >
        <div id="epg-errors-title" class="epg-validation-section-title">Errors:</div>
        <div id="epg-errors-summary" class="validation-summary">
          {{ epgErrorsSummary }}
        </div>
        <div role="list" aria-label="EPG validation errors">
          <div
          v-for="(error, idx) in epgValidation.errors.slice(0, 10)"
          :key="idx"
          class="epg-validation-message"
          role="listitem"
        >
          {{ error }}
        </div>
          <div
          v-if="epgValidation.errors.length > 10"
          class="epg-validation-message"
          role="listitem"
        >
          ... and {{ epgValidation.errors.length - 10 }} more
        </div>
        </div>
      </div>
      <div
        v-if="epgValidation.warnings && epgValidation.warnings.length > 0"
        class="epg-validation-list warning"
        role="region"
        aria-labelledby="epg-warnings-title"
        aria-describedby="epg-warnings-summary"
      >
        <div id="epg-warnings-title" class="epg-validation-section-title">Warnings:</div>
        <div id="epg-warnings-summary" class="validation-summary">
          {{ epgWarningsSummary }}
        </div>
        <div role="list" aria-label="EPG validation warnings">
          <div
          v-for="(warning, idx) in epgValidation.warnings.slice(0, 10)"
          :key="idx"
          class="epg-validation-message"
          role="listitem"
        >
          {{ warning }}
        </div>
          <div
          v-if="epgValidation.warnings.length > 10"
          class="epg-validation-message"
          role="listitem"
        >
          ... and {{ epgValidation.warnings.length - 10 }} more
        </div>
        </div>
      </div>
    </div>
    <div v-if="Array.isArray(providers) && providers.length" class="data-collection" role="region" aria-label="Configured sources">
      <div class="collection-summary" role="status" aria-live="polite">
        {{ providerCountSummary }}
      </div>
      <CindorDataTable
        row-id-key="_id"
        :columns="providerColumns"
        :rows="providers"
        @cell-edit="$emit('cell-edit', $event)"
        @row-action="$emit('row-action', $event)"
      />
    </div>
    <div v-else class="empty-note" role="status" aria-live="polite">
      No sources configured yet. Add a source, then save to reload channels and guide data.
    </div>
  </div>
</template>

<script setup>
import { CindorButton, CindorDataTable, CindorStack } from 'cindor-ui-vue';
import { computed } from 'vue';

const props = defineProps({
  providers: { type: Array, required: true },
  epgValidation: { type: Object, default: null },
  providerValidation: { type: Object, required: true },
  providerColumns: { type: Array, required: true },
  providersCanSave: { type: Boolean, required: true },
  savingProviders: { type: Boolean, required: true },
  loadingEPGValidation: { type: Boolean, required: true },
  addProvider: { type: Function, required: true },
  saveProviders: { type: Function, required: true },
  loadEPGValidation: { type: Function, required: true },
});

defineEmits(['cell-edit', 'row-action']);

const showGettingStarted = computed(() => !Array.isArray(props.providers) || props.providers.length === 0);
const providerCountSummary = computed(
  () => `${props.providers.length} source${props.providers.length === 1 ? '' : 's'} configured.`
);
const providerValidationSummary = computed(
  () =>
    `${props.providerValidation.issues.length} source issue${
      props.providerValidation.issues.length === 1 ? '' : 's'
    } must be fixed before saving.`
);
const epgValidationSummary = computed(() => {
  if (!props.epgValidation) {
    return '';
  }

  const summary = props.epgValidation.summary || {};
  const sources = props.epgValidation.sources || {};
  return `${props.epgValidation.valid ? 'Validation passed' : 'Validation failed'} with ${
    summary.errorCount || 0
  } error${summary.errorCount === 1 ? '' : 's'}, ${summary.warningCount || 0} warning${
    summary.warningCount === 1 ? '' : 's'
  }, and ${sources.valid || 0} of ${sources.total || 0} guide source${sources.total === 1 ? '' : 's'} loaded.`;
});
const sourceToolbarSummary = computed(() => {
  if (props.providerValidation.issues.length) {
    return `There are ${props.providerValidation.issues.length} source issue${
      props.providerValidation.issues.length === 1 ? '' : 's'
    } blocking save. Fix them before saving sources.`;
  }

  if (props.epgValidation) {
    return `Manage ${props.providers.length} source${props.providers.length === 1 ? '' : 's'} and validate guide coverage after saving changes.`;
  }

  return `Manage ${props.providers.length} source${props.providers.length === 1 ? '' : 's'}, save changes, then validate guide coverage.`;
});
const epgFailedSourcesSummary = computed(
  () =>
    `${props.epgValidation?.sources?.failed || 0} guide source${
      props.epgValidation?.sources?.failed === 1 ? '' : 's'
    } failed to load.`
);
const epgCoverageSummary = computed(() => {
  const coverage = props.epgValidation?.coverage;
  if (!coverage) {
    return '';
  }

  return `${coverage.withEPG} of ${coverage.total} channel${coverage.total === 1 ? '' : 's'} currently have guide coverage, with ${
    coverage.withoutEPG || 0
  } still missing.`;
});
const epgMissingCoverageSummary = computed(() => {
  const coverage = props.epgValidation?.coverage;
  if (!coverage?.withoutEPG) {
    return '';
  }

  return `${coverage.withoutEPG} channel${coverage.withoutEPG === 1 ? '' : 's'} below are still missing guide matches.`;
});
const epgErrorsSummary = computed(
  () => `${props.epgValidation?.errors?.length || 0} validation error${props.epgValidation?.errors?.length === 1 ? '' : 's'} listed below.`
);
const epgWarningsSummary = computed(
  () => `${props.epgValidation?.warnings?.length || 0} validation warning${props.epgValidation?.warnings?.length === 1 ? '' : 's'} listed below.`
);
</script>

<style scoped>
.tab-panel {
  padding: 28px 32px 32px;
}

.validation-panel,
.empty-note,
.guide-panel {
  margin: 0 0 1rem;
  padding: 0.85rem 1rem;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.sources-toolbar {
  margin-bottom: 0.5rem;
}

.data-collection {
  display: grid;
  gap: 0.5rem;
}

.collection-summary {
  opacity: 0.72;
  font-size: 0.92rem;
}

.guide-panel {
  background: rgba(255, 255, 255, 0.03);
}

.guide-title {
  font-weight: 600;
  margin-bottom: 0.35rem;
}

.guide-copy {
  opacity: 0.85;
}

.guide-steps {
  display: grid;
  gap: 0.25rem;
  margin-top: 0.55rem;
  font-size: 0.92rem;
  opacity: 0.75;
}

.validation-panel {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  border-color: color-mix(in srgb, var(--danger) 55%, rgba(255, 255, 255, 0.08));
}

.validation-title {
  font-weight: 600;
  margin-bottom: 0.4rem;
}

.validation-summary {
  margin-bottom: 0.35rem;
  opacity: 0.82;
  font-size: 0.92rem;
}

.validation-item {
  font-size: 0.92rem;
  opacity: 0.92;
}

.validation-item + .validation-item {
  margin-top: 0.25rem;
}

.epg-validation-card {
  margin-bottom: 1rem;
  padding: 0.75rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
}

.epg-validation-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.epg-validation-title,
.epg-validation-section-title {
  font-weight: 600;
}

.epg-validation-title {
  font-size: 1.1em;
}

.epg-validation-state.success {
  color: var(--success);
  font-weight: 600;
}

.epg-validation-state.danger {
  color: var(--danger);
  font-weight: 600;
}

.epg-validation-state.warning {
  color: var(--warning);
}

.epg-validation-metric-value.success {
  color: var(--success);
}

.epg-validation-metric-value.warning {
  color: var(--warning);
}

.epg-validation-metric-value.danger {
  color: var(--danger);
}

.epg-validation-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.epg-validation-label,
.epg-validation-meta {
  opacity: 0.7;
}

.epg-validation-meta {
  opacity: 0.6;
}

.epg-validation-section,
.epg-validation-list {
  margin-top: 0.5rem;
}

.epg-validation-section {
  padding: 0.5rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
}

.epg-validation-section-title {
  margin-bottom: 0.25rem;
}

.epg-validation-section-title.danger,
.epg-validation-list.danger {
  color: var(--danger);
}

.epg-validation-list.warning {
  color: var(--warning);
}

.epg-validation-source,
.epg-validation-message {
  padding-left: 1rem;
  font-size: 0.9em;
}

.epg-validation-source {
  margin-bottom: 0.35rem;
}

.epg-validation-url {
  opacity: 0.65;
  padding-left: 0.85rem;
}

.epg-validation-subsection {
  margin-top: 0.25rem;
}

.epg-validation-url,
.epg-validation-message,
.epg-validation-card :is(code, pre) {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.empty-note {
  opacity: 0.75;
  background: rgba(255, 255, 255, 0.03);
}

@media (max-width: 1100px) {
  .tab-panel {
    padding: 24px 24px 28px;
  }
}

@media (max-width: 900px) {
  .tab-panel {
    padding: 20px 20px 20px;
  }

  .sources-toolbar :deep(cindor-button),
  .tab-panel :deep(cindor-data-table) {
    width: 100%;
  }

  .epg-validation-header {
    align-items: flex-start !important;
    flex-direction: column;
  }

  .epg-validation-summary {
    grid-template-columns: 1fr;
  }

  .tab-panel :deep(cindor-data-table) {
    display: block;
    overflow-x: auto;
  }
}
</style>
