import {
  CindorAccordion,
  CindorAlert,
  CindorButton,
  CindorCard,
  CindorCheckbox,
  CindorInput,
  CindorOtpInput,
  CindorRadio,
  CindorSelect,
  CindorTextarea,
} from 'cindor-ui-vue';

export default defineNuxtPlugin((nuxtApp) => {
  for (const component of [
    CindorAccordion,
    CindorAlert,
    CindorButton,
    CindorCard,
    CindorCheckbox,
    CindorInput,
    CindorOtpInput,
    CindorRadio,
    CindorSelect,
    CindorTextarea,
  ]) {
    nuxtApp.vueApp.component(component.name!, component);
  }
});
