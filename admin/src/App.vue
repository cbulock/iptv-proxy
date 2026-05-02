<template>
  <CindorProvider theme="dark" color-scheme="dark">
    <div v-if="showSetupModal" class="setup-overlay">
      <div class="setup-card">
        <h2 id="setup-modal-title" class="setup-title">Set Up Admin Authentication</h2>
        <p class="setup-copy">
          No administrator credentials are configured. Set a username and password to secure the
          admin interface.
        </p>
        <CindorForm>
          <CindorFormField label="Username">
            <CindorInput v-model="setupForm.username" placeholder="admin" :disabled="savingSetup" />
          </CindorFormField>
          <CindorFormField label="Password">
            <CindorPasswordInput
              v-model="setupForm.password"
              placeholder="Min. 8 characters"
              :disabled="savingSetup"
            />
          </CindorFormField>
          <CindorFormField label="Confirm Password">
            <CindorPasswordInput
              v-model="setupForm.confirm"
              placeholder="Repeat password"
              :disabled="savingSetup"
            />
          </CindorFormField>
        </CindorForm>
        <div v-if="setupError" class="setup-error">{{ setupError }}</div>
        <CindorButton :disabled="savingSetup" @click="submitSetup">
          {{ savingSetup ? 'Saving...' : 'Save Credentials' }}
        </CindorButton>
      </div>
    </div>

    <CindorLayout v-if="!authStateReady" class="admin-shell">
      <CindorLayoutHeader class="admin-header">
        <div class="brand-lockup">
          <div class="brand-mark">IP</div>
          <div class="brand-title">IPTV Proxy Admin</div>
        </div>
      </CindorLayoutHeader>
      <CindorLayoutContent class="admin-content login-content">
        <div class="workspace-frame login-frame">
          <div class="login-card">
            <div class="login-title">Loading admin…</div>
          </div>
        </div>
      </CindorLayoutContent>
    </CindorLayout>

    <CindorLayout v-else-if="showLoginView" class="admin-shell">
      <CindorLayoutHeader class="admin-header">
        <div class="brand-lockup">
          <div class="brand-mark">IP</div>
          <div class="brand-title">IPTV Proxy Admin</div>
        </div>
      </CindorLayoutHeader>
      <CindorLayoutContent class="admin-content login-content">
        <div class="workspace-frame login-frame">
          <div class="login-card">
            <h1 class="login-title">Sign In</h1>
            <p class="login-copy">Sign in to manage sources, mappings, backups, and live channel health.</p>
            <form class="login-form" @submit.prevent="submitLogin">
              <CindorForm>
                <CindorFormField label="Username">
                  <CindorInput
                    v-model="loginForm.username"
                    autocomplete="username"
                    :disabled="loggingIn"
                  />
                </CindorFormField>
                <CindorFormField label="Password">
                  <CindorPasswordInput
                    v-model="loginForm.password"
                    autocomplete="current-password"
                    :disabled="loggingIn"
                  />
                </CindorFormField>
              </CindorForm>
              <div v-if="loginError" class="setup-error">{{ loginError }}</div>
              <CindorButton type="submit" :disabled="loggingIn">
                {{ loggingIn ? 'Signing In...' : 'Sign In' }}
              </CindorButton>
            </form>
          </div>
        </div>
      </CindorLayoutContent>
    </CindorLayout>

    <CindorLayout v-else class="admin-shell">
      <CindorLayoutHeader class="admin-header">
        <div class="brand-lockup">
          <div class="brand-mark">IP</div>
          <div class="brand-title">IPTV Proxy Admin</div>
        </div>
        <CindorButton
          v-if="authConfigured"
          class="compact-button signout-button"
          variant="ghost"
          :disabled="loggingOut"
          @click="logout"
        >
          Sign Out
        </CindorButton>
      </CindorLayoutHeader>
      <CindorLayoutContent class="admin-content">
        <div class="workspace-frame">
          <CindorTabs v-model:value="tab" class="admin-tabs">
            <CindorTabPanel value="app" label="App">
              <app-settings-pane
                :app-base-url="app.base_url"
                :auth-configured="authConfigured"
                :password-current="passwordForm.current"
                :password-new="passwordForm.newPass"
                :password-confirm="passwordForm.confirm"
                :saving-app="savingApp"
                :saving-password="savingPassword"
                :save-app="saveApp"
                :change-password="changePassword"
                @update:app-base-url="app.base_url = $event"
                @update:password-current="passwordForm.current = $event"
                @update:password-new="passwordForm.newPass = $event"
                @update:password-confirm="passwordForm.confirm = $event"
              />
            </CindorTabPanel>

            <CindorTabPanel value="providers" label="Sources">
              <sources-pane
                :providers="providers"
                :epg-validation="epgValidation"
                :provider-columns="providerColumns"
                :saving-providers="savingProviders"
                :loading-e-p-g-validation="loadingEPGValidation"
                :add-provider="addProvider"
                :save-providers="saveProviders"
                :load-e-p-g-validation="loadEPGValidation"
                @cell-edit="handleProviderCellEdit"
                @row-action="handleProviderRowAction"
              />
            </CindorTabPanel>

            <CindorTabPanel value="channels" label="Channels">
              <channels-pane
                :profiles="outputProfiles"
                :selected-profile-slug="selectedOutputProfileSlug"
                :selected-profile="selectedOutputProfile"
                :rows="channelWorkflowRows"
                :loading="channelWorkflowsLoading"
                :saving-profile="savingOutputProfile"
                :reloading-channels="reloadingChannels"
                :reloading-e-p-g="reloadingEPG"
                :updating-preferred-stream-id="updatingPreferredStreamChannelId"
                :updating-guide-binding-id="updatingGuideBindingChannelId"
                :profile-dirty="profileDirty"
                :profile-stats="channelWorkflowStats"
                :profile-endpoint-info="selectedOutputProfileEndpointInfo"
                :change-selected-profile="changeSelectedOutputProfile"
                :refresh-channels="loadChannelAuthoringData"
                :reload-channels="reloadChannels"
                :reload-e-p-g="reloadEPG"
                :save-profile-changes="saveOutputProfileChanges"
                :create-profile="createOutputProfile"
                :duplicate-profile="duplicateOutputProfile"
                :delete-profile="deleteSelectedOutputProfile"
                :update-profile-name="updateSelectedOutputProfileName"
                :update-profile-enabled="updateSelectedOutputProfileEnabled"
                :update-preferred-stream="updatePreferredStream"
                :update-guide-binding="updateGuideBinding"
                :update-output-enabled="updateOutputEnabled"
                :update-guide-number-override-input="updateGuideNumberOverrideDraft"
                :commit-guide-number-override="commitGuideNumberOverride"
              />
            </CindorTabPanel>

            <CindorTabPanel value="preview" label="Preview">
              <CindorStack direction="horizontal" align="center" wrap gap="sm" style="margin-bottom: 0.75rem">
                <CindorSelect
                  v-model="previewProfileSlug"
                  style="min-width: 220px"
                  :disabled="!outputProfiles.length"
                  @update:model-value="changePreviewProfile"
                >
                  <option value="" disabled>Select preview profile</option>
                  <option v-for="profile in outputProfiles" :key="profile.slug" :value="profile.slug">
                    {{ profile.name }}
                  </option>
                </CindorSelect>
                <CindorInput
                  v-model="previewSearch"
                  placeholder="Search channels by name, group, or tvg-id…"
                  style="min-width: 260px"
                />
                <CindorButton variant="ghost" :disabled="loadingPreviewChannels" @click="loadPreviewChannels">
                  {{ loadingPreviewChannels ? 'Loading…' : 'Refresh' }}
                </CindorButton>
                <span class="toolbar-count">
                  {{ filteredPreviewChannels.length }} channel{{
                    filteredPreviewChannels.length !== 1 ? 's' : ''
                  }}
                </span>
              </CindorStack>
              <div
                v-if="loadingPreviewChannels && !previewChannels.length"
                style="opacity: 0.6; padding: 2rem 0; text-align: center"
              >
                Loading channels…
              </div>
              <div
                v-else-if="!previewChannels.length"
                style="opacity: 0.6; padding: 2rem 0; text-align: center"
              >
                No channels loaded. Check your source configuration.
              </div>
              <CindorDataTable
                v-else
                row-id-key="previewKey"
                :columns="previewColumns"
                :rows="previewTableRows"
                @row-action="handlePreviewRowAction"
              />
            </CindorTabPanel>

            <CindorTabPanel value="health" label="Health">
              <CindorStack direction="horizontal" align="center" wrap gap="sm" style="margin-bottom: 0.75rem">
                <CindorButton :disabled="loadingHealth" @click="loadHealth">
                  {{ loadingHealth ? 'Loading...' : 'Refresh Status' }}
                </CindorButton>
                <CindorButton variant="ghost" :disabled="runningHealth" @click="runHealth">
                  {{ runningHealth ? 'Running...' : 'Run Health Check' }}
                </CindorButton>
              </CindorStack>
              <div v-if="formattedHealthUpdated" style="opacity: 0.75; margin-bottom: 0.5rem">
                Last updated: {{ formattedHealthUpdated }}
              </div>
              <div v-if="healthDetails.length">
                <CindorDataTable row-id-key="id" :columns="healthColumns" :rows="healthDetails" />
              </div>
              <div v-else style="opacity: 0.6">No health data yet. Run a health check.</div>
            </CindorTabPanel>

            <CindorTabPanel value="usage" :label="usageTabLabel">
              <CindorStack direction="horizontal" align="center" wrap gap="sm" style="margin-bottom: 0.75rem">
                <CindorButton :disabled="loadingUsage" @click="loadUsage">
                  {{ loadingUsage ? 'Loading...' : 'Refresh' }}
                </CindorButton>
              </CindorStack>
              <div v-if="activeUsage.length">
                <CindorDataTable row-id-key="key" :columns="usageColumns" :rows="activeUsage" />
              </div>
              <div v-else style="opacity: 0.6">No active viewers detected.</div>
            </CindorTabPanel>

            <CindorTabPanel value="tasks" label="Tasks">
              <CindorStack direction="horizontal" align="center" wrap gap="sm" style="margin-bottom: 0.75rem">
                <CindorButton :disabled="loadingTasks" @click="loadTasks">
                  {{ loadingTasks ? 'Loading...' : 'Refresh' }}
                </CindorButton>
              </CindorStack>
              <div v-if="tasks.length">
                <CindorDataTable
                  row-id-key="name"
                  :columns="taskColumns"
                  :rows="tasks"
                  @row-action="handleTaskRowAction"
                />
              </div>
              <div v-else style="opacity: 0.6">No scheduled tasks found.</div>
            </CindorTabPanel>

            <CindorTabPanel value="backups" label="Backups">
              <CindorStack direction="horizontal" align="center" wrap gap="sm" style="margin-bottom: 0.75rem">
                <CindorButton :disabled="creatingBackup" @click="createBackup">
                  {{ creatingBackup ? 'Creating...' : 'Create Backup' }}
                </CindorButton>
                <CindorButton variant="ghost" :disabled="loadingBackups" @click="loadBackups">
                  {{ loadingBackups ? 'Loading...' : 'Refresh' }}
                </CindorButton>
              </CindorStack>
              <div v-if="backups.length">
                <CindorDataTable
                  row-id-key="name"
                  :columns="backupColumns"
                  :rows="backups"
                  @row-action="handleBackupRowAction"
                />
              </div>
              <div v-else style="opacity: 0.6">
                No backups yet. Click "Create Backup" to save the current config.
              </div>
            </CindorTabPanel>
          </CindorTabs>
        </div>
      </CindorLayoutContent>
    </CindorLayout>

    <CindorDialog v-model:open="showVideoModal" modal aria-labelledby="preview-dialog-title">
      <div v-if="previewWatchingChannel" class="dialog-body">
        <div id="preview-dialog-title" class="dialog-title">
          {{ previewWatchingChannel ? previewWatchingChannel.name : 'Watch Channel' }}
        </div>
        <div
          style="
            background: #000;
            border-radius: 4px;
            overflow: hidden;
            margin-bottom: 1rem;
            position: relative;
          "
        >
          <video
            ref="videoPlayerEl"
            controls
            autoplay
            style="width: 100%; max-height: 360px; display: block"
            preload="auto"
          />
          <div
            v-if="state.playerError"
            role="alert"
            aria-live="assertive"
            style="
              position: absolute;
              inset: 0;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              background: rgba(0, 0, 0, 0.85);
              color: #fff;
              padding: 1.5rem;
              text-align: center;
              gap: 0.5rem;
            "
          >
            <div aria-hidden="true" style="font-size: 1.5rem">⚠️</div>
            <div style="font-weight: 600">{{ state.playerError }}</div>
            <CindorButton
              v-if="showTranscodeButton"
              class="compact-button"
              style="margin-top: 0.25rem"
              @click="setupTranscodePlayer"
            >
              Try Server Transcoding
            </CindorButton>
            <div style="font-size: 0.8em; opacity: 0.7">
              Try opening the stream URL directly in VLC or another IPTV player.
            </div>
          </div>
        </div>

        <div class="dialog-toolbar">
          <span style="opacity: 0.7; font-size: 0.85em; flex-shrink: 0">Stream URL:</span>
          <code class="dialog-code">{{ previewStreamUrl }}</code>
          <CindorButton class="compact-button" variant="ghost" @click="copyStreamUrl">Copy</CindorButton>
          <a
            :href="previewStreamUrl"
            target="_blank"
            rel="noopener"
            style="font-size: 0.8em; opacity: 0.7"
            >Open ↗</a>
        </div>

        <div v-if="state.playerDebug" class="debug-panel">
          <button
            type="button"
            class="debug-toggle"
            :aria-expanded="state.showPlayerDebug"
            @click="state.showPlayerDebug = !state.showPlayerDebug"
          >
            <span style="font-size: 0.8em; opacity: 0.75">
              🔍 Stream Debug
              <span
                v-if="state.playerDebug.playerMode"
                style="margin-left: 0.5em; opacity: 0.6"
              >
                — player: {{ state.playerDebug.playerMode }}
              </span>
            </span>
            <span style="font-size: 0.75em; opacity: 0.5">{{
              state.showPlayerDebug ? '▲ hide' : '▼ show'
            }}</span>
          </button>
          <div v-if="state.showPlayerDebug" style="padding: 0.5rem 0.6rem; font-size: 0.75em; opacity: 0.85">
            <div class="debug-grid">
              <span style="opacity: 0.6">HDHomeRun</span>
              <span>{{ state.playerDebug.hdhomerun }}</span>
              <span style="opacity: 0.6">Player mode</span>
              <span>{{ state.playerDebug.playerMode ?? '(pending)' }}</span>
              <span style="opacity: 0.6">Probe URL</span>
              <code style="word-break: break-all; font-size: 0.9em">{{ state.playerDebug.probeUrl }}</code>
              <span style="opacity: 0.6">Probe result</span>
              <code style="word-break: break-all; font-size: 0.9em">{{
                state.playerDebug.probeResult ? JSON.stringify(state.playerDebug.probeResult) : '(pending)'
              }}</code>
              <template v-if="state.playerDebug.hlsError">
                <span style="opacity: 0.6">HLS.js error</span>
                <code style="word-break: break-all; font-size: 0.9em">{{
                  JSON.stringify(state.playerDebug.hlsError)
                }}</code>
              </template>
            </div>
            <div style="margin-bottom: 0.4rem; opacity: 0.6; font-size: 0.9em">Events:</div>
            <pre class="debug-pre">{{ state.playerDebug.events.join('\n') }}</pre>
            <div style="margin-top: 0.5rem">
              <CindorButton class="compact-button" variant="ghost" @click="copyPlayerDebug">
                Copy debug info
              </CindorButton>
            </div>
          </div>
        </div>

        <div style="border-top: 1px solid rgba(255, 255, 255, 0.1); padding-top: 0.75rem">
          <div style="font-weight: 600; margin-bottom: 0.5rem">Guide</div>
          <div v-if="loadingGuide" style="opacity: 0.6; font-size: 0.9em">Loading guide data…</div>
          <div v-else-if="!previewGuide.length" style="opacity: 0.5; font-size: 0.9em">
            No guide data available for this channel.
          </div>
          <div v-else style="max-height: 220px; overflow-y: auto">
            <div
              v-for="(prog, idx) in previewGuide"
              :key="idx"
              style="
                display: flex;
                gap: 0.75rem;
                padding: 0.35rem 0;
                border-bottom: 1px solid rgba(255, 255, 255, 0.07);
              "
            >
              <span
                style="
                  opacity: 0.6;
                  font-size: 0.85em;
                  white-space: nowrap;
                  min-width: 85px;
                "
              >
                {{ formatXMLTVTime(prog.start) }}
              </span>
              <div style="flex: 1; min-width: 0">
                <div style="font-size: 0.9em; font-weight: 500">{{ prog.title }}</div>
                <div
                  v-if="prog.desc"
                  style="
                    font-size: 0.8em;
                    opacity: 0.55;
                    margin-top: 0.1rem;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                  "
                >
                  {{ prog.desc }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </CindorDialog>

    <CindorDialog
      v-model:open="confirmDialog.open"
      modal
      aria-labelledby="confirm-dialog-title"
      @cancel="resolveConfirmDialog(false)"
      @close="resolveConfirmDialog(false)"
    >
      <div class="dialog-body">
        <div id="confirm-dialog-title" class="dialog-title">{{ confirmDialog.title }}</div>
        <div class="dialog-copy">{{ confirmDialog.content }}</div>
        <CindorStack direction="horizontal" justify="end" gap="sm" wrap>
          <CindorButton variant="ghost" @click="resolveConfirmDialog(false)">
            {{ confirmDialog.negativeText }}
          </CindorButton>
          <CindorButton
            :class="{
              'danger-button': confirmDialog.tone === 'danger',
              'warning-button': confirmDialog.tone === 'warning',
            }"
            @click="resolveConfirmDialog(true)"
          >
            {{ confirmDialog.positiveText }}
          </CindorButton>
        </CindorStack>
      </div>
    </CindorDialog>
  </CindorProvider>
