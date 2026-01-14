/**
 * Ollama Provider
 *
 * LLM provider that connects to an external Ollama server.
 * For power users who prefer managing models via Ollama.
 */

import type {
  LLMProvider,
  LLMMessage,
  LLMTool,
  LLMToolCall,
  LLMResponse,
  LLMProviderOptions,
  ModelInfo,
  ProgressCallback,
  ContentBlock,
} from './types.js';

// Ollama client types (dynamic import)
type OllamaClient = import('ollama').Ollama;

/**
 * Options for the OllamaProvider
 */
export interface OllamaProviderOptions {
  /** Ollama server URL (default: http://localhost:11434) */
  host?: string;
  /** Model name to use */
  model: string;
  /** Progress callback for status updates */
  onProgress?: ProgressCallback;
}

/**
 * OllamaProvider - Connect to external Ollama server
 *
 * For power users who already have Ollama installed and prefer
 * managing models separately.
 */
export class OllamaProvider implements LLMProvider {
  private client: OllamaClient | null = null;
  private modelName: string;
  private host: string;
  private progressCallback?: ProgressCallback;

  constructor(options: OllamaProviderOptions) {
    this.host = options.host || 'http://localhost:11434';
    this.modelName = options.model;
    this.progressCallback = options.onProgress;
  }

  /**
   * Set a progress callback for status updates
   */
  setProgressCallback(callback: ProgressCallback): void {
    this.progressCallback = callback;
  }

  /**
   * Initialize the provider - connect to Ollama and verify model availability
   */
  async initialize(): Promise<void> {
    console.log(`🔌 Connecting to Ollama at ${this.host}...`);

    try {
      const { Ollama } = await import('ollama');
      this.client = new Ollama({ host: this.host });

      // Check connection and model availability
      const models = await this.client.list();
      const hasModel = models.models.some(
        (m) => m.name === this.modelName || m.name.startsWith(this.modelName + ':')
      );

      if (!hasModel) {
        const availableModels = models.models.map((m) => m.name).join('\n     - ');
        throw new Error(
          `Model '${this.modelName}' not found in Ollama.\n\n` +
            `   Available models:\n     - ${availableModels || '(none)'}\n\n` +
            `   Pull it with: ollama pull ${this.modelName}\n\n` +
            `   Or use the bundled local mode without --use-ollama:\n` +
            `     ted-mosby generate ./project --full-local`
        );
      }

      console.log(`✅ Connected! Using model: ${this.modelName}\n`);
    } catch (error) {
      const err = error as Error & { code?: string };

      if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
        throw new Error(
          `Cannot connect to Ollama at ${this.host}\n\n` +
            `  To use --use-ollama, ensure Ollama is running:\n` +
            `    $ ollama serve\n\n` +
            `  Or use the bundled local mode without --use-ollama:\n` +
            `    $ ted-mosby generate ./project --full-local`
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
    if (!this.client) {
      throw new Error('Provider not initialized. Call initialize() first.');
    }

    const ollamaMessages = this.convertMessages(messages, options.systemPrompt);
    const ollamaTools = this.convertTools(tools);

    try {
      const response = await this.client.chat({
        model: this.modelName,
        messages: ollamaMessages,
        tools: ollamaTools.length > 0 ? ollamaTools : undefined,
        options: {
          num_predict: options.maxTokens,
          temperature: options.temperature ?? 0.7,
        },
      });

      return this.parseResponse(response);
    } catch (error) {
      const err = error as Error;
      console.error('Ollama chat error:', err.message);
      return {
        content: '',
        toolCalls: [],
        stopReason: 'error',
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }
  }

  /**
   * Clean up resources
   */
  async shutdown(): Promise<void> {
    // Ollama client doesn't require cleanup
    this.client = null;
  }

  /**
   * Get information about the current model
   */
  getModelInfo(): ModelInfo {
    return {
      name: this.modelName,
      contextLength: 32768, // Default, actual varies by model
      supportsTools: true,
      supportsStreaming: true,
      isLocal: true,
    };
  }

  /**
   * Convert messages to Ollama format
   */
  private convertMessages(
    messages: LLMMessage[],
    systemPrompt?: string
  ): Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_calls?: Array<{
      function: { name: string; arguments: Record<string, unknown> };
    }>;
  }> {
    const result: Array<{
      role: 'system' | 'user' | 'assistant' | 'tool';
      content: string;
      tool_calls?: Array<{
        function: { name: string; arguments: Record<string, unknown> };
      }>;
    }> = [];

    // Add system prompt if provided
    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === 'system') {
        result.push({ role: 'system', content: this.extractTextContent(msg.content) });
      } else if (msg.role === 'user') {
        result.push({ role: 'user', content: this.extractTextContent(msg.content) });
      } else if (msg.role === 'assistant') {
        const content = this.extractTextContent(msg.content);
        const toolCalls = this.extractToolCalls(msg.content);

        if (toolCalls.length > 0) {
          result.push({
            role: 'assistant',
            content,
            tool_calls: toolCalls.map((tc) => ({
              function: {
                name: tc.name,
                arguments: tc.arguments,
              },
            })),
          });
        } else {
          result.push({ role: 'assistant', content });
        }
      } else if (msg.role === 'tool') {
        result.push({
          role: 'tool',
          content: this.extractTextContent(msg.content),
        });
      }
    }

    return result;
  }

  /**
   * Extract text content from message content
   */
  private extractTextContent(content: string | ContentBlock[]): string {
    if (typeof content === 'string') {
      return content;
    }

    return content
      .filter((c) => c.type === 'text')
      .map((c) => (c as { type: 'text'; text: string }).text)
      .join('\n');
  }

  /**
   * Extract tool calls from message content
   */
  private extractToolCalls(content: string | ContentBlock[]): LLMToolCall[] {
    if (typeof content === 'string') {
      return [];
    }

    return content
      .filter((c) => c.type === 'tool_use')
      .map((c) => {
        const toolUse = c as { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
        return {
          id: toolUse.id,
          name: toolUse.name,
          arguments: toolUse.input,
        };
      });
  }

  /**
   * Convert tools to Ollama format
   */
  private convertTools(tools: LLMTool[]): Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }> {
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as Record<string, unknown>,
      },
    }));
  }

  /**
   * Parse Ollama response to our format
   */
  private parseResponse(response: {
    message: {
      content: string;
      tool_calls?: Array<{
        function: {
          name: string;
          arguments: string | Record<string, unknown>;
        };
      }>;
    };
    prompt_eval_count?: number;
    eval_count?: number;
  }): LLMResponse {
    const toolCalls: LLMToolCall[] = [];

    if (response.message.tool_calls) {
      for (const call of response.message.tool_calls) {
        toolCalls.push({
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          name: call.function.name,
          arguments:
            typeof call.function.arguments === 'string'
              ? JSON.parse(call.function.arguments)
              : call.function.arguments,
        });
      }
    }

    return {
      content: response.message.content || '',
      toolCalls,
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
      usage: {
        inputTokens: response.prompt_eval_count || 0,
        outputTokens: response.eval_count || 0,
      },
    };
  }
}

export default OllamaProvider;
