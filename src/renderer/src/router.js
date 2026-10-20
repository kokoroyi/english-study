import { createRouter, createWebHashHistory } from 'vue-router'
import Dashboard from './views/Dashboard.vue'
import Reading from './views/Reading.vue'
import Vocabulary from './views/Vocabulary.vue'
import Grammar from './views/Grammar.vue'
import Articles from './views/Articles.vue'
import Settings from './views/Settings.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', name: 'dashboard', component: Dashboard },
    { path: '/reading', name: 'reading', component: Reading },
    { path: '/vocabulary', name: 'vocabulary', component: Vocabulary },
    { path: '/grammar', name: 'grammar', component: Grammar },
    { path: '/articles', name: 'articles', component: Articles },
    { path: '/settings', name: 'settings', component: Settings }
  ]
})