</template>

<script setup>
import { reactive, toRefs, watch, computed, ref, nextTick } from 'vue';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import AppSettingsPane from './components/AppSettingsPane.vue';
import ChannelsPane from './components/ChannelsPane.vue';
import SourcesPane from './components/SourcesPane.vue';
import {
  CindorButton,
  CindorDataTable,
  CindorDialog,
  CindorForm,
  CindorFormField,
  CindorInput,
  CindorLayout,
  CindorLayoutContent,
  CindorLayoutHeader,
  CindorPasswordInput,
  CindorProvider,
  CindorSelect,
  CindorStack,
  CindorTabPanel,
  CindorTabs,
  showToast,
} from 'cindor-ui-vue';

const LOGIN_ROUTE = '/admin/login';
const DEFAULT_ADMIN_ROUTE = '/admin';
const isLoginRoute = typeof window !== 'undefined' && window.location?.pathname === LOGIN_ROUTE;

// CSRF token for mutating API requests — fetched after login
let _csrfToken = '';

/**
 * Wrapper around fetch that automatically includes the CSRF token header
 * on mutating requests (POST, PUT, DELETE, PATCH).
 */
function apiFetch(url, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const mutating = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);
  return fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      ...(mutating && _csrfToken ? { 'X-CSRF-Token': _csrfToken } : {}),
    },
  });
}

async function fetchCsrfToken() {
  try {
    const r = await apiFetch('/api/auth/csrf-token');
    if (r.ok) {
      const j = await r.json();
      _csrfToken = j.csrfToken || '';
    }
  } catch (_) {
    /* non-fatal: CSRF token may not be needed when auth is off */
  }
}

function getPostLoginRedirect() {
  if (typeof window === 'undefined') {
    return DEFAULT_ADMIN_ROUTE;
  }

  const redirect = new URLSearchParams(window.location.search).get('redirect') || DEFAULT_ADMIN_ROUTE;
  const safeRedirect =
    redirect.startsWith('/') &&
    !redirect.startsWith('//') &&
    !redirect.includes('://') &&
    redirect !== LOGIN_ROUTE
      ? redirect
      : DEFAULT_ADMIN_ROUTE;

  return safeRedirect;
}

function redirectToAdmin(target = DEFAULT_ADMIN_ROUTE) {
  if (typeof window !== 'undefined') {
    window.location.replace(target);
  }
}

function notify(content, tone = 'neutral') {
  showToast({
    content,
    dismissible: true,
    tone,
  });
}

const message = {
  error(content) {
    notify(content, 'danger');
  },
  success(content) {
    notify(content, 'success');
  },
  warning(content) {
    notify(content, 'warning');
  },
};

const confirmDialog = reactive({
  open: false,
  tone: 'warning',
  title: '',
  content: '',
  positiveText: 'Confirm',
  negativeText: 'Cancel',
  resolve: null,
});

function openConfirmDialog({
  tone = 'warning',
  title,
  content,
  positiveText = 'Confirm',
  negativeText = 'Cancel',
}) {
  return new Promise(resolve => {
    confirmDialog.open = true;
    confirmDialog.tone = tone;
    confirmDialog.title = title;
    confirmDialog.content = content;
    confirmDialog.positiveText = positiveText;
    confirmDialog.negativeText = negativeText;
    confirmDialog.resolve = resolve;
  });
}

function resolveConfirmDialog(confirmed) {
  const resolver = confirmDialog.resolve;
  confirmDialog.open = false;
  confirmDialog.resolve = null;
  if (typeof resolver === 'function') {
    resolver(confirmed);
  }
}

const state = reactive({
  tab: 'app',
  app: { base_url: '' },
  authStateReady: false,
  authConfigured: false,
  sessionAuthenticated: false,
  showSetupModal: false,
  setupForm: { username: 'admin', password: '', confirm: '' },
  setupError: '',
  savingSetup: false,
  loginForm: { username: '', password: '' },
  loginError: '',
  loggingIn: false,
  loggingOut: false,
  passwordForm: { current: '', newPass: '', confirm: '' },
  savingPassword: false,
  providers: [],
  canonicalChannels: [],
  channelBindings: [],
  guideBindings: [],
  outputProfiles: [],
  selectedOutputProfileSlug: 'default',
  outputProfileDraft: {
    name: '',
    enabled: true,
  },
  outputProfileEntries: [],
  loadingChannelAuthoring: false,
  loadingOutputProfileEntries: false,
  savingOutputProfile: false,
  outputProfileDirty: false,
  updatingPreferredStreamChannelId: '',
  updatingGuideBindingChannelId: '',
  epgValidation: null,
  loadingEPGValidation: false,
  status: '',
  statusOk: true,
  savingProviders: false,
  reloadingChannels: false,
  reloadingEPG: false,
  savingApp: false,
  health: {},
  loadingHealth: false,
  runningHealth: false,
  activeUsage: [],
  loadingUsage: false,
  tasks: [],
  loadingTasks: false,
  runningTask: null,
  backups: [],
  loadingBackups: false,
  creatingBackup: false,
  restoringBackup: null,
  deletingBackup: null,
  // Preview tab state
  previewChannels: [],
  loadingPreviewChannels: false,
  previewProfileSlug: 'default',
  previewSearch: '',
  previewWatchingChannel: null,
  showVideoModal: false,
  previewGuide: [],
  loadingGuide: false,
  playerError: null,
  // Player debug info — populated during playback setup so issues can be reported
  showPlayerDebug: false,
  playerDebug: null,
});

function setStatus(msg, ok = true) {
  state.status = msg;
  state.statusOk = ok;
}

function normalizeProvider(provider = {}, index = 0) {
  return {
    ...provider,
    _id: provider._id || `prov_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`,
    name: provider.name || '',
    type: provider.type ? String(provider.type).toLowerCase() : 'm3u',
    url: provider.url || '',
    epg: provider.epg || '',
  };
}

function getSelectedOutputProfileRecord() {
  return state.outputProfiles.find(profile => profile.slug === state.selectedOutputProfileSlug) || null;
}

function resetSelectedOutputProfileDraft() {
  const profile = getSelectedOutputProfileRecord();
  state.outputProfileDraft = {
    name: profile?.name || '',
    enabled: profile?.enabled ?? true,
  };
}

