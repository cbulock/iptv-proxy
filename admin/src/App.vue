<template>
  <n-config-provider :theme="darkTheme">
    <!-- Auth setup modal: shown when no credentials are configured -->
    <n-modal
      :show="showSetupModal"
      :mask-closable="false"
      :closable="false"
      preset="card"
      title="Set Up Admin Authentication"
      style="max-width: 460px"
    >
      <p style="opacity: 0.8; margin-top: 0">
        No administrator credentials are configured. Set a username and password to secure the admin
        interface.
      </p>
      <n-form label-placement="left" label-width="140">
        <n-form-item label="Username">
          <n-input v-model:value="setupForm.username" placeholder="admin" :disabled="savingSetup" />
        </n-form-item>
        <n-form-item label="Password">
          <n-input
            v-model:value="setupForm.password"
            type="password"
            show-password-on="click"
            placeholder="Min. 8 characters"
            :disabled="savingSetup"
          />
        </n-form-item>
        <n-form-item label="Confirm Password">
          <n-input
            v-model:value="setupForm.confirm"
            type="password"
            show-password-on="click"
            placeholder="Repeat password"
            :disabled="savingSetup"
          />
        </n-form-item>
      </n-form>
      <div v-if="setupError" style="color: #d9534f; margin-bottom: 0.75rem">{{ setupError }}</div>
      <n-button type="primary" :loading="savingSetup" @click="submitSetup" block>{{
        savingSetup ? 'Saving...' : 'Save Credentials'
      }}</n-button>
    </n-modal>

    <n-layout>
      <n-layout-header
        bordered
        style="padding: 1rem; display: flex; align-items: center; gap: 1rem"
      >
        <h1 style="margin: 0; font-size: 1.2rem; flex: 1">IPTV Proxy Admin</h1>
        <n-button v-if="authConfigured" size="small" secondary @click="logout" :loading="loggingOut"
          >Sign Out</n-button
        >
      </n-layout-header>
      <n-layout-content style="padding: 1rem">
        <n-tabs v-model:value="tab" type="line" animated>
          <n-tab-pane name="app" tab="App">
            <n-form label-placement="left" label-width="120">
              <n-form-item label="Base URL">
                <n-input v-model:value="app.base_url" placeholder="https://example.com" />
              </n-form-item>
              <n-space>
                <n-button type="primary" @click="saveApp" :loading="savingApp">{{
                  savingApp ? 'Saving...' : 'Save App'
                }}</n-button>
              </n-space>
            </n-form>
            <div class="foot">
              Editing <code>config/app.yaml</code>. Used for absolute URL generation behind proxies.
            </div>

            <!-- Security / Change Password section (shown when auth is configured) -->
            <div v-if="authConfigured" style="margin-top: 2rem">
              <h3 style="margin-bottom: 0.75rem">Security</h3>
              <n-form label-placement="left" label-width="160" style="max-width: 520px">
                <n-form-item label="Current Password">
                  <n-input
                    v-model:value="passwordForm.current"
                    type="password"
                    show-password-on="click"
                    placeholder="Enter current password"
                    :disabled="savingPassword"
                  />
                </n-form-item>
                <n-form-item label="New Password">
                  <n-input
                    v-model:value="passwordForm.newPass"
                    type="password"
                    show-password-on="click"
                    placeholder="Min. 8 characters"
                    :disabled="savingPassword"
                  />
                </n-form-item>
                <n-form-item label="Confirm New Password">
                  <n-input
                    v-model:value="passwordForm.confirm"
                    type="password"
                    show-password-on="click"
                    placeholder="Repeat new password"
                    :disabled="savingPassword"
                  />
                </n-form-item>
                <n-form-item>
                  <n-button type="primary" :loading="savingPassword" @click="changePassword">{{
                    savingPassword ? 'Saving...' : 'Change Password'
                  }}</n-button>
                </n-form-item>
              </n-form>
            </div>
          </n-tab-pane>

          <n-tab-pane name="providers" tab="Providers">
            <n-space align="center" wrap style="margin-bottom: 0.5rem">
              <n-button type="primary" secondary @click="addProvider">Add Provider</n-button>
              <n-button type="primary" @click="saveProviders" :loading="savingProviders">{{
                savingProviders ? 'Saving...' : 'Save Providers'
              }}</n-button>
              <n-button @click="loadEPGValidation" :loading="loadingEPGValidation">{{
                loadingEPGValidation ? 'Validating...' : 'Validate EPG'
              }}</n-button>
            </n-space>
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
                <span v-if="epgValidation.valid" style="color: #21c35b; font-weight: 600"
                  >✓ Valid</span
                >
                <span v-else style="color: #d9534f; font-weight: 600">✗ Invalid</span>
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
                    style="color: #f0a020"
                    >({{ epgValidation.summary?.validChannels || 0 }} valid)</span
                  >
                </div>
                <div>
                  <span style="opacity: 0.7">Programmes:</span>
                  {{ epgValidation.summary?.programmes || 0 }}
                  <span
                    v-if="
                      epgValidation.summary?.validProgrammes !== epgValidation.summary?.programmes
                    "
                    style="color: #f0a020"
                    >({{ epgValidation.summary?.validProgrammes || 0 }} valid)</span
                  >
                </div>
                <div>
                  <span style="opacity: 0.7">Errors:</span>
                  <span
                    :style="{
                      color: epgValidation.summary?.errorCount > 0 ? '#d9534f' : '#21c35b',
                    }"
                    >{{ epgValidation.summary?.errorCount || 0 }}</span
                  >
                </div>
                <div>
                  <span style="opacity: 0.7">Warnings:</span>
                  <span
                    :style="{
                      color: epgValidation.summary?.warningCount > 0 ? '#f0a020' : '#21c35b',
                    }"
                    >{{ epgValidation.summary?.warningCount || 0 }}</span
                  >
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
                  <span style="opacity: 0.7"
                    >Missing EPG ({{ epgValidation.coverage.withoutEPG }}):</span
                  >
                  <div
                    v-for="(ch, idx) in epgValidation.coverage.channelsWithoutEPG"
                    :key="idx"
                    style="padding-left: 1rem; opacity: 0.7; font-size: 0.9em"
                  >
                    • {{ ch.name }}
                    <span style="opacity: 0.6">({{ ch.tvg_id || 'no tvg-id' }})</span>
                  </div>
                </div>
              </div>
              <div
                v-if="epgValidation.errors && epgValidation.errors.length > 0"
                style="margin-top: 0.5rem; color: #d9534f"
              >
                <div style="font-weight: 600; margin-bottom: 0.25rem">Errors:</div>
                <div
                  v-for="(err, idx) in epgValidation.errors.slice(0, 10)"
                  :key="idx"
                  style="padding-left: 1rem; font-size: 0.9em"
                >
                  • {{ err }}
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
                style="margin-top: 0.5rem; color: #f0a020"
              >
                <div style="font-weight: 600; margin-bottom: 0.25rem">Warnings:</div>
                <div
                  v-for="(warn, idx) in epgValidation.warnings.slice(0, 10)"
                  :key="idx"
                  style="padding-left: 1rem; font-size: 0.9em"
                >
                  • {{ warn }}
                </div>
                <div
                  v-if="epgValidation.warnings.length > 10"
                  style="padding-left: 1rem; opacity: 0.7; font-size: 0.9em"
                >
                  ... and {{ epgValidation.warnings.length - 10 }} more
                </div>
              </div>
            </div>
            <n-data-table
              v-if="Array.isArray(providers) && providers.length"
              :columns="providerColumns"
              :data="providers"
              :bordered="false"
              :row-key="rowKeyFn"
            />
            <div v-else style="margin-top: 1rem; opacity: 0.7">No providers configured yet.</div>
            <div class="foot">
              Editing <code>config/providers.yaml</code>. Each provider has a channel source and an
              optional EPG URL.
            </div>
          </n-tab-pane>

          <n-tab-pane name="mapping" tab="Mapping">
            <n-space align="center" wrap style="margin-bottom: 0.5rem">
              <n-button type="primary" secondary @click="addMappingRow">Add Mapping</n-button>
              <n-button type="primary" @click="saveMapping" :loading="savingMapping">{{
                savingMapping ? 'Saving...' : 'Save Mapping'
              }}</n-button>
              <n-button @click="reloadChannels" :loading="reloadingChannels"
                >Reload Channels</n-button
              >
            </n-space>
            <n-collapse>
              <n-collapse-item title="Duplicates (click to expand)" name="duplicates">
                <n-space align="center" wrap style="margin-bottom: 0.5rem">
                  <n-button size="small" @click="loadDuplicates" :loading="loadingDuplicates">{{
                    loadingDuplicates ? 'Loading...' : 'Refresh'
                  }}</n-button>
                </n-space>
                <div
                  v-if="
                    duplicates.summary &&
                    (duplicates.summary.duplicateNames > 0 ||
                      duplicates.summary.duplicateTvgIds > 0)
                  "
                >
                  <div style="margin-bottom: 1rem; opacity: 0.9">
                    Found {{ duplicates.summary.duplicateNames }} duplicate names and
                    {{ duplicates.summary.duplicateTvgIds }} duplicate tvg-ids
                  </div>
                  <div v-if="duplicates.byTvgId.length > 0">
                    <h4 style="margin: 0.5rem 0">By TVG-ID:</h4>
                    <div
                      v-for="dup in duplicates.byTvgId"
                      :key="dup.tvgId"
                      style="
                        margin-bottom: 1rem;
                        padding: 0.5rem;
                        background: rgba(255, 255, 255, 0.05);
                        border-radius: 4px;
                      "
                    >
                      <div style="font-weight: 600; margin-bottom: 0.25rem">
                        tvg-id: {{ dup.tvgId }} ({{ dup.count }} channels)
                      </div>
                      <div
                        v-for="(ch, idx) in dup.channels"
                        :key="idx"
                        style="padding-left: 1rem; opacity: 0.8; margin: 0.25rem 0"
                      >
                        • {{ ch.name }} <span style="opacity: 0.6">({{ ch.source }})</span>
                      </div>
                    </div>
                  </div>
                  <div v-if="duplicates.byName.length > 0" style="margin-top: 1rem">
                    <h4 style="margin: 0.5rem 0">By Name:</h4>
                    <div
                      v-for="dup in duplicates.byName"
                      :key="dup.name"
                      style="
                        margin-bottom: 1rem;
                        padding: 0.5rem;
                        background: rgba(255, 255, 255, 0.05);
                        border-radius: 4px;
                      "
                    >
                      <div style="font-weight: 600; margin-bottom: 0.25rem">
                        {{ dup.name }} ({{ dup.count }} channels)
                      </div>
                      <div
                        v-for="(ch, idx) in dup.channels"
                        :key="idx"
                        style="padding-left: 1rem; opacity: 0.8; margin: 0.25rem 0"
                      >
                        • tvg-id: {{ ch.tvg_id || 'none' }}
                        <span style="opacity: 0.6">({{ ch.source }})</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-else style="opacity: 0.6">No duplicates detected.</div>
              </n-collapse-item>
              <n-collapse-item title="Auto-Suggestions (click to expand)" name="suggestions">
                <n-space align="center" wrap style="margin-bottom: 0.5rem">
                  <n-button size="small" @click="loadSuggestions" :loading="loadingSuggestions">{{
                    loadingSuggestions ? 'Loading...' : 'Refresh'
                  }}</n-button>
                </n-space>
                <div v-if="Array.isArray(suggestions) && suggestions.length">
                  <div
                    v-for="(s, i) in suggestions"
                    :key="'s' + i"
                    style="
                      margin-bottom: 1rem;
                      padding: 0.5rem;
                      background: rgba(255, 255, 255, 0.05);
                      border-radius: 4px;
                    "
                  >
                    <div style="font-weight: 600; margin-bottom: 0.5rem">
                      {{ s.channel.name }}
                      <span style="opacity: 0.6">({{ s.channel.tvg_id }})</span>
                    </div>
                    <div
                      v-for="(sug, j) in s.suggestions"
                      :key="'sg' + j"
                      style="
                        display: flex;
                        gap: 0.5rem;
                        align-items: center;
                        margin: 0.25rem 0;
                        padding-left: 1rem;
                      "
                    >
                      <div style="flex: 1 1 auto; opacity: 0.9">
                        → {{ sug.name }} <span style="opacity: 0.6">({{ sug.tvg_id }})</span>
                        <span style="opacity: 0.5; margin-left: 0.5rem"
                          >score: {{ (sug.score * 100).toFixed(0) }}%</span
                        >
                      </div>
                      <n-button size="tiny" @click="applySuggestion(s.channel, sug)"
                        >Apply</n-button
                      >
                    </div>
                  </div>
                </div>
                <div v-else style="opacity: 0.6">
                  No suggestions available. Try lowering the threshold or ensure you have unmapped
                  channels.
                </div>
              </n-collapse-item>
              <n-collapse-item title="Unmapped (click to expand)" name="unmapped">
                <n-space align="center" wrap style="margin-bottom: 0.5rem">
                  <n-select
                    style="min-width: 220px"
                    clearable
                    placeholder="Filter by source"
                    :options="providers.map(s => ({ label: s.name, value: s.name }))"
                    v-model:value="unmappedSource"
                  />
                  <div style="display: flex; align-items: center; gap: 0.5rem">
                    <n-switch v-model:value="hideAdded" />
                    <span style="opacity: 0.8">Hide ones already added</span>
                  </div>
                  <n-button size="small" @click="refreshUnmapped">Refresh</n-button>
                </n-space>
                <div v-if="Array.isArray(unmapped) && unmapped.length">
                  <n-space vertical>
                    <div
                      v-for="(s, i) in unmapped"
                      :key="'u' + i"
                      style="display: flex; gap: 0.5rem; align-items: center"
                    >
                      <n-button size="small" @click="quickAddMapping(s)">Add</n-button>
                      <div style="flex: 1 1 auto; opacity: 0.9">
                        {{ s.name }}
                        <span v-if="s.tvg_id" style="opacity: 0.6">({{ s.tvg_id }})</span>
                        <span v-if="s.source" style="opacity: 0.5; margin-left: 0.5rem"
                          >— {{ s.source }}</span
                        >
                      </div>
                    </div>
                  </n-space>
                </div>
                <div v-else style="opacity: 0.6">No unmapped items detected.</div>
              </n-collapse-item>
            </n-collapse>
            <n-data-table
              v-if="Array.isArray(mappingRows) && mappingRows.length"
              :columns="mappingColumns"
              :data="sortedMappingRows"
              :bordered="false"
              :row-key="rowKeyFn"
            />
            <div v-else style="margin-top: 1rem; opacity: 0.7">
              No mappings yet. Add one to map EPG names to tvg-id and numbers.
            </div>
            <div class="foot">
              Editing <code>config/channel-map.yaml</code>. Save and then reload channels to apply.
            </div>
          </n-tab-pane>
          <n-tab-pane name="preview" tab="Preview">
            <n-space align="center" wrap style="margin-bottom: 0.75rem">
              <n-input
                v-model:value="previewSearch"
                placeholder="Search channels by name, group, or tvg-id…"
                clearable
                style="min-width: 260px"
              />
              <n-button @click="loadPreviewChannels" :loading="loadingPreviewChannels">{{
                loadingPreviewChannels ? 'Loading…' : 'Refresh'
              }}</n-button>
              <span style="opacity: 0.6; font-size: 0.9em"
                >{{ filteredPreviewChannels.length }} channel{{
                  filteredPreviewChannels.length !== 1 ? 's' : ''
                }}</span
              >
            </n-space>
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
              No channels loaded. Check your provider configuration.
            </div>
            <n-data-table
              v-else
              :columns="previewColumns"
              :data="filteredPreviewChannels"
              :bordered="false"
              :row-key="row => row.original_url || `${row.source}|${row.name}|${row.guideNumber}`"
              size="small"
              :max-height="500"
              virtual-scroll
            />
            <div class="foot">
              Mapped channels as they appear in the M3U output. Channel numbers reflect the
              configured mapping. Click <strong>▶ Watch</strong> to preview a stream.
            </div>

            <!-- Video player modal -->
            <n-modal
              v-model:show="showVideoModal"
              preset="card"
              :title="previewWatchingChannel ? previewWatchingChannel.name : 'Watch Channel'"
              style="max-width: 720px; width: 95vw"
              @after-leave="stopVideoPlayer"
            >
              <div v-if="previewWatchingChannel">
                <!-- Logo + player area -->
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
                    <n-button
                      v-if="showTranscodeButton"
                      size="small"
                      type="primary"
                      style="margin-top: 0.25rem"
                      @click="setupTranscodePlayer"
                    >
                      Try Server Transcoding
                    </n-button>
                    <div style="font-size: 0.8em; opacity: 0.7">
                      Try opening the stream URL directly in VLC or another IPTV player.
                    </div>
                  </div>
                </div>

                <!-- Stream URL row -->
                <div
                  style="
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    margin-bottom: 1rem;
                    flex-wrap: wrap;
                  "
                >
                  <span style="opacity: 0.7; font-size: 0.85em; flex-shrink: 0">Stream URL:</span>
                  <code style="font-size: 0.78em; word-break: break-all; flex: 1; opacity: 0.85">{{
                    previewStreamUrl
                  }}</code>
                  <n-button size="tiny" secondary @click="copyStreamUrl">Copy</n-button>
                  <a
                    :href="previewStreamUrl"
                    target="_blank"
                    rel="noopener"
                    style="font-size: 0.8em; opacity: 0.7"
                    >Open ↗</a
                  >
                </div>

                <!-- Player debug panel -->
                <div
                  v-if="state.playerDebug"
                  style="margin-bottom: 1rem; border: 1px solid rgba(255,255,255,0.12); border-radius: 4px; overflow: hidden;"
                >
                  <button
                    type="button"
                    style="width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 0.35rem 0.6rem; background: rgba(255,255,255,0.06); cursor: pointer; user-select: none; border: none; color: inherit; font: inherit; text-align: left;"
                    :aria-expanded="state.showPlayerDebug"
                    @click="state.showPlayerDebug = !state.showPlayerDebug"
                  >
                    <span style="font-size: 0.8em; opacity: 0.75;">
                      🔍 Stream Debug
                      <span
                        v-if="state.playerDebug.playerMode"
                        style="margin-left: 0.5em; opacity: 0.6;"
                      >— player: {{ state.playerDebug.playerMode }}</span>
                    </span>
                    <span style="font-size: 0.75em; opacity: 0.5;">{{ state.showPlayerDebug ? '▲ hide' : '▼ show' }}</span>
                  </button>
                  <div v-if="state.showPlayerDebug" style="padding: 0.5rem 0.6rem; font-size: 0.75em; opacity: 0.85;">
                    <div style="display: grid; grid-template-columns: max-content 1fr; gap: 0.2rem 0.6rem; margin-bottom: 0.5rem;">
                      <span style="opacity: 0.6;">HDHomeRun</span>
                      <span>{{ state.playerDebug.hdhomerun }}</span>
                      <span style="opacity: 0.6;">Player mode</span>
                      <span>{{ state.playerDebug.playerMode ?? '(pending)' }}</span>
                      <span style="opacity: 0.6;">Probe URL</span>
                      <code style="word-break: break-all; font-size: 0.9em;">{{ state.playerDebug.probeUrl }}</code>
                      <span style="opacity: 0.6;">Probe result</span>
                      <code style="word-break: break-all; font-size: 0.9em;">{{ state.playerDebug.probeResult ? JSON.stringify(state.playerDebug.probeResult) : '(pending)' }}</code>
                      <template v-if="state.playerDebug.hlsError">
                        <span style="opacity: 0.6;">HLS.js error</span>
                        <code style="word-break: break-all; font-size: 0.9em;">{{ JSON.stringify(state.playerDebug.hlsError) }}</code>
                      </template>
                    </div>
                    <div style="margin-bottom: 0.4rem; opacity: 0.6; font-size: 0.9em;">Events:</div>
                    <pre style="font-size: 0.85em; line-height: 1.4; max-height: 140px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; background: rgba(0,0,0,0.3); padding: 0.4rem; border-radius: 3px; margin: 0;">{{ state.playerDebug.events.join('\n') }}</pre>
                    <div style="margin-top: 0.5rem;">
                      <n-button size="tiny" secondary @click="copyPlayerDebug">Copy debug info</n-button>
                    </div>
                  </div>
                </div>

                <!-- Guide / EPG -->
                <div style="border-top: 1px solid rgba(255, 255, 255, 0.1); padding-top: 0.75rem">
                  <div style="font-weight: 600; margin-bottom: 0.5rem">Guide</div>
                  <div v-if="loadingGuide" style="opacity: 0.6; font-size: 0.9em">
                    Loading guide data…
                  </div>
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
                        >{{ formatXMLTVTime(prog.start) }}</span
                      >
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
            </n-modal>
          </n-tab-pane>

          <n-tab-pane name="health" tab="Health">
            <n-space align="center" wrap style="margin-bottom: 0.75rem">
              <n-button type="primary" @click="loadHealth" :loading="loadingHealth">{{
                loadingHealth ? 'Loading...' : 'Refresh Status'
              }}</n-button>
              <n-button type="primary" secondary @click="runHealth" :loading="runningHealth">{{
                runningHealth ? 'Running...' : 'Run Health Check'
              }}</n-button>
            </n-space>
            <div v-if="formattedHealthUpdated" style="opacity: 0.75; margin-bottom: 0.5rem">
              Last updated: {{ formattedHealthUpdated }}
            </div>
            <div v-if="healthDetails.length">
              <n-data-table
                :columns="healthColumns"
                :data="healthDetails"
                :bordered="false"
                :row-key="row => row.id"
              />
            </div>
            <div v-else style="opacity: 0.6">No health data yet. Run a health check.</div>
            <div class="foot">
              Channel health statuses are stored in <code>data/lineup_status.json</code>.
            </div>
          </n-tab-pane>
          <n-tab-pane name="usage">
            <template #tab>
              <n-badge :value="activeUsage.length" :show="activeUsage.length > 0" :max="99">
                Usage
              </n-badge>
            </template>
            <n-space align="center" wrap style="margin-bottom: 0.75rem">
              <n-button type="primary" @click="loadUsage" :loading="loadingUsage">{{
                loadingUsage ? 'Loading...' : 'Refresh'
              }}</n-button>
            </n-space>
            <div v-if="activeUsage.length">
              <n-data-table
                :columns="usageColumns"
                :data="activeUsage"
                :bordered="false"
                :row-key="row => row.key"
              />
            </div>
            <div v-else style="opacity: 0.6">No active viewers detected.</div>
            <div class="foot">Active usage is tracked in-memory and refreshed periodically.</div>
          </n-tab-pane>
          <n-tab-pane name="tasks" tab="Tasks">
            <n-space align="center" wrap style="margin-bottom: 0.75rem">
              <n-button type="primary" @click="loadTasks" :loading="loadingTasks">{{
                loadingTasks ? 'Loading...' : 'Refresh'
              }}</n-button>
            </n-space>
            <div v-if="tasks.length">
              <n-data-table
                :columns="taskColumns"
                :data="tasks"
                :bordered="false"
                :row-key="row => row.name"
              />
            </div>
            <div v-else style="opacity: 0.6">No scheduled tasks found.</div>
            <div class="foot">
              Scheduled tasks run automatically. You can also trigger them manually.
            </div>
          </n-tab-pane>
          <n-tab-pane name="backups" tab="Backups">
            <n-space align="center" wrap style="margin-bottom: 0.75rem">
              <n-button type="primary" @click="createBackup" :loading="creatingBackup">{{
                creatingBackup ? 'Creating...' : 'Create Backup'
              }}</n-button>
              <n-button @click="loadBackups" :loading="loadingBackups">{{
                loadingBackups ? 'Loading...' : 'Refresh'
              }}</n-button>
            </n-space>
            <div v-if="backups.length">
              <n-data-table
                :columns="backupColumns"
                :data="backups"
                :bordered="false"
                :row-key="row => row.name"
              />
            </div>
            <div v-else style="opacity: 0.6">
              No backups yet. Click "Create Backup" to save the current config.
            </div>
            <div class="foot">
              Backups are stored in <code>data/backups/</code> and contain all YAML config files.
            </div>
          </n-tab-pane>
        </n-tabs>
      </n-layout-content>
    </n-layout>
  </n-config-provider>
