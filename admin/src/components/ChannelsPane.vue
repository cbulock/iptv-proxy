<template>
  <section ref="pane" class="channels-pane" aria-labelledby="channels-title">
    <header class="page-heading">
      <div>
        <h1 id="channels-title">Channels</h1>
        <p>Choose which channels appear in your player.</p>
      </div>
      <label class="lineup-picker"><span>Lineup</span>
        <CindorSelect
          :model-value="selectedProfileSlug"
          :value.attr="selectedProfileSlug"
          :disabled="busy || !profiles.length"
          aria-label="Lineup"
          @update:model-value="changeSelectedProfile"
        >
          <option v-for="profile in profiles" :key="profile.slug" :value="profile.slug">
            {{ profile.name }}
          </option>
        </CindorSelect>
      </label>
    </header>

    <div class="lineup-tools">
      <span v-if="profileEndpointInfo" class="publication"><span class="status-dot" :class="{ active: profileEndpointInfo?.available }" />{{
          profileEndpointInfo?.available ? 'Saved lineup enabled' : 'Saved lineup disabled'
        }}</span>
      <span
        v-if="selectedProfile && selectedProfile.enabled !== savedProfile.enabled"
        class="pending"
        >Availability change pending</span>
      <details>
        <summary>Lineup settings</summary>
        <div class="disclosure-content settings-fields">
          <label><span>Lineup name</span><CindorInput
              :model-value="selectedProfile?.name || ''"
              :disabled="busy || !selectedProfile"
              aria-label="Lineup name"
              @update:model-value="updateProfileName"
          /></label>
          <label v-if="selectedProfile && !selectedProfile.isDefault" class="switch-label"><CindorSwitch
              :model-value="selectedProfile.enabled"
              :disabled="busy"
              aria-label="Lineup enabled"
              @update:model-value="updateProfileEnabled"
            />Enable this lineup</label>
          <p v-else class="help">The default lineup is always enabled and cannot be deleted.</p>
          <p class="help">Name and availability changes take effect when you save.</p>
          <div class="button-row">
            <CindorButton variant="ghost" :disabled="busy" @click="createProfile">
New lineup
</CindorButton>
            <CindorButton
              variant="ghost"
              :disabled="busy || !selectedProfile"
              @click="duplicateProfile"
              >
Duplicate lineup
</CindorButton>
            <CindorButton
              v-if="selectedProfile && !selectedProfile.isDefault"
              variant="ghost"
              :disabled="busy"
              @click="deleteProfile"
              >
Delete lineup
</CindorButton>
          </div>
        </div>
      </details>
      <details>
        <summary>Connect a player</summary>
        <div class="disclosure-content">
          <p>{{ profileEndpointInfo?.message }}</p>
          <div
            v-for="endpoint in profileEndpointInfo?.endpoints || []"
            :key="endpoint.label"
            class="endpoint"
          >
            <strong>{{ endpointNames[endpoint.label] || endpoint.label }}</strong><code>{{ endpoint.url }}</code>
            <CindorButton
              variant="ghost"
              :aria-label="`Copy ${endpointNames[endpoint.label] || endpoint.label} URL`"
              @click="copyEndpoint(endpoint)"
              >
Copy
</CindorButton>
          </div>
          <p v-if="copyStatus" role="status">{{ copyStatus }}</p>
        </div>
      </details>
      <details>
        <summary>Maintenance</summary>
        <div class="disclosure-content maintenance">
          <div>
            <CindorButton variant="ghost" :disabled="actionsBusy || loading" @click="refreshChannels">
Refresh view
</CindorButton>
            <p>Reread saved channel settings.</p>
          </div>
          <div>
            <CindorButton variant="ghost" :disabled="busy" @click="reloadChannels">
{{
              reloadingChannels ? 'Rescanning…' : 'Rescan sources'
            }}
</CindorButton>
            <p>Discover channels again from your sources.</p>
          </div>
          <div>
            <CindorButton variant="ghost" :disabled="busy" @click="reloadEPG">
{{
              reloadingEPG ? 'Updating…' : 'Update TV guide'
            }}
</CindorButton>
            <p>Download programme schedules. Your drafts are kept.</p>
          </div>
        </div>
      </details>
    </div>

    <div v-if="loadError" class="error-message" role="alert">
      <p>{{ loadError }}</p>
      <CindorButton variant="ghost" :disabled="actionsBusy || loading" @click="refreshChannels">