async function loadProviders() {
  try {
    const r = await apiFetch('/api/config/providers');
    const cfg = await r.json();
    state.providers = (cfg.providers && Array.isArray(cfg.providers) ? cfg.providers : []).map(
      normalizeProvider
    );
    setStatus('Loaded sources');
  } catch (e) {
    setStatus('Failed to load sources: ' + e.message, false);
    message.error(e.message);
  }
}

async function loadChannelAuthoringData() {
  try {
    state.loadingChannelAuthoring = true;
    const [channelsRes, bindingsRes, guideBindingsRes, profilesRes] = await Promise.all([
      apiFetch('/api/canonical/channels'),
      apiFetch('/api/canonical/bindings'),
      apiFetch('/api/canonical/guide-bindings'),
      apiFetch('/api/output-profiles'),
    ]);
    const [channelsJson, bindingsJson, guideBindingsJson, profilesJson] = await Promise.all([
      channelsRes.json(),
      bindingsRes.json(),
      guideBindingsRes.json(),
      profilesRes.json(),
    ]);

    if (!channelsRes.ok) {
      throw new Error(channelsJson.error || 'Failed to load canonical channels');
    }
    if (!bindingsRes.ok) {
      throw new Error(bindingsJson.error || 'Failed to load channel bindings');
    }
    if (!guideBindingsRes.ok) {
      throw new Error(guideBindingsJson.error || 'Failed to load guide bindings');
    }
    if (!profilesRes.ok) {
      throw new Error(profilesJson.error || 'Failed to load output profiles');
    }

    state.canonicalChannels = Array.isArray(channelsJson?.channels) ? channelsJson.channels : [];
    state.channelBindings = Array.isArray(bindingsJson?.bindings) ? bindingsJson.bindings : [];
    state.guideBindings = Array.isArray(guideBindingsJson?.bindings)
      ? guideBindingsJson.bindings
      : [];
    state.outputProfiles = Array.isArray(profilesJson?.profiles) ? profilesJson.profiles : [];

    const hasSelectedProfile = state.outputProfiles.some(
      profile => profile.slug === state.selectedOutputProfileSlug
    );
    const nextProfileSlug = hasSelectedProfile
      ? state.selectedOutputProfileSlug
      : state.outputProfiles[0]?.slug || 'default';
    state.selectedOutputProfileSlug = nextProfileSlug;
    if (!state.outputProfiles.some(profile => profile.slug === state.previewProfileSlug)) {
      state.previewProfileSlug = nextProfileSlug;
    }
    resetSelectedOutputProfileDraft();

    await loadOutputProfileEntries(nextProfileSlug);
    setStatus('Loaded channel workflows');
  } catch (e) {
    setStatus('Failed to load channel workflows: ' + e.message, false);
    message.error(e.message);
  } finally {
    state.loadingChannelAuthoring = false;
  }
}

async function loadOutputProfileEntries(slug = state.selectedOutputProfileSlug) {
  try {
    state.loadingOutputProfileEntries = true;
    const response = await apiFetch(`/api/output-profiles/${encodeURIComponent(slug)}/entries`);
    const json = await response.json();
    if (!response.ok) {
      throw new Error(json.error || 'Failed to load output profile entries');
    }

    state.outputProfileEntries = Array.isArray(json?.channels)
      ? json.channels.map(channel => ({
        ...channel,
        canonical: { ...(channel.canonical || {}) },
        guideNumberOverrideDraft: channel?.guideNumberOverride ?? '',
      }))
      : [];
    state.outputProfileDirty = false;
    resetSelectedOutputProfileDraft();
  } catch (e) {
    setStatus(e.message, false);
    message.error(e.message);
  } finally {
    state.loadingOutputProfileEntries = false;
  }
}

async function loadApp() {
  try {
    const r = await apiFetch('/api/config/app');
    const cfg = await r.json();
    state.app = { base_url: cfg.base_url || '' };
  } catch (e) {
    setStatus('Failed to load app config: ' + e.message, false);
    message.error(e.message);
  }
}

async function saveProviders() {
  try {
    state.savingProviders = true;
    const cleaned = state.providers
      .filter(p => p.name && p.url)
      .map(p => {
        const entry = {
          name: p.name,
          url: p.url,
          type: p.type ? String(p.type).toLowerCase() : 'm3u',
        };
        if (p.epg) entry.epg = p.epg;
        return entry;
      });
    const body = { providers: cleaned };
    const r = await apiFetch('/api/config/providers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Save sources failed');
    setStatus('Sources saved. Reloading...');
    message.success('Sources saved');
    // Reload channels and EPG concurrently after save
    await Promise.all([reloadChannels(), reloadEPG()]);
  } catch (e) {
    setStatus(e.message, false);
    message.error(e.message);
  } finally {
    state.savingProviders = false;
  }
}

