<template>
  <div class="tab-panel">
    <n-space align="center" wrap style="margin-bottom: 0.75rem">
      <n-select
        style="min-width: 220px"
        :value="selectedProfileSlug"
        :options="profileOptions"
        placeholder="Select output profile"
        :disabled="loading || !profileOptions.length"
        @update:value="changeSelectedProfile"
      />
      <n-input
        style="min-width: 220px"
        :value="selectedProfile?.name || ''"
        placeholder="Profile name"
        :disabled="loading || !selectedProfile"
        @update:value="updateProfileName"
      />
      <n-switch
        :value="selectedProfile?.enabled ?? true"
        :disabled="loading || !selectedProfile || selectedProfile?.isDefault"
        @update:value="updateProfileEnabled"
      >
        <template #checked>Enabled</template>
        <template #unchecked>Disabled</template>
      </n-switch>
      <n-button @click="createProfile" :disabled="loading">New Profile</n-button>
      <n-button @click="duplicateProfile" :disabled="loading || !selectedProfile">Duplicate</n-button>
      <n-button
        tertiary
        type="error"
        @click="deleteProfile"
        :disabled="loading || !selectedProfile || selectedProfile?.isDefault"
        >
Delete
</n-button>
      <n-button @click="refreshChannels" :loading="loading">
{{
        loading ? 'Refreshing...' : 'Refresh'
      }}
</n-button>
      <n-button @click="reloadChannels" :loading="reloadingChannels">
{{
        reloadingChannels ? 'Reloading Channels...' : 'Reload Channels'
      }}
</n-button>
      <n-button @click="reloadEPG" :loading="reloadingEPG">
{{
        reloadingEPG ? 'Reloading EPG...' : 'Reload EPG'
      }}
</n-button>
      <n-button
        type="primary"
        @click="saveProfileChanges"
        :disabled="!profileDirty"
        :loading="savingProfile"
        >
{{ savingProfile ? 'Saving Output...' : 'Save Output Changes' }}
</n-button>
    </n-space>

    <div v-if="selectedProfile" class="profile-meta">
      <div class="profile-meta-item">
        <span class="profile-meta-label">Slug</span>
        <code>{{ selectedProfile.slug }}</code>
      </div>
      <div class="profile-meta-item">
        <span class="profile-meta-label">Role</span>
        <span>{{ selectedProfile.isDefault ? 'Default output lineup' : 'Named output variant' }}</span>
      </div>
    </div>

    <div v-if="selectedProfile && profileEndpointInfo" class="endpoint-card">
      <div class="endpoint-card-header">
        <div class="endpoint-card-title">{{ profileEndpointInfo.title }}</div>
        <n-tag
          size="small"
          round
          :bordered="false"
          :type="profileEndpointInfo.available ? 'success' : 'warning'"
        >
          {{ profileEndpointInfo.available ? 'Active for this profile' : 'Disabled' }}
        </n-tag>
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
            <td class="cell-center">
              <n-switch
                :value="row.outputEnabled"
                :disabled="row.enableToggleDisabled"
                @update:value="value => updateOutputEnabled(row.id, value)"
              />
            </td>
            <td>
              <div class="channel-name">{{ row.name }}</div>
              <div class="meta-line">
                <n-tag size="small" round :bordered="false">{{ row.tvg_id || 'no tvg-id' }}</n-tag>
                <n-tag size="small" round :bordered="false" type="info">
{{
                  row.guideNumber || 'no guide #'
                }}
</n-tag>
                <n-tag size="small" round :bordered="false" type="success">
                  {{ row.sourceBindings.length }} source{{
                    row.sourceBindings.length === 1 ? '' : 's'
                  }}
                </n-tag>
                <n-tag v-if="row.outputEnabled" size="small" round :bordered="false" type="warning">
                  output {{ row.effectiveGuideNumber || row.guideNumber || 'default' }}
                </n-tag>
              </div>
              <div class="source-list">
                {{ row.sourceBindingsSummary || 'No source bindings available yet.' }}
              </div>
              <div v-if="row.sourceGuideReferencesSummary" class="source-reference">
                Source refs: {{ row.sourceGuideReferencesSummary }}
              </div>
            </td>
            <td>
              <n-select
                :value="row.preferredSourceChannelId"
                :options="row.preferredStreamOptions"
                placeholder="No stream choices"
                :disabled="row.preferredStreamOptions.length === 0"
                :loading="updatingPreferredStreamId === row.id"
                @update:value="value => updatePreferredStream(row.id, value)"
              />
            </td>
            <td>
              <n-select
                :value="row.selectedGuideBindingValue"
                :options="row.guideBindingOptions"
                placeholder="No guide choices"
                :disabled="row.guideBindingOptions.length === 0"
                :loading="updatingGuideBindingId === row.id"
                @update:value="value => updateGuideBinding(row.id, value)"
              />
            </td>
            <td>
              <div class="guide-state">
                <n-tag
                  size="small"
                  round
                  :bordered="false"
                  :type="row.guideDisplayWarning ? 'error' : row.guideDisplaySource === 'override' ? 'success' : 'info'"
                >
                  {{ row.guideDisplayLabel }}
                </n-tag>
              </div>
              <n-input
                :value="row.guideNumberOverrideInput"
                clearable
                placeholder="Use canonical"
                @update:value="value => updateGuideNumberOverrideInput(row.id, value)"
                @blur="() => commitGuideNumberOverride(row.id)"
              />
              <div class="guide-help" :class="{ warning: row.guideDisplayWarning }">
                {{ row.guideHelpText }}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="foot">
      Choose the preferred stream and guide source, then save profile inclusion and guide-number
      overrides for the selected profile.
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { NButton, NInput, NSelect, NSpace, NSwitch, NTag } from 'naive-ui';

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

.meta-line {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-bottom: 0.35rem;
}

.source-list {
  font-size: 0.82rem;
  opacity: 0.72;
  line-height: 1.4;
}

.source-reference {
  margin-top: 0.3rem;
  font-size: 0.78rem;
  opacity: 0.68;
}

.guide-state {
  margin-bottom: 0.35rem;
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

.cell-center {
  text-align: center;
  vertical-align: middle;
}

.empty-state {
  padding: 2rem 0;
  text-align: center;
  opacity: 0.65;
}

@media (max-width: 900px) {
  .tab-panel {
    padding: 20px 20px 20px;
  }
}
</style>
