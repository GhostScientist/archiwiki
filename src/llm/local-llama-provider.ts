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

    // Build an enhanced system prompt that includes tool instructions
    const enhancedSystemPrompt = this.buildSystemPromptWithTools(
      options.systemPrompt || '',
      tools
    );

    // Create a new chat session with enhanced system prompt
    const session = new LlamaChatSession({
      contextSequence: this.context.getSequence(),
      systemPrompt: enhancedSystemPrompt,
    });

    // Get the last user message
    const lastUserMessage = this.getLastUserMessage(messages);
    if (!lastUserMessage) {
      throw new Error('No user message found in conversation');
    }

    // Track tool calls made during this turn
    const toolCalls: LLMToolCall[] = [];
    let responseText = '';

    try {
      // Prompt the model (tools are described in system prompt)
      responseText = await session.prompt(lastUserMessage, {
        maxTokens: options.maxTokens,
        temperature: options.temperature ?? 0.7,
      });

      // Parse tool calls from the response text
      const parsedToolCalls = this.parseToolCallsFromResponse(responseText, tools);

      if (parsedToolCalls.length > 0) {
        toolCalls.push(...parsedToolCalls);
        // Remove tool call blocks from the response text for cleaner output
        responseText = this.removeToolCallsFromResponse(responseText);
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
   * Build a system prompt that includes tool definitions for local models
   */
  private buildSystemPromptWithTools(basePrompt: string, tools: LLMTool[]): string {
    if (tools.length === 0) {
      return basePrompt;
    }

    const toolDescriptions = tools.map(tool => {
      const params = tool.parameters as { properties?: Record<string, any>; required?: string[] };
      const paramList = params.properties
        ? Object.entries(params.properties).map(([name, schema]) => {
            const required = params.required?.includes(name) ? ' (required)' : ' (optional)';
            return `    - ${name}${required}: ${schema.description || schema.type || 'any'}`;
          }).join('\n')
        : '    (no parameters)';

      return `### ${tool.name}
${tool.description}
Parameters:
${paramList}`;
    }).join('\n\n');

    const toolInstructions = `
## Available Tools

You have access to the following tools to help complete your task. To use a tool, output a tool call in this EXACT format:

<tool_call>
{"name": "tool_name", "arguments": {"param1": "value1", "param2": "value2"}}
</tool_call>

You can make multiple tool calls in a single response. After each tool call, wait for the result before proceeding.

IMPORTANT: You MUST use tools to complete tasks. Do not just describe what you would do - actually call the tools.

${toolDescriptions}

## Instructions

1. Analyze the task and determine which tools you need
2. Make tool calls using the exact format shown above
3. Wait for tool results before making additional calls
4. Continue until the task is complete

Start by using a tool now:
`;

    return basePrompt + '\n\n' + toolInstructions;
  }

  /**
   * Parse tool calls from the model's response text
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
      } catch (e) {
        // Failed to parse, try next match
        console.warn('Failed to parse tool call:', match[1]);
      }
    }

    // Pattern 2: ```tool\n{"name": "...", "arguments": {...}}\n```
    const codeBlockPattern = /```(?:tool|json)?\s*([\s\S]*?)\s*```/gi;
    while ((match = codeBlockPattern.exec(responseText)) !== null) {
      try {
        const jsonStr = match[1].trim();
        // Check if it looks like a tool call
        if (jsonStr.includes('"name"') && (jsonStr.includes('"arguments"') || jsonStr.includes('"params"'))) {
          const parsed = JSON.parse(jsonStr);
          if (parsed.name && validToolNames.has(parsed.name)) {
            // Avoid duplicates
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
      } catch (e) {
        // Not a valid tool call, skip
      }
    }

    // Pattern 3: Direct function call syntax - tool_name({"param": "value"})
    for (const tool of tools) {
      const funcPattern = new RegExp(`${tool.name}\\s*\\(\\s*({[\\s\\S]*?})\\s*\\)`, 'gi');
      while ((match = funcPattern.exec(responseText)) !== null) {
        try {
          const args = JSON.parse(match[1]);
          const exists = toolCalls.some(tc => tc.name === tool.name &&
            JSON.stringify(tc.arguments) === JSON.stringify(args));
          if (!exists) {
            toolCalls.push({
              id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
              name: tool.name,
              arguments: args,
            });
          }
        } catch (e) {
          // Failed to parse arguments
        }
      }
    }

    return toolCalls;
  }

  /**
   * Remove tool call blocks from response text
   */
  private removeToolCallsFromResponse(responseText: string): string {
    let cleaned = responseText;

    // Remove <tool_call>...</tool_call> blocks
    cleaned = cleaned.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');

    // Remove tool-related code blocks
    cleaned = cleaned.replace(/```(?:tool|json)?\s*\{[\s\S]*?"name"[\s\S]*?\}\s*```/gi, '');

    // Clean up extra whitespace
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
}

export default LocalLlamaProvider;
