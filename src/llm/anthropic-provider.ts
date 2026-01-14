/**
 * Anthropic Provider
 *
 * LLM provider that connects to the Anthropic API (Claude).
 * This is the default cloud provider.
 */

import Anthropic from '@anthropic-ai/sdk';
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

/**
 * Options for the AnthropicProvider
 */
export interface AnthropicProviderOptions {
  /** Anthropic API key */
  apiKey?: string;
  /** Model name to use (default: claude-sonnet-4-20250514) */
  model?: string;
  /** Progress callback for status updates */
  onProgress?: ProgressCallback;
}

/**
 * AnthropicProvider - Connect to Anthropic's Claude API
 *
 * The default cloud provider for high-quality wiki generation.
 */
export class AnthropicProvider implements LLMProvider {
  private client: Anthropic | null = null;
  private modelName: string;
  private apiKey?: string;
  private progressCallback?: ProgressCallback;

  constructor(options: AnthropicProviderOptions = {}) {
    this.apiKey = options.apiKey;
    this.modelName = options.model || 'claude-sonnet-4-20250514';
    this.progressCallback = options.onProgress;
  }

  /**
   * Set a progress callback for status updates
   */
  setProgressCallback(callback: ProgressCallback): void {
    this.progressCallback = callback;
  }

  /**
   * Initialize the provider - create client and verify API key
   */
  async initialize(): Promise<void> {
    const key = this.apiKey || process.env.ANTHROPIC_API_KEY;

    if (!key) {
      throw new Error(
        'Anthropic API key not found.\n\n' +
          'Set it via:\n' +
          '  1. Environment variable: ANTHROPIC_API_KEY=your-key\n' +
          '  2. Or use --full-local for offline mode'
      );
    }

    this.client = new Anthropic({ apiKey: key });

    // Optionally verify the key works (commented out to avoid unnecessary API call)
    // await this.client.messages.create({ model: this.modelName, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] });

    console.log(`☁️  Using Anthropic API with model: ${this.modelName}\n`);
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

    const anthropicMessages = this.convertMessages(messages);
    const anthropicTools = this.convertTools(tools);

    try {
      const response = await this.client.messages.create({
        model: this.modelName,
        max_tokens: options.maxTokens,
        system: options.systemPrompt,
        tools: anthropicTools.length > 0 ? anthropicTools : undefined,
        messages: anthropicMessages,
        stop_sequences: options.stopSequences,
      });

      return this.parseResponse(response);
    } catch (error) {
      const err = error as Error & { status?: number };

      if (err.status === 401) {
        throw new Error('Invalid Anthropic API key. Please check your ANTHROPIC_API_KEY.');
      }

      if (err.status === 429) {
        throw new Error('Rate limited by Anthropic API. Please wait and try again.');
      }

      throw error;
    }
  }

  /**
   * Clean up resources
   */
  async shutdown(): Promise<void> {
    this.client = null;
  }

  /**
   * Get information about the current model
   */
  getModelInfo(): ModelInfo {
    return {
      name: this.modelName,
      contextLength: 200000, // Claude's context window
      supportsTools: true,
      supportsStreaming: true,
      isLocal: false,
    };
  }

  /**
   * Convert messages to Anthropic format
   */
  private convertMessages(messages: LLMMessage[]): Anthropic.MessageParam[] {
    const result: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // System messages are handled via the system parameter
        continue;
      }

      if (msg.role === 'user') {
        if (typeof msg.content === 'string') {
          result.push({ role: 'user', content: msg.content });
        } else {
          // Convert content blocks
          const blocks = msg.content.map((block) => this.convertContentBlock(block));
          result.push({ role: 'user', content: blocks as Anthropic.ContentBlockParam[] });
        }
      } else if (msg.role === 'assistant') {
        if (typeof msg.content === 'string') {
          result.push({ role: 'assistant', content: msg.content });
        } else {
          const blocks = msg.content.map((block) => this.convertContentBlock(block));
          result.push({ role: 'assistant', content: blocks as Anthropic.ContentBlock[] });
        }
      } else if (msg.role === 'tool') {
        // Tool results are added as user messages with tool_result content
        if (typeof msg.content === 'string') {
          result.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: msg.toolCallId || '',
                content: msg.content,
              },
            ],
          });
        } else {
          // Handle complex tool results
          const toolResult = msg.content.find((c) => c.type === 'tool_result') as
            | { type: 'tool_result'; tool_use_id: string; content: string }
            | undefined;
          if (toolResult) {
            result.push({
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolResult.tool_use_id,
                  content: toolResult.content,
                },
              ],
            });
          }
        }
      }
    }

    return result;
  }

  /**
   * Convert a content block to Anthropic format
   */
  private convertContentBlock(
    block: ContentBlock
  ): Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam | Anthropic.ToolResultBlockParam {
    switch (block.type) {
      case 'text':
        return { type: 'text', text: block.text };
      case 'tool_use':
        return {
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input,
        };
      case 'tool_result':
        return {
          type: 'tool_result',
          tool_use_id: block.tool_use_id,
          content: block.content,
          is_error: block.is_error,
        };
      default:
        throw new Error(`Unknown content block type: ${(block as ContentBlock).type}`);
    }
  }

  /**
   * Convert tools to Anthropic format
   */
  private convertTools(tools: LLMTool[]): Anthropic.Tool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters as Anthropic.Tool['input_schema'],
    }));
  }

  /**
   * Parse Anthropic response to our format
   */
  private parseResponse(response: Anthropic.Message): LLMResponse {
    const toolCalls: LLMToolCall[] = [];
    let textContent = '';

    for (const block of response.content) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    let stopReason: LLMResponse['stopReason'] = 'end_turn';
    if (response.stop_reason === 'tool_use') {
      stopReason = 'tool_use';
    } else if (response.stop_reason === 'max_tokens') {
      stopReason = 'max_tokens';
    }

    return {
      content: textContent,
      toolCalls,
      stopReason,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}

export default AnthropicProvider;
