<script setup lang="ts">
// The editor is always entered via /open (handoff) or a deep link to a timeline. The bare root
// just points users back to Stocka.
const config = useRuntimeConfig()
const stockaUrl = config.public.stockaUrl as string
</script>

<template>
  <div class="panel max-w-md p-6 text-center">
    <h1 class="text-[18px] font-semibold text-ink">Stocka · Timeline Editor</h1>
    <p class="mt-2 text-[13.5px] text-ink-soft">
      Abre el editor desde el botón <strong>Modificar</strong> de una timeline en Stocka.
    </p>
    <a :href="stockaUrl" class="btn btn-primary mt-4 inline-flex">Ir a Stocka</a>
  </div>
</template>
