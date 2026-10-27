import { createApp } from 'vue';
import App from './App.vue';
import 'cindor-ui-core/register';
import 'cindor-ui-core/styles.css';

document.documentElement.setAttribute('data-theme', 'dark');

createApp(App).mount('#app');
