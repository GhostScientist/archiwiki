/**
 * Local Llama Provider
 *
 * LLM provider that runs models locally using node-llama-cpp.
 * Uses a simple prompt-based approach for tool calling that works with any model.
 */

import * as path from 'path';
import type {
  LLMProvider,
  LLMMessage,
  LLMTool,
  LLMToolCall,
  LLMResponse,
  LLMProviderOptions,
  ModelInfo,
  ProgressCallback,
} from './types.js';
import { ModelManager, type ModelFamily } from './model-manager.js';

/**
 * Options for LocalLlamaProvider
 */
export interface LocalLlamaProviderOptions {
  /** Path to a local GGUF model file (overrides auto-selection) */
  modelPath?: string;
  /** Specific model ID to use from the registry */
  modelId?: string;
  /** Model family to prefer ('lfm' or 'qwen') */
  modelFamily?: ModelFamily;
  /** Number of GPU layers to offload (-1 = auto, 0 = CPU only) */
  gpuLayers?: number;
  /** Context window size */
  contextSize?: number;
  /** Number of CPU threads to use */
  threads?: number;
  /** Progress callback for status updates */
  onProgress?: ProgressCallback;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * LocalLlamaProvider - Run LLMs locally using node-llama-cpp
 *
 * Uses a prompt-based approach for tool calling that works reliably
 * with any instruction-tuned model (LFM2.5, Qwen, etc.)
 */
export class LocalLlamaProvider implements LLMProvider {
  private llama: any = null;
  private model: any = null;
  private context: any = null;
  private modelManager: ModelManager;
  private options: LocalLlamaProviderOptions;
  private progressCallback?: ProgressCallback;
  private verbose: boolean;
  private modelInfo: ModelInfo | null = null;
  private modelFamily: ModelFamily = 'gpt-oss';
  private modelPath: string = '';

  constructor(options: LocalLlamaProviderOptions = {}) {
    this.options = options;
    this.modelManager = new ModelManager();
    this.progressCallback = options.onProgress;
    this.verbose = options.verbose ?? false;
    this.modelFamily = options.modelFamily || 'gpt-oss';
  }

  private log(...args: any[]): void {
    if (this.verbose) {
      console.log('[LocalLLM]', ...args);
    }
  }

  /**
   * Set a progress callback
   */
  setProgressCallback(callback: ProgressCallback): void {
    this.progressCallback = callback;
    this.modelManager.setProgressCallback(callback);
  }

  /**
   * Initialize the provider - detect hardware, select model, load it
   */
  async initialize(): Promise<void> {
    console.log('🔧 Initializing local LLM provider...\n');

    // Detect hardware
    const hardware = await this.modelManager.detectHardware();
    console.log('📊 Hardware detected:');
    console.log(this.modelManager.formatHardwareProfile(hardware));
    console.log();

    // Determine model to use
    let modelId: string;
    let contextLength: number;

    if (this.options.modelPath) {
      // User specified a custom model path
      this.modelPath = this.options.modelPath;
      modelId = 'custom';
      contextLength = this.options.contextSize || 32768;
      console.log(`📦 Using custom model: ${this.modelPath}\n`);
    } else {
      // Auto-select or use specified model
      let model;
      if (this.options.modelId) {
        model = this.modelManager.getModelById(this.options.modelId);
        if (!model) {
          throw new Error(`Model not found: ${this.options.modelId}`);
        }
      } else {
        // Recommend best model for hardware, preferring the specified family
        model = this.modelManager.recommendModel(hardware, this.modelFamily);
      }

      modelId = model.modelId;
      contextLength = model.contextLength;
      const sizeGB = (model.fileSizeBytes / 1e9).toFixed(1);

      console.log(`🎯 Selected model: ${model.modelId} (${sizeGB} GB)`);
      console.log(`   Quality: ${model.quality}`);
      console.log(`   Context: ${model.contextLength.toLocaleString()} tokens\n`);

      // Ensure model is downloaded
      this.modelPath = await this.modelManager.ensureModel(model);
    }

    // Load the model using node-llama-cpp
    console.log('⏳ Loading model into memory...');

    try {
      const { getLlama } = await import('node-llama-cpp');

      this.llama = await getLlama();

      // Load the model
      this.model = await this.llama.loadModel({
        modelPath: this.modelPath,
        gpuLayers: this.options.gpuLayers ?? -1, // Auto-detect
      });

      // Create context with multiple sequences for concurrent/sequential page generation
      // Each page generation needs its own sequence, so we allocate enough for a full wiki
      this.context = await this.model.createContext({
        contextSize: Math.min(this.options.contextSize || contextLength, contextLength),
        threads: this.options.threads,
        sequences: 20, // Allow up to 20 sequential page generations
      });

      this.modelInfo = {
        name: modelId,
        contextLength: this.context.contextSize,
        supportsTools: true,
        supportsStreaming: false,
        isLocal: true,
      };

      console.log('✅ Model loaded and ready!\n');
    } catch (error) {
      const err = error as Error;
      throw new Error(`Failed to load local model: ${err.message}`);
    }
  }

