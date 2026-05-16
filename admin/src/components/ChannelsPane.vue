<template>
  <div class="tab-panel">
    <CindorStack
      class="channel-toolbar"
      direction="horizontal"
      align="center"
      wrap
      gap="sm"
      role="group"
      aria-label="Channel workflow actions"
    >
      <CindorSelect
        class="profile-select"
        :model-value="selectedProfileSlug"
        :disabled="loading || !profileOptions.length"
        aria-label="Selected output profile"
        :aria-describedby="selectedProfile ? 'channels-toolbar-summary channels-profile-meta-list' : 'channels-toolbar-summary'"
        @update:model-value="changeSelectedProfile"
      >
        <option value="" disabled>Select output profile</option>
        <option v-for="profile in profileOptions" :key="profile.value" :value="profile.value">
          {{ profile.label }}
        </option>
      </CindorSelect>
      <CindorInput
        class="profile-name-input"
        :model-value="selectedProfile?.name || ''"
        placeholder="Profile name"
        :disabled="loading || !selectedProfile"
        aria-label="Output profile name"
        :aria-describedby="selectedProfile ? 'channels-toolbar-summary channels-editing-model-copy' : 'channels-toolbar-summary'"
        @update:model-value="updateProfileName"
      />
      <label class="toolbar-switch">
        <span>Enabled</span>
        <CindorSwitch
          :model-value="selectedProfile?.enabled ?? true"
          :disabled="loading || !selectedProfile || selectedProfile?.isDefault"
          aria-label="Output profile enabled"
          :aria-describedby="selectedProfile ? 'channels-toolbar-summary channels-editing-model-copy' : 'channels-toolbar-summary'"
          @update:model-value="updateProfileEnabled"
        />
      </label>
      <CindorButton
        variant="ghost"
        :disabled="loading"
        aria-describedby="channels-toolbar-summary"
        @click="createProfile"
      >
        New Profile
      </CindorButton>
      <CindorButton
        variant="ghost"
        :disabled="loading || !selectedProfile"
        :aria-describedby="selectedProfile ? 'channels-toolbar-summary channels-editing-model-copy' : 'channels-toolbar-summary'"
        @click="duplicateProfile"
      >
        Duplicate
      </CindorButton>
      <CindorButton
        class="danger-button"
        variant="ghost"
        :disabled="loading || !selectedProfile || selectedProfile?.isDefault"
        :aria-describedby="selectedProfile ? 'channels-toolbar-summary channels-editing-model-copy' : 'channels-toolbar-summary'"
        @click="deleteProfile"
      >
        Delete
      </CindorButton>
      <CindorButton
        variant="ghost"
        :disabled="loading"
        :aria-busy="loading ? 'true' : undefined"
        :aria-describedby="selectedProfile ? 'channels-toolbar-summary channels-editing-model-copy' : 'channels-toolbar-summary'"
        @click="refreshChannels"
      >
        {{ loading ? 'Refreshing...' : 'Refresh' }}
      </CindorButton>
      <CindorButton
        variant="ghost"
        :disabled="reloadingChannels"
        :aria-busy="reloadingChannels ? 'true' : undefined"
        :aria-describedby="selectedProfile ? 'channels-toolbar-summary channels-editing-model-copy' : 'channels-toolbar-summary'"
        @click="reloadChannels"
      >
        {{ reloadingChannels ? 'Reloading Channels...' : 'Reload Channels' }}
      </CindorButton>
      <CindorButton
        variant="ghost"
        :disabled="reloadingEPG"
        :aria-busy="reloadingEPG ? 'true' : undefined"
        :aria-describedby="selectedProfile ? 'channels-toolbar-summary channels-editing-model-copy' : 'channels-toolbar-summary'"
        @click="reloadEPG"
      >
        {{ reloadingEPG ? 'Reloading EPG...' : 'Reload EPG' }}
      </CindorButton>
      <CindorButton
        :disabled="!profileDirty || savingProfile"
        :aria-busy="savingProfile ? 'true' : undefined"
        :aria-describedby="selectedProfile ? 'channels-toolbar-summary channels-editing-model-copy' : 'channels-toolbar-summary'"
        @click="saveProfileChanges"
      >
        {{ savingProfile ? 'Saving Output...' : 'Save Output Changes' }}
      </CindorButton>
    </CindorStack>
    <div id="channels-toolbar-summary" class="table-summary" role="status" aria-live="polite">
      {{ channelToolbarSummary }}
    </div>

    <div
      v-if="selectedProfile"
      class="profile-meta"
      role="region"
      aria-labelledby="channels-profile-meta-title"
      aria-describedby="channels-profile-meta-list"
    >
      <div id="channels-profile-meta-title" class="sr-only">Selected profile metadata</div>
      <div id="channels-profile-meta-list" class="profile-meta-item">
        <span class="profile-meta-label">Slug</span>
        <code>{{ selectedProfile.slug }}</code>
      </div>
    </div>

    <div
      v-if="selectedProfile"
      class="save-model-card"
      role="region"
      aria-labelledby="channels-editing-model-title"
      aria-describedby="channels-editing-model-copy"
    >
      <div id="channels-editing-model-title" class="save-model-title">Editing model</div>
      <div id="channels-editing-model-copy" class="save-model-copy">
        Channel name, preferred stream, guide source, enabled state, and guide number changes are
        staged in this table. Use <strong>Save Output Changes</strong> to apply them together.
      </div>
    </div>

    <div
      v-if="selectedProfile && profileEndpointInfo"
      class="endpoint-card"
      role="region"
      aria-labelledby="channels-endpoint-card-title"
      aria-describedby="channels-endpoint-card-message"
    >
      <div class="endpoint-card-header">
        <div id="channels-endpoint-card-title" class="endpoint-card-title">{{ profileEndpointInfo.title }}</div>
        <CindorTag
          :tone="profileEndpointInfo.available ? 'success' : 'neutral'"
          :class="{ 'status-warning': !profileEndpointInfo.available }"
        >
          {{ profileEndpointInfo.available ? 'Active for this profile' : 'Disabled' }}
        </CindorTag>
      </div>
      <div id="channels-endpoint-card-message" class="endpoint-card-message">{{ profileEndpointInfo.message }}</div>
      <div class="endpoint-list" role="list" aria-label="Published endpoints">
        <div v-for="endpoint in profileEndpointInfo.endpoints" :key="endpoint.label" class="endpoint-item" role="listitem">
          <span class="endpoint-label">{{ endpoint.label }}</span>
          <code>{{ endpoint.url }}</code>
        </div>
      </div>
    </div>

    <div
      class="summary-region"
      role="region"
      aria-labelledby="channels-summary-title"
      aria-describedby="channels-summary-copy"
    >
      <div id="channels-summary-title" class="sr-only">Channel profile summary</div>
      <div id="channels-summary-copy" class="table-summary" role="status" aria-live="polite">
        {{ channelProfileSummary }}
      </div>
      <div class="summary-grid" role="list" aria-label="Channel profile summary">
        <div class="summary-card" role="listitem">
          <div class="summary-label">Canonical Channels</div>
          <div class="summary-value">{{ profileStats.totalChannels }}</div>
        </div>
        <div class="summary-card" role="listitem">
          <div class="summary-label">Enabled In Profile</div>
          <div class="summary-value">{{ profileStats.enabledChannels }}</div>
        </div>
        <div class="summary-card" role="listitem">
          <div class="summary-label">Guide Warnings</div>
          <div class="summary-value">{{ profileStats.missingGuideChannels }}</div>
        </div>
        <div class="summary-card" role="listitem">
          <div class="summary-label">Multi-Source</div>
          <div class="summary-value">{{ profileStats.multiSourceChannels }}</div>
        </div>
      </div>
    </div>

    <CindorStack
      class="channel-filter-row"
      direction="horizontal"
      wrap
      gap="sm"
      role="group"
      aria-label="Channel filters"
    >
      <CindorInput
        v-model="channelSearch"
        class="channel-search"
        placeholder="Search channels, tvg-id, or sources"
        aria-label="Search channels"
        aria-describedby="channels-summary-copy filter-count"
      />
      <CindorSelect
        v-model="channelFilter"
        class="channel-filter-select"
        aria-label="Filter channels"
        aria-describedby="channels-summary-copy filter-count"
      >
        <option value="all">All channels</option>
        <option value="drafts">Unsaved changes</option>
        <option value="guide-warnings">Guide warnings</option>
        <option value="enabled">Enabled only</option>
        <option value="disabled">Disabled only</option>
        <option value="multi-source">Multi-source only</option>
      </CindorSelect>
      <div id="filter-count" class="filter-count" role="status" aria-live="polite" aria-atomic="true">
        Showing {{ filteredRows.length }} of {{ rows.length }} channel{{
          rows.length === 1 ? '' : 's'
        }}
      </div>
    </CindorStack>

    <div
      v-if="showGettingStarted"
      class="guide-panel"
      role="region"
      aria-labelledby="channels-guide-title"
      aria-describedby="channels-guide-copy"
    >
      <div id="channels-guide-title" class="guide-title">Finish channel setup</div>
      <div id="channels-guide-copy" class="guide-copy">
        Channel publishing becomes available after source discovery completes and a profile is ready
        to save.
      </div>
      <div class="guide-steps" role="list" aria-label="Channel setup steps">
        <span role="listitem">1. Save sources and run “Reload Channels”.</span>
        <span role="listitem">2. Resolve guide warnings and pick preferred streams where needed.</span>
        <span role="listitem">3. Save output changes to publish the profile lineup.</span>
      </div>
    </div>

    <div v-if="loading && !rows.length" class="empty-state" role="status" aria-live="polite">
      Loading channel workflows…
    </div>
    <div v-else-if="!rows.length" class="empty-state" role="status" aria-live="polite">
      No canonical channels are available yet. Save sources and reload channels first.
    </div>
    <div v-else-if="!filteredRows.length" class="empty-state" role="status" aria-live="polite">
      No channels match the current filters.
    </div>
    <div
      v-else
      class="table-shell"
      role="region"
      aria-labelledby="channels-table-title"
      aria-describedby="channels-table-summary"
    >
      <div id="channels-table-title" class="sr-only">Channel workflow table</div>
      <div id="channels-table-summary" class="table-summary" role="status" aria-live="polite">
        {{ channelTableSummary }}
      </div>
      <table class="channel-table">
        <caption class="sr-only">
          Channel workflow settings for the selected output profile.
        </caption>
        <thead>
          <tr>
            <th scope="col">Enabled</th>
            <th scope="col">Channel</th>
            <th scope="col">Preferred Stream</th>
            <th scope="col">Guide Source</th>
            <th scope="col">Guide Number</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in filteredRows" :key="row.id">
            <td class="cell-center" data-label="Enabled">
              <CindorSwitch
                :model-value="row.outputEnabled"
                :disabled="row.enableToggleDisabled || savingProfile"
                :aria-label="`Publish channel ${row.name}`"
                :aria-describedby="buildChannelSourceDetailsDescribedBy(row)"
                @update:model-value="value => updateOutputEnabled(row.id, value)"
              />
            </td>
            <td data-label="Channel">
              <div class="channel-name-row">
                <CindorInput
                  class="channel-name-input"
                  :model-value="row.customNameDraft"
                  :placeholder="row.baseName || 'Channel name'"
                  :disabled="loading || savingProfile"
                  :aria-label="`Display name for ${row.baseName || row.name}`"
                  @update:model-value="value => updateCanonicalNameDraft(row.id, value)"
                  @blur="() => saveCanonicalName(row.id)"
                  @keydown.enter.prevent="() => saveCanonicalName(row.id)"
                />
                <CindorTag v-if="row.customName" tone="accent">Custom</CindorTag>
                <CindorTag :tone="row.rowStatusTone" :class="{ 'status-danger': row.rowStatusTone === 'danger' }">
                  {{ row.rowStatusLabel }}
                </CindorTag>
              </div>
              <div
                v-if="row.customName && row.baseName && row.baseName !== row.name"
                class="channel-original-name"
              >
                Original: {{ row.baseName }}
              </div>
              <div
                v-if="row.tvg_id || row.guideNumber || row.sourceBindings.length"
                class="channel-meta"
                role="list"
                :aria-label="`Channel metadata for ${row.name}`"
              >
                <span v-if="row.tvg_id" role="listitem">TVG ID: {{ row.tvg_id }}</span>
                <span v-if="row.guideNumber" role="listitem">Guide: {{ row.guideNumber }}</span>
                <span role="listitem">
                  {{ row.sourceBindings.length }} source{{ row.sourceBindings.length === 1 ? '' : 's' }}
                </span>
              </div>
              <div
                class="source-details"
                role="group"
                :aria-label="`Source details for ${row.name}`"
              >
                <div :id="buildChannelSourceDetailsId(row.id)" class="source-list">
                  {{ row.sourceBindingsSummary || 'No source bindings available yet.' }}
                </div>
                <div
                  v-if="row.sourceGuideReferencesSummary"
                  :id="buildChannelSourceReferencesId(row.id)"
                  class="source-reference"
                >
                  Source refs: {{ row.sourceGuideReferencesSummary }}
                </div>
              </div>
            </td>
            <td data-label="Preferred Stream">
              <CindorSelect
                :model-value="row.preferredSourceChannelId || ''"
                :disabled="row.preferredStreamOptions.length === 0 || savingProfile"
                :aria-label="`Preferred stream for ${row.name}`"
                :aria-describedby="buildChannelSourceDetailsDescribedBy(row)"
                @update:model-value="value => updatePreferredStream(row.id, value)"
              >
                <option value="" disabled>No stream choices</option>
                <option
                  v-for="option in row.preferredStreamOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </CindorSelect>
            </td>
            <td data-label="Guide Source">
              <CindorSelect
                :model-value="row.selectedGuideBindingValue || ''"
                :disabled="row.guideBindingOptions.length === 0 || savingProfile"
                :aria-label="`Guide source for ${row.name}`"
                :aria-describedby="buildChannelGuideHelpId(row.id)"
                @update:model-value="value => updateGuideBinding(row.id, value)"
              >
                <option value="" disabled>No guide choices</option>
                <option
                  v-for="option in row.guideBindingOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </CindorSelect>
            </td>
            <td data-label="Guide Number">
              <div class="guide-control-row">
                <CindorTag
                  :tone="row.guideDisplaySource === 'override' ? 'success' : 'accent'"
                  :class="{ 'status-danger': row.guideDisplayWarning }"
                >
                  {{ row.guideDisplayLabel }}
                </CindorTag>
                <CindorInput
                  class="guide-input"
                  :model-value="row.guideNumberOverrideInput"
                  maxlength="5"
                  placeholder="Guide #"
                  :disabled="savingProfile"
                  :aria-label="`Guide number override for ${row.name}`"
                  :aria-describedby="buildChannelGuideHelpId(row.id)"
                  @update:model-value="value => updateGuideNumberOverrideInput(row.id, value)"
                  @blur="() => commitGuideNumberOverride(row.id)"
                />
              </div>
              <div
                :id="buildChannelGuideHelpId(row.id)"
                class="guide-help"
                :class="{ warning: row.guideDisplayWarning }"
              >
                {{ row.guideHelpText }}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import {
  CindorButton,
  CindorInput,
  CindorSelect,
  CindorStack,
  CindorSwitch,
  CindorTag,
} from 'cindor-ui-vue';