async function reloadChannels() {
  try {
    state.reloadingChannels = true;
    setStatus('Reloading channels...');
    const r = await apiFetch('/api/reload/channels', { method: 'POST' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Reload failed');
    setStatus(`Reloaded ${j.channels} channels.`);
    await loadChannelAuthoringData();
    if (state.previewChannels.length) {
      await loadPreviewChannels();
    }
    message.success('Channel workflows refreshed');
  } catch (e) {
    setStatus(e.message, false);
  } finally {
    state.reloadingChannels = false;
  }
}

async function reloadEPG() {
  try {
    state.reloadingEPG = true;
    const r = await apiFetch('/api/reload/epg', { method: 'POST' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Reload EPG failed');
    setStatus('EPG reloaded.');
    message.success('EPG reloaded');
  } catch (e) {
    setStatus(e.message, false);
  } finally {
    state.reloadingEPG = false;
  }
}

async function saveApp() {
  try {
    state.savingApp = true;
    const body = { base_url: state.app.base_url || '' };
    const r = await apiFetch('/api/config/app', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Save app failed');
    setStatus('App settings saved.');
    message.success('App settings saved');
  } catch (e) {
    setStatus(e.message, false);
    message.error(e.message);
  } finally {
    state.savingApp = false;
  }
}

function addProvider() {
  state.providers = [...state.providers, normalizeProvider({}, state.providers.length)];
}
function removeProvider(i) {
  state.providers = state.providers.filter((_, index) => index !== i);
}

function handleProviderCellEdit(event) {
  const { columnKey, rowId, value } = event?.detail || {};
  if (!columnKey) {
    return;
  }

  const providerIndex = state.providers.findIndex(entry => String(entry?._id) === String(rowId));
  if (providerIndex < 0) {
    return;
  }

  state.providers = state.providers.map((entry, index) =>
    index === providerIndex ? normalizeProvider({ ...entry, [columnKey]: value }, index) : entry
  );
}

function handleProviderRowAction(event) {
  if (event?.detail?.actionKey !== 'remove') {
    return;
  }

  const index = state.providers.findIndex(entry => String(entry?._id) === String(event.detail.rowId));
  if (index >= 0) {
    removeProvider(index);
  }
}

async function loadHealth() {
  try {
    state.loadingHealth = true;
    const r = await apiFetch('/api/channel-health');
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Failed to load health');
    state.health = { summary: j.summary || {}, details: j.details || [], meta: j.meta || null };
  } catch (e) {
    setStatus(e.message, false);
  } finally {
    state.loadingHealth = false;
  }
}

async function runHealth() {
  try {
    state.runningHealth = true;
    setStatus('Running health check...');
    const r = await apiFetch('/api/channel-health/run', { method: 'POST' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Health run failed');
    state.health = { summary: j.summary || {}, details: j.details || [], meta: j.meta || null };
    setStatus('Health check completed');
  } catch (e) {
    setStatus(e.message, false);
  } finally {
    state.runningHealth = false;
  }
}

async function loadUsage() {
  try {
    state.loadingUsage = true;
    const r = await apiFetch('/api/usage/active');
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Failed to load usage');
    const list = Array.isArray(j?.active) ? j.active : [];
    // Normalize and sort by startedAt desc
    state.activeUsage = list
      .map(u => ({
        key: `${u.ip}|${u.channelId}`,
        ip: u.ip,
        channelId: u.channelId,
        name: u.name || '',
        tvg_id: u.tvg_id || '',
        client: u.client || '',
        userAgent: u.userAgent || '',
        startedAt: u.startedAt ? new Date(u.startedAt).toLocaleString() : '',
        startedAtRaw: u.startedAt || '',
        lastSeenAt:
          u.lastSeenAt || u.lastSeen ? new Date(u.lastSeenAt || u.lastSeen).toLocaleString() : '',
      }))
      .sort((a, b) => {
        if (a.startedAtRaw < b.startedAtRaw) return 1;
        if (a.startedAtRaw > b.startedAtRaw) return -1;
        return 0;
      });
  } catch (e) {
    setStatus(e.message, false);
  } finally {
    state.loadingUsage = false;
  }
}

async function loadTasks() {
  try {
    state.loadingTasks = true;
    const r = await apiFetch('/api/scheduler/jobs');
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Failed to load tasks');
    state.tasks = Array.isArray(j?.jobs) ? j.jobs : [];
  } catch (e) {
    setStatus(e.message, false);
  } finally {
    state.loadingTasks = false;
  }
}

async function runTask(taskName) {
  try {
    state.runningTask = taskName;
    setStatus(`Running task: ${taskName}...`);
    const r = await apiFetch(`/api/scheduler/jobs/${encodeURIComponent(taskName)}/run`, {
      method: 'POST',
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Failed to start task');
    setStatus(`Task "${taskName}" started`);
    message.success(`Task "${taskName}" started`);
    // Poll until task completes
    const pollInterval = setInterval(async () => {
      try {
        const pr = await apiFetch('/api/scheduler/jobs');
        const pj = await pr.json();
        if (pr.ok && Array.isArray(pj?.jobs)) {
          state.tasks = pj.jobs;
          const task = pj.jobs.find(t => t.name === taskName);
          if (task && !task.isRunning) {
            clearInterval(pollInterval);
            state.runningTask = null;
            setStatus(`Task "${taskName}" completed`);
          }
        }
      } catch (_) {
        /* ignore poll errors */
      }
    }, 1000);
    // Safety timeout - stop polling after 5 minutes
    setTimeout(
      () => {
        clearInterval(pollInterval);
        if (state.runningTask === taskName) state.runningTask = null;
      },
      5 * 60 * 1000
    );
  } catch (e) {
    setStatus(e.message, false);
    message.error(e.message);
    state.runningTask = null;
  }
}

function handleTaskRowAction(event) {
  if (event?.detail?.actionKey === 'run' && event.detail.row?.name) {
    runTask(event.detail.row.name);
  }
}

function updateOutputProfileEntry(channelId, patch) {
  const entry = state.outputProfileEntries.find(item => item.canonical?.id === channelId);
  if (!entry) return;

  Object.assign(entry, patch);
  state.outputProfileDirty = true;
}

function parseGuideBindingValue(value) {
  if (typeof value !== 'string' || !value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    if (!parsed?.sourceId || !parsed?.epgChannelId) {
      return null;
    }

    return {
      sourceId: String(parsed.sourceId),
      epgChannelId: String(parsed.epgChannelId),
    };
  } catch (_error) {
    return null;
  }
}

async function changeSelectedOutputProfile(slug) {
  if (!slug || slug === state.selectedOutputProfileSlug) {
    return;
  }
  if (profileDirty.value) {
    message.warning('Save output changes before switching profiles.');
    return;
  }

  state.selectedOutputProfileSlug = slug;
  await loadOutputProfileEntries(slug);
}

async function updatePreferredStream(channelId, sourceChannelId) {
  if (!sourceChannelId) {
    return;
  }

  try {
    state.updatingPreferredStreamChannelId = channelId;
    const response = await apiFetch(
      `/api/canonical/channels/${encodeURIComponent(channelId)}/preferred-stream`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceChannelId }),
      }
    );
    const json = await response.json();
    if (!response.ok) {
      throw new Error(json.error || 'Failed to update preferred stream');
    }

    state.channelBindings = state.channelBindings.map(binding => ({
      ...binding,
      isPreferredStream:
        binding.canonical?.id === channelId
          ? binding.id === json.binding.id
          : binding.isPreferredStream,
    }));
    if (state.previewChannels.length) {
      await loadPreviewChannels();
    }
    message.success('Preferred stream saved');
  } catch (e) {
    setStatus(e.message, false);
    message.error(e.message);
  } finally {
    state.updatingPreferredStreamChannelId = '';
  }
}

async function updateGuideBinding(channelId, value) {
  const binding = parseGuideBindingValue(value);
  if (!binding) {
    return;
  }

  try {
    state.updatingGuideBindingChannelId = channelId;
    const response = await apiFetch(
      `/api/canonical/channels/${encodeURIComponent(channelId)}/guide-binding`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(binding),
      }
    );
    const json = await response.json();
    if (!response.ok) {
      throw new Error(json.error || 'Failed to update guide binding');
    }

    state.guideBindings = state.guideBindings.map(entry => {
      if (entry.canonical?.id !== channelId) {
        return entry;
      }

      if (entry.source?.id === json.binding.source.id) {
        return {
          ...entry,
          epgChannelId: json.binding.epgChannelId,
          priority: json.binding.priority,
          selected: true,
        };
      }

      return {
        ...entry,
        selected: false,
        priority: entry.priority === 0 ? 1 : entry.priority,
      };
    });
    message.success('Guide source saved');
  } catch (e) {
    setStatus(e.message, false);
    message.error(e.message);
  } finally {
    state.updatingGuideBindingChannelId = '';
  }
}

function updateOutputEnabled(channelId, enabled) {
  updateOutputProfileEntry(channelId, { enabled });
}

function updateGuideNumberOverrideDraft(channelId, value) {
  const entry = state.outputProfileEntries.find(item => item.canonical?.id === channelId);
  if (!entry) return;

  entry.guideNumberOverrideDraft = typeof value === 'string' ? value : '';
}

function commitGuideNumberOverride(channelId) {
  const entry = state.outputProfileEntries.find(item => item.canonical?.id === channelId);
  if (!entry) return;

  const nextValue = typeof entry.guideNumberOverrideDraft === 'string'
    ? entry.guideNumberOverrideDraft.trim()
    : '';
  const normalized = nextValue ? nextValue : null;
  entry.guideNumberOverrideDraft = nextValue;

  if (entry.guideNumberOverride === normalized) {
    return;
  }

  updateOutputProfileEntry(channelId, {
    guideNumberOverride: normalized,
  });
}

function updateSelectedOutputProfileName(value) {
  state.outputProfileDraft.name = value;
}

function updateSelectedOutputProfileEnabled(value) {
  state.outputProfileDraft.enabled = value;
}

async function createOutputProfile() {
  if (profileDirty.value) {
    message.warning('Save output changes before creating another profile.');
    return;
  }

  const name = window.prompt('Name for the new output profile', 'New Output');
  if (!name || !name.trim()) {
    return;
  }

  try {
    state.savingOutputProfile = true;
    const response = await apiFetch('/api/output-profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    const json = await response.json();
    if (!response.ok) {
      throw new Error(json.error || 'Failed to create output profile');
    }

    state.selectedOutputProfileSlug = json.profile.slug;
    await loadChannelAuthoringData();
    message.success('Output profile created');
  } catch (e) {
    setStatus(e.message, false);
    message.error(e.message);
  } finally {
    state.savingOutputProfile = false;
  }
}

async function duplicateOutputProfile() {
  if (profileDirty.value) {
    message.warning('Save output changes before duplicating a profile.');
    return;
  }

  const sourceProfile = getSelectedOutputProfileRecord();
  if (!sourceProfile) {
    return;
  }

  const name = window.prompt(
    'Name for the duplicated output profile',
    `${sourceProfile.name} Copy`
  );
  if (!name || !name.trim()) {
    return;
  }

  try {
    state.savingOutputProfile = true;
    const response = await apiFetch('/api/output-profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        copyFromSlug: sourceProfile.slug,
        enabled: sourceProfile.enabled,
      }),
    });
    const json = await response.json();
    if (!response.ok) {
      throw new Error(json.error || 'Failed to duplicate output profile');
    }

    state.selectedOutputProfileSlug = json.profile.slug;
    await loadChannelAuthoringData();
    message.success('Output profile duplicated');
  } catch (e) {
    setStatus(e.message, false);
    message.error(e.message);
  } finally {
    state.savingOutputProfile = false;
  }
}

function deleteSelectedOutputProfile() {
  const profile = getSelectedOutputProfileRecord();
  if (!profile || profile.isDefault) {
    return;
  }
  if (profileDirty.value) {
    message.warning('Save output changes before deleting a profile.');
    return;
  }

  openConfirmDialog({
    tone: 'danger',
    title: 'Delete output profile?',
    content: `Delete "${profile.name}" and all of its channel overrides?`,
    positiveText: 'Delete',
    negativeText: 'Cancel',
  }).then(async confirmed => {
    if (!confirmed) {
      return;
    }

    try {
      state.savingOutputProfile = true;
      const response = await apiFetch(`/api/output-profiles/${encodeURIComponent(profile.slug)}`, {
        method: 'DELETE',
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error || 'Failed to delete output profile');
      }

      state.selectedOutputProfileSlug = 'default';
      await loadChannelAuthoringData();
      message.success('Output profile deleted');
    } catch (e) {
      setStatus(e.message, false);
      message.error(e.message);
    } finally {
      state.savingOutputProfile = false;
    }
  });
}

async function saveOutputProfileChanges() {
  try {
    state.savingOutputProfile = true;
    const selectedProfile = getSelectedOutputProfileRecord();
    if (!selectedProfile) {
      throw new Error('No output profile selected');
    }

    if (profileMetaDirty.value) {
      const profileResponse = await apiFetch(
        `/api/output-profiles/${encodeURIComponent(state.selectedOutputProfileSlug)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: state.outputProfileDraft.name.trim(),
            enabled: state.outputProfileDraft.enabled,
          }),
        }
      );
      const profileJson = await profileResponse.json();
      if (!profileResponse.ok) {
        throw new Error(profileJson.error || 'Failed to save output profile details');
      }
    }

    if (state.outputProfileDirty) {
      const response = await apiFetch(
        `/api/output-profiles/${encodeURIComponent(state.selectedOutputProfileSlug)}/channels`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channels: channelWorkflowRows.value.map(row => ({
              canonicalId: row.id,
              position: row.position,
              enabled: row.outputEnabled,
              guideNumberOverride: row.committedGuideNumberOverride,
            })),
          }),
        }
      );
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error || 'Failed to save output profile channels');
      }
    }

    await loadChannelAuthoringData();
    if (state.previewChannels.length) {
      await loadPreviewChannels();
    }
    message.success('Output profile saved');
  } catch (e) {
    setStatus(e.message, false);
    message.error(e.message);
  } finally {
    state.savingOutputProfile = false;
  }
}

async function loadEPGValidation() {
  try {
    state.loadingEPGValidation = true;
    const r = await apiFetch('/api/epg/validate');
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Failed to validate EPG');
    state.epgValidation = j;
  } catch (e) {
    setStatus(e.message, false);
    message.error(e.message);
  } finally {
    state.loadingEPGValidation = false;
  }
}

async function initializeAuthState() {
  try {
    const [statusResponse, sessionResponse] = await Promise.all([
      fetch('/api/auth/status'),
      fetch('/api/auth/session'),
    ]);
    const statusJson = await statusResponse.json();
    const sessionJson = await sessionResponse.json();

    state.authConfigured = !!statusJson.configured;
    state.sessionAuthenticated = !state.authConfigured || !!sessionJson.authenticated;
    state.showSetupModal = !state.authConfigured;

    if (!state.authConfigured && isLoginRoute) {
      redirectToAdmin(DEFAULT_ADMIN_ROUTE);
      return false;
    }

    if (state.authConfigured && state.sessionAuthenticated) {
      await fetchCsrfToken();
      if (isLoginRoute) {
        redirectToAdmin(getPostLoginRedirect());
        return false;
      }
    }

    return !isLoginRoute || state.sessionAuthenticated || !state.authConfigured;
  } catch (e) {
    // If status check fails, assume auth may be configured; don't force modal,
    // but surface an error so the user/admin knows something went wrong.
    state.authConfigured = true;
    state.sessionAuthenticated = !isLoginRoute;
    state.showSetupModal = false;
    if (e && e.message) {
      message.error(e.message);
    } else {
      message.error('Failed to check authentication status.');
    }
    return !isLoginRoute;
  } finally {
    state.authStateReady = true;
  }
}

async function submitLogin() {
  state.loginError = '';
  const username = state.loginForm.username.trim();
  const password = state.loginForm.password;

  if (!username || !password) {
    state.loginError = 'Username and password are required.';
    return;
  }

  try {
    state.loggingIn = true;
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const json = await response.json();
    if (!response.ok) {
      state.loginError = json.error || 'Login failed.';
      return;
    }

    state.sessionAuthenticated = true;
    _csrfToken = json.csrfToken || '';
    state.loginForm.password = '';
    redirectToAdmin(getPostLoginRedirect());
  } catch (e) {
    state.loginError = e.message || 'Login failed.';
  } finally {
    state.loggingIn = false;
  }
}

async function logout() {
  state.loggingOut = true;
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch (_) {
    /* ignore logout errors */
  }
  redirectToAdmin(LOGIN_ROUTE);
}

async function submitSetup() {
  state.setupError = '';
  const { username, password, confirm } = state.setupForm;
  if (!username.trim()) {
    state.setupError = 'Username is required.';
    return;
  }
  if (password.length < 8) {
    state.setupError = 'Password must be at least 8 characters.';
    return;
  }
  if (password !== confirm) {
    state.setupError = 'Passwords do not match.';
    return;
  }
  try {
    state.savingSetup = true;
    const r = await apiFetch('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim(), password }),
    });
    const j = await r.json();
    if (!r.ok) {
      state.setupError = j.error || 'Setup failed.';
      return;
    }
    state.setupForm = { username: 'admin', password: '', confirm: '' };
    // Reload so the browser picks up the new auth requirement immediately.
    window.location.reload();
  } catch (e) {
    state.setupError = e.message || 'Setup failed.';
  } finally {
    state.savingSetup = false;
  }
}

async function changePassword() {
  const { current, newPass, confirm } = state.passwordForm;
  if (!current) {
    message.error('Current password is required.');
    return;
  }
  if (newPass.length < 8) {
    message.error('New password must be at least 8 characters.');
    return;
  }
  if (newPass !== confirm) {
    message.error('New passwords do not match.');
    return;
  }
  try {
    state.savingPassword = true;
    const r = await apiFetch('/api/auth/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: current, newPassword: newPass }),
    });
    if (r.status === 401) {
      window.location.href = '/admin/login';
      return;
    }
    const j = await r.json();
    if (!r.ok) {
      message.error(j.error || 'Password update failed.');
      return;
    }
    state.passwordForm = { current: '', newPass: '', confirm: '' };
    message.success('Password updated successfully.');
  } catch (e) {
    message.error(e.message || 'Password update failed.');
  } finally {
    state.savingPassword = false;
  }
}

async function loadBackups() {
  try {
    state.loadingBackups = true;
    const r = await apiFetch('/api/config/backups');
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Failed to load backups');
    state.backups = Array.isArray(j?.backups) ? j.backups : [];
  } catch (e) {
    setStatus(e.message, false);
    message.error(e.message);
  } finally {
    state.loadingBackups = false;
  }
}

async function createBackup() {
  try {
    state.creatingBackup = true;
    const r = await apiFetch('/api/config/backup', { method: 'POST' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Failed to create backup');
    message.success(`Backup created: ${j.name}`);
    await loadBackups();
  } catch (e) {
    setStatus(e.message, false);
    message.error(e.message);
  } finally {
    state.creatingBackup = false;
  }
}

async function restoreBackup(name) {
  const confirmed = await openConfirmDialog({
    title: 'Restore Backup',
    content: `Restore config from "${formatBackupTimestamp(name) || name}"? This will overwrite your current configuration and apply it immediately.`,
    positiveText: 'Restore',
    negativeText: 'Cancel',
    tone: 'warning',
  });
  if (!confirmed) return;
  try {
    state.restoringBackup = name;
    const r = await apiFetch(`/api/config/backups/${encodeURIComponent(name)}/restore`, {
      method: 'POST',
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Failed to restore backup');
    message.success(`Restored backup: ${name}`);
    await Promise.all([loadProviders(), loadApp(), loadChannelAuthoringData(), loadBackups()]);
    if (state.previewChannels.length) {
      await loadPreviewChannels();
    }
  } catch (e) {
    setStatus(e.message, false);
    message.error(e.message);
  } finally {
    state.restoringBackup = null;
  }
}

async function downloadBackup(name) {
  try {
    const r = await apiFetch(`/api/config/backups/${encodeURIComponent(name)}/download`);
    if (!r.ok) {
      let errorMessage = 'Failed to download backup';
      try {
        const j = await r.json();
        if (j && typeof j === 'object' && j.error) {
          errorMessage = j.error;
        }
      } catch {
        // Ignore JSON parse errors and fall back to generic message
      }
      throw new Error(errorMessage);
    }

    const blob = await r.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    const messageText = e?.message ?? 'Failed to download backup';
    setStatus(messageText, false);
    message.error(messageText);
  }
}

async function deleteBackup(name) {
  const confirmed = await openConfirmDialog({
    tone: 'danger',
    title: 'Delete Backup',
    content: `Delete backup "${formatBackupTimestamp(name) || name}"? This cannot be undone.`,
    positiveText: 'Delete',
    negativeText: 'Cancel',
  });
  if (!confirmed) return;
  try {
    state.deletingBackup = name;
    const r = await apiFetch(`/api/config/backups/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Failed to delete backup');
    message.success(`Deleted backup: ${name}`);
    await loadBackups();
  } catch (e) {
    setStatus(e.message, false);
    message.error(e.message);
  } finally {
    state.deletingBackup = null;
  }
}

function handleBackupRowAction(event) {
  const backupName = event?.detail?.row?.name;
  if (!backupName) {
    return;
  }

  if (event.detail.actionKey === 'restore') {
    restoreBackup(backupName);
  } else if (event.detail.actionKey === 'download') {
    downloadBackup(backupName);
  } else if (event.detail.actionKey === 'delete') {
    deleteBackup(backupName);
  }
}

// ─── Preview tab ─────────────────────────────────────────────────────────────

async function loadPreviewChannels() {
  try {
    state.loadingPreviewChannels = true;
    const slug = state.previewProfileSlug || state.selectedOutputProfileSlug || 'default';
    const r = await apiFetch(`/api/output-profiles/${encodeURIComponent(slug)}/channels`);
    const j = await r.json();
    if (!r.ok) {
      throw new Error(j.error || 'Failed to load preview channels');
    }
    state.previewChannels = Array.isArray(j?.channels) ? j.channels : [];
  } catch (e) {
    message.error('Failed to load channels: ' + e.message);
  } finally {
    state.loadingPreviewChannels = false;
  }
}

async function changePreviewProfile(slug) {
  if (!slug || slug === state.previewProfileSlug) {
    return;
  }

  state.previewProfileSlug = slug;
  await loadPreviewChannels();
}

async function loadGuide(tvgId) {
  if (!tvgId) {
    state.previewGuide = [];
    return;
  }
  try {
    state.loadingGuide = true;
    const r = await apiFetch(`/api/guide?tvgId=${encodeURIComponent(tvgId)}`);
    const j = await r.json();
    state.previewGuide = Array.isArray(j.programmes) ? j.programmes : [];
  } catch (_) {
    state.previewGuide = [];
  } finally {
    state.loadingGuide = false;
  }
}

// Video player DOM ref (bound with ref="videoPlayerEl" in the template)
const videoPlayerEl = ref(null);
let hlsInstance = null;
let mpegtsInstance = null;

const ERR_UNSUPPORTED_CODEC =
  'Stream uses a codec not supported by your browser (likely MPEG-2 video or AC-3 audio). Use VLC or another IPTV player to watch this channel.';
const ERR_STREAM_UNAVAILABLE = 'Stream unavailable. The channel may be offline or unreachable.';
const ERR_TRANSCODE_FAILED =
  'Server transcoding failed. Ensure ffmpeg is installed on the server, or open the stream URL in VLC.';

/**
 * Set up mpegts.js player for raw MPEG-TS streams (e.g. HDHomeRun that returns
 * video/mpeg instead of HLS). Called directly for HDHomeRun channels, or as a
 * fallback when hls.js cannot parse the stream.
 */
function showPlayerError(msg) {
  if (state.playerError) return; // already showing an error; don't overwrite
  console.warn('[player] error:', msg);
  state.playerError = msg;
}

/**
 * Returns true when a play() rejection was caused by browser autoplay policy
 * rather than a real playback or decoding failure.
 * @param {unknown} err
 * @returns {boolean}
 */
function isAutoplayBlocked(err) {
  const name = err && err.name;
  const msg = err && err.message ? String(err.message) : '';
  return (
    name === 'NotAllowedError' ||
    msg.includes("play() failed because the user didn't interact with the document first") ||
    msg.includes("user didn't interact with the document first") ||
    msg.includes('must be user-initiated')
  );
}

function setupMpegtsPlayer(video, streamUrl) {
  if (mpegtsInstance) {
    mpegtsInstance.destroy();
    mpegtsInstance = null;
  }
  if (!mpegts.getFeatureList().mseLivePlayback) {
    // MSE not supported in this browser; nothing more we can try
    showPlayerError('Browser does not support media streaming (MSE unavailable).');
    return;
  }
  // Capture the player in a local const so callbacks can guard against firing
  // after this instance has been replaced (e.g. play().catch fires asynchronously).
  const player = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: streamUrl });
  mpegtsInstance = player;
  player.attachMediaElement(video);
  player.on(mpegts.Events.ERROR, (errorType, errorDetail, _errorInfo) => {
    if (player !== mpegtsInstance) return; // stale callback from a previous player
    console.warn('[player] mpegts.js error:', errorType, errorDetail);
    mpegtsInstance.destroy();
    mpegtsInstance = null;
    const msg = errorType === 'MediaError' ? ERR_UNSUPPORTED_CODEC : ERR_STREAM_UNAVAILABLE;
    showPlayerError(msg);
  });
  player.load();
  player.play().catch(err => {
    if (player !== mpegtsInstance) return; // stale callback from a previous player

    if (isAutoplayBlocked(err)) {
      // Autoplay was blocked by the browser. Keep the mpegts instance attached so the
      // user can start playback manually (e.g. by clicking the video element).
      console.warn('[player] mpegts.js autoplay blocked by browser policy:', err);
      return;
    }

    console.warn('[player] mpegts.js playback failed:', err);
    mpegtsInstance.destroy();
    mpegtsInstance = null;
    showPlayerError(ERR_UNSUPPORTED_CODEC);
  });
}

async function setupVideoPlayer() {
  await nextTick();
  const video = videoPlayerEl.value;
  if (!video || !state.previewWatchingChannel) return;

  const streamUrl = previewStreamUrl.value;
  const ch = state.previewWatchingChannel;

  // Destroy any previous instances before resetting state
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }
  if (mpegtsInstance) {
    mpegtsInstance.destroy();
    mpegtsInstance = null;
  }

  // Clear any error and debug state from the previous player session
  state.playerError = null;
  state.playerDebug = {
    channel: ch.name,
    source: ch.source,
    hdhomerun: Boolean(ch.hdhomerun),
    streamUrl,
    transcodeUrl: `/transcode/${encodeURIComponent(ch.source || '')}/${encodeURIComponent(ch.name || '')}`,
    probeUrl: null,
    probeResult: null,
    playerMode: null,
    hlsError: null,
    events: [],
  };

  const dbg = state.playerDebug;
  function dbgEvent(msg) {
    console.log('[player:debug]', msg);
    dbg.events.push(`${new Date().toISOString().slice(11, 23)} ${msg}`);
  }

  dbgEvent(`setupVideoPlayer hdhomerun=${dbg.hdhomerun} streamUrl=${streamUrl}`);

  // Safari / iOS and modern Chrome — native HLS support.
  // Skip for HDHomeRun channels: their HLS segments still carry MPEG-2/AC-3 codecs
  // that browsers cannot decode natively (the device wraps MPEG-TS in an HLS
  // playlist but does NOT re-encode the video).  Falling through to the HLS.js +
  // probe + transcode path allows server-side transcoding to recover regardless of
  // which browser is used.
  if (video.canPlayType('application/vnd.apple.mpegurl') && !ch.hdhomerun) {
    dbgEvent('browser supports HLS natively → video.src');
    dbg.playerMode = 'native-hls';
    video.src = streamUrl;
    return;
  }

  // Start a parallel codec probe for all channels.  The server-side probe reads
  // a small header of the upstream stream and parses the MPEG-TS PAT/PMT tables
  // to identify the video and audio stream types.  If the codecs are incompatible
  // with browser MSE (e.g. MPEG-2 video or AC-3 audio from ATSC OTA broadcasts),
  // the probe returns { browserCompatible: false } and we automatically switch to
  // server-side transcoding via ffmpeg.
  //
  // For HDHomeRun channels we intentionally probe the raw stream WITHOUT
  // ?streamMode=hls.  HDHomeRun devices that support HLS mode wrap their MPEG-TS
  // packets into an HLS playlist but do NOT re-encode the video — the HLS
  // segments still carry the original MPEG-2/AC-3 codecs from the OTA broadcast.
  // Probing the HLS URL would see an HLS content-type and mistakenly report
  // browserCompatible:true, causing the player to skip transcoding.  Probing the
  // raw MPEG-TS stream lets the PAT/PMT parser detect MPEG-2/AC-3 and correctly
  // trigger server-side transcoding via ffmpeg.
  //
  // The probe runs in parallel with HLS.js so it does not add latency when the
  // codecs are already browser-compatible.
  const probeChannel = state.previewWatchingChannel;
  const probeBase = `/api/stream-probe/${encodeURIComponent(probeChannel?.source || '')}/${encodeURIComponent(probeChannel?.name || '')}`;
  // Do NOT append ?streamMode=hls for HDHomeRun — see comment above.
  const probeUrl = probeBase;
  dbg.probeUrl = probeUrl;

  // probeSettled / probeResult track the async probe lifecycle.
  // pendingAfterProbe is set by the HLS.js error handler when the probe has not
  // yet returned and it needs to defer the player-type decision.
  let probeSettled = false;
  let probeResult = null;
  let pendingAfterProbe = null;

  // Return true when the channel has changed or the player was replaced since
  // setupVideoPlayer() was called — used to discard stale async results.
  function isStale() {
    return (
      videoPlayerEl.value !== video ||
      state.previewWatchingChannel !== probeChannel ||
      previewStreamUrl.value !== streamUrl
    );
  }

  // Choose the right player once the probe result is available.
  // NOTE: applyProbeResult is ONLY ever called from the HLS.js fatal-error path —
  // either directly (when the probe settled before HLS.js fired) or via
  // pendingAfterProbe (when HLS.js fired before the probe settled).  The probe
  // pre-emption path (probe fires first, incompatible MPEG-TS) calls
  // setupTranscodePlayer() directly and never goes through this function.  So the
  // `probeChannel?.hdhomerun` guard below fires exclusively when HLS.js has already
  // reported that it cannot play the stream.
  function applyProbeResult(probe) {
    if (isStale()) return;
    // For HDHomeRun channels, always fall back to server-side transcoding when
    // HLS.js cannot play the stream.  HDHomeRun devices that serve HLS playlists
    // carry incompatible MPEG-2/AC-3 tracks in the segments, so mpegts.js with
    // the ?streamMode=hls URL would also fail.  Transcoding is the reliable
    // fallback regardless of the probe result (which checks only the raw stream).
    // This also covers the case where the probe itself failed and returned null.
    if ((probe && !probe.browserCompatible) || probeChannel?.hdhomerun) {
      const reason = probeChannel?.hdhomerun
        ? 'hdhomerun channel — always transcode after HLS.js error'
        : `probe browserCompatible=false (container=${probe?.container})`;
      dbgEvent(`applyProbeResult: choosing transcode — ${reason}`);
      dbg.playerMode = 'transcode';
      setupTranscodePlayer().catch(err => {
        console.warn(
          '[player] probe-triggered transcode setup failed for %s/%s:',
          probeChannel?.source,
          probeChannel?.name,
          err
        );
        dbgEvent(`transcode setup error: ${err?.message}`);
      });
    } else {
      dbgEvent('applyProbeResult: choosing mpegts.js (probe compatible or null, not HDHomeRun)');
      dbg.playerMode = 'mpegts';
      setupMpegtsPlayer(video, streamUrl);
    }
  }

  dbgEvent(`starting probe: ${probeUrl}`);
  // AbortSignal.timeout() is not available in all browsers; fall back to an
  // AbortController + setTimeout pair where necessary.
  const probeAbortSignal =
    typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(15000)
      : (() => {
        const ac = new AbortController();
        setTimeout(() => ac.abort(), 15000);
        return ac.signal;
      })();
  fetch(probeUrl, { signal: probeAbortSignal })
    .then(r => (r.ok ? r.json() : null))
    .then(result => {
      if (isStale()) return;
      probeResult = result;
      probeSettled = true;
      dbg.probeResult = result;
      dbgEvent(
        `probe settled: container=${result?.container} browserCompatible=${result?.browserCompatible} video=0x${(result?.videoStreamType ?? 0).toString(16).padStart(2, '0')} audio=0x${(result?.audioStreamType ?? 0).toString(16).padStart(2, '0')}`
      );

      if (pendingAfterProbe) {
        // HLS.js already reported a manifest error while the probe was in flight.
        dbgEvent('probe settled after HLS.js error — running deferred applyProbeResult');
        pendingAfterProbe();
        pendingAfterProbe = null;
      } else if (result && !result.browserCompatible && result.container === 'mpeg-ts') {
        // Codec probe identified incompatible codecs (e.g. MPEG-2/AC-3 from an
        // HDHomeRun OTA tuner) before HLS.js fired an error.  Pre-empt the running
        // player and switch immediately to server-side transcoding.
        dbgEvent(
          'probe pre-empt: incompatible mpeg-ts — destroying current player, switching to transcode'
        );
        if (hlsInstance) {
          hlsInstance.destroy();
          hlsInstance = null;
        }
        if (mpegtsInstance) {
          mpegtsInstance.destroy();
          mpegtsInstance = null;
        }
        video.removeAttribute('src');
        video.load();
        dbg.playerMode = 'transcode';
        setupTranscodePlayer().catch(err => {
          console.warn(
            '[player] probe-triggered transcode setup failed for %s/%s:',
            probeChannel?.source,
            probeChannel?.name,
            err
          );
          dbgEvent(`transcode setup error: ${err?.message}`);
        });
      }
    })
    .catch(err => {
      if (isStale()) return;
      probeSettled = true;
      dbgEvent(`probe failed: ${err?.message || String(err)}`);
      // Probe failed — if the HLS.js error handler is already waiting, unblock it.
      if (pendingAfterProbe) {
        dbgEvent('probe failed after HLS.js error — running deferred applyProbeResult with null');
        pendingAfterProbe();
        pendingAfterProbe = null;
      }
    });

  // Use bundled HLS.js for other browsers.
  // For HDHomeRun channels the stream URL includes ?streamMode=hls (see previewStreamUrl),
  // so HLS.js receives the server-proxied HLS playlist from the device.  The codec
  // probe runs against the raw stream (without ?streamMode=hls) in parallel so it
  // can detect MPEG-2/AC-3 codecs and pre-empt the player before HLS.js encounters
  // them in the HLS segments.  If the probe fires first, it tears down HLS.js and
  // starts server-side transcoding.  If HLS.js fires a format/codec error first,
  // the pending probe result is applied (applyProbeResult) to decide whether to
  // transcode (HDHomeRun or incompatible codecs) or use mpegts.js.
  if (Hls.isSupported()) {
    dbgEvent('starting HLS.js');
    dbg.playerMode = 'hls';
    hlsInstance = new Hls();
    hlsInstance.loadSource(streamUrl);
    hlsInstance.attachMedia(video);
    hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
      dbgEvent('HLS.js MANIFEST_PARSED — stream is live HLS, playing');
      dbg.playerMode = 'hls';
      video.play().catch(() => {});
    });
    hlsInstance.on(Hls.Events.ERROR, (_evt, data) => {
      if (!data || !data.fatal) {
        return;
      }

      const manifestFormatErrorDetails = [
        Hls.ErrorDetails.MANIFEST_PARSING_ERROR,
        Hls.ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR,
        Hls.ErrorDetails.LEVEL_PARSING_ERROR,
      ];

      // Only route to an alternative player when the response is not a valid HLS
      // playlist (as opposed to a network/auth error, which shows a stream-unavailable
      // message instead).
      const isManifestFormatError = manifestFormatErrorDetails.includes(data.details);

      dbgEvent(
        `HLS.js fatal error: type=${data.type} details=${data.details} isManifestFormatError=${isManifestFormatError} probeSettled=${probeSettled}`
      );
      dbg.hlsError = { type: data.type, details: data.details };

      hlsInstance.destroy();
      hlsInstance = null;

      if (isManifestFormatError) {
        // Stream is raw MPEG-TS (or some other non-HLS format).  Use the codec
        // probe result to choose between mpegts.js (compatible) and server
        // transcoding (incompatible codecs such as MPEG-2 video or AC-3 audio).
        if (probeSettled) {
          dbgEvent('HLS.js manifest error — probe already settled, applying now');
          applyProbeResult(probeResult);
        } else {
          // Probe is still in flight — defer the decision until it resolves.
          dbgEvent('HLS.js manifest error — probe still in flight, deferring');
          pendingAfterProbe = () => applyProbeResult(probeResult);
        }
      } else {
        dbgEvent(`HLS.js non-format fatal error (${data.details}) — showing stream unavailable`);
        showPlayerError(ERR_STREAM_UNAVAILABLE);
      }
    });
    return;
  }

  // Last resort: direct src (works for MP4/MPEG-TS in some browsers)
  dbgEvent('HLS.js not supported — using direct video.src');
  dbg.playerMode = 'direct-src';
  video.src = streamUrl;
}

