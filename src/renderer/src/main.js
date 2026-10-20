import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { vTip } from './lib/tip'
import './assets/calm-admin-tokens.css'
import './assets/global.css'

createApp(App).use(router).directive('tip', vTip).mount('#app')