const props = defineProps({
  profiles: { type: Array, required: true },
  selectedProfileSlug: { type: String, required: true },
  selectedProfile: { type: Object, default: null },
  rows: { type: Array, required: true },
  loading: { type: Boolean, required: true },
  savingProfile: { type: Boolean, required: true },
  reloadingChannels: { type: Boolean, required: true },
  reloadingEPG: { type: Boolean, required: true },
  updatingCanonicalNameId: { type: String, default: '' },
  updatingPreferredStreamId: { type: String, default: '' },
  updatingGuideBindingId: { type: String, default: '' },
  profileDirty: { type: Boolean, required: true },
  profileStats: {
    type: Object,
    required: true,
  },
  profileEndpointInfo: { type: Object, default: null },
  changeSelectedProfile: { type: Function, required: true },
  refreshChannels: { type: Function, required: true },
  reloadChannels: { type: Function, required: true },
  reloadEPG: { type: Function, required: true },
  saveProfileChanges: { type: Function, required: true },
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

const profileOptions = computed(() =>
  props.profiles.map(profile => ({
    label: profile.name,
    value: profile.slug,
  }))
);

const showGettingStarted = computed(
  () =>
    !props.loading &&
    (!Array.isArray(props.rows) || props.rows.length === 0 || (props.profileStats?.totalChannels || 0) === 0)
);

const channelSearch = ref('');
const channelFilter = ref('all');

const filteredRows = computed(() => {
  const search = channelSearch.value.trim().toLowerCase();

  return props.rows.filter(row => {
    const matchesSearch =
      !search ||
      [
        row.name,
        row.baseName,
        row.customNameDraft,
        row.tvg_id,
        row.sourceBindingsSummary,
        row.sourceGuideReferencesSummary,
      ]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(search));

    if (!matchesSearch) {
      return false;
    }

    switch (channelFilter.value) {
      case 'drafts':
        return Boolean(row.hasDraftChanges);
      case 'guide-warnings':
        return Boolean(row.guideDisplayWarning);
      case 'enabled':
        return Boolean(row.outputEnabled);
      case 'disabled':
        return !row.outputEnabled;
      case 'multi-source':
        return Array.isArray(row.sourceBindings) && row.sourceBindings.length > 1;
      default:
        return true;
    }
  });
});

const channelTableSummary = computed(() => {
  const profileName = props.selectedProfile?.name || 'the selected profile';
  const visibleCount = filteredRows.value.length;
  const totalCount = props.rows.length;
  const filterLabel = CHANNEL_FILTER_LABELS[channelFilter.value] || 'all channels';

  return `Showing ${visibleCount} of ${totalCount} channels for ${profileName}. Current filter: ${filterLabel}.`;
});

const channelProfileSummary = computed(() => {
  const profileName = props.selectedProfile?.name || 'the selected profile';
  return `${profileName} includes ${props.profileStats.totalChannels} canonical channel${
    props.profileStats.totalChannels === 1 ? '' : 's'
  }, ${props.profileStats.enabledChannels} enabled channel${
    props.profileStats.enabledChannels === 1 ? '' : 's'
  }, ${props.profileStats.missingGuideChannels} guide warning${
    props.profileStats.missingGuideChannels === 1 ? '' : 's'
  }, and ${props.profileStats.multiSourceChannels} multi-source channel${
    props.profileStats.multiSourceChannels === 1 ? '' : 's'
  }.`;
});

const channelToolbarSummary = computed(() => {
  const profileName = props.selectedProfile?.name || 'No output profile selected';
  if (!props.selectedProfile) {
    return 'Select or create an output profile before editing channel publishing settings.';
  }

  return `${profileName} is currently ${props.profileDirty ? 'showing unsaved changes' : 'saved'}. Use the toolbar to rename the profile, toggle publishing, reload source data, or save staged channel edits.`;
});

const CHANNEL_FILTER_LABELS = {
  all: 'all channels',
  drafts: 'unsaved changes',
  'guide-warnings': 'guide warnings',
  enabled: 'enabled only',
  disabled: 'disabled only',
  'multi-source': 'multi-source only',
};

function buildChannelSourceDetailsId(channelId) {
  return `channel-source-details-${channelId}`;
}

function buildChannelSourceReferencesId(channelId) {
  return `channel-source-references-${channelId}`;
}

function buildChannelSourceDetailsDescribedBy(row) {
  const ids = [buildChannelSourceDetailsId(row.id)];
  if (row.sourceGuideReferencesSummary) {
    ids.push(buildChannelSourceReferencesId(row.id));
  }
  return ids.join(' ');
}

function buildChannelGuideHelpId(channelId) {
  return `channel-guide-help-${channelId}`;
}
</script>

<style scoped>
.tab-panel {
  padding: 28px 32px 32px;
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

.channel-toolbar {
  margin-bottom: 0.75rem;
}

.table-summary {
  margin-bottom: 0.5rem;
  opacity: 0.72;
  font-size: 0.92rem;
}

.profile-select,
.profile-name-input {
  min-width: 220px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.summary-region {
  margin-bottom: 1rem;
}

.endpoint-card {
  margin-bottom: 1rem;
  padding: 0.85rem 1rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
}

.save-model-card {
  margin-bottom: 1rem;
  padding: 0.85rem 1rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
}

.save-model-title {
  margin-bottom: 0.35rem;
  font-weight: 600;
}

.save-model-copy {
  opacity: 0.8;
}

.endpoint-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.4rem;
}

.endpoint-card-title {
  font-weight: 600;
}

.endpoint-card-message {
  margin-bottom: 0.75rem;
  opacity: 0.75;
}

.endpoint-list {
  display: grid;
  gap: 0.45rem;
}

.channel-filter-row {
  align-items: center;
  margin-bottom: 1rem;
}

.channel-search {
  flex: 1 1 18rem;
  min-width: 18rem;
}

.channel-filter-select {
  flex: 0 1 12rem;
  min-width: 12rem;
}

.filter-count {
  display: inline-flex;
  align-items: center;
  min-height: 2.5rem;
  opacity: 0.72;
  font-size: 0.88rem;
}

.endpoint-item {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.endpoint-item code {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.endpoint-label {
  min-width: 3.5rem;
  opacity: 0.65;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 0.72rem;
}

.profile-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 1rem;
  padding: 0.85rem 1rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
}

.profile-meta-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
}

.profile-meta-label {
  opacity: 0.65;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 0.72rem;
}

.summary-card {
  padding: 0.85rem 1rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
}

.summary-label {
  opacity: 0.65;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.summary-value {
  margin-top: 0.3rem;
  font-size: 1.5rem;
  font-weight: 600;
}

.table-shell {
  overflow-x: auto;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
}

.channel-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 1080px;
}

.channel-table th,
.channel-table td {
  padding: 0.8rem 0.75rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  vertical-align: top;
}

.channel-table th {
  text-align: left;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--fg-subtle);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  background: rgba(255, 255, 255, 0.03);
}

.channel-name-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}

