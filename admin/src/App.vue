<template>
  <n-config-provider :theme="darkTheme">
    <n-layout>
      <n-layout-header bordered style="padding:1rem;display:flex;align-items:center;gap:1rem;">
        <h1 style="margin:0;font-size:1.2rem;">IPTV Proxy Admin</h1>
      </n-layout-header>
      <n-layout-content style="padding:1rem;">
  <n-tabs v-model:value="tab" type="line" animated>
          <n-tab-pane name="app" tab="App">
            <n-alert v-if="status" :type="statusOk ? 'success' : 'error'" :title="statusOk ? 'OK' : 'Error'" style="margin:.75rem 0;">{{ status }}</n-alert>
            <n-form label-placement="left" label-width="120">
              <n-form-item label="Base URL">
                <n-input v-model:value="app.base_url" placeholder="https://example.com" />
              </n-form-item>
              <n-space>
                <n-button type="primary" @click="saveApp" :loading="savingApp">{{ savingApp ? 'Saving...' : 'Save App' }}</n-button>
              </n-space>
            </n-form>
            <div class="foot">Editing <code>config/app.yaml</code>. Used for absolute URL generation behind proxies.</div>
          </n-tab-pane>

          <n-tab-pane name="channels" tab="Channels">
            <n-alert v-if="status" :type="statusOk ? 'success' : 'error'" :title="statusOk ? 'OK' : 'Error'" style="margin:.75rem 0;">{{ status }}</n-alert>
            <n-space align="center" wrap style="margin-bottom:.5rem;">
              <n-button type="primary" secondary @click="addSource">Add Source</n-button>
              <n-button type="primary" @click="saveChannels" :loading="savingChannels">{{ savingChannels ? 'Saving...' : 'Save Channels' }}</n-button>
            </n-space>
            <n-data-table
              v-if="channelSources.length"
              :columns="channelColumns"
              :data="channelSources"
              :bordered="false"
              :row-key="rowKeyFn"
            />
            <div v-else style="margin-top:1rem; opacity:.7">No channel sources configured yet.</div>
            <div class="foot">Editing <code>config/m3u.yaml</code>. Changes require channel reload.</div>
          </n-tab-pane>

          <n-tab-pane name="epg" tab="EPG">
            <n-alert v-if="status" :type="statusOk ? 'success' : 'error'" :title="statusOk ? 'OK' : 'Error'" style="margin:.75rem 0;">{{ status }}</n-alert>
            <n-space align="center" wrap style="margin-bottom:.5rem;">
              <n-button type="primary" secondary @click="addEPGSource">Add EPG Source</n-button>
              <n-button type="primary" @click="saveEPG" :loading="savingEPG">{{ savingEPG ? 'Saving...' : 'Save EPG' }}</n-button>
            </n-space>
            <n-data-table
              v-if="epgSources.length"
              :columns="epgColumns"
              :data="epgSources"
              :bordered="false"
              :row-key="rowKeyFn"
            />
            <div v-else style="margin-top:1rem; opacity:.7">No EPG sources configured yet.</div>
            <div class="foot">Editing <code>config/epg.yaml</code>. Changes require EPG reload.</div>
          </n-tab-pane>
        </n-tabs>
      </n-layout-content>
    </n-layout>
  </n-config-provider>
</template>

<script setup>
import { reactive, toRefs, h } from 'vue';
import { darkTheme, NInput, NSelect, NButton, NAlert, NForm, NFormItem, NSpace, NTabs, NTabPane, NLayout, NLayoutContent, NLayoutHeader, NConfigProvider, NDataTable } from 'naive-ui';

const state = reactive({
  tab: 'app',
  app: { base_url: '' },
  channelSources: [],
  epgSources: [],
  status: '',
  statusOk: true,
  savingChannels: false,
  reloadingChannels: false,
  savingEPG: false,
  reloadingEPG: false,
  savingApp: false
});

function setStatus(msg, ok = true) {
  state.status = msg;
  state.statusOk = ok;
}

async function loadChannels() {
  try {
    const r = await fetch("/api/config/m3u");
    const cfg = await r.json();
    state.channelSources.splice(
      0,
      state.channelSources.length,
      ...(cfg.urls && Array.isArray(cfg.urls) ? cfg.urls : [])
    );
    state.channelSources.forEach(s => { s.type = s.type ? String(s.type).toLowerCase() : 'm3u'; });
    setStatus('Loaded channel config');
  } catch (e) {
    setStatus("Failed to load config: " + e.message, false);
  }
}

