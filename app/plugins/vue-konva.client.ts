import VueKonva from 'vue-konva'

// Konva needs the DOM/canvas, so it is registered client-side only. Board components must
// therefore render inside <ClientOnly> (or be *.client.vue).
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(VueKonva)
})
