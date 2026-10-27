export default defineNuxtConfig({
  compatibilityDate: '2026-10-23',
  devtools: { enabled: false },
  css: ['cindor-ui-core/styles.css','@fontsource/dm-sans/400.css','@fontsource/dm-sans/500.css','@fontsource/dm-sans/600.css','@fontsource/dm-sans/700.css','~/assets/main.css'],
  typescript: { strict: true },
  nitro: { externals: { external: ['node:sqlite'] } },
  app: { head: { title: 'Bulock Media', meta: [{name:'description',content:'Your movies, shows, and live TV. A good night in.'}], link:[{rel:'icon',href:'/favicon.svg',type:'image/svg+xml'}] } },
  routeRules: { '/api/**': { headers: {'Cache-Control':'no-store'} } }
});
