/**
 * Local Llama Provider
 *
 * Self-contained local LLM inference using node-llama-cpp.
 * Handles model loading, hardware detection, and tool calling.
 */

import * as path from 'path';
import { ModelManager } from './model-manager';
import type {
  LLMProvider,
  LLMMessage,
  LLMTool,
  LLMToolCall,
  LLMResponse,
  LLMProviderOptions,
  ModelInfo,
  ProgressCallback,
  HardwareProfile,
} from './types';

// Dynamic imports for node-llama-cpp types
type LlamaModule = typeof import('node-llama-cpp');
type LlamaType = Awaited<ReturnType<LlamaModule['getLlama']>>;
type LlamaModelType = Awaited<ReturnType<LlamaType['loadModel']>>;
type LlamaContextType = Awaited<ReturnType<LlamaModelType['createContext']>>;
type LlamaChatSessionType = InstanceType<LlamaModule['LlamaChatSession']>;

/**
 * Options for the LocalLlamaProvider
 */
export interface LocalLlamaProviderOptions {
  /** Explicit path to a GGUF model file */
  modelPath?: string;
  /** Model ID from the registry to use */
  modelId?: string;
  /** Number of layers to offload to GPU (default: auto) */
  gpuLayers?: number;
  /** Context window size (default: 32768) */
  contextSize?: number;
  /** Number of CPU threads to use (default: auto) */
  threads?: number;
  /** Progress callback for status updates */
  onProgress?: ProgressCallback;
}

/**
 * LocalLlamaProvider - Self-contained local LLM inference
 *
 * Uses node-llama-cpp for in-process inference without requiring
 * external servers like Ollama.
 */
export class LocalLlamaProvider implements LLMProvider {
  private options: LocalLlamaProviderOptions;
  private modelManager: ModelManager;
  private progressCallback?: ProgressCallback;

  // node-llama-cpp instances (set after initialization)
  private llama: LlamaType | null = null;
  private model: LlamaModelType | null = null;
  private context: LlamaContextType | null = null;
  private modelPath: string = '';
  private hardware: HardwareProfile | null = null;

  constructor(options: LocalLlamaProviderOptions = {}) {
    this.options = options;
    this.modelManager = new ModelManager();
    this.progressCallback = options.onProgress;
  }

  /**
   * Set a progress callback for status updates
   */
  setProgressCallback(callback: ProgressCallback): void {
    this.progressCallback = callback;
    this.modelManager.setProgressCallback(callback);
  }

  /**
   * Initialize the provider - detect hardware, download model if needed, load model
   */
  async initialize(): Promise<void> {
    this.reportProgress('initializing', undefined, 'Detecting hardware...');

    // Detect hardware
    console.log('🔍 Detecting hardware...');
    this.hardware = await this.modelManager.detectHardware();

    console.log(`   ├─ ${this.formatGpuInfo()}`);
    console.log(`   ├─ RAM: ${this.hardware.systemRam.toFixed(0)} GB available`);
    console.log(`   └─ CPU: ${this.hardware.cpuCores} cores`);

    // Determine which model to use
    if (this.options.modelPath) {
      // Explicit path provided
      this.modelPath = this.options.modelPath;
      console.log(`\n📦 Using specified model: ${path.basename(this.modelPath)}`);
    } else if (this.options.modelId) {
      // Specific model ID requested
      const model = this.modelManager.getModelById(this.options.modelId);
      if (!model) {
        throw new Error(`Unknown model ID: ${this.options.modelId}`);
      }
      console.log(`\n📦 Requested model: ${model.modelId}`);
      this.modelPath = await this.modelManager.ensureModel(model);
    } else {
      // Auto-select based on hardware
      const recommendation = this.modelManager.recommendModel(this.hardware);
      console.log(`   └─ Recommended: ${recommendation.modelId} (${recommendation.quality} quality)`);
      this.modelPath = await this.modelManager.ensureModel(recommendation);
    }

    // Load the model
    this.reportProgress('loading', undefined, 'Loading model...');
    console.log('\n⏳ Loading model into memory...');

    try {
      const { getLlama } = await import('node-llama-cpp');
      this.llama = await getLlama();

      // Load model with configuration
      this.model = await this.llama.loadModel({
        modelPath: this.modelPath,
        gpuLayers: this.options.gpuLayers, // undefined = auto
      });

      // Create context
      const contextSize = this.options.contextSize ?? 32768;
      this.context = await this.model.createContext({
        contextSize,
      });

      console.log('✅ Model loaded and ready!\n');
      this.reportProgress('ready', 100, 'Model ready');
    } catch (error) {
      const err = error as Error;
      if (err.message?.includes('out of memory') || err.message?.includes('OOM')) {
        throw new Error(
          `Out of memory while loading model.\n\n` +
            `Try:\n` +
            `  1. Reduce context size: --context-size 16384\n` +
            `  2. Use fewer GPU layers: --gpu-layers 20\n` +
            `  3. Use a smaller model: --local-model qwen2.5-coder-7b-q5`
        );
      }
      throw error;
    }
  }