Retry refresh
</CindorButton>
    </div>
    <div v-if="saveError" class="error-message" role="alert">
      {{ saveError }} Your changes are kept for correction.
    </div>
    <div class="search-row">
      <CindorInput
        v-model="search"
        class="channel-search"
        aria-label="Search channels"
        placeholder="Search name, channel number, or source"
      />
      <CindorButton v-if="search || filter !== 'all'" variant="ghost" @click="clearFilters">
Clear filters
</CindorButton>
    </div>
    <div class="filters" role="group" aria-label="Show channels">
      <CindorButton
        v-for="item in filters"
        :key="item.value"
        variant="ghost"
        :class="{ selected: filter === item.value }"
        :aria-pressed="filter === item.value"
        @click="filter = item.value"
        >
{{ item.label }} <span class="filter-count">{{ item.count }}</span>
</CindorButton>
    </div>
    <p class="results" role="status">
      {{
        loading ? 'Loading channels…' : `Showing ${filteredRows.length} of ${rows.length} channels`
      }}<span v-if="rows.length"> · Sorted by channel number</span>
    </p>

    <div v-if="!loading && !loadError && !rows.length" class="empty-state">
      <h2>Add your first channels</h2>
      <p>Configure a source, then rescan it to discover channels.</p>
      <CindorButton :disabled="busy" @click="openSources">Configure sources</CindorButton>
    </div>
    <div v-else-if="!loading && rows.length && !filteredRows.length" class="empty-state">
      <h2>No matching channels</h2>
      <p>Try another name or number, or clear your filters.</p>
      <CindorButton variant="ghost" @click="clearFilters">Clear filters</CindorButton>
    </div>
    <table
      v-if="filteredRows.length"
      class="channel-list"
      aria-label="Channels in the selected lineup"
      :aria-busy="loading"
    >
      <thead>
        <tr>
          <th scope="col">Include</th>
          <th scope="col">Number</th>
          <th scope="col">Channel</th>
          <th scope="col" class="source-heading">Stream source</th>
          <th scope="col"><span class="sr-only">Edit channel</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in filteredRows" :key="row.id" :class="{ changed: row.hasDraftChanges }">
          <td class="include-cell">
            <CindorSwitch
              :model-value="row.outputEnabled"
              :disabled="busy || row.enableToggleDisabled"
              :aria-label="`Include ${displayName(row)} in lineup`"
              :aria-describedby="row.enableToggleDisabled ? `setup-${row.id}` : undefined"
              @update:model-value="value => updateOutputEnabled(row.id, value)"
            />
          </td>
          <td class="number-cell">
            <span
              :aria-label="
                row.effectiveGuideNumber
                  ? `Channel ${row.effectiveGuideNumber}`
                  : 'No channel number'
              "
              >{{ row.effectiveGuideNumber || '—' }}</span>
          </td>
          <td class="identity-cell">
            <strong>{{ displayName(row) }}</strong><span v-if="row.hasDraftChanges" class="pending changed-label">Changed</span>
            <div
              :id="`setup-${row.id}`"
              class="row-help"
              :class="{ 'needs-setup': row.setupIssues.length }"
            >
              {{ row.setupIssues.map(issue => issue.label).join(' · ') }}
            </div>
            <div v-if="row.rowFeedbackTone === 'danger'" class="row-error">
              {{ row.rowFeedbackLabel }}
            </div>
            <div class="mobile-source">{{ sourceLabel(row) }}</div>
          </td>
          <td class="source-cell">
            <span>{{ sourceLabel(row) }}</span><small v-if="row.preferredStreamOptions.length > 1">{{ row.preferredStreamOptions.length }} sources available</small>
          </td>
          <td class="edit-cell">
            <CindorButton
              variant="ghost"
              :disabled="busy"
              :data-edit-channel="row.id"
              :aria-label="`Edit ${displayName(row)}`"
              @click="openEditor(row)"
              >
{{ row.setupIssues.length ? 'Set up' : 'Edit' }}
</CindorButton>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="profileDirty" class="save-bar" aria-label="Unsaved changes">
      <div>
        <strong>{{ changedCount }} channel{{ changedCount === 1 ? '' : 's' }} changed</strong><span v-if="review.profile.length" class="help"> · Lineup settings changed</span>
        <p class="help">Changes take effect when you save.</p>
      </div>
      <div class="button-row">
        <CindorButton variant="ghost" :disabled="busy" @click="reviewOpen = true">
