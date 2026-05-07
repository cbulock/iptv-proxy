<template>
  <div class="tab-panel">
    <div v-if="authConfigured" class="security-section">
      <h3 class="section-title">Security</h3>
      <CindorForm class="security-form">
        <CindorFormField label="Current Password">
          <CindorPasswordInput
            v-model="passwordCurrent"
            name="current-password"
            autocomplete="current-password"
            placeholder="Enter current password"
            :disabled="savingPassword"
          />
        </CindorFormField>
        <CindorFormField label="New Password">
          <CindorPasswordInput
            v-model="passwordNew"
            name="new-password"
            autocomplete="new-password"
            placeholder="Min. 8 characters"
            :disabled="savingPassword"
          />
        </CindorFormField>
        <CindorFormField label="Confirm New Password">
          <CindorPasswordInput
            v-model="passwordConfirm"
            name="confirm-password"
            autocomplete="new-password"
            placeholder="Repeat new password"
            :disabled="savingPassword"
          />
        </CindorFormField>
        <CindorStack direction="horizontal" gap="sm" wrap>
          <CindorButton :disabled="savingPassword" @click="changePassword">
            {{ savingPassword ? 'Saving...' : 'Change Password' }}
          </CindorButton>
        </CindorStack>
      </CindorForm>
    </div>

    <CindorForm class="settings-form app-settings-form">
      <h3 class="section-title">Core Settings</h3>
      <CindorFormField label="Base URL">
        <CindorInput v-model="appBaseUrl" placeholder="https://example.com" />
      </CindorFormField>

      <div class="oauth-section">
        <div class="section-header">
          <div>
            <h3 class="section-title">MCP OAuth Clients (/mcp only)</h3>
            <p class="section-copy">
              Configure the built-in OAuth server used only by `/mcp` clients. This does not change
              admin sign-in, which continues to use the normal session-based login.
            </p>
          </div>
        </div>

        <div class="section-actions">
          <CindorButton class="action-button" :disabled="savingApp" @click="addClient">
            Add MCP Client
          </CindorButton>
        </div>

        <div class="preset-grid">
          <div v-for="preset in oauthClientPresets" :key="preset.key" class="preset-card">
            <div class="preset-card-title">{{ preset.label }}</div>
            <div class="preset-card-meta">
              {{ preset.verified ? 'Verified callbacks' : 'Template - add your own callback URI' }}
            </div>
            <p class="preset-card-copy">{{ preset.description }}</p>
            <CindorButton
              class="preset-button"
              :disabled="savingApp"
              @click="addPresetClient(preset.key)"
            >
              Use Preset
            </CindorButton>
          </div>
        </div>

        <div class="oauth-grid">
          <CindorFormField label="OAuth Issuer">
            <CindorInput v-model="oauthIssuer" placeholder="https://iptv.example.com" />
          </CindorFormField>
          <CindorFormField label="Authorization Code TTL (seconds)">
            <CindorInput
              v-model="oauthAuthorizationCodeTtl"
              type="number"
              inputmode="numeric"
              min="60"
              max="1800"
              placeholder="300"
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
            />
          </CindorFormField>
        </div>

        <div v-if="oauthClients.length" class="oauth-client-list">
          <div
            v-for="(client, index) in oauthClients"
            :key="client._id || index"
            class="oauth-client-card"
          >
            <div class="client-card-header">
              <div>
                <div class="client-card-title">
                  {{ client.client_name || client.client_id || `OAuth Client ${index + 1}` }}
                </div>
                <div class="client-card-copy">
                  Public OAuth client for `/mcp` authorization-code + PKCE only.
                </div>
              </div>
              <CindorButton
                class="remove-button"
                :disabled="savingApp"
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
                  @update:model-value="updateClient(index, { client_id: $event })"
                />
              </CindorFormField>
              <CindorFormField label="Client Name">
                <CindorInput
                  :model-value="client.client_name"
                  placeholder="ChatGPT"
                  @update:model-value="updateClient(index, { client_name: $event })"
                />
              </CindorFormField>
              <CindorFormField label="Scope">
                <CindorInput
                  :model-value="client.scope"
                  placeholder="mcp"
                  @update:model-value="updateClient(index, { scope: $event })"
                />
              </CindorFormField>
            </div>

            <CindorFormField label="Redirect URIs">
              <CindorTextarea
                :model-value="client.redirectUrisText"
                rows="4"
                placeholder="One absolute callback URL per line"
                @update:model-value="updateClient(index, { redirectUrisText: $event })"
              />
            </CindorFormField>
            <p class="field-copy">
              Enter one redirect URI per line. The MCP client must send one of these exact callback
              URLs when authorizing against `/mcp`.
            </p>
          </div>
        </div>
        <div v-else class="empty-note">
          No MCP OAuth clients configured yet. Add a client or start with one of the presets above.
        </div>

        <CindorStack class="oauth-save-actions" direction="horizontal" gap="sm" wrap>
          <CindorButton class="action-button" :disabled="savingApp" @click="saveApp">
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

function removeClient(index) {
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

.empty-note {
  margin-top: 1rem;
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
</style>
