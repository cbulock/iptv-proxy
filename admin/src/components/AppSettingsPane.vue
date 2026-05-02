<template>
  <div class="tab-panel">
    <CindorForm>
      <CindorFormField label="Base URL">
        <CindorInput v-model="appBaseUrl" placeholder="https://example.com" />
      </CindorFormField>
      <CindorStack direction="horizontal" gap="sm">
        <CindorButton :disabled="savingApp" @click="saveApp">
          {{ savingApp ? 'Saving...' : 'Save App' }}
        </CindorButton>
      </CindorStack>
    </CindorForm>
    <div class="foot">
      Used for absolute URL generation behind proxies and external clients.
    </div>

    <div v-if="authConfigured" style="margin-top: 2rem">
      <h3 style="margin-bottom: 0.75rem">Security</h3>
      <CindorForm style="max-width: 520px">
        <CindorFormField label="Current Password">
          <CindorPasswordInput
            v-model="passwordCurrent"
            placeholder="Enter current password"
            :disabled="savingPassword"
          />
        </CindorFormField>
        <CindorFormField label="New Password">
          <CindorPasswordInput
            v-model="passwordNew"
            placeholder="Min. 8 characters"
            :disabled="savingPassword"
          />
        </CindorFormField>
        <CindorFormField label="Confirm New Password">
          <CindorPasswordInput
            v-model="passwordConfirm"
            placeholder="Repeat new password"
            :disabled="savingPassword"
          />
        </CindorFormField>
        <CindorStack direction="horizontal" gap="sm">
          <CindorButton :disabled="savingPassword" @click="changePassword">
            {{ savingPassword ? 'Saving...' : 'Change Password' }}
          </CindorButton>
        </CindorStack>
      </CindorForm>
    </div>
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
} from 'cindor-ui-vue';

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