function stopVideoPlayer() {
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }
  if (mpegtsInstance) {
    mpegtsInstance.destroy();
    mpegtsInstance = null;
  }
  const video = videoPlayerEl.value;
  if (video) {
    video.pause();
    video.src = '';
    video.load();
  }
  state.playerError = null;
  state.showPlayerDebug = false;
  state.playerDebug = null;
}

/**
 * Start the server-side transcoding player for streams with unsupported codecs.
 * Uses the /transcode/:source/:name endpoint which runs ffmpeg on the server to
 * convert MPEG-2/AC-3 MPEG-TS to H.264/AAC MPEG-TS that browsers can decode.
 * The resulting stream is played via mpegts.js.
 */
async function setupTranscodePlayer() {
  await nextTick();
  const video = videoPlayerEl.value;
  if (!video || !state.previewWatchingChannel) return;

  // Append a timestamped message to the debug event log.
  // setupTranscodePlayer() may be called from outside setupVideoPlayer() (e.g. via
  // the manual "Transcode" button), so playerDebug may not be present; only log when
  // the debug session is active.
  function dbgEvent(msg) {
    const events = state.playerDebug?.events;
    if (!events) return;
    console.log('[player:debug]', msg);
    events.push(`${new Date().toISOString().slice(11, 23)} ${msg}`);
  }

  // Clear the codec error so the player area is visible again
  state.playerError = null;

  // Destroy any existing player instances
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }
  if (mpegtsInstance) {
    mpegtsInstance.destroy();
    mpegtsInstance = null;
  }

  if (!mpegts.getFeatureList().mseLivePlayback) {
    state.playerError = 'Browser does not support media streaming (MSE unavailable).';
    return;
  }

  const transcodeUrl = previewTranscodeUrl.value;
  dbgEvent(`starting transcode player: ${transcodeUrl}`);
  const player = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: transcodeUrl });
  mpegtsInstance = player;
  player.attachMediaElement(video);

  player.on(mpegts.Events.ERROR, (errorType, errorDetail, _errorInfo) => {
    if (player !== mpegtsInstance) return; // stale callback from a previous player
    console.warn('[player] transcode error:', errorType, errorDetail);
    dbgEvent(`transcode error: ${errorType} ${errorDetail}`);
    mpegtsInstance.destroy();
    mpegtsInstance = null;
    if (!state.playerError) {
      state.playerError = ERR_TRANSCODE_FAILED;
    }
  });

  player.load();
  player.play().catch(err => {
    if (player !== mpegtsInstance) return; // stale callback from a previous player

    if (isAutoplayBlocked(err)) {
      // Autoplay blocked — user can click the video element to start playback.
      console.warn('[player] transcode autoplay blocked by browser policy:', err);
      return;
    }

    console.warn('[player] transcode playback failed:', err);
    dbgEvent(`transcode play() failed: ${err?.name} ${err?.message}`);
    mpegtsInstance.destroy();
    mpegtsInstance = null;
    if (!state.playerError) {
      state.playerError = ERR_TRANSCODE_FAILED;
    }
  });
}