  /**
   * Build a system prompt that includes tool definitions
   */
  private buildToolPrompt(tools: LLMTool[]): string {
    if (tools.length === 0) {
      return '';
    }

    const toolDescriptions = tools.map((t) => {
      const params = t.parameters?.properties
        ? Object.entries(t.parameters.properties as Record<string, any>)
            .map(([name, schema]: [string, any]) => {
              const required = (t.parameters?.required as string[] || []).includes(name);
              return `    - ${name}${required ? ' (required)' : ''}: ${schema.description || schema.type || 'any'}`;
            })
            .join('\n')
        : '    (no parameters)';

      return `- ${t.name}: ${t.description}\n  Parameters:\n${params}`;
    }).join('\n\n');

    return `
## Available Tools

You have access to the following tools. To use a tool, output a JSON object on its own line in this exact format:

{"tool": "tool_name", "args": {"param1": "value1", "param2": "value2"}}

Available tools:

${toolDescriptions}

IMPORTANT RULES:
1. Output tool calls as valid JSON on a SINGLE LINE
2. You can make multiple tool calls by outputting multiple JSON lines
3. After a tool result is provided, analyze it and continue with your task
4. When you have completed the task and need no more tools, write your final response
5. DO NOT wrap tool calls in markdown code blocks - just output raw JSON
`;
  }

