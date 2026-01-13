/**
 * LLM Provider Types
 *
 * Shared types and interfaces for all LLM providers (Anthropic, Local, Ollama)
 */

// JSON Schema type for tool parameters
export type JSONSchema = {
  type?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  description?: string;
  enum?: string[];
  [key: string]: unknown;
};

/**
 * Content block types for complex message content
 */
export interface TextContentBlock {
  type: 'text';
  text: string;
}

export interface ToolUseContentBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultContentBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ContentBlock = TextContentBlock | ToolUseContentBlock | ToolResultContentBlock;

/**
 * Message format for LLM conversations
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
  toolCallId?: string;
  name?: string;
}

/**
 * Tool definition for function calling
 */
export interface LLMTool {
  name: string;
  description: string;
  parameters: JSONSchema;
}

/**
 * Tool call made by the LLM
 */
export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Response from an LLM provider
 */
export interface LLMResponse {
  content: string;
  toolCalls: LLMToolCall[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error';
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Streaming chunk for real-time responses
 */
export interface LLMStreamChunk {
  type: 'text' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_end' | 'done';
  text?: string;
  toolCall?: Partial<LLMToolCall>;
}

/**
 * Options for chat completions
 */
export interface LLMProviderOptions {
  maxTokens: number;
  temperature?: number;
  systemPrompt?: string;
  stopSequences?: string[];
}

/**
 * Model information returned by providers
 */
export interface ModelInfo {
  name: string;
  contextLength: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
  isLocal: boolean;
}

/**
 * Progress callback for long-running operations
 */
export interface ProgressCallback {
  (progress: {
    phase: string;
    percent?: number;
    message?: string;
    tokensPerSecond?: number;
    memoryUsage?: number;
  }): void;
}

/**
 * Base interface for all LLM providers
 */
export interface LLMProvider {
  /**
   * Initialize the provider (load model, connect to server, etc.)
   * Must be called before using chat()
   */
  initialize(): Promise<void>;

  /**
   * Send a chat completion request
   */
  chat(
    messages: LLMMessage[],
    tools: LLMTool[],
    options: LLMProviderOptions
  ): Promise<LLMResponse>;

  /**
   * Stream a chat completion (optional)
   */
  stream?(
    messages: LLMMessage[],
    tools: LLMTool[],
    options: LLMProviderOptions
  ): AsyncIterable<LLMStreamChunk>;

  /**
   * Clean up resources (unload model, close connections)
   */
  shutdown(): Promise<void>;

  /**
   * Get information about the current model
   */
  getModelInfo(): ModelInfo;

  /**
   * Set a progress callback for status updates
   */
  setProgressCallback?(callback: ProgressCallback): void;
}

/**
 * Hardware profile for model selection
 */
export interface HardwareProfile {
  gpuVendor: 'nvidia' | 'amd' | 'apple' | 'intel' | 'none';
  gpuName?: string;
  gpuVram: number; // In GB
  systemRam: number; // In GB
  cpuCores: number;
  cpuModel?: string;
}

/**
 * Model recommendation from the registry
 */
export interface ModelRecommendation {
  modelId: string;
  ggufFile: string;
  downloadUrl: string;
  fileSizeBytes: number;
  minVram: number;
  minRam: number;
  contextLength: number;
  quality: 'excellent' | 'good' | 'acceptable';
}

/**
 * Model family type for local models
 */
export type ModelFamily = 'gpt-oss';

/**
 * Options for creating an LLM provider
 */
export interface CreateProviderOptions {
  // Mode selection
  fullLocal?: boolean;
  useOllama?: boolean;

  // Anthropic options
  apiKey?: string;
  model?: string;

  // Local options
  modelPath?: string;
  localModel?: string;
  modelFamily?: ModelFamily; // 'gpt-oss' (21B model)
  gpuLayers?: number;
  contextSize?: number;
  threads?: number;
  verbose?: boolean;

  // Ollama options
  ollamaHost?: string;

  // Progress callback
  onProgress?: ProgressCallback;
}