function watchChannel(channel) {
  state.previewWatchingChannel = channel;
  state.previewGuide = [];
  state.showVideoModal = true;
  if (channel.tvg_id) loadGuide(channel.tvg_id);
}

function handlePreviewRowAction(event) {
  if (event?.detail?.actionKey === 'watch' && event.detail.row) {
    watchChannel(event.detail.row);
  }
}

function copyStreamUrl() {
  const relativeUrl = previewStreamUrl.value;
  if (!relativeUrl) {
    message.error('No stream URL available');
    return;
  }
  const url = `${window.location.origin}${relativeUrl}`;
  navigator.clipboard.writeText(url).then(
    () => message.success('Stream URL copied to clipboard'),
    () => message.error('Failed to copy URL')
  );
}

function copyPlayerDebug() {
  const d = state.playerDebug;
  if (!d) {
    message.error('No debug info available');
    return;
  }
  const text = JSON.stringify(d, null, 2);
  navigator.clipboard.writeText(text).then(
    () => message.success('Debug info copied to clipboard'),
    () => message.error('Failed to copy debug info')
  );
}

/**
 * Format an XMLTV datetime string ("20240115143000 +0000") into a local time like "14:00".
 * @param {string} str
 * @returns {string}
 */
function formatXMLTVTime(str) {
  if (!str) return '';
  const match = String(str).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
  if (!match) return String(str).slice(0, 5);
  const [, year, month, day, hour, min, sec, tz] = match;
  let tzOffset = 0;
  if (tz) {
    const sign = tz[0] === '+' ? 1 : -1;
    const tzH = parseInt(tz.slice(1, 3), 10);
    const tzM = parseInt(tz.slice(3, 5), 10);
    tzOffset = sign * (tzH * 60 + tzM) * 60 * 1000;
  }
  const utc = Date.UTC(+year, +month - 1, +day, +hour, +min, +sec);
  const d = new Date(utc - tzOffset);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Set up the video player whenever the modal opens, tear it down when it closes
watch(
  () => state.showVideoModal,
  open => {
    if (open) {
      setupVideoPlayer();
    } else {
      stopVideoPlayer();
      state.previewWatchingChannel = null;
      state.previewGuide = [];
    }
  }
);

// Load channels the first time the Preview tab is selected
let _previewLoaded = false;
let _usagePollInterval = null;
watch(
  () => state.tab,
  newTab => {
    if (newTab === 'preview' && !_previewLoaded) {
      _previewLoaded = true;
      loadPreviewChannels();
    }
  }
);

function startUsagePolling() {
  if (_usagePollInterval) {
    return;
  }

  _usagePollInterval = setInterval(() => {
    loadUsage();
  }, 5000);
}

async function initializeApp() {
  const shouldLoadAdminData = await initializeAuthState();
  if (!shouldLoadAdminData) {
    return;
  }

  loadProviders();
  loadApp();
  loadChannelAuthoringData();
  loadHealth();
  loadUsage();
  loadTasks();
  loadBackups();
  startUsagePolling();
}

initializeApp();

// Expose reactive fields directly in template
const {
  tab,
  app,
  authStateReady,
  authConfigured,
  sessionAuthenticated,
  showSetupModal,
  setupForm,
  setupError,
  savingSetup,
  loginForm,
  loginError,
  loggingIn,
  loggingOut,
  passwordForm,
  savingPassword,
  providers,
  outputProfiles,
  selectedOutputProfileSlug,
  epgValidation,
  loadingEPGValidation,
  health,
  loadingHealth,
  runningHealth,
  savingProviders,
  reloadingChannels,
  reloadingEPG,
  savingApp,
  loadingChannelAuthoring,
  savingOutputProfile,
  updatingPreferredStreamChannelId,
  updatingGuideBindingChannelId,
  activeUsage,
  loadingUsage,
  tasks,
  loadingTasks,
  backups,
  loadingBackups,
  creatingBackup,
  previewChannels,
  loadingPreviewChannels,
  previewProfileSlug,
  previewSearch,
  previewWatchingChannel,
  showVideoModal,
  previewGuide,
  loadingGuide,
} = toRefs(state);

const showLoginView = computed(
  () =>
    authStateReady.value &&
    isLoginRoute &&
    authConfigured.value &&
    !sessionAuthenticated.value &&
    !showSetupModal.value
);

const usageTabLabel = computed(() =>
  activeUsage.value.length > 0 ? `Usage (${Math.min(activeUsage.value.length, 99)})` : 'Usage'
);

const channelWorkflowsLoading = computed(
  () => loadingChannelAuthoring.value || state.loadingOutputProfileEntries
);

const selectedOutputProfile = computed(() => {
  const profile = getSelectedOutputProfileRecord();
  if (!profile) {
    return null;
  }

  return {
    ...profile,
    name: state.outputProfileDraft.name,
    enabled: state.outputProfileDraft.enabled,
  };
});

const profileMetaDirty = computed(() => {
  const profile = getSelectedOutputProfileRecord();
  if (!profile) {
    return false;
  }

  return (
    state.outputProfileDraft.name.trim() !== String(profile.name || '').trim() ||
    state.outputProfileDraft.enabled !== Boolean(profile.enabled)
  );
});

const profileDirty = computed(() => state.outputProfileDirty || profileMetaDirty.value);

function getPublicBaseUrl() {
  const configuredBaseUrl = String(state.app.base_url || '').trim();
  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/+$/, '');
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, '');
  }

  return '';
}

