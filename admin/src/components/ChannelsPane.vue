<template>
  <div class="tab-panel">
    <CindorStack
      class="channel-toolbar"
      direction="horizontal"
      align="center"
      wrap
      gap="sm"
      style="margin-bottom: 0.75rem"
    >
      <CindorSelect
        style="min-width: 220px"
        :model-value="selectedProfileSlug"
        :disabled="loading || !profileOptions.length"
        @update:model-value="changeSelectedProfile"
      >
        <option value="" disabled>Select output profile</option>
        <option v-for="profile in profileOptions" :key="profile.value" :value="profile.value">
          {{ profile.label }}
        </option>
      </CindorSelect>
      <CindorInput
        style="min-width: 220px"
        :model-value="selectedProfile?.name || ''"
        placeholder="Profile name"
        :disabled="loading || !selectedProfile"
        @update:model-value="updateProfileName"
      />
      <label class="toolbar-switch">
        <span>Enabled</span>
        <CindorSwitch
          :model-value="selectedProfile?.enabled ?? true"
          :disabled="loading || !selectedProfile || selectedProfile?.isDefault"
          @update:model-value="updateProfileEnabled"
        />
      </label>
      <CindorButton variant="ghost" :disabled="loading" @click="createProfile">New Profile</CindorButton>
      <CindorButton variant="ghost" :disabled="loading || !selectedProfile" @click="duplicateProfile">
        Duplicate
      </CindorButton>
      <CindorButton
        class="danger-button"
        variant="ghost"
        :disabled="loading || !selectedProfile || selectedProfile?.isDefault"
        @click="deleteProfile"
      >
        Delete
      </CindorButton>
      <CindorButton variant="ghost" :disabled="loading" @click="refreshChannels">
        {{ loading ? 'Refreshing...' : 'Refresh' }}
      </CindorButton>
      <CindorButton variant="ghost" :disabled="reloadingChannels" @click="reloadChannels">
        {{ reloadingChannels ? 'Reloading Channels...' : 'Reload Channels' }}
      </CindorButton>
      <CindorButton variant="ghost" :disabled="reloadingEPG" @click="reloadEPG">
        {{ reloadingEPG ? 'Reloading EPG...' : 'Reload EPG' }}
      </CindorButton>
      <CindorButton :disabled="!profileDirty || savingProfile" @click="saveProfileChanges">
        {{ savingProfile ? 'Saving Output...' : 'Save Output Changes' }}
      </CindorButton>
    </CindorStack>

    <div v-if="selectedProfile" class="profile-meta">
      <div class="profile-meta-item">
        <span class="profile-meta-label">Slug</span>
        <code>{{ selectedProfile.slug }}</code>
      </div>
    </div>

    <div v-if="selectedProfile && profileEndpointInfo" class="endpoint-card">
      <div class="endpoint-card-header">
        <div class="endpoint-card-title">{{ profileEndpointInfo.title }}</div>
        <CindorTag
          :tone="profileEndpointInfo.available ? 'success' : 'neutral'"
          :class="{ 'status-warning': !profileEndpointInfo.available }"
        >
          {{ profileEndpointInfo.available ? 'Active for this profile' : 'Disabled' }}
        </CindorTag>
      </div>
      <div class="endpoint-card-message">{{ profileEndpointInfo.message }}</div>
      <div class="endpoint-list">
        <div v-for="endpoint in profileEndpointInfo.endpoints" :key="endpoint.label" class="endpoint-item">
          <span class="endpoint-label">{{ endpoint.label }}</span>
          <code>{{ endpoint.url }}</code>
        </div>
      </div>
    </div>

    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-label">Canonical Channels</div>
        <div class="summary-value">{{ profileStats.totalChannels }}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Enabled In Profile</div>
        <div class="summary-value">{{ profileStats.enabledChannels }}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Guide Warnings</div>
        <div class="summary-value">{{ profileStats.missingGuideChannels }}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Multi-Source</div>
        <div class="summary-value">{{ profileStats.multiSourceChannels }}</div>
      </div>
    </div>

    <div v-if="loading && !rows.length" class="empty-state">Loading channel workflows…</div>
    <div v-else-if="!rows.length" class="empty-state">
      No canonical channels are available yet. Save sources and reload channels first.
    </div>
    <div v-else class="table-shell">
      <table class="channel-table">
        <thead>
          <tr>
            <th>Enabled</th>
            <th>Channel</th>
            <th>Preferred Stream</th>
            <th>Guide Source</th>
            <th>Guide Number</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td class="cell-center" data-label="Enabled">
              <CindorSwitch
                :model-value="row.outputEnabled"
                :disabled="row.enableToggleDisabled"
                @update:model-value="value => updateOutputEnabled(row.id, value)"
              />
            </td>
            <td data-label="Channel">
              <div class="channel-name">{{ row.name }}</div>
              <div v-if="row.tvg_id || row.guideNumber || row.sourceBindings.length" class="channel-meta">
                <span v-if="row.tvg_id">TVG ID: {{ row.tvg_id }}</span>
                <span v-if="row.guideNumber">Guide: {{ row.guideNumber }}</span>
                <span>
                  {{ row.sourceBindings.length }} source{{ row.sourceBindings.length === 1 ? '' : 's' }}
                </span>
              </div>
              <div class="source-list">
                {{ row.sourceBindingsSummary || 'No source bindings available yet.' }}
              </div>
              <div v-if="row.sourceGuideReferencesSummary" class="source-reference">
                Source refs: {{ row.sourceGuideReferencesSummary }}
              </div>
            </td>
            <td data-label="Preferred Stream">
              <CindorSelect
                :model-value="row.preferredSourceChannelId || ''"
                :disabled="row.preferredStreamOptions.length === 0"
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
                :disabled="row.guideBindingOptions.length === 0"
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
                  @update:model-value="value => updateGuideNumberOverrideInput(row.id, value)"
                  @blur="() => commitGuideNumberOverride(row.id)"
                />
              </div>
              <div class="guide-help" :class="{ warning: row.guideDisplayWarning }">
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
import { computed } from 'vue';
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
</script>

<style scoped>
.tab-panel {
  padding: 28px 32px 32px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.endpoint-card {
  margin-bottom: 1rem;
  padding: 0.85rem 1rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
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

.endpoint-item {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
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

.channel-name {
  font-weight: 600;
  margin-bottom: 0.35rem;
}

.source-list {
  font-size: 0.82rem;
  opacity: 0.72;
  line-height: 1.4;
}

.channel-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.75rem;
  margin-bottom: 0.35rem;
  font-size: 0.78rem;
  opacity: 0.72;
}

.source-reference {
  margin-top: 0.3rem;
  font-size: 0.78rem;
  opacity: 0.68;
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
</style>
