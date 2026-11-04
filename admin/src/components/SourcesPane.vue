<template>
  <div class="tab-panel">
    <header class="page-header">
      <h1>Sources</h1>
      <p>Add feeds and tuners, then save to refresh channels and guide data.</p>
    </header>
    <CindorStack
      class="sources-toolbar"
      direction="horizontal"
      align="center"
      wrap
      gap="sm"
      role="group"
      aria-label="Source actions"
    >
      <CindorButton variant="ghost" aria-describedby="sources-toolbar-summary" @click="addSource">
Add source
</CindorButton>
      <CindorButton
        :disabled="savingProviders || !providersCanSave"
        :aria-busy="savingProviders ? 'true' : undefined"
        aria-describedby="sources-toolbar-summary"
        @click="saveProviders"
      >
        {{ savingProviders ? 'Saving and refreshing...' : 'Save and refresh' }}
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
        Add an M3U playlist or HDHomeRun tuner. Saving refreshes channels and guide data; then
        choose which channels to include in your lineups.
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
      <div
        id="sources-epg-validation-summary"
        class="collection-summary"
        role="status"
        aria-live="polite"
      >
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
            >{{ epgValidation.sources?.valid || 0 }}/{{
              epgValidation.sources?.total || 0
            }}
            loaded</span>
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
        <div role="list" aria-label="Failed EPG sources">
          <div
            v-for="(source, idx) in epgValidation.sources.results.filter(
              result => result.status === 'error'
            )"
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
          <div role="list" aria-label="Channels missing EPG">
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
    <div
      v-if="Array.isArray(providers) && providers.length"
      class="data-collection"
      role="region"
      aria-label="Configured sources"
    >
      <div class="collection-summary" role="status" aria-live="polite">
        {{ providerCountSummary }}
      </div>
      <article v-for="(provider, index) in providers" :key="provider._id" class="source-card">
        <div class="source-card-header">
          <div class="source-heading">
            <h3>{{ sourceName(provider, index) }}</h3>
            <span class="source-type">{{
              provider.type === 'hdhomerun' ? 'HDHomeRun' : 'M3U playlist'
            }}</span>
            <span v-if="sourceIssues(provider).length" class="source-issue-count">Needs attention</span>
          </div>
          <CindorButton
            variant="ghost"
            :aria-label="`${expandedSourceId === provider._id ? 'Close editor for' : 'Edit'} ${sourceName(provider, index)}`"
            :aria-expanded="expandedSourceId === provider._id ? 'true' : 'false'"
            :aria-controls="`source-editor-${provider._id}`"
            @click="toggleSource(provider)"
            >
{{ expandedSourceId === provider._id ? 'Close editor' : 'Edit' }}
</CindorButton>
        </div>
        <dl v-if="expandedSourceId !== provider._id" class="source-addresses">
          <div>
            <dt>{{ provider.type === 'hdhomerun' ? 'Tuner URL' : 'Playlist URL' }}</dt>
            <dd>{{ provider.url || 'Required — add a source URL' }}</dd>
          </div>
          <div>
            <dt>Guide URL</dt>
            <dd :class="{ 'optional-value': !provider.epg }">
              {{ provider.epg || 'Not configured' }}
            </dd>
          </div>
        </dl>
        <div
          v-show="expandedSourceId === provider._id"
          :id="`source-editor-${provider._id}`"
          class="source-editor"
        >
          <div class="source-fields">
            <div
              v-for="field in sourceFields"
              :key="field.key"
              class="source-field"
              :class="{ 'url-field': field.key === 'url' || field.key === 'epg' }"
            >
              <label :for="`source-${provider._id}-${field.key}`">{{ field.label }}</label>
              <select
                v-if="field.key === 'type'"
                :id="`source-${provider._id}-${field.key}`"
                :value="provider.type"
                :aria-label="`${field.label} for ${sourceName(provider, index)}`"
                @change="updateSource(provider, field.key, $event.target.value)"
              >
                <option value="m3u">M3U playlist</option>
                <option value="hdhomerun">HDHomeRun tuner</option>
              </select>
              <input
                v-else
                :id="`source-${provider._id}-${field.key}`"
                :value="provider[field.key]"
                :placeholder="field.placeholder"
                :aria-label="`${field.label} for ${sourceName(provider, index)}`"
                :aria-invalid="fieldIssue(provider, field.key) ? 'true' : undefined"
                :aria-describedby="
                  fieldIssue(provider, field.key)
                    ? `source-error-${provider._id}-${field.key}`
                    : undefined
                "
                :required="field.key === 'name' || field.key === 'url'"
                :inputmode="field.key === 'name' ? 'text' : 'url'"
                @input="updateSource(provider, field.key, $event.target.value)"
              >
              <p
                v-if="fieldIssue(provider, field.key)"
                :id="`source-error-${provider._id}-${field.key}`"
                class="field-error"
              >
                {{ fieldIssue(provider, field.key).message }}
              </p>
            </div>
          </div>
          <div class="source-editor-footer">
            <span>Changes stay in your draft until you save and refresh.</span>
            <CindorButton
              variant="ghost"
              :aria-label="`Remove ${sourceName(provider, index)}`"
              @click="emit('row-action', { detail: { actionKey: 'remove', rowId: provider._id } })"
              >