const selectedOutputProfileEndpointInfo = computed(() => {
  const profile = selectedOutputProfile.value;
  if (!profile) {
    return null;
  }

  const baseUrl = getPublicBaseUrl();
  const profilePath = profile.isDefault ? '' : `/profiles/${encodeURIComponent(profile.slug)}`;
  const endpoints = [
    {
      label: 'M3U',
      url: baseUrl ? `${baseUrl}${profilePath}/lineup.m3u` : `${profilePath || ''}/lineup.m3u`,
    },
    {
      label: 'JSON',
      url: baseUrl ? `${baseUrl}${profilePath}/lineup.json` : `${profilePath || ''}/lineup.json`,
    },
    {
      label: 'XMLTV',
      url: baseUrl ? `${baseUrl}${profilePath}/xmltv.xml` : `${profilePath || ''}/xmltv.xml`,
    },
  ];

  if (profile.isDefault) {
    return {
      available: true,
      title: 'Public Endpoints',
      message: 'These public URLs currently publish this profile.',
      endpoints,
    };
  }

  return {
    available: profile.enabled,
    title: 'Public Endpoints',
    message: profile.enabled
      ? 'These profile-specific public URLs publish this named profile.'
      : 'Enable this profile to publish these profile-specific public URLs.',
    endpoints,
  };
});

function parseGuideNumberSortParts(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }

  const parts = normalized.split('.');
  if (!parts.every(part => /^\d+$/.test(part))) {
    return null;
  }

  return parts.map(part => Number(part));
}

function compareGuideNumbers(left, right) {
  const leftParts = parseGuideNumberSortParts(left);
  const rightParts = parseGuideNumberSortParts(right);

  if (!leftParts && !rightParts) {
    return String(left || '').localeCompare(String(right || ''));
  }
  if (!leftParts) {
    return 1;
  }
  if (!rightParts) {
    return -1;
  }

  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];

    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }
    if (leftPart !== rightPart) {
      return leftPart - rightPart;
    }
  }

  return 0;
}

function describeEffectiveGuideNumber(outputEntry, channel) {
  const overrideGuideNumber = String(outputEntry?.guideNumberOverride || '').trim();
  const canonicalGuideNumber = String(channel?.guideNumber || '').trim();

  if (overrideGuideNumber) {
    return {
      label: overrideGuideNumber,
      helpText: `Using override ${overrideGuideNumber}.`,
      source: 'override',
      warning: false,
    };
  }

  if (canonicalGuideNumber) {
    return {
      label: canonicalGuideNumber,
      helpText: `Using canonical guide number ${canonicalGuideNumber}.`,
      source: 'canonical',
      warning: false,
    };
  }

  return {
    label: 'Missing',
    helpText: outputEntry?.enabled
      ? 'No guide number is assigned for this enabled channel.'
      : 'No guide number is assigned.',
    source: 'missing',
    warning: Boolean(outputEntry?.enabled),
  };
}

function hasAssignedGuideNumber(outputEntry, channel) {
  return Boolean(
    String(outputEntry?.guideNumberOverride || '').trim() || String(channel?.guideNumber || '').trim()
  );
}

const channelWorkflowRows = computed(() => {
  const bindingsByCanonicalId = new Map();
  const guideBindingsByCanonicalId = new Map();
  const outputEntriesByCanonicalId = new Map(
    state.outputProfileEntries.map(entry => [entry.canonical?.id, entry])
  );

  for (const binding of state.channelBindings) {
    const key = binding.canonical?.id;
    if (!key) continue;
    if (!bindingsByCanonicalId.has(key)) {
      bindingsByCanonicalId.set(key, []);
    }
    bindingsByCanonicalId.get(key).push(binding);
  }

  for (const binding of state.guideBindings) {
    const key = binding.canonical?.id;
    if (!key) continue;
    if (!guideBindingsByCanonicalId.has(key)) {
      guideBindingsByCanonicalId.set(key, []);
    }
    guideBindingsByCanonicalId.get(key).push(binding);
  }

  return state.canonicalChannels
    .map(channel => {
      const sourceBindings = bindingsByCanonicalId.get(channel.id) || [];
      const guideBindingOptions = (guideBindingsByCanonicalId.get(channel.id) || []).map(
        binding => ({
          label: `${binding.source?.name || 'Unknown source'} - ${binding.epgChannelId || 'no EPG id'}`,
          value: JSON.stringify({
            sourceId: binding.source?.id || '',
            epgChannelId: binding.epgChannelId || '',
          }),
        })
      );
      const selectedGuideBinding = (guideBindingsByCanonicalId.get(channel.id) || []).find(
        binding => binding.selected
      );
      const outputEntry = outputEntriesByCanonicalId.get(channel.id);
      const preferredBinding = sourceBindings.find(binding => binding.isPreferredStream);
      const sortedBindings = sourceBindings.slice().sort((left, right) => {
        if (left.isPreferredStream !== right.isPreferredStream) {
          return left.isPreferredStream ? -1 : 1;
        }
        if ((left.priority ?? 0) !== (right.priority ?? 0)) {
          return (left.priority ?? 0) - (right.priority ?? 0);
        }
        return (left.sourceChannel?.source || '').localeCompare(right.sourceChannel?.source || '');
      });
      const guideDisplay = describeEffectiveGuideNumber(outputEntry, channel);
      const hasGuideNumber = hasAssignedGuideNumber(outputEntry, channel);
      const sourceGuideReferences = sortedBindings
        .map(binding => {
          const sourceGuideNumber =
            binding.sourceChannel?.sourceGuideNumber || binding.sourceChannel?.guideNumber || '';
          if (!sourceGuideNumber) {
            return '';
          }

          return `${binding.sourceChannel?.source || 'Unknown'} ${sourceGuideNumber}`;
        })
        .filter(Boolean);

      return {
        id: channel.id,
        name: channel.name,
        tvg_id: channel.tvg_id,
        guideNumber: channel.guideNumber,
        sourceBindings,
        sourceBindingsSummary: sortedBindings
          .map(
            binding =>
              `${binding.sourceChannel?.source || 'Unknown'}: ${binding.sourceChannel?.name || 'Unnamed channel'}`
          )
          .join(', '),
        sourceGuideReferencesSummary: sourceGuideReferences.join(', '),
        preferredSourceChannelId: preferredBinding?.sourceChannel?.id || null,
        preferredStreamOptions: sortedBindings.map(binding => ({
          label: `${binding.sourceChannel?.source || 'Unknown'} - ${binding.sourceChannel?.name || 'Unnamed channel'}${
            binding.sourceChannel?.sourceGuideNumber || binding.sourceChannel?.guideNumber
              ? ` (${binding.sourceChannel?.sourceGuideNumber || binding.sourceChannel?.guideNumber})`
              : ''
          }`,
          value: binding.sourceChannel?.id || '',
        })),
        guideBindingOptions,
        selectedGuideBindingValue: selectedGuideBinding
          ? JSON.stringify({
            sourceId: selectedGuideBinding.source?.id || '',
            epgChannelId: selectedGuideBinding.epgChannelId || '',
          })
          : null,
        outputEnabled: hasGuideNumber ? (outputEntry?.enabled ?? false) : false,
        enableToggleDisabled: !hasGuideNumber,
        position: outputEntry?.position ?? 0,
        guideNumberOverrideInput:
          outputEntry?.guideNumberOverrideDraft ?? outputEntry?.guideNumberOverride ?? '',
        committedGuideNumberOverride: outputEntry?.guideNumberOverride ?? null,
        effectiveGuideNumber: outputEntry?.guideNumberOverride || channel.guideNumber || '',
        guideDisplayLabel: guideDisplay.label,
        guideDisplaySource: guideDisplay.source,
        guideDisplayWarning: guideDisplay.warning,
        guideHelpText: guideDisplay.helpText,
      };
    })
    .sort((left, right) => {
      const guideNumberComparison = compareGuideNumbers(
        left.effectiveGuideNumber,
        right.effectiveGuideNumber
      );
      if (guideNumberComparison !== 0) {
        return guideNumberComparison;
      }
      if (left.position !== right.position) {
        return left.position - right.position;
      }
      return (left.name || '').localeCompare(right.name || '');
    });
});

const channelWorkflowStats = computed(() => ({
  totalChannels: state.canonicalChannels.length,
  enabledChannels: channelWorkflowRows.value.filter(row => row.outputEnabled).length,
  missingGuideChannels: channelWorkflowRows.value.filter(row => row.guideDisplayWarning).length,
  multiSourceChannels: channelWorkflowRows.value.filter(row => row.sourceBindings.length > 1)
    .length,
}));

const healthDetails = computed(() =>
  Array.isArray(health.value.details)
    ? health.value.details.map(d => ({
      id: d.id,
      status: d.healthy ? 'online' : 'offline',
      ms: d.ms,
      code: d.statusCode,
      contentType: d.contentType,
      error: d.error,
      method: d.method,
      path: d.path,
    }))
    : Object.entries(health.value.summary || {}).map(([id, status]) => ({
      id,
      status,
      ms: '',
      code: '',
      contentType: '',
      error: '',
      method: '',
      path: '',
    }))
);

const healthColumns = [
  { label: 'Channel ID', key: 'id', sortable: true },
  {
    label: 'Status',
    key: 'status',
    sortable: true,
    cellRenderer: ({ row }) => (row.status === 'online' ? 'Online' : 'Offline'),
  },
  { label: 'Latency (ms)', key: 'ms', sortable: true },
  { label: 'Content-Type', key: 'contentType' },
  { label: 'Error', key: 'error' },
];

const formattedHealthUpdated = computed(() => {
  const ended = health.value?.meta?.endedAt || health.value?.meta?.startedAt;
  if (!ended) return '';
  try {
    return new Date(ended).toLocaleString();
  } catch {
    return String(ended);
  }
});

const usageColumns = [
  { label: 'IP', key: 'ip', sortable: true },
  { label: 'Channel ID', key: 'channelId', sortable: true },
  { label: 'Name', key: 'name', sortable: true },
  { label: 'tvg-id', key: 'tvg_id', sortable: true },
  { label: 'Client', key: 'client' },
  { label: 'User Agent', key: 'userAgent', tooltip: true, truncate: true },
  { label: 'Started', key: 'startedAt', sortable: true },
  { label: 'Last Seen', key: 'lastSeenAt', sortable: true },
];

