<template>
  <div class="tab-panel">
    <n-form label-placement="left" label-width="120">
      <n-form-item label="Base URL">
        <n-input v-model:value="appBaseUrl" placeholder="https://example.com" />
      </n-form-item>
      <n-space>
        <n-button type="primary" @click="saveApp" :loading="savingApp">
{{
          savingApp ? 'Saving...' : 'Save App'
        }}
</n-button>
      </n-space>
    </n-form>
    <div class="foot">
      Used for absolute URL generation behind proxies and external clients.
    </div>

    <div v-if="authConfigured" style="margin-top: 2rem">
      <h3 style="margin-bottom: 0.75rem">Security</h3>
      <n-form label-placement="left" label-width="160" style="max-width: 520px">
        <n-form-item label="Current Password">
          <n-input
            v-model:value="passwordCurrent"
            type="password"
            show-password-on="click"
            placeholder="Enter current password"
            :disabled="savingPassword"
          />
        </n-form-item>
        <n-form-item label="New Password">
          <n-input
            v-model:value="passwordNew"
            type="password"
            show-password-on="click"
            placeholder="Min. 8 characters"
            :disabled="savingPassword"
          />
        </n-form-item>
        <n-form-item label="Confirm New Password">
          <n-input
            v-model:value="passwordConfirm"
            type="password"
            show-password-on="click"
            placeholder="Repeat new password"
            :disabled="savingPassword"
          />
        </n-form-item>
        <n-form-item>
          <n-button type="primary" :loading="savingPassword" @click="changePassword">
{{
            savingPassword ? 'Saving...' : 'Change Password'
          }}
</n-button>
        </n-form-item>
      </n-form>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { NButton, NForm, NFormItem, NInput, NSpace } from 'naive-ui';

const props = defineProps({
  appBaseUrl: { type: String, required: true },
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
  'update:password-current',
  'update:password-new',
  'update:password-confirm',
]);

const appBaseUrl = computed({
  get: () => props.appBaseUrl,
  set: value => emit('update:app-base-url', value),
});

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
</script>

<style scoped>
.tab-panel {
  padding: 28px 32px 32px;
}

@media (max-width: 900px) {
  .tab-panel {
    padding: 20px 20px 20px;
  }
}
</style>