.channel-name-input {
  flex: 1 1 12rem;
  min-width: 14rem;
}

.channel-original-name {
  margin-bottom: 0.35rem;
  font-size: 0.78rem;
  opacity: 0.72;
}

.source-list {
  font-size: 0.82rem;
  opacity: 0.72;
  line-height: 1.4;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.channel-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.75rem;
  margin-bottom: 0.35rem;
  font-size: 0.78rem;
  opacity: 0.72;
}

.channel-meta span,
.profile-meta-item code {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.source-reference {
  margin-top: 0.3rem;
  font-size: 0.78rem;
  opacity: 0.68;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.guide-control-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.guide-input {
  width: 6.5rem;
  min-width: 6.5rem;
}

.guide-help {
  margin-top: 0.35rem;
  font-size: 0.78rem;
  opacity: 0.72;
}

.guide-help.warning {
  color: var(--warning);
  opacity: 1;
}

.toolbar-switch {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
}

.cell-center {
  text-align: center;
  vertical-align: middle;
}

.empty-state {
  padding: 2rem 0;
  text-align: center;
  opacity: 0.65;
}

.guide-panel {
  margin-bottom: 1rem;
  padding: 0.85rem 1rem;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
}

.guide-title {
  font-weight: 600;
  margin-bottom: 0.35rem;
}

.guide-copy {
  opacity: 0.84;
}

.guide-steps {
  display: grid;
  gap: 0.25rem;
  margin-top: 0.55rem;
  font-size: 0.92rem;
  opacity: 0.75;
}

.danger-button {
  --cindor-button-ghost-border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
  --cindor-button-ghost-color: var(--danger);
  --cindor-button-hover-border-color: var(--danger);
  --cindor-button-hover-color: var(--danger);
}

.status-warning {
  color: var(--warning);
}

.status-danger {
  color: var(--danger);
}

@media (max-width: 1100px) {
  .tab-panel {
    padding: 24px 24px 28px;
  }

  .profile-select,
  .profile-name-input {
    min-width: 12rem;
  }

  .channel-search {
    min-width: 14rem;
  }

  .channel-filter-select {
    min-width: 10rem;
  }

  .channel-table {
    min-width: 920px;
  }

  .channel-name-input {
    min-width: 10rem;
  }
}

@media (max-width: 900px) {
  .tab-panel {
    padding: 20px 20px 20px;
  }

  .channel-toolbar > * {
    width: 100%;
  }

  .channel-toolbar :deep(cindor-select),
  .channel-toolbar :deep(cindor-input),
  .channel-toolbar :deep(cindor-button) {
    width: 100%;
  }

  .channel-filter-row > * {
    width: 100%;
  }

  .filter-count {
    justify-content: flex-start;
  }

  .endpoint-card-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .table-shell {
    overflow: visible;
    border: none;
  }

  .channel-table {
    min-width: 0;
  }

  .channel-table thead {
    display: none;
  }

  .channel-table,
  .channel-table tbody,
  .channel-table tr,
  .channel-table td {
    display: block;
    width: 100%;
  }

  .channel-table tr {
    margin-bottom: 1rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.02);
  }

  .channel-table td {
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    padding: 0.75rem;
  }

  .channel-table td:last-child {
    border-bottom: none;
  }

  .channel-table td::before {
    content: attr(data-label);
    display: block;
    margin-bottom: 0.4rem;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    opacity: 0.65;
    text-transform: uppercase;
  }

  .cell-center {
    text-align: left;
  }

  .guide-control-row {
    align-items: stretch;
    flex-direction: column;
  }

  .guide-input {
    width: 100%;
    min-width: 0;
  }
}

@media (max-width: 700px) {
  .channel-name-row {
    align-items: flex-start;
  }

  .channel-meta {
    flex-direction: column;
    gap: 0.2rem;
  }

  .channel-name-input {
    min-width: 0;
    width: 100%;
  }

  .profile-meta-item {
    align-items: flex-start;
    flex-direction: column;
    gap: 0.2rem;
  }
}
</style>
