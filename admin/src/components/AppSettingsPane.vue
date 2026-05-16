<template>
  <div class="tab-panel">
    <div
      v-if="authConfigured"
      class="security-section"
      role="region"
      aria-labelledby="app-settings-security-title"
    >
      <h3 id="app-settings-security-title" class="section-title">Security</h3>
      <p id="app-settings-security-copy" class="section-copy">
        Update the admin password here. New passwords must be between 8 and 128 characters.
      </p>
      <CindorForm
        class="security-form"
        :aria-busy="savingPassword ? 'true' : undefined"
        aria-describedby="app-settings-security-copy"
      >
        <CindorFormField label="Current Password">
          <CindorPasswordInput
            v-model="passwordCurrent"
            name="current-password"
            autocomplete="current-password"
            placeholder="Enter current password"
            :disabled="savingPassword"
            aria-describedby="app-settings-security-copy"
          />
        </CindorFormField>
        <CindorFormField label="New Password">
          <CindorPasswordInput
            v-model="passwordNew"
            name="new-password"
            autocomplete="new-password"
            placeholder="Min. 8 characters"
            :disabled="savingPassword"
            aria-describedby="app-settings-security-copy"
          />
        </CindorFormField>
        <CindorFormField label="Confirm New Password">
          <CindorPasswordInput
            v-model="passwordConfirm"
            name="confirm-password"
            autocomplete="new-password"
            placeholder="Repeat new password"
            :disabled="savingPassword"
            aria-describedby="app-settings-security-copy"
          />
        </CindorFormField>
        <CindorStack direction="horizontal" gap="sm" wrap role="group" aria-label="Password actions">
          <CindorButton
            :disabled="savingPassword"
            :aria-busy="savingPassword ? 'true' : undefined"
            aria-describedby="app-settings-security-copy"
            @click="changePassword"
          >
            {{ savingPassword ? 'Saving...' : 'Change Password' }}
          </CindorButton>
        </CindorStack>
      </CindorForm>
    </div>

    <CindorForm
      class="settings-form app-settings-form"
      :aria-busy="savingApp ? 'true' : undefined"
      aria-labelledby="app-settings-core-title"
      aria-describedby="app-settings-core-copy"
    >
      <h3 id="app-settings-core-title" class="section-title">Core Settings</h3>
      <p id="app-settings-core-copy" class="section-copy">
        Set the public base URL used for generated links and OAuth defaults when the proxy sits
        behind a reverse proxy or custom hostname.
      </p>
      <CindorFormField label="Base URL">
        <CindorInput v-model="appBaseUrl" placeholder="https://example.com" aria-describedby="app-settings-core-copy" />
      </CindorFormField>

      <div
        class="oauth-section"
        role="region"
        aria-labelledby="app-settings-oauth-title"
        aria-describedby="app-settings-oauth-copy"
      >
        <div class="section-header">
          <div>
            <h3 id="app-settings-oauth-title" class="section-title">MCP OAuth Clients (/mcp only)</h3>
            <p id="app-settings-oauth-copy" class="section-copy">
              Configure the built-in OAuth server used only by `/mcp` clients. This does not change
              admin sign-in, which continues to use the normal session-based login.
            </p>
          </div>
        </div>

        <div class="section-actions" role="group" aria-label="OAuth client actions">
          <CindorButton
            class="action-button"
            :disabled="savingApp"
            :aria-busy="savingApp ? 'true' : undefined"
            :aria-describedby="oauthClients.length ? 'app-settings-oauth-copy oauth-client-summary' : 'app-settings-oauth-copy'"
            @click="addClient"
          >
            Add MCP Client
          </CindorButton>
        </div>

        <p id="oauth-preset-summary" class="section-copy" role="status" aria-live="polite">
          {{ oauthPresetCountSummary }}
        </p>
        <div class="preset-grid" role="list" aria-label="OAuth client presets" aria-describedby="oauth-preset-summary">
          <div
            v-for="preset in oauthClientPresets"
            :key="preset.key"
            class="preset-card"
            role="listitem"
            :aria-labelledby="buildPresetTitleId(preset)"
            :aria-describedby="buildPresetDescriptionId(preset)"
          >
            <div :id="buildPresetTitleId(preset)" class="preset-card-title">{{ preset.label }}</div>
            <div class="preset-card-meta">
              {{ preset.verified ? 'Verified callbacks' : 'Template - add your own callback URI' }}
            </div>
            <p :id="buildPresetDescriptionId(preset)" class="preset-card-copy">{{ preset.description }}</p>
            <CindorButton
              class="preset-button"
              :disabled="savingApp"
              :aria-busy="savingApp ? 'true' : undefined"
              :aria-label="`Use ${preset.label} OAuth client preset`"
              :aria-describedby="`oauth-preset-summary ${buildPresetDescriptionId(preset)}`"
              @click="addPresetClient(preset.key)"
            >
              Use Preset
            </CindorButton>
          </div>
        </div>

        <p id="app-settings-oauth-fields-copy" class="field-copy">
          OAuth issuer should usually match the public base URL. Adjust token lifetimes only if your
          MCP clients need shorter or longer authorization windows.
        </p>
        <div class="oauth-grid">
          <CindorFormField label="OAuth Issuer">
            <CindorInput
              v-model="oauthIssuer"
              placeholder="https://iptv.example.com"
              aria-describedby="app-settings-oauth-fields-copy"
            />
          </CindorFormField>
          <CindorFormField label="Authorization Code TTL (seconds)">
            <CindorInput
              v-model="oauthAuthorizationCodeTtl"
              type="number"
              inputmode="numeric"
              min="60"
              max="1800"
              placeholder="300"
              aria-describedby="app-settings-oauth-fields-copy"
            />
          </CindorFormField>
          <CindorFormField label="Access Token TTL (seconds)">
            <CindorInput
              v-model="oauthAccessTokenTtl"
              type="number"
              inputmode="numeric"
              min="60"
              max="86400"
              placeholder="3600"
              aria-describedby="app-settings-oauth-fields-copy"
            />
          </CindorFormField>
        </div>

        <p v-if="oauthClients.length" id="oauth-client-summary" class="section-copy oauth-client-summary" role="status" aria-live="polite">
          {{ oauthClientCountSummary }}
        </p>
        <div
          v-if="oauthClients.length"
          class="oauth-client-list"
          role="list"
          aria-label="Configured OAuth clients"
          aria-describedby="oauth-client-summary"
        >
          <div
            v-for="(client, index) in oauthClients"
            :key="client._id || index"
            class="oauth-client-card"
            role="listitem"
            :aria-labelledby="buildClientTitleId(index, client)"
            :aria-describedby="buildClientDescriptionId(index, client)"
          >
            <div class="client-card-header">
              <div>
                <div :id="buildClientTitleId(index, client)" class="client-card-title">
                  {{ client.client_name || client.client_id || `OAuth Client ${index + 1}` }}
                </div>
                <div :id="buildClientDescriptionId(index, client)" class="client-card-copy">
                  Public OAuth client for `/mcp` authorization-code + PKCE only.
                </div>
              </div>
              <CindorButton
                class="remove-button"
                :disabled="savingApp"
                :aria-busy="savingApp ? 'true' : undefined"
                :aria-label="`Remove MCP client ${client.client_name || client.client_id || index + 1}`"
                :aria-describedby="buildClientDescriptionId(index, client)"
                @click="removeClient(index)"
              >
                Remove Client
              </CindorButton>
            </div>

            <div class="oauth-grid">
              <CindorFormField label="Client ID">
                <CindorInput
                  :model-value="client.client_id"
                  placeholder="chatgpt"
                  :aria-describedby="buildClientFieldDescribedBy(index, client)"
                  @update:model-value="updateClient(index, { client_id: $event })"
                />
              </CindorFormField>
              <CindorFormField label="Client Name">
                <CindorInput
                  :model-value="client.client_name"
                  placeholder="ChatGPT"
                  :aria-describedby="buildClientFieldDescribedBy(index, client)"
                  @update:model-value="updateClient(index, { client_name: $event })"
                />
              </CindorFormField>
              <CindorFormField label="Scope">
                <CindorInput
                  :model-value="client.scope"
                  placeholder="mcp"
                  :aria-describedby="buildClientFieldDescribedBy(index, client)"
                  @update:model-value="updateClient(index, { scope: $event })"
                />
              </CindorFormField>
            </div>

            <CindorFormField label="Redirect URIs">
              <CindorTextarea
                :model-value="client.redirectUrisText"
                rows="4"
                placeholder="One absolute callback URL per line"
                :aria-describedby="buildClientFieldDescribedBy(index, client)"
                @update:model-value="updateClient(index, { redirectUrisText: $event })"
              />
            </CindorFormField>
            <p :id="buildClientRedirectHelpId(index, client)" class="field-copy">
              Enter one redirect URI per line. The MCP client must send one of these exact callback
              URLs when authorizing against `/mcp`.
            </p>
          </div>
        </div>
        <div v-else class="empty-note" role="status" aria-live="polite">
          No MCP OAuth clients configured yet. Add a client or start with one of the presets above.
        </div>

        <CindorStack
          class="oauth-save-actions"
          direction="horizontal"
          gap="sm"
          wrap
          role="group"
          aria-label="App settings actions"
        >
          <CindorButton
            class="action-button"
            :disabled="savingApp"
            :aria-busy="savingApp ? 'true' : undefined"
            :aria-describedby="
              oauthClients.length
                ? 'app-settings-oauth-copy app-settings-oauth-fields-copy oauth-client-summary'
                : 'app-settings-oauth-copy app-settings-oauth-fields-copy'
            "
            @click="saveApp"
          >
            {{ savingApp ? 'Saving...' : 'Save App Settings' }}
          </CindorButton>
        </CindorStack>
      </div>
    </CindorForm>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import {
  CindorButton,
  CindorForm,
  CindorFormField,
  CindorInput,
  CindorPasswordInput,
  CindorStack,
  CindorTextarea,
} from 'cindor-ui-vue';