Remove source
</CindorButton>
          </div>
        </div>
      </article>
    </div>
    <div v-else class="empty-note" role="status" aria-live="polite">
      No sources configured yet. Add a source, then save to reload channels and guide data.
    </div>
  </div>
</template>

<script setup>
import { CindorButton, CindorStack } from 'cindor-ui-vue';
import { computed, nextTick, ref } from 'vue';

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

const emit = defineEmits(['cell-edit', 'row-action']);
const expandedSourceId = ref(null);
const sourceFields = [
  { key: 'name', label: 'Source name', placeholder: 'Living room tuner' },
  { key: 'type', label: 'Source type' },
  { key: 'url', label: 'Source URL', placeholder: 'Playlist URL or HDHomeRun base URL' },
  { key: 'epg', label: 'Guide URL (optional)', placeholder: 'XMLTV guide URL' },
];
const sourceName = (provider, index) => provider.name || `Source ${index + 1}`;
const sourceIssues = provider =>
  props.providerValidation.issues.filter(issue => String(issue.rowId) === String(provider._id));
const fieldIssue = (provider, field) => sourceIssues(provider).find(issue => issue.field === field);
function updateSource(provider, columnKey, value) {
  emit('cell-edit', { detail: { rowId: provider._id, columnKey, value } });
}
async function toggleSource(provider) {
  expandedSourceId.value = expandedSourceId.value === provider._id ? null : provider._id;
  if (expandedSourceId.value) {
    await nextTick();
    document.getElementById(`source-${provider._id}-name`)?.focus();
  }
}
async function addSource() {
  props.addProvider();
  await nextTick();
  const provider = props.providers[props.providers.length - 1];
  if (provider) await toggleSource(provider);
}

const showGettingStarted = computed(
  () => !Array.isArray(props.providers) || props.providers.length === 0
);
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
  () =>
    `${props.epgValidation?.errors?.length || 0} validation error${props.epgValidation?.errors?.length === 1 ? '' : 's'} listed below.`
);
const epgWarningsSummary = computed(
  () =>
    `${props.epgValidation?.warnings?.length || 0} validation warning${props.epgValidation?.warnings?.length === 1 ? '' : 's'} listed below.`
);
</script>

<style scoped>
.tab-panel {
  padding: 8px 4px;
  min-width: 0;
}

.page-header {
  margin-bottom: 1rem;
}
.page-header h1 {
  margin: 0 0 0.35rem;
  font-size: 1.35rem;
}
.page-header p {
  margin: 0;
  color: var(--muted, #b5b5b5);
}
.source-card {
  min-width: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.025);
}
.source-card-header,
.source-heading,
.source-editor-footer {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.source-card-header,
.source-editor-footer {
  justify-content: space-between;
}
.source-heading {
  flex-wrap: wrap;
  min-width: 0;
}
.source-heading h3 {
  margin: 0;
  font-size: 1.05rem;
  overflow-wrap: anywhere;
}
.source-type {
  padding: 0.2rem 0.5rem;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.075);
  font-size: 0.8rem;
}
.source-issue-count,
.field-error {
  color: var(--warning, #f7bc6d);
  font-size: 0.85rem;
}
.source-addresses {
  margin: 0.75rem 0 0;
  display: grid;
  gap: 0.5rem;
}
.source-addresses > div {
  display: grid;
  grid-template-columns: 7rem minmax(0, 1fr);
  gap: 0.75rem;
}
.source-addresses dt,
.optional-value {
  color: var(--muted, #b5b5b5);
}
.source-addresses dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.source-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1rem;
  margin-top: 1rem;
}
.source-field {
  display: grid;
  align-content: start;
  gap: 0.4rem;
  min-width: 0;
}
.source-field label {
  font-size: 0.9rem;
  font-weight: 600;
}
.source-field input,
.source-field select {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 0.65rem 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  color: inherit;
  background: #202022;
  font: inherit;
}
.source-field input:focus-visible,
.source-field select:focus-visible {
  outline: 2px solid var(--accent, #ff9a3c);
  outline-offset: 2px;
}
.source-field input[aria-invalid='true'] {
  border-color: var(--warning, #f7bc6d);
}
.source-field input::placeholder {
  color: #a5a5aa;
}
.url-field {
  grid-column: 1 / -1;
}
.field-error {
  margin: 0;
}
.source-editor-footer {
  margin-top: 1rem;
  gap: 1rem;
  flex-wrap: wrap;
  font-size: 0.9rem;
  color: var(--muted, #b5b5b5);
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
  margin-top: 1rem;
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
    padding: 8px 4px 16px;
  }
}

@media (max-width: 900px) {
  .tab-panel {
    padding: 8px 4px;
  }

  .source-fields {
    grid-template-columns: minmax(0, 1fr);
  }
  .source-addresses > div {
    grid-template-columns: minmax(0, 1fr);
    gap: 0.2rem;
  }

  .sources-toolbar :deep(cindor-button) {
    width: 100%;
  }

  .epg-validation-header {
    align-items: flex-start !important;
    flex-direction: column;
  }

  .epg-validation-summary {
    grid-template-columns: 1fr;
  }
}
</style>
