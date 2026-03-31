import { falProvider } from './fal-provider'
import { FalVideoProvider } from './fal-video-provider'
import type { AIProvider } from './types'

const registry = new Map<string, AIProvider>()
let defaultProviderName = 'fal'

// Register built-in providers
registerProvider(falProvider)

export function registerProvider(provider: AIProvider): void {
  registry.set(provider.name, provider)
}

export function getProvider(name: string): AIProvider {
  const provider = registry.get(name)
  if (!provider) throw new Error(`AI provider "${name}" is not registered`)
  return provider
}

export function getDefaultProvider(): AIProvider {
  return getProvider(defaultProviderName)
}

export function setDefaultProvider(name: string): void {
  defaultProviderName = name
}

export const falVideoProvider = new FalVideoProvider()