const taskColumns = [
  { label: 'Task Name', key: 'name', sortable: true },
  { label: 'Schedule', key: 'schedule' },
  {
    label: 'Status',
    key: 'status',
    cellRenderer: ({ row }) => {
      if (row.isRunning || state.runningTask === row.name) {
        return 'Running';
      }
      if (!row.lastStatus) {
        return '—';
      }
      return row.lastStatus === 'success' ? 'Success' : `Failed: ${row.lastStatus}`;
    },
  },
  {
    label: 'Last Run',
    key: 'lastRun',
    cellRenderer: ({ row }) => (row.lastRun ? new Date(row.lastRun).toLocaleString() : 'Never'),
  },
  {
    label: 'Duration',
    key: 'lastDuration',
    cellRenderer: ({ row }) => (row.lastDuration == null ? '—' : `${row.lastDuration}ms`),
  },
  {
    label: 'Actions',
    key: 'actions',
    actions: [
      {
        key: 'run',
        label: 'Run Now',
        variant: 'ghost',
        disabled: ({ row }) => row.isRunning || state.runningTask === row.name,
      },
    ],
  },
];

const providerColumns = [
  {
    label: 'Name',
    key: 'name',
    editor: { type: 'input', placeholder: 'Source name' },
  },
  {
    label: 'Type',
    key: 'type',
    editor: {
      type: 'select',
      options: [
        { label: 'M3U', value: 'm3u' },
        { label: 'HDHomeRun', value: 'hdhomerun' },
      ],
    },
  },
  {
    label: 'Source URL',
    key: 'url',
    editor: { type: 'input', placeholder: 'https://example.com/playlist.m3u' },
  },
  {
    label: 'EPG URL (optional)',
    key: 'epg',
    editor: { type: 'input', placeholder: 'https://...epg.xml (optional)' },
  },
  {
    label: 'Actions',
    key: 'actions',
    actions: [{ key: 'remove', label: 'Remove', variant: 'ghost' }],
  },
];

/**
 * Format a backup name (e.g. "backup-2024-01-15T14-30-00") into a human-readable
 * timestamp string (e.g. "2024-01-15 14:30:00").
 * @param {string} name
 * @returns {string}
 */
function formatBackupTimestamp(name) {
  return name
    .replace(/^backup-/, '')
    .replace('T', ' ')
    .replace(/-(\d{2})-(\d{2})-(\d{2})$/, ':$1:$2:$3');
}

const backupColumns = [
  {
    label: 'Backup',
    key: 'name',
    sortable: true,
    cellRenderer: ({ row }) => formatBackupTimestamp(row.name) || row.name,
  },
  {
    label: 'Actions',
    key: 'actions',
    actions: [
      {
        key: 'restore',
        label: 'Restore',
        variant: 'ghost',
        disabled: () => Boolean(state.restoringBackup || state.deletingBackup),
      },
      {
        key: 'download',
        label: 'Download',
        variant: 'ghost',
      },
      {
        key: 'delete',
        label: 'Delete',
        variant: 'ghost',
        disabled: () => Boolean(state.restoringBackup || state.deletingBackup),
      },
    ],
  },
];

// ─── Preview tab computed + column definitions ────────────────────────────────

const filteredPreviewChannels = computed(() => {
  const q = state.previewSearch.toLowerCase().trim();
  if (!q) return state.previewChannels;
  return state.previewChannels.filter(
    c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.group || '').toLowerCase().includes(q) ||
      (c.tvg_id || '').toLowerCase().includes(q) ||
      (c.source || '').toLowerCase().includes(q)
  );
});

const previewTableRows = computed(() =>
  filteredPreviewChannels.value.map((channel, index) => ({
    ...channel,
    previewKey: channel.original_url || `${channel.source}|${channel.name}|${channel.guideNumber}|${index}`,
  }))
);

const previewStreamUrl = computed(() => {
  const ch = state.previewWatchingChannel;
  if (!ch) return '';
  const base = `/stream/${encodeURIComponent(ch.source || '')}/${encodeURIComponent(ch.name || '')}`;
  // HDHomeRun OTA broadcasts use MPEG-2 video and AC-3 audio — codecs not supported
  // by browser MSE.  Append ?streamMode=hls so the server requests the HLS variant
  // from the HDHomeRun device.  Note: HLS mode wraps the MPEG-TS in an HLS playlist
  // but does NOT re-encode; codecs are still MPEG-2/AC-3.  HLS.js will detect the
  // format/codec mismatch and the probe + transcode path will handle playback.
  return ch.hdhomerun ? `${base}?streamMode=hls` : base;
});

const previewTranscodeUrl = computed(() => {
  const ch = state.previewWatchingChannel;
  if (!ch) return '';
  // Server-side transcoding endpoint — converts MPEG-2/AC-3 MPEG-TS to H.264/AAC
  // using ffmpeg so the browser can play the stream natively via mpegts.js.
  return `/transcode/${encodeURIComponent(ch.source || '')}/${encodeURIComponent(ch.name || '')}`;
});

// Show the transcoding button only when the unsupported-codec error is active
// (i.e. the stream is live but uses codecs the browser cannot decode).
const showTranscodeButton = computed(() => state.playerError === ERR_UNSUPPORTED_CODEC);

function createPreviewLogoFallbackElement() {
  const fallback = document.createElement('span');
  fallback.textContent = '📺';
  fallback.setAttribute('aria-hidden', 'true');
  fallback.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'justify-content:center',
    'width:32px',
    'height:32px',
    'max-width:32px',
    'max-height:32px',
    'overflow:hidden',
    'border-radius:4px',
    'background:rgba(255,255,255,0.06)',
    'font-size:1.05rem',
    'line-height:1',
    'vertical-align:middle',
  ].join(';');
  return fallback;
}

function renderPreviewLogoCell({ row }) {
  if (typeof document === 'undefined') {
    return row.logo ? '' : '📺';
  }

  const wrapper = document.createElement('span');
  wrapper.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'justify-content:center',
    'width:32px',
    'height:32px',
    'max-width:32px',
    'max-height:32px',
    'flex:0 0 32px',
    'overflow:hidden',
    'vertical-align:middle',
  ].join(';');

  if (!row.logo) {
    wrapper.append(createPreviewLogoFallbackElement());
    return wrapper;
  }

  const image = document.createElement('img');
  image.src = row.logo;
  image.alt = '';
  image.style.cssText = [
    'display:block',
    'width:100%',
    'height:100%',
    'max-width:32px',
    'max-height:32px',
    'object-fit:contain',
    'border-radius:4px',
  ].join(';');
  image.addEventListener('error', () => {
    wrapper.replaceChildren(createPreviewLogoFallbackElement());
  });
  wrapper.append(image);
  return wrapper;
}

const previewColumns = [
  {
    label: '',
    key: 'logo',
    align: 'center',
    width: '56px',
    cellRenderer: renderPreviewLogoCell,
  },
  {
    label: 'Ch #',
    key: 'guideNumber',
    sortable: true,
    sortValue: row => {
      const value = parseFloat(String(row?.guideNumber ?? ''));
      return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
    },
    cellRenderer: ({ row }) => row.guideNumber || '—',
  },
  {
    label: 'Name',
    key: 'name',
    sortable: true,
  },
  {
    label: 'Group',
    key: 'group',
    tooltip: true,
    cellRenderer: ({ row }) => row.group || '—',
  },
  {
    label: 'Source',
    key: 'source',
    tooltip: true,
  },
  {
    label: 'TVG-ID',
    key: 'tvg_id',
    tooltip: true,
    cellRenderer: ({ row }) => row.tvg_id || '—',
  },
  {
    label: 'Actions',
    key: 'actions',
    width: '120px',
    actions: [{ key: 'watch', label: 'Watch', icon: 'play', variant: 'ghost' }],
  },
];
</script>

<style>
html,
body,
#app {
  height: 100%;
  margin: 0;
}

body {
  background: radial-gradient(circle at top, rgba(224, 125, 44, 0.08), transparent 32%), var(--bg);
  color: var(--fg);
}

#app {
  min-height: 100%;
}

.admin-shell {
  min-height: 100%;
  background: transparent;
}

.admin-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border) !important;
  background: rgba(15, 14, 12, 0.9);
  backdrop-filter: blur(10px);
}

.brand-lockup {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1;
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 4px;
  background: var(--gradient-mark);
  color: #fff;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.brand-title {
  color: var(--fg);
  font-size: var(--text-md);
  font-weight: 600;
  letter-spacing: -0.01em;
}

.signout-button {
  margin-inline-start: auto;
}

.admin-content {
  padding: 24px;
}

.login-content {
  min-height: calc(100vh - 73px);
  display: grid;
  place-items: center;
}

.workspace-frame {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  overflow: hidden;
  box-shadow: var(--shadow-lg);
}

.login-frame {
  width: min(460px, 100%);
}

.login-card {
  padding: 24px;
}

.login-title {
  margin: 0 0 0.75rem;
  font-size: 1.25rem;
  font-weight: 600;
}

.login-copy {
  margin: 0 0 1rem;
  opacity: 0.8;
  line-height: 1.5;
}

.login-form {
  display: grid;
  gap: 0.75rem;
}

.admin-tabs h3 {
  margin-top: 0;
  margin-bottom: 16px !important;
}

.admin-tabs {
  display: block;
  padding: 20px;
  background: var(--bg-subtle);
}

.admin-tabs cindor-tab-panel {
  display: block;
  padding-top: 12px;
}

.admin-tabs cindor-data-table {
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.admin-tabs code,
.admin-tabs pre {
  font-family: var(--font-mono);
}

.setup-overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 14, 12, 0.72);
  backdrop-filter: blur(10px);
}

.setup-card {
  width: min(460px, 100%);
  padding: 24px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow-lg);
}

.setup-title {
  margin: 0 0 0.75rem;
  font-size: 1.25rem;
}

.setup-copy {
  margin: 0 0 1rem;
  opacity: 0.8;
}

.setup-error {
  margin-bottom: 0.75rem;
  color: var(--danger);
}

.compact-button {
  --cindor-button-min-height: 30px;
  --cindor-button-padding-inline: var(--space-3);
}

.warning-button {
  --cindor-button-solid-background: var(--warning);
  --cindor-button-solid-border-color: var(--warning);
  --cindor-button-solid-color: #111;
  --cindor-button-solid-hover-background: color-mix(in srgb, var(--warning) 85%, white);
  --cindor-button-solid-hover-border-color: color-mix(in srgb, var(--warning) 85%, white);
}

.danger-button {
  --cindor-button-solid-background: var(--danger);
  --cindor-button-solid-border-color: var(--danger);
  --cindor-button-solid-hover-background: color-mix(in srgb, var(--danger) 85%, white);
  --cindor-button-solid-hover-border-color: color-mix(in srgb, var(--danger) 85%, white);
  --cindor-button-ghost-border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
  --cindor-button-ghost-color: var(--danger);
  --cindor-button-hover-border-color: var(--danger);
  --cindor-button-hover-color: var(--danger);
}

.toolbar-count {
  opacity: 0.6;
  font-size: 0.9em;
}

.dialog-body {
  display: grid;
  gap: 1rem;
  min-width: min(720px, 90vw);
}

.dialog-title {
  font-size: 1.1rem;
  font-weight: 600;
}

.dialog-copy {
  line-height: 1.5;
}

.dialog-toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.dialog-code {
  flex: 1;
  font-size: 0.78em;
  word-break: break-all;
  opacity: 0.85;
}

.debug-panel {
  margin-bottom: 1rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  overflow: hidden;
}

.debug-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.35rem 0.6rem;
  background: rgba(255, 255, 255, 0.06);
  cursor: pointer;
  user-select: none;
  border: none;
  color: inherit;
  font: inherit;
  text-align: left;
}

.debug-grid {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.2rem 0.6rem;
  margin-bottom: 0.5rem;
}

.debug-pre {
  font-size: 0.85em;
  line-height: 1.4;
  max-height: 140px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  background: rgba(0, 0, 0, 0.3);
  padding: 0.4rem;
  border-radius: 3px;
  margin: 0;
}

@media (max-width: 900px) {
  .admin-header {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .admin-content {
    padding: 14px;
  }

  .admin-tabs {
    padding: 16px;
  }

  .dialog-body {
    min-width: min(100%, 90vw);
  }
}
</style>
