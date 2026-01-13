/**
 * LLM Provider Module
 *
 * Unified interface for multiple LLM backends:
 * - AnthropicProvider: Cloud-based Claude API (default)
 * - LocalLlamaProvider: Self-contained local inference via node-llama-cpp
 * - OllamaProvider: External Ollama server for power users
 */

import { AnthropicProvider } from './anthropic-provider.js';
import { LocalLlamaProvider } from './local-llama-provider.js';
import { OllamaProvider } from './ollama-provider.js';
import type { LLMProvider, CreateProviderOptions } from './types.js';

/**
 * Create an LLM provider based on the given options
 *
 * @param options - Configuration options for the provider
 * @returns Initialized LLM provider ready for use
 *
 * @example
 * // Use Claude API (default)
 * const provider = await createLLMProvider({ model: 'claude-sonnet-4-20250514' });
 *
 * @example
 * // Use local mode (self-contained)
 * const provider = await createLLMProvider({ fullLocal: true });
 *
 * @example
 * // Use Ollama
 * const provider = await createLLMProvider({
 *   fullLocal: true,
 *   useOllama: true,
 *   ollamaHost: 'http://localhost:11434',
 *   localModel: 'qwen2.5-coder:14b'
 * });
 */
export async function createLLMProvider(options: CreateProviderOptions = {}): Promise<LLMProvider> {
  let provider: LLMProvider;

  console.log('[createLLMProvider] Options:', {
    fullLocal: options.fullLocal,
    useOllama: options.useOllama,
    modelFamily: options.modelFamily,
    verbose: options.verbose,
    localModel: options.localModel
  });

  if (options.fullLocal) {
    if (options.useOllama) {
      // Use external Ollama server
      console.log('🔌 Using Ollama backend...\n');
      provider = new OllamaProvider({
        host: options.ollamaHost,
        model: options.localModel || 'qwen2.5-coder:14b',
        onProgress: options.onProgress,
      });
      console.log('[createLLMProvider] Created OllamaProvider');
    } else {
      // Use bundled node-llama-cpp (default for --full-local)
      const familyName = options.modelFamily === 'qwen' ? 'Qwen' : 'LFM (LiquidAI)';
      console.log(`🏠 Using self-contained local mode with ${familyName} models...\n`);
      provider = new LocalLlamaProvider({
        modelPath: options.modelPath,
        modelId: options.localModel,
        modelFamily: options.modelFamily || 'lfm', // Default to LFM for better tool calling
        gpuLayers: options.gpuLayers,
        contextSize: options.contextSize,
        threads: options.threads,
        onProgress: options.onProgress,
        verbose: options.verbose,
      });
      console.log('[createLLMProvider] Created LocalLlamaProvider with family:', options.modelFamily || 'lfm');
    }
  } else {
    // Use cloud Anthropic API
    provider = new AnthropicProvider({
      apiKey: options.apiKey,
      model: options.model || 'claude-sonnet-4-20250514',
      onProgress: options.onProgress,
    });
    console.log('[createLLMProvider] Created AnthropicProvider');
  }

  console.log('[createLLMProvider] Calling provider.initialize()...');
  await provider.initialize();
  console.log('[createLLMProvider] Provider initialized, returning');
  return provider;
}

/**
 * Check if local mode is available on this system
 */
export async function isLocalModeAvailable(): Promise<{
  available: boolean;
  reason?: string;
  hardware?: import('./types.js').HardwareProfile;
}> {
  try {
    const { ModelManager } = await import('./model-manager.js');
    const manager = new ModelManager();
    const hardware = await manager.detectHardware();

    // Check minimum requirements
    if (hardware.gpuVram < 2 && hardware.systemRam < 4) {
      return {
        available: false,
        reason: 'Insufficient hardware: need at least 2GB VRAM or 4GB RAM',
        hardware,
      };
    }

    return { available: true, hardware };
  } catch (error) {
    return {
      available: false,
      reason: `Hardware detection failed: ${(error as Error).message}`,
    };
  }
}

/**
 * Get recommended model for the current hardware
 */
export async function getRecommendedModel(): Promise<{
  model: import('./types.js').ModelRecommendation;
  hardware: import('./types.js').HardwareProfile;
} | null> {
  try {
    const { ModelManager } = await import('./model-manager.js');
    const manager = new ModelManager();
    const hardware = await manager.detectHardware();
    const model = manager.recommendModel(hardware);
    return { model, hardware };
  } catch {
    return null;
  }
}

/**
 * List all downloaded models
 */
export async function listDownloadedModels(): Promise<
  Array<{
    model: import('./types.js').ModelRecommendation;
    path: string;
    sizeBytes: number;
  }>
> {
  try {
    const { ModelManager } = await import('./model-manager.js');
    const manager = new ModelManager();
    return manager.listDownloadedModels();
  } catch {
    return [];
  }
}

// Re-export types and providers
export * from './types.js';
export { AnthropicProvider } from './anthropic-provider.js';
export { LocalLlamaProvider } from './local-llama-provider.js';
export { OllamaProvider } from './ollama-provider.js';
export { ModelManager } from './model-manager.js';