Review changes
</CindorButton><CindorButton variant="ghost" :disabled="busy" @click="discardChanges">
Discard
</CindorButton><CindorButton :disabled="busy" @click="saveProfileChanges">
{{
          savingProfile ? 'Saving…' : 'Save changes'
        }}
</CindorButton>
      </div>
    </div>

    <CindorDialog
      v-model:open="editorOpen"
      modal
      aria-labelledby="channel-editor-title"
      aria-describedby="channel-editor-draft-copy"
      @close="closeEditor"
      @cancel="closeEditor"
    >
      <div v-if="activeRow" class="channel-editor">
        <header class="editor-header">
          <div>
            <p class="eyebrow">CHANNEL SETTINGS</p>
            <h2 id="channel-editor-title">{{ displayName(activeRow) }}</h2>
          </div>
        </header>
        <p id="channel-editor-draft-copy" class="help">
          Changes are kept as a draft until you save.
        </p>
        <section aria-labelledby="lineup-fields-title" class="editor-section">
          <h3 id="lineup-fields-title">In this lineup</h3>
          <p class="help">Only affects {{ selectedProfile?.name }}.</p>
          <label class="switch-label"><CindorSwitch
              :model-value="activeRow.outputEnabled"
              :disabled="busy || activeRow.enableToggleDisabled"
              aria-label="Include in this lineup"
              :aria-describedby="activeRow.enableToggleDisabled ? 'editor-include-help' : undefined"
              @update:model-value="value => updateOutputEnabled(activeRow.id, value)"
            />Include in lineup</label>
          <p v-if="activeRow.enableToggleDisabled" id="editor-include-help" class="needs-setup">
            Assign a channel number to include this channel.
          </p>
          <label class="editor-field"><span>Channel number</span><CindorInput
              ref="numberInput"
              :model-value="activeRow.guideNumberOverrideInput"
              :placeholder="activeRow.guideNumber || 'e.g. 42'"
              :disabled="busy"
              aria-label="Channel number"
              aria-describedby="editor-number-help"
              @update:model-value="value => updateGuideNumberOverrideInput(activeRow.id, value)"
              @blur="commitGuideNumberOverride(activeRow.id)"
          /></label>
          <div class="number-help">
            <p id="editor-number-help" class="help">
              {{
                activeRow.guideNumber
                  ? `Default: ${activeRow.guideNumber}. Leave blank to use it.`
                  : 'No default number. Enter the number you want to see in your player.'
              }}
            </p>
            <CindorButton
              v-if="activeRow.guideNumberOverrideInput"
              variant="ghost"
              :disabled="busy"
              @click="resetNumber"
              >