const CHATGPT_REDIRECT_URIS = [
  'https://chat.openai.com/aip/oauth/callback',
  'https://chat.openai.com/aip/mcp/callback',
  'https://chatgpt.com/aip/oauth/callback',
  'https://chatgpt.com/aip/mcp/callback',
];

const OAUTH_CLIENT_PRESETS = [
  {
    key: 'openai-chatgpt',
    label: 'OpenAI / ChatGPT',
    verified: true,
    description:
      'Pre-fills the known ChatGPT and chat.openai.com callback URLs for a remote MCP OAuth client.',
    client: {
      client_id: 'chatgpt',
      client_name: 'ChatGPT',
      redirectUrisText: CHATGPT_REDIRECT_URIS.join('\n'),
      scope: 'mcp',
    },
  },
  {
    key: 'openai-agents-sdk',
    label: 'OpenAI Agents SDK',
    verified: false,
    description:
      'Best-effort template for OpenAI Agents SDK and similar MCP SDK clients. Add the exact callback URI used by your app.',
    client: {
      client_id: 'openai-agents-sdk',
      client_name: 'OpenAI Agents SDK',
      redirectUrisText: '',
      scope: 'mcp',
    },
  },
  {
    key: 'generic-public-client',
    label: 'Generic Public Client',
    verified: false,
    description:
      'Template for other HTTP MCP clients that follow OAuth 2.1 + PKCE. Supply the client-specific redirect URI manually.',
    client: {
      client_id: 'mcp-client',
      client_name: 'MCP Client',
      redirectUrisText: '',
      scope: 'mcp',
    },
  },
];

