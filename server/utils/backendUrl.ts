export function getBackendBaseUrl(): string {
  const config = useRuntimeConfig()
  const url = config.apiBaseUrl as string | undefined
  if (!url) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Backend no configurado: define NUXT_API_BASE_URL.'
    })
  }
  return url.replace(/\/+$/, '')
}