Use default number
</CindorButton>
          </div>
        </section>
        <section aria-labelledby="shared-fields-title" class="editor-section">
          <h3 id="shared-fields-title">Shared across all lineups</h3>
          <p class="scope-notice">Changes here apply to this channel in every lineup.</p>
          <label class="editor-field"><span>Display name</span><CindorInput
              :model-value="activeRow.customNameDraft"
              :placeholder="activeRow.baseName"
              :disabled="busy"
              aria-label="Channel display name"
              aria-describedby="editor-name-help"
              @update:model-value="value => updateCanonicalNameDraft(activeRow.id, value)"
              @blur="saveCanonicalName(activeRow.id)"
          /></label>
          <p id="editor-name-help" class="help">Leave blank to use {{ activeRow.baseName }}.</p>
          <label class="editor-field"><span>Stream source</span><CindorSelect
              :model-value="activeRow.preferredSourceChannelId || ''"
              :value.attr="activeRow.preferredSourceChannelId || ''"
              :disabled="busy || !activeRow.preferredStreamOptions.length"
              aria-label="Stream source"
              @update:model-value="value => updatePreferredStream(activeRow.id, value)"
              ><option value="" disabled>
                {{
                  activeRow.preferredStreamOptions.length
                    ? 'Choose a stream'
                    : 'No stream available'
                }}
              </option>
              <option
                v-for="option in activeRow.preferredStreamOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option></CindorSelect></label>
          <p class="help">
            {{
              activeRow.preferredStreamOptions.length === 1
                ? 'One stream source is available.'
                : 'Choose the source you prefer for playback.'
            }}
          </p>
          <label class="editor-field"><span>TV guide source</span><CindorSelect
              :model-value="activeRow.selectedGuideBindingValue || ''"
              :value.attr="activeRow.selectedGuideBindingValue || ''"
              :disabled="busy || !activeRow.guideBindingOptions.length"
              aria-label="TV guide source"
              aria-describedby="editor-guide-help"
              @update:model-value="value => updateGuideBinding(activeRow.id, value)"
              ><option value="" disabled>
                {{
                  activeRow.guideBindingOptions.length
                    ? 'Choose a TV guide'
                    : 'No TV guide available'
                }}
              </option>
              <option
                v-for="option in activeRow.guideBindingOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option></CindorSelect></label>
          <p id="editor-guide-help" class="help">
            Selects programme information, not the channel number. A selection does not guarantee
            schedule coverage.
          </p>
        </section>
        <details class="technical-details">
          <summary>Technical details</summary>
          <dl>
            <dt>Channel ID</dt>
            <dd>{{ activeRow.id }}</dd>
            <dt>Original name</dt>
            <dd>{{ activeRow.baseName }}</dd>
            <dt>TVG ID</dt>
            <dd>{{ activeRow.tvg_id || 'Not assigned' }}</dd>
            <dt>Sources</dt>
            <dd>{{ activeRow.sourceBindingsSummary || 'None' }}</dd>
            <dt>Source references</dt>
            <dd>{{ activeRow.sourceGuideReferencesSummary || 'None' }}</dd>
          </dl>
        </details>
        <footer class="editor-footer">
          <span class="help">Done keeps your draft. Save changes from the channel list.</span><CindorButton @click="closeEditor">Done</CindorButton>
        </footer>
      </div>
    </CindorDialog>

    <CindorDialog v-model:open="reviewOpen" modal aria-labelledby="changes-review-title">
      <div class="change-review">
        <h2 id="changes-review-title">Review changes</h2>
        <p>Nothing below is applied until you save changes.</p>
        <section v-if="review.profile.length">
          <h3>Lineup settings</h3>
          <ul>
            <li v-for="change in review.profile" :key="change.field">
              <strong>{{ change.field }}:</strong> {{ change.before }} → {{ change.after }}
            </li>
          </ul>
        </section>
        <section v-for="group in reviewGroups" :key="group.key" v-show="review[group.key].length">
          <h3>{{ group.title }}</h3>
          <div v-for="channel in review[group.key]" :key="channel.id" class="review-channel">
            <h4>{{ channel.name }}</h4>
            <ul>
              <li v-for="change in channel.changes" :key="change.field">
                <strong>{{ change.field }}:</strong> {{ change.before }} → {{ change.after }}
              </li>
            </ul>
          </div>
        </section>
        <div class="button-row">
          <CindorButton variant="ghost" @click="reviewOpen = false">Keep editing</CindorButton><CindorButton :disabled="busy" @click="saveFromReview">
{{
            savingProfile ? 'Saving…' : 'Save changes'
          }}
</CindorButton>
        </div>
      </div>
    </CindorDialog>
  </section>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { CindorButton, CindorDialog, CindorInput, CindorSelect, CindorSwitch } from 'cindor-ui-vue';
import {
  matchesChannelSearch,
  getChannelSetupIssues,
  buildChannelChangeReview,
} from '../utils/channel-workflow.js';