</template>

<script setup>
import { reactive, toRefs, h, watch, computed, ref, nextTick } from 'vue';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import {
  darkTheme,
  NInput,
  NSelect,
  NButton,
  NForm,
  NFormItem,
  NSpace,
  NTabs,
  NTabPane,
  NLayout,
  NLayoutContent,
  NLayoutHeader,
  NConfigProvider,
  NDataTable,
  NCollapse,
  NCollapseItem,
  NSwitch,
  NBadge,
  NModal,
  NTooltip,
  createDiscreteApi,
} from 'naive-ui';
const { message, dialog } = createDiscreteApi(['message', 'dialog']);

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

const state = reactive({
  tab: 'app',
  app: { base_url: '' },
  authConfigured: false,
  showSetupModal: false,
  setupForm: { username: 'admin', password: '', confirm: '' },
  setupError: '',
  savingSetup: false,
  loggingOut: false,
  passwordForm: { current: '', newPass: '', confirm: '' },
  savingPassword: false,
  providers: [],
  mapping: {},
  mappingRows: [],
  candidates: { epgNames: [], tvgIds: [], tvgOptions: [] },
  unmapped: [],
  unmappedSource: '',
  hideAdded: true,
  duplicates: { byName: [], byTvgId: [], summary: {} },
  suggestions: [],
  epgValidation: null,
  loadingDuplicates: false,
  loadingSuggestions: false,
  loadingEPGValidation: false,
  status: '',
  statusOk: true,
  savingProviders: false,
  reloadingChannels: false,
  savingApp: false,
  savingMapping: false,
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

async function loadProviders() {
  try {
    const r = await apiFetch('/api/config/providers');
    const cfg = await r.json();
    state.providers.splice(
      0,
      state.providers.length,
      ...(cfg.providers && Array.isArray(cfg.providers) ? cfg.providers : [])
    );
    state.providers.forEach((p, i) => {
      p.type = p.type ? String(p.type).toLowerCase() : 'm3u';
      p.epg = p.epg || '';
      if (!p._id) p._id = `prov_${Date.now()}_${i}`;
    });
    setStatus('Loaded providers config');
  } catch (e) {
    setStatus('Failed to load providers config: ' + e.message, false);
    message.error(e.message);
  }
}

async function loadMapping() {
  try {
    const [mapRes, candRes, unmappedRes] = await Promise.all([
      apiFetch('/api/config/channel-map'),
      apiFetch('/api/mapping/candidates'),
      apiFetch('/api/mapping/unmapped'),
    ]);
    const map = await mapRes.json();
    const candidates = await candRes.json();
    const unmapped = await unmappedRes.json();
    state.mapping = map || {};
    state.candidates = candidates || { epgNames: [], tvgIds: [], tvgOptions: [] };
    state.unmapped = Array.isArray(unmapped?.suggestions) ? unmapped.suggestions : [];
    // flatten mapping into rows for editing
    state.mappingRows = Object.entries(state.mapping).map(([name, v]) => ({
      name,
      number: v.number || '',
      tvg_id: v.tvg_id || '',
    }));
    setStatus('Loaded mapping');
    // refresh with filters applied
    await refreshUnmapped();
  } catch (e) {
    setStatus('Failed to load mapping: ' + e.message, false);
    message.error(e.message);
  }
}

async function refreshUnmapped() {
  try {
    const url = state.unmappedSource
      ? `/api/mapping/unmapped?source=${encodeURIComponent(state.unmappedSource)}`
      : '/api/mapping/unmapped';
    const r = await apiFetch(url);
    const j = await r.json();
    const list = Array.isArray(j?.suggestions) ? j.suggestions : [];
    const existing = new Set(state.mappingRows.map(r => r.name));
    const filtered = state.hideAdded ? list.filter(s => !existing.has(s.name)) : list;
    // sort by tvg_id (numeric dot notation if possible, else string)
    const isNumericDots = v => typeof v === 'string' && /^\d+(?:\.\d+)*$/.test(v);
    const cmpTvg = (a, b) => {
      const av = a?.tvg_id || '';
      const bv = b?.tvg_id || '';
      if (isNumericDots(av) && isNumericDots(bv)) {
        const ap = av.split('.').map(Number);
        const bp = bv.split('.').map(Number);
        const len = Math.max(ap.length, bp.length);
        for (let i = 0; i < len; i++) {
          const ai = ap[i] ?? 0;
          const bi = bp[i] ?? 0;
          if (ai !== bi) return ai - bi;
        }
        return 0;
      }
      // Empty tvg_id to the end
      if (!av && bv) return 1;
      if (!bv && av) return -1;
      return String(av).localeCompare(String(bv));
    };
    state.unmapped = filtered.slice().sort(cmpTvg);
  } catch (_) {
    /* ignore refresh errors */
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
    if (!r.ok) throw new Error(j.error || 'Save providers failed');
    setStatus('Providers saved. Reloading...');
    message.success('Providers saved');
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
    // Refresh mapping data after channels reload
    await loadMapping();
    message.success('Mapping updated with new channels');
  } catch (e) {
    setStatus(e.message, false);
  } finally {
    state.reloadingChannels = false;
  }
}

async function reloadEPG() {
  try {
    const r = await apiFetch('/api/reload/epg', { method: 'POST' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Reload EPG failed');
    setStatus('EPG reloaded.');
  } catch (e) {
    setStatus(e.message, false);
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

async function saveMapping() {
  try {
    state.savingMapping = true;
    // build object back from rows
    const obj = {};
    for (const row of state.mappingRows) {
      if (!row.name) continue;
      // Start from the full existing entry to preserve fields not editable in the UI
      // (e.g. name override, logo, url, group set directly in channel-map.yaml).
      const existing = state.mapping[row.name] || {};
      const merged = { ...existing };
      // Apply the editable fields; remove them when blank so Joi rejects empty strings.
      if (row.number) {
        merged.number = String(row.number);
      } else {
        delete merged.number;
      }
      if (row.tvg_id) {
        merged.tvg_id = String(row.tvg_id);
      } else {
        delete merged.tvg_id;
      }
      // Strip any remaining empty-string values defensively.
      for (const k of Object.keys(merged)) {
        if (merged[k] === '') delete merged[k];
      }
      if (Object.keys(merged).length === 0) continue;
      obj[row.name] = merged;
    }
    const r = await apiFetch('/api/config/channel-map', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obj),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Save mapping failed');
    setStatus('Mapping saved. Reload channels to apply.');
    message.success('Mapping saved');
  } catch (e) {
    setStatus(e.message, false);
    message.error(e.message);
  } finally {
    state.savingMapping = false;
  }
}

function addProvider() {
  state.providers.push({
    _id: `prov_${Date.now()}_${Math.random()}`,
    name: '',
    type: 'm3u',
    url: '',
    epg: '',
  });
}
function removeProvider(i) {
  state.providers.splice(i, 1);
}

function addMappingRow() {
  state.mappingRows.push({ name: '', number: '', tvg_id: '' });
}
function removeMappingRow(i) {
  state.mappingRows.splice(i, 1);
}

function quickAddMapping(s) {
  if (!s) return;
  // Avoid duplicates by name
  if (!state.mappingRows.some(r => r.name === s.name)) {
    state.mappingRows.push({ name: s.name || '', tvg_id: s.tvg_id || '', number: '' });
  }
  // remove from unmapped when added
  const idx = state.unmapped.findIndex(
    x => x && x.name === s.name && (x.tvg_id || '') === (s.tvg_id || '')
  );
  if (idx >= 0) state.unmapped.splice(idx, 1);
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

async function loadDuplicates() {
  try {
    state.loadingDuplicates = true;
    const r = await apiFetch('/api/mapping/duplicates');
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Failed to load duplicates');
    state.duplicates = j;
  } catch (e) {
    setStatus(e.message, false);
    message.error(e.message);
  } finally {
    state.loadingDuplicates = false;
  }
}

async function loadSuggestions() {
  try {
    state.loadingSuggestions = true;
    const r = await apiFetch('/api/mapping/suggestions?threshold=0.7&max=3');
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Failed to load suggestions');
    state.suggestions = j.suggestions || [];
  } catch (e) {
    setStatus(e.message, false);
    message.error(e.message);
  } finally {
    state.loadingSuggestions = false;
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

function applySuggestion(channel, suggestion) {
  // Add mapping based on suggestion
  if (!state.mappingRows.some(r => r.name === channel.name)) {
    state.mappingRows.push({
      name: channel.name,
      tvg_id: suggestion.tvg_id || '',
      number: '',
    });
    message.success(`Added mapping for ${channel.name}`);
  }
}

async function checkAuthStatus() {
  try {
    const r = await fetch('/api/auth/status');
    const j = await r.json();
    state.authConfigured = !!j.configured;
    state.showSetupModal = !j.configured;
    // Fetch the CSRF token once we know auth is configured (requires a valid session)
    if (j.configured) {
      await fetchCsrfToken();
    }
  } catch (e) {
    // If status check fails, assume auth may be configured; don't force modal,
    // but surface an error so the user/admin knows something went wrong.
    state.authConfigured = true;
    state.showSetupModal = false;
    if (e && e.message) {
      message.error(e.message);
    } else {
      message.error('Failed to check authentication status.');
    }
  }
}

async function logout() {
  state.loggingOut = true;
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch (_) {
    /* ignore logout errors */
  }
  window.location.href = '/admin/login';
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
  const confirmed = await new Promise(resolve => {
    let resolved = false;
    const safeResolve = value => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };
    dialog.warning({
      title: 'Restore Backup',
      content: `Restore config from "${formatBackupTimestamp(name) || name}"? This will overwrite your current configuration files.`,
      positiveText: 'Restore',
      negativeText: 'Cancel',
      maskClosable: false,
      closeOnEsc: false,
      closable: false,
      onPositiveClick: () => safeResolve(true),
      onNegativeClick: () => safeResolve(false),
      onClose: () => safeResolve(false),
      onMaskClick: () => safeResolve(false),
      onEsc: () => safeResolve(false),
    });
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
  const confirmed = await new Promise(resolve => {
    let resolved = false;
    const safeResolve = value => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };
    dialog.error({
      title: 'Delete Backup',
      content: `Delete backup "${formatBackupTimestamp(name) || name}"? This cannot be undone.`,
      positiveText: 'Delete',
      negativeText: 'Cancel',
      maskClosable: false,
      closeOnEsc: false,
      closable: false,
      onPositiveClick: () => safeResolve(true),
      onNegativeClick: () => safeResolve(false),
      onClose: () => safeResolve(false),
      onMaskClick: () => safeResolve(false),
      onEsc: () => safeResolve(false),
    });
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

// ─── Preview tab ─────────────────────────────────────────────────────────────

async function loadPreviewChannels() {
  try {
    state.loadingPreviewChannels = true;
    const r = await apiFetch('/channels?mapped_only=true');
    const channels = await r.json();
    state.previewChannels = Array.isArray(channels) ? channels : [];
  } catch (e) {
    message.error('Failed to load channels: ' + e.message);
  } finally {
    state.loadingPreviewChannels = false;
  }
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
const ERR_STREAM_UNAVAILABLE =
  'Stream unavailable. The channel may be offline or unreachable.';
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
          err,
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
        dbgEvent('probe pre-empt: incompatible mpeg-ts — destroying current player, switching to transcode');
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
            err,
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
watch(
  () => state.tab,
  newTab => {
    if (newTab === 'preview' && !_previewLoaded) {
      _previewLoaded = true;
      loadPreviewChannels();
    }
  }
);

// Initial loads
checkAuthStatus();
loadProviders();
loadApp();
loadMapping();
loadHealth();
loadUsage();
loadTasks();
loadBackups();
// poll usage every 5s
setInterval(() => {
  loadUsage();
}, 5000);
// keep unmapped list in sync when filters or rows change
watch(
  () => state.unmappedSource,
  () => {
    refreshUnmapped();
  }
);
watch(
  () => state.hideAdded,
  () => {
    refreshUnmapped();
  }
);
watch(
  () => state.mappingRows.map(r => r.name),
  () => {
    if (state.hideAdded) refreshUnmapped();
  }
);

// Expose reactive fields directly in template
const {
  tab,
  app,
  authConfigured,
  showSetupModal,
  setupForm,
  setupError,
  savingSetup,
  loggingOut,
  passwordForm,
  savingPassword,
  providers,
  mappingRows,
  unmapped,
  unmappedSource,
  hideAdded,
  duplicates,
  suggestions,
  epgValidation,
  loadingDuplicates,
  loadingSuggestions,
  loadingEPGValidation,
  health,
  loadingHealth,
  runningHealth,
  savingProviders,
  reloadingChannels,
  savingApp,
  savingMapping,
  activeUsage,
  loadingUsage,
  tasks,
  loadingTasks,
  backups,
  loadingBackups,
  creatingBackup,
  previewChannels,
  loadingPreviewChannels,
  previewSearch,
  previewWatchingChannel,
  showVideoModal,
  previewGuide,
  loadingGuide,
} = toRefs(state);

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
  { title: 'Channel ID', key: 'id' },
  {
    title: 'Status',
    key: 'status',
    render(row) {
      return h(
        'span',
        { style: `font-weight:600;color:${row.status === 'online' ? '#21c35b' : '#d9534f'}` },
        row.status
      );
    },
  },
  { title: 'Latency (ms)', key: 'ms' },
  { title: 'Content-Type', key: 'contentType' },
  { title: 'Error', key: 'error' },
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
  { title: 'IP', key: 'ip' },
  { title: 'Channel ID', key: 'channelId' },
  { title: 'Name', key: 'name' },
  { title: 'tvg-id', key: 'tvg_id' },
  {
    title: 'Client',
    key: 'client',
    render(row) {
      const label = row.client || h('span', { style: 'opacity:.5' }, '—');
      if (!row.userAgent) return label;
      return h(NTooltip, null, {
        trigger: () =>
          h('span', { style: 'cursor:default;border-bottom:1px dotted currentColor' }, label),
        default: () => h('span', { style: 'font-size:.8em;word-break:break-all' }, row.userAgent),
      });
    },
  },
  { title: 'Started', key: 'startedAt' },
  { title: 'Last Seen', key: 'lastSeenAt' },
];

const taskColumns = [
  { title: 'Task Name', key: 'name' },
  {
    title: 'Schedule',
    key: 'schedule',
    render(row) {
      return h('code', { style: 'font-size:.85em;opacity:.8' }, row.schedule);
    },
  },
  {
    title: 'Status',
    key: 'status',
    render(row) {
      if (row.isRunning || state.runningTask === row.name)
        return h('span', { style: 'color:#f0a020;font-weight:600' }, '⏳ Running');
      if (!row.lastStatus) return h('span', { style: 'opacity:.6' }, '—');
      const color = row.lastStatus === 'success' ? '#21c35b' : '#d9534f';
      const icon = row.lastStatus === 'success' ? '✓' : '✗';
      return h('span', { style: `color:${color};font-weight:600` }, `${icon} ${row.lastStatus}`);
    },
  },
  {
    title: 'Last Run',
    key: 'lastRun',
    render(row) {
      if (!row.lastRun) return h('span', { style: 'opacity:.6' }, 'Never');
      return new Date(row.lastRun).toLocaleString();
    },
  },
  {
    title: 'Duration',
    key: 'lastDuration',
    render(row) {
      if (row.lastDuration == null) return h('span', { style: 'opacity:.6' }, '—');
      return `${row.lastDuration}ms`;
    },
  },
  {
    title: 'Actions',
    key: 'actions',
    render(row) {
      return h(
        NButton,
        {
          type: 'primary',
          size: 'small',
          secondary: true,
          disabled: row.isRunning || state.runningTask === row.name,
          loading: state.runningTask === row.name,
          onClick: () => runTask(row.name),
        },
        { default: () => (row.isRunning ? 'Running...' : 'Run Now') }
      );
    },
  },
];

const providerColumns = [
  {
    title: 'Name',
    key: 'name',
    render(row) {
      return h(NInput, { value: row?.name ?? '', onUpdateValue: v => (row.name = v) });
    },
  },
  {
    title: 'Type',
    key: 'type',
    render(row) {
      return h(NSelect, {
        value: row?.type ?? 'm3u',
        options: [
          { label: 'M3U', value: 'm3u' },
          { label: 'HDHomeRun', value: 'hdhomerun' },
        ],
        onUpdateValue: v => (row.type = v),
      });
    },
  },
  {
    title: 'Channel URL',
    key: 'url',
    render(row) {
      return h(NInput, { value: row?.url ?? '', onUpdateValue: v => (row.url = v) });
    },
  },
  {
    title: 'EPG URL (optional)',
    key: 'epg',
    render(row) {
      return h(NInput, {
        value: row?.epg ?? '',
        placeholder: 'https://...epg.xml (optional)',
        onUpdateValue: v => (row.epg = v),
      });
    },
  },
  {
    title: 'Remove',
    key: 'remove',
    render(row) {
      return h(
        NButton,
        {
          type: 'error',
          size: 'small',
          onClick: () => removeProvider(providers.value.indexOf(row)),
        },
        { default: () => '✕' }
      );
    },
  },
];

function rowKeyFn(row) {
  // Use stable _id if available, otherwise generate a fallback
  if (row?._id) return row._id;
  return (row?.name || '') + '|' + (row?.url ?? row?.tvg_id ?? '');
}

const mappingColumns = [
  {
    title: 'EPG Channel',
    key: 'name',
    render(row) {
      return h(NSelect, {
        filterable: true,
        options: state.candidates.epgNames.map(n => ({ label: n, value: n })),
        value: row?.name ?? '',
        onUpdateValue: v => (row.name = v),
      });
    },
  },
  {
    title: 'M3U Channel',
    key: 'tvg_id',
    render(row) {
      return h(NSelect, {
        filterable: true,
        options: state.candidates.tvgOptions || [],
        value: row?.tvg_id ?? '',
        onUpdateValue: v => (row.tvg_id = v),
        placeholder: 'Select M3U channel...',
      });
    },
  },
  {
    title: 'Channel Number',
    key: 'number',
    render(row) {
      return h(NInput, {
        defaultValue: row?.number ?? '',
        onBlur: e => {
          row.number = e.target.value;
        },
        placeholder: 'e.g. 101',
      });
    },
  },
  {
    title: 'Remove',
    key: 'remove',
    render(row) {
      return h(
        NButton,
        {
          type: 'error',
          size: 'small',
          onClick: () => removeMappingRow(state.mappingRows.indexOf(row)),
        },
        { default: () => '✕' }
      );
    },
  },
];

// display mapping rows sorted by channel number
const sortedMappingRows = computed(() => {
  const num = v => {
    const n = parseFloat(String(v ?? '').trim());
    return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
  };
  return state.mappingRows.slice().sort((a, b) => num(a.number) - num(b.number));
});

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
    title: 'Backup',
    key: 'name',
    render(row) {
      const ts = formatBackupTimestamp(row.name);
      return h('code', { style: 'font-size:.85em' }, ts || row.name);
    },
  },
  {
    title: 'Actions',
    key: 'actions',
    render(row) {
      return h(
        NSpace,
        { align: 'center' },
        {
          default: () => [
            h(
              NButton,
              {
                size: 'small',
                secondary: true,
                loading: state.restoringBackup === row.name,
                disabled: !!state.restoringBackup || !!state.deletingBackup,
                onClick: () => restoreBackup(row.name),
              },
              { default: () => (state.restoringBackup === row.name ? 'Restoring...' : 'Restore') }
            ),
            h(
              NButton,
              {
                size: 'small',
                secondary: true,
                onClick: () => downloadBackup(row.name),
              },
              { default: () => 'Download' }
            ),
            h(
              NButton,
              {
                type: 'error',
                size: 'small',
                loading: state.deletingBackup === row.name,
                disabled: !!state.restoringBackup || !!state.deletingBackup,
                onClick: () => deleteBackup(row.name),
              },
              { default: () => '✕' }
            ),
          ],
        }
      );
    },
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

const previewColumns = [
  {
    title: '',
    key: 'logo',
    width: 44,
    render(row) {
      if (!row.logo) return h('span', { style: 'opacity:.25;font-size:1.3em;line-height:1' }, '📺');
      return h('img', {
        src: row.logo,
        style: 'width:32px;height:32px;object-fit:contain;vertical-align:middle;border-radius:2px;',
        onerror: e => {
          e.target.style.display = 'none';
        },
      });
    },
  },
  {
    title: 'Ch #',
    key: 'guideNumber',
    width: 68,
    sorter: (a, b) => {
      const n = v => {
        const x = parseFloat(String(v?.guideNumber ?? ''));
        return Number.isFinite(x) ? x : 99999;
      };
      return n(a) - n(b);
    },
    render(row) {
      return h('span', { style: 'opacity:.85' }, row.guideNumber || '—');
    },
  },
  {
    title: 'Name',
    key: 'name',
    sorter: (a, b) => (a.name || '').localeCompare(b.name || ''),
    ellipsis: { tooltip: true },
  },
  {
    title: 'Group',
    key: 'group',
    ellipsis: { tooltip: true },
    render(row) {
      return h('span', { style: 'opacity:.8' }, row.group || '—');
    },
  },
  {
    title: 'Source',
    key: 'source',
    ellipsis: { tooltip: true },
    render(row) {
      return h('span', { style: 'opacity:.7;font-size:.85em' }, row.source || '—');
    },
  },
  {
    title: 'TVG-ID',
    key: 'tvg_id',
    ellipsis: { tooltip: true },
    render(row) {
      return h('code', { style: 'font-size:.78em;opacity:.75' }, row.tvg_id || '—');
    },
  },
  {
    title: '',
    key: 'actions',
    width: 90,
    render(row) {
      return h(
        NButton,
        {
          size: 'small',
          secondary: true,
          type: 'primary',
          onClick: () => watchChannel(row),
        },
        { default: () => '▶ Watch' }
      );
    },
  },
];
</script>

<style>
.foot {
  margin-top: 1rem;
  font-size: 0.75rem;
  opacity: 0.7;
}
html,
body,
#app {
  height: 100%;
  margin: 0;
}
n-layout {
  min-height: 100%;
}
n-layout-content {
  flex: 1;
  display: block;
}
body {
  background: #111;
}
</style>