  /**
   * Parse tool calls from model response
   */
  private parseToolCalls(response: string, tools: LLMTool[]): LLMToolCall[] {
    const toolCalls: LLMToolCall[] = [];
    const toolNames = new Set(tools.map((t) => t.name));

    // Match JSON objects that look like tool calls
    // Try multiple patterns

    // Pattern 1: Simple {"tool": "...", "args": {...}} on its own line
    const lines = response.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('{') && trimmed.includes('"tool"')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.tool && toolNames.has(parsed.tool)) {
            toolCalls.push({
              id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              name: parsed.tool,
              arguments: parsed.args || parsed.arguments || {},
            });
            this.log('Parsed tool call:', parsed.tool);
          }
        } catch {
          // Not valid JSON, skip
        }
      }
    }

    // Pattern 2: JSON in code blocks
    const codeBlockPattern = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/g;
    let match;
    while ((match = codeBlockPattern.exec(response)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed.tool && toolNames.has(parsed.tool)) {
          // Check if already captured
          const exists = toolCalls.some(tc =>
            tc.name === parsed.tool &&
            JSON.stringify(tc.arguments) === JSON.stringify(parsed.args || parsed.arguments || {})
          );
          if (!exists) {
            toolCalls.push({
              id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              name: parsed.tool,
              arguments: parsed.args || parsed.arguments || {},
            });
            this.log('Parsed tool call from code block:', parsed.tool);
          }
        }
      } catch {
        // Not valid JSON, skip
      }
    }

    // Pattern 3: LFM2.5's native format: <|tool_call_start|>[...]<|tool_call_end|>
    const lfmPattern = /<\|tool_call_start\|>([\s\S]*?)<\|tool_call_end\|>/g;
    while ((match = lfmPattern.exec(response)) !== null) {
      try {
        // LFM2.5 outputs Python-style function calls
        const callText = match[1].trim();
        // Parse: [tool_name(arg1="val1", arg2="val2")]
        const funcMatch = callText.match(/\[?(\w+)\((.*)\)\]?/s);
        if (funcMatch && toolNames.has(funcMatch[1])) {
          const args: Record<string, unknown> = {};
          const argsText = funcMatch[2];
          // Parse kwargs
          const argPattern = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
          let argMatch;
          while ((argMatch = argPattern.exec(argsText)) !== null) {
            args[argMatch[1]] = argMatch[2] ?? argMatch[3] ?? argMatch[4];
          }
          toolCalls.push({
            id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: funcMatch[1],
            arguments: args,
          });
          this.log('Parsed LFM tool call:', funcMatch[1]);
        }
      } catch {
        // Parsing failed, skip
      }
    }

    return toolCalls;
  }

  /**
   * Remove tool call JSON from response text
   */
  private cleanResponse(response: string, toolCalls: LLMToolCall[]): string {
    let cleaned = response;

    // Remove lines that are just tool call JSON
    const lines = cleaned.split('\n');
    const filteredLines = lines.filter(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('{') && trimmed.includes('"tool"')) {
        try {
          const parsed = JSON.parse(trimmed);
          // If this was parsed as a tool call, remove it
          return !toolCalls.some(tc => tc.name === parsed.tool);
        } catch {
          return true;
        }
      }
      return true;
    });
    cleaned = filteredLines.join('\n');

    // Remove JSON in code blocks that were tool calls
    cleaned = cleaned.replace(/```(?:json)?\s*\{[^}]*"tool"[^}]*\}\s*```/g, '');

    // Remove LFM2.5 tool call markers
    cleaned = cleaned.replace(/<\|tool_call_start\|>[\s\S]*?<\|tool_call_end\|>/g, '');

    // Clean up extra whitespace
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

    return cleaned;
  }

  /**
   * Send a chat completion request
   */
  async chat(
    messages: LLMMessage[],
    tools: LLMTool[],
    options: LLMProviderOptions
  ): Promise<LLMResponse> {
    console.log('[LocalLLM] chat() called with', messages.length, 'messages,', tools.length, 'tools');

    if (!this.context || !this.model || !this.llama) {
      throw new Error('Provider not initialized. Call initialize() first.');
    }

    const { LlamaChatSession } = await import('node-llama-cpp');

    // Build system prompt with tool definitions
    const toolPrompt = this.buildToolPrompt(tools);
    const fullSystemPrompt = options.systemPrompt
      ? `${options.systemPrompt}\n\n${toolPrompt}`
      : toolPrompt;

    this.log('System prompt length:', fullSystemPrompt.length, 'chars');

    // Create a new chat session
    const session = new LlamaChatSession({
      contextSequence: this.context.getSequence(),
      systemPrompt: fullSystemPrompt,
    });

    // Get the last user message
    let lastUserMessage = '';
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'user') {
        if (typeof msg.content === 'string') {
          lastUserMessage = msg.content;
        } else {
          // Extract text from content blocks
          lastUserMessage = msg.content
            .filter((b) => b.type === 'text')
            .map((b) => (b as { type: 'text'; text: string }).text)
            .join('\n');
        }
        break;
      }
    }

    if (!lastUserMessage) {
      return {
        content: '',
        toolCalls: [],
        stopReason: 'end_turn',
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    this.log('User message:', lastUserMessage.slice(0, 200) + (lastUserMessage.length > 200 ? '...' : ''));

    try {
      console.log('[LocalLLM] Calling session.prompt()...');

      // Prompt the model
      const responseText = await session.prompt(lastUserMessage, {
        maxTokens: options.maxTokens || 4096,
        temperature: options.temperature ?? 0.7,
      });

      console.log('[LocalLLM] Got response:', responseText.length, 'chars');
      this.log('Response preview:', responseText.slice(0, 500));

      // Parse tool calls from response
      const toolCalls = this.parseToolCalls(responseText, tools);

      // Clean the response text (remove tool call JSON)
      const cleanedContent = toolCalls.length > 0
        ? this.cleanResponse(responseText, toolCalls)
        : responseText;

      const result: LLMResponse = {
        content: cleanedContent,
        toolCalls,
        stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
        usage: {
          inputTokens: 0,
          outputTokens: 0,
        },
      };

      console.log('[LocalLLM] Returning:', {
        contentLength: result.content.length,
        toolCalls: result.toolCalls.length,
        stopReason: result.stopReason,
      });

      if (toolCalls.length > 0) {
        console.log('[LocalLLM] Tool calls:', toolCalls.map(tc => tc.name).join(', '));
      }

      return result;
    } catch (error) {
      const err = error as Error;
      console.error('[LocalLLM] Error during chat:', err.message);
      if (this.verbose) {
        console.error('[LocalLLM] Stack:', err.stack);
      }
      return {
        content: '',
        toolCalls: [],
        stopReason: 'error',
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    } finally {
      // CRITICAL: Dispose session to release sequence back to pool
      // Without this, subsequent chat() calls fail with "No sequences left"
      try {
        await session.dispose?.();
      } catch {
        // Ignore disposal errors
      }
    }
  }

  /**
   * Clean up resources
   */
  async shutdown(): Promise<void> {
    if (this.context) {
      await this.context.dispose?.();
      this.context = null;
    }
    if (this.model) {
      await this.model.dispose?.();
      this.model = null;
    }
    this.llama = null;
  }

  /**
   * Get information about the current model
   */
  getModelInfo(): ModelInfo {
    return (
      this.modelInfo || {
        name: path.basename(this.modelPath, '.gguf') || 'local',
        contextLength: 32768,
        supportsTools: true,
        supportsStreaming: false,
        isLocal: true,
      }
    );
  }
}

export default LocalLlamaProvider;