const props = defineProps({
  profiles: { type: Array, required: true },
  selectedProfileSlug: { type: String, required: true },
  selectedProfile: { type: Object, default: null },
  savedProfile: { type: Object, required: true },
  rows: { type: Array, required: true },
  loading: Boolean,
  savingProfile: Boolean,
  reloadingChannels: Boolean,
  reloadingEPG: Boolean,
  actionsBusy: Boolean,
  snapshotInvalid: Boolean,
  profileDirty: Boolean,
  loadError: { type: String, default: '' },
  saveError: { type: String, default: '' },
  profileEndpointInfo: { type: Object, default: null },
  changeSelectedProfile: { type: Function, required: true },
  refreshChannels: { type: Function, required: true },
  reloadChannels: { type: Function, required: true },
  reloadEPG: { type: Function, required: true },
  saveProfileChanges: { type: Function, required: true },
  discardChanges: { type: Function, required: true },
  openSources: { type: Function, required: true },
  createProfile: { type: Function, required: true },
  duplicateProfile: { type: Function, required: true },
  deleteProfile: { type: Function, required: true },
  updateProfileName: { type: Function, required: true },
  updateProfileEnabled: { type: Function, required: true },
  updateCanonicalNameDraft: { type: Function, required: true },
  saveCanonicalName: { type: Function, required: true },
  updatePreferredStream: { type: Function, required: true },
  updateGuideBinding: { type: Function, required: true },
  updateOutputEnabled: { type: Function, required: true },
  updateGuideNumberOverrideInput: { type: Function, required: true },
  commitGuideNumberOverride: { type: Function, required: true },
});
const search = ref('');
const filter = ref('all');
const pane = ref(null);
const numberInput = ref(null);
const editorOpen = ref(false);
const editorId = ref('');
const reviewOpen = ref(false);
const copyStatus = ref('');
const endpointNames = { M3U: 'Playlist (M3U)', XMLTV: 'TV guide (XMLTV)', JSON: 'Lineup JSON' };
const reviewGroups = [
  { key: 'lineup', title: 'In this lineup' },
  { key: 'shared', title: 'Shared across all lineups' },
];
const busy = computed(
  () =>
    props.snapshotInvalid ||
    props.actionsBusy ||
    props.loading ||
    props.savingProfile ||
    props.reloadingChannels ||
    props.reloadingEPG
);
const enrichedRows = computed(() =>
  props.rows.map(row => ({ ...row, setupIssues: getChannelSetupIssues(row) }))
);
const matchesFilter = (row, value) =>
  value === 'enabled'
    ? row.outputEnabled
    : value === 'disabled'
      ? !row.outputEnabled
      : value === 'setup'
        ? row.setupIssues.length > 0
        : value === 'changed'
          ? row.hasDraftChanges
          : true;
const filters = computed(() =>
  [
    ['all', 'All'],
    ['enabled', 'In lineup'],
    ['disabled', 'Not in lineup'],
    ['setup', 'Needs setup'],
    ['changed', 'Changed'],
  ].map(([value, label]) => ({
    value,
    label,
    count: enrichedRows.value.filter(row => matchesFilter(row, value)).length,
  }))
);
const filteredRows = computed(() =>
  enrichedRows.value.filter(
    row => matchesChannelSearch(row, search.value) && matchesFilter(row, filter.value)
  )
);
const activeRow = computed(() => enrichedRows.value.find(row => row.id === editorId.value));
const changedCount = computed(() => props.rows.filter(row => row.hasDraftChanges).length);
const review = computed(() =>
  buildChannelChangeReview(props.rows, props.selectedProfile || {}, props.savedProfile)
);
const displayName = row => row.customNameDraft?.trim() || row.baseName || row.name;
const sourceLabel = row =>
  row.preferredStreamOptions.find(option => option.value === row.preferredSourceChannelId)?.label ||
  (row.preferredStreamOptions.length ? 'Choose a stream' : 'No stream available');
function clearFilters() {
  search.value = '';
  filter.value = 'all';
}
function focusControl(element) {
  const host = element?.$el || element;
  const control =
    host?.shadowRoot?.querySelector('input, button, select') ||
    host?.querySelector?.('input, button, select') ||
    host;
  control?.focus?.();
}
async function openEditor(row) {
  editorId.value = row.id;
  editorOpen.value = true;
  await nextTick();
  if (row.enableToggleDisabled) focusControl(numberInput.value);
}
async function closeEditor() {
  if (!editorOpen.value && !editorId.value) return;
  const id = editorId.value;
  editorOpen.value = false;
  editorId.value = '';
  await nextTick();
  const button = [...(pane.value?.querySelectorAll('[data-edit-channel]') || [])].find(
    element => element.getAttribute('data-edit-channel') === id
  );
  focusControl(button || pane.value?.querySelector('.channel-search'));
}
function resetNumber() {
  props.updateGuideNumberOverrideInput(editorId.value, '');
  props.commitGuideNumberOverride(editorId.value);
}
async function copyEndpoint(endpoint) {
  try {
    await navigator.clipboard.writeText(endpoint.url);
    copyStatus.value = `${endpointNames[endpoint.label] || endpoint.label} URL copied.`;
  } catch {
    copyStatus.value = 'Could not copy. Select and copy the URL above.';
  }
}
async function saveFromReview() {
  await props.saveProfileChanges();
  reviewOpen.value = false;
}
watch(
  () => props.selectedProfileSlug,
  () => {
    closeEditor();
    copyStatus.value = '';
  }
);
watch(activeRow, row => {
  if (editorOpen.value && !row) closeEditor();
});
</script>

