import { createApp } from 'vue';
import App from './App.vue';
import naive from 'naive-ui';
import 'emberline-design-system/emberline.css';

document.documentElement.setAttribute('data-theme', 'dark');

createApp(App).use(naive).mount('#app');