async function loadEPG() {
  try {
    const r = await fetch('/api/config/epg');
    const cfg = await r.json();
    state.epgSources.splice(0, state.epgSources.length, ...(cfg.urls && Array.isArray(cfg.urls) ? cfg.urls : []));
    setStatus('Loaded EPG config');
  } catch (e) {
    setStatus('Failed to load EPG config: ' + e.message, false);
  }
}

async function loadApp() {
  try {
    const r = await fetch('/api/config/app');
    const cfg = await r.json();
    state.app = { base_url: cfg.base_url || '' };
  } catch (e) {
    setStatus('Failed to load app config: ' + e.message, false);
  }
}

async function saveChannels() {
  try {
  state.savingChannels = true;
  const cleaned = state.channelSources
      .filter((u) => u.name && u.url)
      .map(u => ({ ...u, type: u.type ? String(u.type).toLowerCase() : 'm3u' }));
    const body = { urls: cleaned };
    const r = await fetch("/api/config/m3u", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Save channels failed");
  setStatus("Channels saved. Reload channels to apply.");
  } catch (e) {
    setStatus(e.message, false);
  } finally {
  state.savingChannels = false;
  }
}

async function reloadChannels() {
  try {
    state.reloadingChannels = true;
    setStatus("Reloading channels...");
    const r = await fetch("/api/reload/channels", { method: "POST" });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Reload failed");
    setStatus(`Reloaded ${j.channels} channels.`);
  } catch (e) {
    setStatus(e.message, false);
  } finally {
    state.reloadingChannels = false;
  }
}

async function saveEPG() {
  try {
    state.savingEPG = true;
    const cleaned = state.epgSources.filter(u => u.name && u.url);
    const body = { urls: cleaned };
    const r = await fetch('/api/config/epg', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Save EPG failed');
    setStatus('EPG saved. Reload EPG to apply.');
  } catch (e) {
    setStatus(e.message, false);
  } finally {
    state.savingEPG = false;
  }
}

async function reloadEPG() {
  try {
    state.reloadingEPG = true;
    setStatus('Reloading EPG...');
    const r = await fetch('/api/reload/epg', { method: 'POST' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Reload EPG failed');
    setStatus('EPG reloaded.');
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
    const r = await fetch('/api/config/app', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Save app failed');
    setStatus('App settings saved.');
  } catch (e) {
    setStatus(e.message, false);
  } finally {
    state.savingApp = false;
  }
}

function addSource() { addChannelSource(); }
function addChannelSource() {
  state.channelSources.push({ name: '', type: 'm3u', url: '' });
}
function removeChannelSource(i) { state.channelSources.splice(i,1); }

function addEPGSource() { state.epgSources.push({ name: '', url: '' }); }
function removeEPGSource(i) { state.epgSources.splice(i,1); }

// Initial loads
loadChannels();
loadEPG();
loadApp();

// Expose reactive fields directly in template
const { tab, app, channelSources, epgSources, status, statusOk, savingChannels, reloadingChannels, savingEPG, reloadingEPG, savingApp } = toRefs(state);

function rowKey(row) { return row.name + row.url; }

const channelColumns = [
  { title: 'Name', key: 'name', render(row) { return h(NInput, { value: row?.name ?? '', onUpdateValue: v => row.name = v }); } },
  { title: 'Type', key: 'type', render(row) { return h(NSelect, { value: row?.type ?? 'm3u', options: [ {label:'M3U', value:'m3u'}, {label:'HDHomeRun', value:'hdhomerun'} ], onUpdateValue: v => row.type = v }); } },
  { title: 'URL', key: 'url', render(row) { return h(NInput, { value: row?.url ?? '', onUpdateValue: v => row.url = v }); } },
  { title: 'Remove', key: 'remove', render(row) { return h(NButton, { type:'error', size:'small', onClick: () => removeChannelSource(channelSources.value.indexOf(row)) }, { default: () => '✕' }); } }
];

const epgColumns = [
  { title: 'Name', key: 'name', render(row) { return h(NInput, { value: row?.name ?? '', onUpdateValue: v => row.name = v }); } },
  { title: 'URL', key: 'url', render(row) { return h(NInput, { value: row?.url ?? '', onUpdateValue: v => row.url = v }); } },
  { title: 'Remove', key: 'remove', render(row) { return h(NButton, { type:'error', size:'small', onClick: () => removeEPGSource(epgSources.value.indexOf(row)) }, { default: () => '✕' }); } }
];

function rowKeyFn(row) {
  return (row?.name || '') + '|' + (row?.url || '');
}

// use imported darkTheme directly in template
</script>

<style>
.foot { margin-top: 1rem; font-size: .75rem; opacity:.7; }
html, body, #app { height:100%; margin:0; }
n-layout { min-height:100%; }
n-layout-content { flex:1; display:block; }
body { background:#111; }
</style>