const props = defineProps({
  appBaseUrl: { type: String, required: true },
  oauthIssuer: { type: String, required: true },
  oauthAuthorizationCodeTtl: { type: String, required: true },
  oauthAccessTokenTtl: { type: String, required: true },
  oauthClients: { type: Array, required: true },
  authConfigured: { type: Boolean, required: true },
  passwordCurrent: { type: String, required: true },
  passwordNew: { type: String, required: true },
  passwordConfirm: { type: String, required: true },
  savingApp: { type: Boolean, required: true },
  savingPassword: { type: Boolean, required: true },
  confirmRemoveClient: { type: Function, required: true },
  saveApp: { type: Function, required: true },
  changePassword: { type: Function, required: true },
});

const emit = defineEmits([
  'update:app-base-url',
  'update:oauth-issuer',
  'update:oauth-authorization-code-ttl',
  'update:oauth-access-token-ttl',
  'update:oauth-clients',
  'update:password-current',
  'update:password-new',
  'update:password-confirm',
]);

const appBaseUrl = computed({
  get: () => props.appBaseUrl,
  set: value => emit('update:app-base-url', value),
});

const oauthIssuer = computed({
  get: () => props.oauthIssuer,
  set: value => emit('update:oauth-issuer', value),
});

const oauthAuthorizationCodeTtl = computed({
  get: () => props.oauthAuthorizationCodeTtl,
  set: value => emit('update:oauth-authorization-code-ttl', value),
});