<style scoped>
.channels-pane {
  padding: 24px 28px;
  color: var(--fg);
}
h1,
h2,
h3,
h4,
p {
  margin: 0;
}
h1 {
  font-size: 1.65rem;
  letter-spacing: -0.03em;
}
h2 {
  font-size: 1.35rem;
}
h3 {
  font-size: 1.05rem;
}
p {
  line-height: 1.5;
}
.page-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  margin-bottom: 18px;
}
.page-heading p,
.help,
.results {
  color: var(--fg-subtle);
  font-size: 0.88rem;
}
.lineup-picker {
  display: grid;
  gap: 5px;
  width: 260px;
  max-width: 100%;
  font-size: 0.85rem;
}
.lineup-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 20px;
  margin-bottom: 22px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}
.publication {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 0.82rem;
  color: var(--fg-subtle);
}
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--fg-subtle);
}
.status-dot.active {
  background: var(--success, #91b969);
}
.lineup-tools details {
  font-size: 0.88rem;
}
.lineup-tools details[open] {
  flex-basis: 100%;
}
summary {
  cursor: pointer;
  padding: 5px 0;
  font-weight: 600;
}
summary:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 4px;
}
.disclosure-content {
  margin-top: 12px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  display: grid;
  gap: 12px;
}
.settings-fields > label:first-child {
  display: grid;
  gap: 6px;
  max-width: 380px;
}
.button-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.endpoint {
  display: grid;
  grid-template-columns: 145px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
}
.endpoint code {
  overflow-wrap: anywhere;
  font-size: 0.8rem;
}
.maintenance {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.maintenance p {
  font-size: 0.82rem;
  color: var(--fg-subtle);
  margin-top: 6px;
}
.search-row {
  display: flex;
  gap: 10px;
  align-items: center;
}
.channel-search {
  flex: 1;
  min-width: 0;
}
.filters {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin: 12px 0 8px;
}
.filters .selected {
  --cindor-button-ghost-color: var(--accent);
  --cindor-button-ghost-border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  border-radius: 6px;
}
.filter-count {
  margin-left: 6px;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}
.results {
  margin-bottom: 12px;
}
.channel-list {
  border-collapse: collapse;
  width: 100%;
  table-layout: fixed;
}
.channel-list th {
  color: var(--fg-subtle);
  font-size: 0.73rem;
  font-weight: 600;
  text-align: left;
  padding: 10px;
  border-bottom: 1px solid var(--border);
}
.channel-list th:first-child {
  width: 72px;
}
.channel-list th:nth-child(2) {
  width: 76px;
}
.channel-list th:last-child {
  width: 100px;
}
.edit-cell :deep(cindor-button) {
  --cindor-button-padding-inline: 12px;
  white-space: nowrap;
}
.channel-list th:nth-child(4) {
  width: 28%;
}
.channel-list td {
  padding: 12px 10px;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}
.number-cell {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--fg-subtle);
}
.identity-cell strong {
  font-size: 0.95rem;
  overflow-wrap: anywhere;
}
.source-cell {
  font-size: 0.85rem;
  color: var(--fg-subtle);
  overflow-wrap: anywhere;
}
.source-cell small {
  display: block;
  margin-top: 3px;
}
.row-help {
  font-size: 0.78rem;
  margin-top: 4px;
  line-height: 1.45;
}
.row-help:empty {
  display: none;
}
.needs-setup,
.pending {
  color: var(--warning, #e5b66d);
}
.pending {
  font-size: 0.8rem;
}
.changed-label {
  margin-left: 8px;
}
.row-error {
  color: var(--danger);
  font-size: 0.85rem;
  margin-top: 5px;
}
.changed {
  background: color-mix(in srgb, var(--accent) 4%, transparent);
}
.mobile-source {
  display: none;
}
.save-bar {
  position: sticky;
  bottom: 12px;
  z-index: 10;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  margin-top: 18px;
  background: var(--surface, #24231f);
  border: 1px solid var(--accent);
  border-radius: 10px;
  box-shadow: 0 8px 28px #0005;
}
.error-message {
  border: 1px solid var(--danger);
  padding: 14px;
  border-radius: 8px;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.empty-state {
  padding: 36px 12px;
  text-align: center;
  display: grid;
  justify-items: center;
  gap: 12px;
}
.channel-editor,
.change-review {
  width: min(640px, calc(100vw - 64px));
  max-height: calc(100dvh - 80px);
  overflow-y: auto;
  padding: 24px;
  box-sizing: border-box;
}
:deep(cindor-dialog::part(dialog)) {
 padding: 12px; max-width: calc(100vw - 24px); max-height: calc(100dvh - 24px); overflow: hidden; box-sizing: border-box;
}
.editor-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 8px;
}
.eyebrow {
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  color: var(--fg-subtle);
  margin-bottom: 5px;
}
.editor-section {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--border);
}
.editor-section h3 {
  margin-bottom: 5px;
}
.switch-label {
  display: flex;
  gap: 10px;
  align-items: center;
  margin: 14px 0;
}
.editor-field {
  display: grid;
  gap: 6px;
  margin-top: 16px;
  font-size: 0.9rem;
}
.editor-field > span {
  font-weight: 600;
}
.editor-field :deep(cindor-input),
.editor-field :deep(cindor-select) {
  width: 100%;
}
.number-help {
  margin-top: 6px;
  display: grid;
  gap: 6px;
  justify-items: start;
}
.scope-notice {
  font-size: 0.85rem;
  color: var(--warning, #e5b66d);
}
.technical-details {
  margin-top: 20px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
dl {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  gap: 10px;
  font-size: 0.8rem;
}
dt {
  color: var(--fg-subtle);
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 22px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
.change-review > p,
.change-review section {
  margin-top: 16px;
}
.change-review .button-row {
  margin-top: 22px;
}
.review-channel {
  margin-top: 12px;
}
.change-review ul {
  padding-left: 20px;
  overflow-wrap: anywhere;
}
.change-review li {
  margin: 6px 0;
  line-height: 1.45;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
@media (max-width: 700px) {
  .channels-pane {
    padding: 16px 4px;
  }
  .page-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
  }
  .lineup-picker {
    width: 100%;
  }
  .lineup-tools {
    gap: 8px 14px;
    margin-bottom: 16px;
  }
  .search-row {
    flex-wrap: wrap;
  }
  .channel-search {
    flex-basis: 100%;
  }
  .filters {
    gap: 4px;
  }
  .filters :deep(cindor-button) {
    font-size: 0.78rem;
  }
  .channel-list th:first-child {
    width: 48px;
  }
  .channel-list th:nth-child(2) {
    width: 48px;
  }
  .channel-list th:last-child {
    width: 72px;
  }
  .channel-list td,
  .channel-list th {
    padding: 10px 4px;
  }
  .source-cell,
  .source-heading {
    display: none;
  }
  .mobile-source {
    display: block;
    font-size: 0.75rem;
    color: var(--fg-subtle);
    margin-top: 4px;
    overflow-wrap: anywhere;
  }
  .identity-cell strong {
    font-size: 0.85rem;
  }
  .changed-label {
    display: block;
    margin: 3px 0 0;
  }
  .row-help {
    font-size: 0.74rem;
  }
  .edit-cell :deep(cindor-button) {
    --cindor-button-padding-inline: 8px;
  }
  .save-bar {
    bottom: 6px;
    padding: 12px;
    gap: 10px;
  }
  .save-bar .button-row {
    width: 100%;
  }
  .save-bar strong {
    font-size: 0.9rem;
  }
  .endpoint {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .endpoint strong {
    grid-column: 1/-1;
  }
  .maintenance {
    grid-template-columns: 1fr;
  }
  .channel-editor,
  .change-review {
    width: calc(100vw - 80px);
    padding: 12px;
    max-height: calc(100dvh - 72px);
  }
  .editor-footer {
    align-items: flex-start;
  }
  .editor-footer .help {
    font-size: 0.8rem;
  }
}
</style>
