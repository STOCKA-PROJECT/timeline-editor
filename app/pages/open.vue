<script setup lang="ts">
// Handoff entry point. The main Stocka app opens this URL in a new window with a one-time ticket;
// we exchange it for a session (cookies set by our BFF) and redirect into the editor.
const route = useRoute()
const auth = useAuthStore()
const config = useRuntimeConfig()
const stockaUrl = config.public.stockaUrl as string

const status = ref<'working' | 'error'>('working')
const message = ref('Conectando con tu sesión…')

onMounted(async () => {
  const ticket = typeof route.query.ticket === 'string' ? route.query.ticket : null
  const org = typeof route.query.org === 'string' ? route.query.org : null
  const timeline = typeof route.query.timeline === 'string' ? route.query.timeline : null

  if (!ticket || !org || !timeline) {
    status.value = 'error'
    message.value = 'Falta información para abrir el editor. Vuelve a abrirlo desde Stocka.'
    return
  }

  try {
    await auth.exchangeTicket(ticket)
    await navigateTo(`/${org}/timelines/${timeline}`)
  } catch {
    status.value = 'error'
    message.value = 'El enlace de acceso ha caducado o no es válido. Vuelve a abrir el editor desde Stocka.'
  }
})
</script>

<template>
  <div class="panel max-w-md p-6 text-center">
    <h1 class="text-[18px] font-semibold text-ink">Stocka · Timeline Editor</h1>
    <p class="mt-3 text-[13.5px]" :class="status === 'error' ? 'text-danger' : 'text-ink-soft'">
      {{ message }}
    </p>
    <a v-if="status === 'error'" :href="stockaUrl" class="btn btn-primary mt-4 inline-flex">Ir a Stocka</a>
  </div>
</template>