const oauthAccessTokenTtl = computed({
  get: () => props.oauthAccessTokenTtl,
  set: value => emit('update:oauth-access-token-ttl', value),
});

const oauthClientPresets = OAUTH_CLIENT_PRESETS;
const oauthPresetCountSummary = `${oauthClientPresets.length} OAuth client preset${
  oauthClientPresets.length === 1 ? '' : 's'
} available.`;
const oauthClientCountSummary = computed(
  () => `${props.oauthClients.length} MCP OAuth client${props.oauthClients.length === 1 ? '' : 's'} configured.`
);

const passwordCurrent = computed({
  get: () => props.passwordCurrent,
  set: value => emit('update:password-current', value),
});

const passwordNew = computed({
  get: () => props.passwordNew,
  set: value => emit('update:password-new', value),
});

const passwordConfirm = computed({
  get: () => props.passwordConfirm,
  set: value => emit('update:password-confirm', value),
});

function buildClient(overrides = {}) {
  return {
    _id: `oauth-ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    client_id: '',
    client_name: '',
    redirectUrisText: '',
    scope: 'mcp',
    ...overrides,
  };
}

function buildClientIdentity(index, client = {}) {
  return String(client._id || client.client_id || client.client_name || `oauth-client-${index + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildPresetTitleId(preset = {}) {
  return `oauth-preset-title-${String(preset.key || 'preset')}`;
}

function buildPresetDescriptionId(preset = {}) {
  return `oauth-preset-description-${String(preset.key || 'preset')}`;
}

function buildClientTitleId(index, client) {
  return `oauth-client-title-${buildClientIdentity(index, client)}`;
}

function buildClientDescriptionId(index, client) {
  return `oauth-client-description-${buildClientIdentity(index, client)}`;
}

function buildClientRedirectHelpId(index, client) {
  return `oauth-client-redirect-help-${buildClientIdentity(index, client)}`;
}

function buildClientFieldDescribedBy(index, client) {
  return `${buildClientDescriptionId(index, client)} ${buildClientRedirectHelpId(index, client)}`;
}

function updateClients(nextClients) {
  emit('update:oauth-clients', nextClients);
}

function addClient() {
  updateClients([...props.oauthClients, buildClient()]);
}

function addPresetClient(presetKey) {
  const preset = OAUTH_CLIENT_PRESETS.find(candidate => candidate.key === presetKey);
  if (preset) {
    updateClients([...props.oauthClients, buildClient(preset.client)]);
    if (!props.oauthIssuer && props.appBaseUrl) {
      emit('update:oauth-issuer', props.appBaseUrl);
    }
  }
}

function updateClient(index, patch) {
  updateClients(
    props.oauthClients.map((client, clientIndex) =>
      clientIndex === index ? { ...client, ...patch } : client
    )
  );
}

async function removeClient(index) {
  const client = props.oauthClients[index];
  const hasContent = Boolean(
    String(client?.client_id || '').trim() ||
      String(client?.client_name || '').trim() ||
      String(client?.redirectUrisText || '').trim()
  );

  if (hasContent) {
    const confirmed = await props.confirmRemoveClient(client, index);
    if (!confirmed) {
      return;
    }
  }

  updateClients(props.oauthClients.filter((_, clientIndex) => clientIndex !== index));
}
</script>

<style scoped>
.tab-panel {
  padding: 28px 32px 32px;
}

.settings-form,
.security-form {
  gap: 0.9rem;
}

.app-settings-form {
  margin-top: 0;
}

.security-section {
  margin-top: 2rem;
}

.security-section + .app-settings-form {
  margin-top: 2rem;
}

.section-header {
  margin-bottom: 1rem;
}

.section-actions {
  display: flex;
  justify-content: flex-end;
  margin: 0 0 1.25rem;
}

.section-title {
  margin: 0 0 0.35rem;
}

.section-copy,
.field-copy {
  margin: 0;
  opacity: 0.72;
  font-size: 0.92rem;
}

.oauth-section {
  margin-top: 2rem;
  padding: 1rem 1rem 1.25rem;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
}

.action-button,
.preset-button,
.remove-button {
  min-width: 152px;
  white-space: nowrap;
}

.preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 0.9rem;
  margin-top: 0.5rem;
  margin-bottom: 1rem;
}

.preset-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 1rem 1.1rem;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.preset-card-title {
  font-weight: 600;
  margin: 0;
}

.preset-card-meta {
  opacity: 0.65;
  font-size: 0.82rem;
  margin: 0;
}

.preset-card-copy {
  margin: 0;
  opacity: 0.78;
  font-size: 0.92rem;
  flex: 1;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.preset-button {
  margin-top: 0.35rem;
}

.oauth-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.9rem;
}

.oauth-client-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-top: 0.5rem;
}

.oauth-client-summary {
  margin-top: 1rem;
}

.oauth-save-actions {
  margin-top: 1.25rem;
  padding-top: 0.25rem;
}

.oauth-client-card {
  padding: 1rem;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.client-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1rem;
}

.client-card-title {
  font-weight: 600;
  margin-bottom: 0.2rem;
}

.client-card-copy,
.empty-note {
  opacity: 0.72;
}

.client-card-copy {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.empty-note {
  margin-top: 1rem;
}

@media (max-width: 1100px) {
  .tab-panel {
    padding: 24px 24px 28px;
  }

  .section-actions {
    justify-content: flex-start;
  }

  .preset-grid {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }

  .oauth-grid {
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  }

  .client-card-header {
    align-items: flex-start;
  }
}

@media (max-width: 900px) {
  .tab-panel {
    padding: 20px 20px 20px;
  }

  .section-header,
  .client-card-header {
    flex-direction: column;
  }

  .section-actions {
    justify-content: stretch;
  }

  .tab-panel :deep(cindor-button),
  .tab-panel :deep(cindor-input),
  .tab-panel :deep(cindor-password-input),
  .tab-panel :deep(cindor-stack),
  .tab-panel :deep(cindor-textarea) {
    width: 100%;
  }
}

@media (max-width: 700px) {
  .action-button,
  .preset-button,
  .remove-button {
    min-width: 0;
    white-space: normal;
  }

  .preset-card {
    align-items: stretch;
  }

  .remove-button {
    width: 100%;
  }

  .client-card-header > * {
    width: 100%;
  }

  .oauth-grid,
  .preset-grid {
    grid-template-columns: 1fr;
  }
}
</style>
