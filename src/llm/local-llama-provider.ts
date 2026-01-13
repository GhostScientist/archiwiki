/**
 * Local Llama Provider
 *
 * Self-contained local LLM inference using node-llama-cpp.
 * Handles model loading, hardware detection, and tool calling.
 */

import * as path from 'path';
import { ModelManager } from './model-manager.js';
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
} from './types.js';

// Dynamic imports for node-llama-cpp types
type LlamaModule = typeof import('node-llama-cpp');
type LlamaType = Awaited<ReturnType<LlamaModule['getLlama']>>;
type LlamaModelType = Awaited<ReturnType<LlamaType['loadModel']>>;
type LlamaContextType = Awaited<ReturnType<LlamaModelType['createContext']>>;

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
  /** Enable verbose logging */
  verbose?: boolean;
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
  private verbose: boolean = false;

  // node-llama-cpp instances (set after initialization)
  private llama: LlamaType | null = null;
  private model: LlamaModelType | null = null;
  private context: LlamaContextType | null = null;
  private modelPath: string = '';
  private hardware: HardwareProfile | null = null;

  // Tool execution callback - set by the wiki agent
  private toolExecutor?: (name: string, args: Record<string, unknown>) => Promise<string>;

  constructor(options: LocalLlamaProviderOptions = {}) {
    this.options = options;
    this.modelManager = new ModelManager();
    this.progressCallback = options.onProgress;
    this.verbose = options.verbose ?? false;
  }

  /**
   * Set a callback for executing tools during inference
   */
  setToolExecutor(executor: (name: string, args: Record<string, unknown>) => Promise<string>): void {
    this.toolExecutor = executor;
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
   * Send a chat completion request using node-llama-cpp's native function calling
   */
  async chat(
    messages: LLMMessage[],
    tools: LLMTool[],
    options: LLMProviderOptions
  ): Promise<LLMResponse> {
    // Always log entry to chat() for debugging
    console.log('[LocalLLM] chat() called with', messages.length, 'messages,', tools.length, 'tools');
    console.log('[LocalLLM] verbose mode:', this.verbose);

    if (!this.context || !this.model || !this.llama) {
      console.log('[LocalLLM] ERROR: Provider not initialized!');
      throw new Error('Provider not initialized. Call initialize() first.');
    }

    console.log('[LocalLLM] Context and model are available, loading node-llama-cpp...');
    const { LlamaChatSession, defineChatSessionFunction } = await import('node-llama-cpp');
    console.log('[LocalLLM] node-llama-cpp imported successfully');

    // Create a new chat session
    const session = new LlamaChatSession({
      contextSequence: this.context.getSequence(),
      systemPrompt: options.systemPrompt,
    });

    // Get the last user message
    const lastUserMessage = this.getLastUserMessage(messages);
    if (!lastUserMessage) {
      throw new Error('No user message found in conversation');
    }

    // Track tool calls made during this turn
    const toolCalls: LLMToolCall[] = [];
    let responseText = '';

    // Convert tools to node-llama-cpp function format
    const functions: Record<string, ReturnType<typeof defineChatSessionFunction>> = {};

    if (tools.length > 0) {
      this.log('Setting up', tools.length, 'tools for native function calling');

      for (const tool of tools) {
        const toolName = tool.name;
        this.log('  - Registering tool:', toolName);

        functions[toolName] = defineChatSessionFunction({
          description: tool.description,
          params: this.convertToNodeLlamaSchema(tool.parameters),
          handler: async (params) => {
            this.log('🔧 Tool called:', toolName);
            this.log('   Arguments:', JSON.stringify(params, null, 2));

            // Record the tool call
            toolCalls.push({
              id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
              name: toolName,
              arguments: (params ?? {}) as Record<string, unknown>,
            });

            // Execute the tool if we have an executor
            if (this.toolExecutor) {
              try {
                const result = await this.toolExecutor(toolName, (params ?? {}) as Record<string, unknown>);
                this.log('   Result:', result.slice(0, 200) + (result.length > 200 ? '...' : ''));
                return result;
              } catch (error) {
                const errMsg = `Error: ${(error as Error).message}`;
                this.log('   Error:', errMsg);
                return errMsg;
              }
            }

            // If no executor, return a placeholder
            return JSON.stringify({ status: 'executed', tool: toolName });
          },
        });
      }
    }

    console.log('[LocalLLM] Preparing to call session.prompt()...');
    console.log('[LocalLLM] Last user message length:', lastUserMessage.length);
    console.log('[LocalLLM] Message preview:', lastUserMessage.slice(0, 200) + '...');
    this.log('\n📝 Prompt to model:');
    this.log('─'.repeat(60));
    this.log(lastUserMessage.slice(0, 500) + (lastUserMessage.length > 500 ? '\n...[truncated]' : ''));
    this.log('─'.repeat(60));

    try {
      // Prompt the model with native function calling
      const promptOptions: any = {
        maxTokens: options.maxTokens,
        temperature: options.temperature ?? 0.7,
      };

      // Only pass functions if we have any
      if (Object.keys(functions).length > 0) {
        promptOptions.functions = functions;
        console.log('[LocalLLM] Passing', Object.keys(functions).length, 'functions to prompt');
      } else {
        console.log('[LocalLLM] No functions to pass');
      }

      console.log('[LocalLLM] Calling session.prompt() now...');
      responseText = await session.prompt(lastUserMessage, promptOptions);
      console.log('[LocalLLM] session.prompt() returned, response length:', responseText.length);

      this.log('\n📤 Model response:');
      this.log('─'.repeat(60));
      this.log(responseText.slice(0, 1000) + (responseText.length > 1000 ? '\n...[truncated]' : ''));
      this.log('─'.repeat(60));
      this.log('Tool calls captured:', toolCalls.length);

      // If no tool calls were captured via handlers, try parsing from text
      if (toolCalls.length === 0 && tools.length > 0) {
        this.log('No native tool calls detected, trying text parsing...');
        const parsedCalls = this.parseToolCallsFromResponse(responseText, tools);
        if (parsedCalls.length > 0) {
          this.log('Found', parsedCalls.length, 'tool calls via text parsing');
          toolCalls.push(...parsedCalls);
          responseText = this.removeToolCallsFromResponse(responseText);
        }
      }

    } catch (error) {
      const err = error as Error;
      console.error('[LocalLLM] ❌ CHAT ERROR:', err.message);
      console.error('[LocalLLM] Error stack:', err.stack);
      return {
        content: '',
        toolCalls: [],
        stopReason: 'error',
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    const result: LLMResponse = {
      content: responseText,
      toolCalls,
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
      usage: {
        inputTokens: 0,
        outputTokens: 0,
      },
    };

    console.log('[LocalLLM] chat() returning:', {
      contentLength: result.content.length,
      toolCallCount: result.toolCalls.length,
      stopReason: result.stopReason
    });

    return result;
  }

  /**
   * Convert our JSON Schema to node-llama-cpp's expected format
   */
  private convertToNodeLlamaSchema(schema: any): any {
    // node-llama-cpp expects a specific format
    // Pass through most properties but ensure type is correct
    if (!schema || typeof schema !== 'object') {
      return { type: 'object', properties: {} };
    }

    return {
      type: schema.type || 'object',
      properties: schema.properties || {},
      required: schema.required || [],
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
   * Parse tool calls from the model's response text (fallback for models without native support)
   */
  private parseToolCallsFromResponse(responseText: string, tools: LLMTool[]): LLMToolCall[] {
    const toolCalls: LLMToolCall[] = [];
    const validToolNames = new Set(tools.map(t => t.name));

    // Pattern 1: <tool_call>{"name": "...", "arguments": {...}}</tool_call>
    const toolCallPattern = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
    let match;

    while ((match = toolCallPattern.exec(responseText)) !== null) {
      try {
        const jsonStr = match[1].trim();
        const parsed = JSON.parse(jsonStr);

        if (parsed.name && validToolNames.has(parsed.name)) {
          toolCalls.push({
            id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            name: parsed.name,
            arguments: parsed.arguments || parsed.params || {},
          });
        }
      } catch {
        this.log('Failed to parse tool call:', match[1]);
      }
    }

    // Pattern 2: ```json or ```tool blocks
    const codeBlockPattern = /```(?:tool|json)?\s*([\s\S]*?)\s*```/gi;
    while ((match = codeBlockPattern.exec(responseText)) !== null) {
      try {
        const jsonStr = match[1].trim();
        if (jsonStr.includes('"name"') && (jsonStr.includes('"arguments"') || jsonStr.includes('"params"'))) {
          const parsed = JSON.parse(jsonStr);
          if (parsed.name && validToolNames.has(parsed.name)) {
            const exists = toolCalls.some(tc => tc.name === parsed.name &&
              JSON.stringify(tc.arguments) === JSON.stringify(parsed.arguments || parsed.params || {}));
            if (!exists) {
              toolCalls.push({
                id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                name: parsed.name,
                arguments: parsed.arguments || parsed.params || {},
              });
            }
          }
        }
      } catch {
        // Not a valid tool call
      }
    }

    // Pattern 3: Qwen native format - <|tool_call|> or similar
    const qwenPattern = /<\|?(?:tool_call|function_call)\|?>\s*([\s\S]*?)\s*<\|?\/(?:tool_call|function_call)\|?>/gi;
    while ((match = qwenPattern.exec(responseText)) !== null) {
      try {
        const jsonStr = match[1].trim();
        const parsed = JSON.parse(jsonStr);
        if (parsed.name && validToolNames.has(parsed.name)) {
          toolCalls.push({
            id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            name: parsed.name,
            arguments: parsed.arguments || parsed.params || {},
          });
        }
      } catch {
        // Not valid JSON
      }
    }

    return toolCalls;
  }

  /**
   * Remove tool call blocks from response text
   */
  private removeToolCallsFromResponse(responseText: string): string {
    let cleaned = responseText;
    cleaned = cleaned.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
    cleaned = cleaned.replace(/<\|?(?:tool_call|function_call)\|?>[\s\S]*?<\|?\/(?:tool_call|function_call)\|?>/gi, '');
    cleaned = cleaned.replace(/```(?:tool|json)?\s*\{[\s\S]*?"name"[\s\S]*?\}\s*```/gi, '');
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
    return cleaned;
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

  /**
   * Log message if verbose mode is enabled
   */
  private log(...args: any[]): void {
    if (this.verbose) {
      console.log('[LocalLLM]', ...args);
    }
  }
}

export default LocalLlamaProvider;