  /**
   * Send a chat completion request
   */
  async chat(
    messages: LLMMessage[],
    tools: LLMTool[],
    options: LLMProviderOptions
  ): Promise<LLMResponse> {
    if (!this.context || !this.model || !this.llama) {
      throw new Error('Provider not initialized. Call initialize() first.');
    }

    const { LlamaChatSession } = await import('node-llama-cpp');

    // Create a new chat session
    const session = new LlamaChatSession({
      contextSequence: this.context.getSequence(),
      systemPrompt: options.systemPrompt,
    });

    // Build the conversation history
    const conversationHistory = this.buildConversationHistory(messages);

    // Convert tools to function definitions (pass session for tool call capture)
    const functions = await this.convertToolsToFunctions(tools, session);

    // Get the last user message
    const lastUserMessage = this.getLastUserMessage(messages);
    if (!lastUserMessage) {
      throw new Error('No user message found in conversation');
    }

    // Track tool calls made during this turn
    const toolCalls: LLMToolCall[] = [];
    let responseText = '';

    try {
      // Prompt the model with function calling support
      if (Object.keys(functions).length > 0) {
        // With tools - tool calls are captured via the handlers in convertToolsToFunctions
        responseText = await session.prompt(lastUserMessage, {
          maxTokens: options.maxTokens,
          temperature: options.temperature ?? 0.7,
          functions,
        });

        // Extract tool calls from the captured calls array
        // (set during defineChatSessionFunction handlers)
        const capturedCalls = (session as any).__toolCalls as Array<{
          name: string;
          params: Record<string, unknown>;
        }> | undefined;

        if (capturedCalls && capturedCalls.length > 0) {
          for (const call of capturedCalls) {
            toolCalls.push({
              id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
              name: call.name,
              arguments: call.params,
            });
          }
        }
      } else {
        // Without tools
        responseText = await session.prompt(lastUserMessage, {
          maxTokens: options.maxTokens,
          temperature: options.temperature ?? 0.7,
        });
      }
    } catch (error) {
      const err = error as Error;
      console.error('Chat error:', err.message);
      return {
        content: '',
        toolCalls: [],
        stopReason: 'error',
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    return {
      content: responseText,
      toolCalls,
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
      usage: {
        // node-llama-cpp doesn't expose token counts easily
        inputTokens: 0,
        outputTokens: 0,
      },
    };
  }

  /**
   * Clean up resources
   */
  async shutdown(): Promise<void> {
    if (this.context) {
      await this.context.dispose();
      this.context = null;
    }
    if (this.model) {
      await this.model.dispose();
      this.model = null;
    }
    this.llama = null;
  }

  /**
   * Get information about the current model
   */
  getModelInfo(): ModelInfo {
    return {
      name: path.basename(this.modelPath, '.gguf'),
      contextLength: this.options.contextSize ?? 32768,
      supportsTools: true,
      supportsStreaming: true,
      isLocal: true,
    };
  }

  /**
   * Convert LLM tools to node-llama-cpp function format
   * The session object is used to store captured tool calls
   */
  private async convertToolsToFunctions(
    tools: LLMTool[],
    session: LlamaChatSessionType
  ): Promise<Record<string, ReturnType<LlamaModule['defineChatSessionFunction']>>> {
    const { defineChatSessionFunction } = await import('node-llama-cpp');
    const functions: Record<string, ReturnType<typeof defineChatSessionFunction>> = {};

    // Initialize tool calls array on session
    (session as any).__toolCalls = [];

    for (const tool of tools) {
      const toolName = tool.name;
      functions[toolName] = defineChatSessionFunction({
        description: tool.description,
        params: tool.parameters as any,
        handler: async (params) => {
          // Capture the tool call for later processing
          (session as any).__toolCalls.push({
            name: toolName,
            params: (params ?? {}) as Record<string, unknown>,
          });
          // Return a placeholder - actual execution happens in the main loop
          return { _pending: true, message: 'Tool execution pending' };
        },
      });
    }

    return functions;
  }

  /**
   * Build conversation history for the session
   */
  private buildConversationHistory(
    messages: LLMMessage[]
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    for (const msg of messages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        const content =
          typeof msg.content === 'string'
            ? msg.content
            : msg.content
                .filter((c) => c.type === 'text')
                .map((c) => (c as { type: 'text'; text: string }).text)
                .join('\n');

        if (content) {
          history.push({
            role: msg.role,
            content,
          });
        }
      } else if (msg.role === 'tool') {
        // Append tool results to the last assistant message or create a new user message
        const content =
          typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);

        history.push({
          role: 'user',
          content: `Tool result for ${msg.name || 'unknown'}: ${content}`,
        });
      }
    }

    return history;
  }

  /**
   * Extract the last user message from the conversation
   */
  private getLastUserMessage(messages: LLMMessage[]): string | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'user') {
        if (typeof msg.content === 'string') {
          return msg.content;
        }
        return msg.content
          .filter((c) => c.type === 'text')
          .map((c) => (c as { type: 'text'; text: string }).text)
          .join('\n');
      }
    }
    return null;
  }

  /**
   * Format GPU info for display
   */
  private formatGpuInfo(): string {
    if (!this.hardware) return 'GPU: Unknown';

    if (this.hardware.gpuVendor === 'none') {
      return 'GPU: None detected (CPU-only mode)';
    }

    if (this.hardware.gpuName) {
      return `GPU: ${this.hardware.gpuName} (${this.hardware.gpuVram} GB VRAM)`;
    }

    const vendor =
      this.hardware.gpuVendor.charAt(0).toUpperCase() + this.hardware.gpuVendor.slice(1);
    return `GPU: ${vendor} (${this.hardware.gpuVram} GB VRAM)`;
  }

  /**
   * Report progress to callback
   */
  private reportProgress(phase: string, percent?: number, message?: string): void {
    if (this.progressCallback) {
      this.progressCallback({ phase, percent, message });
    }
  }
}

export default LocalLlamaProvider;
