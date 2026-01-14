# Local Mode Implementation Plan

## Overview

This document outlines the implementation plan for adding a `--full-local` flag to the `ted-mosby generate` command, enabling complete offline operation using local language models with **zero external dependencies**.

## Design Philosophy: Zero-Friction Local Mode

**Goal:** Users should be able to run `ted-mosby generate --full-local` without installing anything else. The CLI handles everything: model download, GPU detection, and inference.

```bash
# This should "just work" - no Ollama, no setup
ted-mosby generate ./my-project --full-local
```

---

## Current Architecture Analysis

### Already Local Components ✅

| Component | Technology | Location |
|-----------|------------|----------|
| **Embeddings** | Transformers.js (`all-MiniLM-L6-v2`) | `src/rag/index.ts` |
| **Vector Database** | FAISS (`faiss-node`) | `src/rag/index.ts` |
| **Code Chunking** | TypeScript Compiler AST | `src/ast-chunker.ts` |
| **File Operations** | Node.js fs | `src/tools/file-operations.ts` |
| **Wiki Verification** | In-process link checking | `src/wiki-agent.ts` |
| **Site Generation** | Marked (Markdown→HTML) | `src/site-generator.ts` |

### Cloud-Dependent Components ☁️

| Component | Current Implementation | Location |
|-----------|----------------------|----------|
| **LLM Reasoning** | Claude API via `@anthropic-ai/sdk` | `src/wiki-agent.ts:698-932` |
| **Agent Orchestration** | Claude Agent SDK | `src/agent.ts`, `src/wiki-agent.ts` |

**Key Finding:** The `--direct-api` mode in `generateWikiDirectApi()` already implements a manual tool-calling loop that is perfect for local model integration.

---

## Proposed Solution

### Technology Choice: `node-llama-cpp` (Self-Contained)

**Why `node-llama-cpp`?**

| Feature | Benefit |
|---------|---------|
| **In-process inference** | No external server needed |
| **Automatic GPU detection** | CUDA, Metal, Vulkan auto-detected |
| **Model management** | Download models on-demand |
| **Native tool calling** | Built-in function calling support |
| **Cross-platform** | macOS, Linux, Windows |
| **Active development** | Regular updates, good documentation |

**Alternative: Ollama (Power Users)**

For users who already have Ollama installed and prefer managing models separately, we'll provide `--use-ollama` as an alternative backend.

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           ted-mosby CLI                              │
│                                                                      │
│   --full-local           → LocalLlamaProvider (default, bundled)    │
│   --full-local --use-ollama → OllamaProvider (external server)      │
│   (no flag)              → AnthropicProvider (cloud)                │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        LLM Provider Interface                        │
│                                                                      │
│   interface LLMProvider {                                            │
│     initialize(): Promise<void>                                      │
│     chat(messages, tools, options): Promise<LLMResponse>            │
│     shutdown(): Promise<void>                                        │
│   }                                                                  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         ▼                          ▼                          ▼
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│ AnthropicProvider│      │LocalLlamaProvider│      │  OllamaProvider │
│                 │      │                 │      │                 │
│ Cloud API       │      │ node-llama-cpp  │      │ External server │
│ Default mode    │      │ Self-contained  │      │ Power users     │
└─────────────────┘      └─────────────────┘      └─────────────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │   Model Management  │
                         │                     │
                         │ ~/.ted-mosby/models │
                         │ Auto-download GGUF  │
                         │ Hardware detection  │
                         └─────────────────────┘
```

---

## User Experience

### First-Time User Flow

```bash
$ ted-mosby generate ./my-project --full-local

🏠 Local Mode Activated
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔍 Detecting hardware...
   ├─ GPU: NVIDIA RTX 4090 (24 GB VRAM)
   ├─ RAM: 64 GB available
   └─ Recommended model: qwen2.5-coder-14b-instruct-q5_k_m

📦 Model not found locally. Downloading...
   └─ qwen2.5-coder-14b-instruct-q5_k_m.gguf (9.8 GB)

   [████████████████████████░░░░░░░░░░░░░░░░] 62%  |  6.1 GB  |  45 MB/s  |  ETA 1:23

   This is a one-time download. Models are cached in ~/.ted-mosby/models

✅ Model ready!

🔍 Indexing repository...
   ├─ Parsed 245 files
   ├─ Generated 1,247 chunks
   └─ Created embeddings (local)

📝 Generating wiki...
   ├─ Phase 1: Discovery    [████████████████████] 100%
   ├─ Phase 2: Planning     [████████████░░░░░░░░]  60%
   ├─ Phase 3: Generation   [░░░░░░░░░░░░░░░░░░░░]   0%
   └─ Phase 4: Verification [░░░░░░░░░░░░░░░░░░░░]   0%

⚡ Inference: 28.4 tokens/sec  |  📊 VRAM: 12.3 GB  |  🧠 Context: 16K/32K
```

### Subsequent Runs (Model Cached)

```bash
$ ted-mosby generate ./another-project --full-local

🏠 Local Mode Activated
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔍 Detecting hardware...
   └─ GPU: NVIDIA RTX 4090 (24 GB VRAM)

✅ Using cached model: qwen2.5-coder-14b-instruct-q5_k_m

🔍 Indexing repository...
   ...
```

### Power User: Ollama Backend

```bash
# Use existing Ollama installation
$ ted-mosby generate ./project --full-local --use-ollama

# With custom Ollama host
$ ted-mosby generate ./project --full-local --use-ollama --ollama-host http://192.168.1.50:11434

# With specific Ollama model
$ ted-mosby generate ./project --full-local --use-ollama --local-model codestral:22b
```

### Power User: Custom Model

```bash
# Use a specific GGUF file
$ ted-mosby generate ./project --full-local --model-path ~/models/my-custom-model.gguf

# Use a specific HuggingFace model (auto-downloads)
$ ted-mosby generate ./project --full-local --local-model Qwen/Qwen2.5-Coder-32B-Instruct-GGUF
```

---

## CLI Options

```typescript
program
  .command('generate')
  .description('Generate architecture wiki')

  // Local mode flags
  .option('--full-local', 'Run entirely locally without cloud APIs')
  .option('--local-model <model>', 'Model to use (default: auto-selected based on hardware)')
  .option('--model-path <path>', 'Path to a local GGUF model file')

  // Ollama backend (alternative)
  .option('--use-ollama', 'Use Ollama server instead of bundled inference')
  .option('--ollama-host <url>', 'Ollama server URL (default: http://localhost:11434)')

  // Performance tuning
  .option('--gpu-layers <n>', 'Number of layers to offload to GPU (default: auto)')
  .option('--context-size <n>', 'Context window size (default: 32768)')
  .option('--threads <n>', 'CPU threads for inference (default: auto)')

  // Existing options...
  .option('-m, --model <model>', 'Claude model (when not using --full-local)')
```

---

## Implementation Phases

### Phase 1: LLM Provider Abstraction

**Goal:** Create a clean abstraction layer for LLM providers

**New Files:**
```
src/llm/
├── index.ts                  # Exports and factory function
├── types.ts                  # Shared types and interfaces
├── anthropic-provider.ts     # Existing Claude integration (extracted)
├── local-llama-provider.ts   # NEW: node-llama-cpp integration
├── ollama-provider.ts        # NEW: Ollama client integration
├── model-manager.ts          # NEW: Download, cache, hardware detection
└── prompt-adapter.ts         # Model-specific prompt formatting
```

**Core Interface:**

```typescript
// src/llm/types.ts

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
  toolCallId?: string;
  name?: string;
}

export interface LLMTool {
  name: string;
  description: string;
  parameters: JSONSchema;
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  toolCalls: LLMToolCall[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error';
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface LLMProviderOptions {
  maxTokens: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface LLMProvider {
  /** Initialize the provider (load model, connect to server, etc.) */
  initialize(): Promise<void>;

  /** Send a chat completion request */
  chat(
    messages: LLMMessage[],
    tools: LLMTool[],
    options: LLMProviderOptions
  ): Promise<LLMResponse>;

  /** Stream a chat completion (optional) */
  stream?(
    messages: LLMMessage[],
    tools: LLMTool[],
    options: LLMProviderOptions
  ): AsyncIterable<LLMStreamChunk>;

  /** Clean up resources */
  shutdown(): Promise<void>;

  /** Get model information */
  getModelInfo(): {
    name: string;
    contextLength: number;
    supportsTools: boolean;
    supportsStreaming: boolean;
    isLocal: boolean;
  };
}
```

### Phase 2: Model Management System

**Goal:** Automatic hardware detection, model selection, and download management

```typescript
// src/llm/model-manager.ts

import { getLlama, LlamaModel } from 'node-llama-cpp';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

export interface HardwareProfile {
  gpuVendor: 'nvidia' | 'amd' | 'apple' | 'intel' | 'none';
  gpuVram: number;        // In GB
  systemRam: number;      // In GB
  cpuCores: number;
}

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

// Model registry with hardware requirements
const MODEL_REGISTRY: ModelRecommendation[] = [
  {
    modelId: 'qwen2.5-coder-32b-q4',
    ggufFile: 'qwen2.5-coder-32b-instruct-q4_k_m.gguf',
    downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-Coder-32B-Instruct-GGUF/resolve/main/qwen2.5-coder-32b-instruct-q4_k_m.gguf',
    fileSizeBytes: 19_500_000_000,  // ~19.5 GB
    minVram: 20,
    minRam: 24,
    contextLength: 131072,
    quality: 'excellent',
  },
  {
    modelId: 'qwen2.5-coder-14b-q5',
    ggufFile: 'qwen2.5-coder-14b-instruct-q5_k_m.gguf',
    downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-Coder-14B-Instruct-GGUF/resolve/main/qwen2.5-coder-14b-instruct-q5_k_m.gguf',
    fileSizeBytes: 10_200_000_000,  // ~10.2 GB
    minVram: 12,
    minRam: 16,
    contextLength: 131072,
    quality: 'excellent',
  },
  {
    modelId: 'qwen2.5-coder-7b-q5',
    ggufFile: 'qwen2.5-coder-7b-instruct-q5_k_m.gguf',
    downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q5_k_m.gguf',
    fileSizeBytes: 5_500_000_000,   // ~5.5 GB
    minVram: 6,
    minRam: 8,
    contextLength: 131072,
    quality: 'good',
  },
  {
    modelId: 'qwen2.5-coder-3b-q8',
    ggufFile: 'qwen2.5-coder-3b-instruct-q8_0.gguf',
    downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-Coder-3B-Instruct-GGUF/resolve/main/qwen2.5-coder-3b-instruct-q8_0.gguf',
    fileSizeBytes: 3_400_000_000,   // ~3.4 GB
    minVram: 4,
    minRam: 6,
    contextLength: 32768,
    quality: 'acceptable',
  },
];

export class ModelManager {
  private modelsDir: string;

  constructor() {
    this.modelsDir = path.join(os.homedir(), '.ted-mosby', 'models');
  }

  async detectHardware(): Promise<HardwareProfile> {
    const llama = await getLlama();
    const gpuInfo = await llama.getGpuDeviceInfo();

    return {
      gpuVendor: this.detectGpuVendor(gpuInfo),
      gpuVram: this.getVramGb(gpuInfo),
      systemRam: os.totalmem() / (1024 ** 3),
      cpuCores: os.cpus().length,
    };
  }

  recommendModel(hardware: HardwareProfile): ModelRecommendation {
    // Find the best model that fits the hardware
    const candidates = MODEL_REGISTRY
      .filter(m => {
        if (hardware.gpuVram >= m.minVram) return true;
        if (hardware.systemRam >= m.minRam) return true;
        return false;
      })
      .sort((a, b) => {
        // Prefer higher quality, then larger context
        if (a.quality !== b.quality) {
          const qualityOrder = { excellent: 0, good: 1, acceptable: 2 };
          return qualityOrder[a.quality] - qualityOrder[b.quality];
        }
        return b.contextLength - a.contextLength;
      });

    if (candidates.length === 0) {
      throw new Error(
        `Insufficient hardware for local mode.\n` +
        `Minimum requirements: 4GB VRAM or 6GB RAM.\n` +
        `Detected: ${hardware.gpuVram}GB VRAM, ${hardware.systemRam.toFixed(1)}GB RAM`
      );
    }

    return candidates[0];
  }

  async ensureModel(recommendation: ModelRecommendation): Promise<string> {
    const modelPath = path.join(this.modelsDir, recommendation.ggufFile);

    if (existsSync(modelPath)) {
      return modelPath;
    }

    await this.downloadModel(recommendation, modelPath);
    return modelPath;
  }

  private async downloadModel(model: ModelRecommendation, destPath: string): Promise<void> {
    console.log(`\n📦 Downloading model: ${model.modelId}`);
    console.log(`   Size: ${(model.fileSizeBytes / 1e9).toFixed(1)} GB`);
    console.log(`   Destination: ${destPath}\n`);

    await mkdir(path.dirname(destPath), { recursive: true });

    const response = await fetch(model.downloadUrl);
    if (!response.ok) {
      throw new Error(`Failed to download model: ${response.statusText}`);
    }

    const totalBytes = model.fileSizeBytes;
    let downloadedBytes = 0;

    const progressStream = new Transform({
      transform(chunk, encoding, callback) {
        downloadedBytes += chunk.length;
        const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
        const downloaded = (downloadedBytes / 1e9).toFixed(1);
        const total = (totalBytes / 1e9).toFixed(1);

        process.stdout.write(
          `\r   [${this.progressBar(percent)}] ${percent}%  |  ${downloaded}/${total} GB`
        );

        callback(null, chunk);
      },
      progressBar(percent: number): string {
        const width = 40;
        const filled = Math.round((percent / 100) * width);
        return '█'.repeat(filled) + '░'.repeat(width - filled);
      }
    });

    await pipeline(
      response.body,
      progressStream,
      createWriteStream(destPath)
    );

    console.log('\n\n✅ Download complete!\n');
  }
}
```

### Phase 3: LocalLlamaProvider Implementation

**Dependency:**
```json
{
  "dependencies": {
    "node-llama-cpp": "^3.0.0"
  }
}
```

**Implementation:**

```typescript
// src/llm/local-llama-provider.ts

import {
  getLlama,
  LlamaChatSession,
  LlamaModel,
  LlamaContext,
  defineChatSessionFunction,
} from 'node-llama-cpp';
import { ModelManager } from './model-manager';
import type { LLMProvider, LLMMessage, LLMTool, LLMResponse, LLMProviderOptions } from './types';

export interface LocalLlamaProviderOptions {
  modelPath?: string;           // Explicit path to GGUF file
  modelId?: string;             // Model ID from registry
  gpuLayers?: number;           // GPU offload layers (default: auto)
  contextSize?: number;         // Context window size
  threads?: number;             // CPU threads
}

export class LocalLlamaProvider implements LLMProvider {
  private options: LocalLlamaProviderOptions;
  private modelManager: ModelManager;
  private model: LlamaModel | null = null;
  private context: LlamaContext | null = null;
  private modelPath: string = '';

  constructor(options: LocalLlamaProviderOptions = {}) {
    this.options = options;
    this.modelManager = new ModelManager();
  }

  async initialize(): Promise<void> {
    console.log('🔍 Detecting hardware...');
    const hardware = await this.modelManager.detectHardware();

    console.log(`   ├─ GPU: ${this.formatGpuInfo(hardware)}`);
    console.log(`   ├─ RAM: ${hardware.systemRam.toFixed(0)} GB available`);

    // Determine which model to use
    if (this.options.modelPath) {
      // Explicit path provided
      this.modelPath = this.options.modelPath;
      console.log(`   └─ Using specified model: ${this.modelPath}`);
    } else {
      // Auto-select and ensure model is downloaded
      const recommendation = this.modelManager.recommendModel(hardware);
      console.log(`   └─ Recommended model: ${recommendation.modelId}`);
      this.modelPath = await this.modelManager.ensureModel(recommendation);
    }

    // Load the model
    console.log('\n⏳ Loading model...');
    const llama = await getLlama();

    this.model = await llama.loadModel({
      modelPath: this.modelPath,
      gpuLayers: this.options.gpuLayers,  // undefined = auto
    });

    this.context = await this.model.createContext({
      contextSize: this.options.contextSize ?? 32768,
    });

    console.log('✅ Model ready!\n');
  }

  async chat(
    messages: LLMMessage[],
    tools: LLMTool[],
    options: LLMProviderOptions
  ): Promise<LLMResponse> {
    if (!this.context || !this.model) {
      throw new Error('Provider not initialized. Call initialize() first.');
    }

    // Convert tools to node-llama-cpp format
    const functions = this.convertToolsToFunctions(tools);

    // Create chat session with tools
    const session = new LlamaChatSession({
      context: this.context,
      systemPrompt: options.systemPrompt,
    });

    // Convert messages to session format
    for (const msg of messages) {
      if (msg.role === 'user') {
        // User messages will be sent via prompt()
      } else if (msg.role === 'assistant' && typeof msg.content === 'string') {
        // Previous assistant responses
      }
      // Tool results are handled within the function calling flow
    }

    // Get the last user message
    const lastUserMessage = messages
      .filter(m => m.role === 'user')
      .pop();

    if (!lastUserMessage) {
      throw new Error('No user message found');
    }

    const userContent = typeof lastUserMessage.content === 'string'
      ? lastUserMessage.content
      : lastUserMessage.content.map(c => c.type === 'text' ? c.text : '').join('');

    // Prompt with function calling
    let responseText = '';
    const toolCalls: LLMToolCall[] = [];

    const response = await session.prompt(userContent, {
      maxTokens: options.maxTokens,
      temperature: options.temperature ?? 0.7,
      functions,
      onFunctionCall: async (call) => {
        // Collect tool calls for execution by the caller
        toolCalls.push({
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          name: call.functionName,
          arguments: call.params,
        });

        // Return placeholder - actual execution happens in the main loop
        return { pending: true };
      },
    });

    responseText = response;

    return {
      content: responseText,
      toolCalls,
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
      usage: {
        inputTokens: 0,  // node-llama-cpp doesn't expose this easily
        outputTokens: 0,
      },
    };
  }

  private convertToolsToFunctions(tools: LLMTool[]): Record<string, any> {
    const functions: Record<string, any> = {};

    for (const tool of tools) {
      functions[tool.name] = defineChatSessionFunction({
        description: tool.description,
        params: tool.parameters,
        handler: async (params) => {
          // This handler is called during inference
          // We'll intercept via onFunctionCall instead
          return { pending: true };
        },
      });
    }

    return functions;
  }

  async shutdown(): Promise<void> {
    if (this.context) {
      await this.context.dispose();
      this.context = null;
    }
    if (this.model) {
      await this.model.dispose();
      this.model = null;
    }
  }

  getModelInfo() {
    return {
      name: path.basename(this.modelPath, '.gguf'),
      contextLength: this.options.contextSize ?? 32768,
      supportsTools: true,
      supportsStreaming: true,
      isLocal: true,
    };
  }

  private formatGpuInfo(hardware: HardwareProfile): string {
    if (hardware.gpuVendor === 'none') {
      return 'None (CPU-only mode)';
    }
    const vendor = hardware.gpuVendor.charAt(0).toUpperCase() + hardware.gpuVendor.slice(1);
    return `${vendor} (${hardware.gpuVram} GB VRAM)`;
  }
}
```

### Phase 4: Ollama Provider (Alternative Backend)

For power users who prefer Ollama:

```typescript
// src/llm/ollama-provider.ts

import { Ollama } from 'ollama';
import type { LLMProvider, LLMMessage, LLMTool, LLMResponse, LLMProviderOptions } from './types';

export interface OllamaProviderOptions {
  host?: string;  // Default: http://localhost:11434
  model: string;
}

export class OllamaProvider implements LLMProvider {
  private client: Ollama;
  private modelName: string;
  private host: string;

  constructor(options: OllamaProviderOptions) {
    this.host = options.host || 'http://localhost:11434';
    this.client = new Ollama({ host: this.host });
    this.modelName = options.model;
  }

  async initialize(): Promise<void> {
    console.log(`🔌 Connecting to Ollama at ${this.host}...`);

    try {
      // Check connection
      const models = await this.client.list();
      const hasModel = models.models.some(m => m.name.startsWith(this.modelName));

      if (!hasModel) {
        console.log(`\n⚠️  Model '${this.modelName}' not found in Ollama.`);
        console.log(`   Available models:`);
        models.models.forEach(m => console.log(`     - ${m.name}`));
        console.log(`\n   Pull it with: ollama pull ${this.modelName}\n`);
        throw new Error(`Model '${this.modelName}' not available`);
      }

      console.log(`✅ Connected! Using model: ${this.modelName}\n`);
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
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

  async chat(
    messages: LLMMessage[],
    tools: LLMTool[],
    options: LLMProviderOptions
  ): Promise<LLMResponse> {
    const ollamaMessages = this.convertMessages(messages, options.systemPrompt);
    const ollamaTools = this.convertTools(tools);

    const response = await this.client.chat({
      model: this.modelName,
      messages: ollamaMessages,
      tools: ollamaTools,
      options: {
        num_predict: options.maxTokens,
        temperature: options.temperature ?? 0.7,
      },
    });

    return this.parseResponse(response);
  }

  private convertMessages(messages: LLMMessage[], systemPrompt?: string): any[] {
    const result: any[] = [];

    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === 'tool') {
        result.push({
          role: 'tool',
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        });
      } else {
        result.push({
          role: msg.role,
          content: typeof msg.content === 'string' ? msg.content :
            msg.content.map(c => c.type === 'text' ? c.text : '').join(''),
        });
      }
    }

    return result;
  }

  private convertTools(tools: LLMTool[]): any[] {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  private parseResponse(response: any): LLMResponse {
    const toolCalls: LLMToolCall[] = [];

    if (response.message.tool_calls) {
      for (const call of response.message.tool_calls) {
        toolCalls.push({
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          name: call.function.name,
          arguments: typeof call.function.arguments === 'string'
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

  async shutdown(): Promise<void> {
    // Ollama client doesn't need cleanup
  }

  getModelInfo() {
    return {
      name: this.modelName,
      contextLength: 32768,
      supportsTools: true,
      supportsStreaming: true,
      isLocal: true,
    };
  }
}
```

### Phase 5: Provider Factory & CLI Integration

```typescript
// src/llm/index.ts

import { AnthropicProvider } from './anthropic-provider';
import { LocalLlamaProvider } from './local-llama-provider';
import { OllamaProvider } from './ollama-provider';
import type { LLMProvider } from './types';

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
  gpuLayers?: number;
  contextSize?: number;
  threads?: number;

  // Ollama options
  ollamaHost?: string;
}

export async function createLLMProvider(options: CreateProviderOptions): Promise<LLMProvider> {
  let provider: LLMProvider;

  if (options.fullLocal) {
    if (options.useOllama) {
      // Use external Ollama server
      provider = new OllamaProvider({
        host: options.ollamaHost,
        model: options.localModel || 'qwen2.5-coder:14b',
      });
    } else {
      // Use bundled node-llama-cpp (default for --full-local)
      provider = new LocalLlamaProvider({
        modelPath: options.modelPath,
        modelId: options.localModel,
        gpuLayers: options.gpuLayers,
        contextSize: options.contextSize,
        threads: options.threads,
      });
    }
  } else {
    // Use cloud Anthropic API
    provider = new AnthropicProvider({
      apiKey: options.apiKey || process.env.ANTHROPIC_API_KEY!,
      model: options.model || 'claude-sonnet-4-20250514',
    });
  }

  await provider.initialize();
  return provider;
}

export * from './types';
export { AnthropicProvider } from './anthropic-provider';
export { LocalLlamaProvider } from './local-llama-provider';
export { OllamaProvider } from './ollama-provider';
```

**CLI Integration:**

```typescript
// src/cli.ts (additions to generate command)

.option('--full-local', 'Run entirely locally without cloud APIs')
.option('--local-model <model>', 'Local model to use (auto-selected if not specified)')
.option('--model-path <path>', 'Path to a local GGUF model file')
.option('--use-ollama', 'Use Ollama server instead of bundled inference')
.option('--ollama-host <url>', 'Ollama server URL', 'http://localhost:11434')
.option('--gpu-layers <n>', 'GPU layers to offload (default: auto)', parseInt)
.option('--context-size <n>', 'Context window size', parseInt, 32768)
.option('--threads <n>', 'CPU threads for inference', parseInt)
```

---

## Model Recommendations by Hardware

| Hardware Profile | Recommended Model | Download Size | Quality |
|-----------------|-------------------|---------------|---------|
| **High-end GPU (24GB+ VRAM)** | qwen2.5-coder-32b-q4 | 19.5 GB | Excellent |
| **Mid-range GPU (12-16GB VRAM)** | qwen2.5-coder-14b-q5 | 10.2 GB | Excellent |
| **Entry GPU (6-8GB VRAM)** | qwen2.5-coder-7b-q5 | 5.5 GB | Good |
| **Apple Silicon (M1/M2/M3)** | qwen2.5-coder-14b-q5 | 10.2 GB | Excellent |
| **CPU-only (16GB+ RAM)** | qwen2.5-coder-7b-q5 | 5.5 GB | Good |
| **Low-end (8GB RAM)** | qwen2.5-coder-3b-q8 | 3.4 GB | Acceptable |

**Why Qwen 2.5 Coder?**
1. State-of-the-art code understanding
2. Native tool/function calling support
3. 128K context window (plenty for large codebases)
4. Apache 2.0 license (permissive)
5. Excellent GGUF quantizations available
6. Active development by Alibaba

---

## Performance Expectations

| Metric | Claude API | Local 14B (GPU) | Local 7B (GPU) | Local 7B (CPU) |
|--------|------------|-----------------|----------------|----------------|
| Tokens/sec | ~80 | ~25-40 | ~50-80 | ~5-15 |
| Small repo wiki | ~5 min | ~12-18 min | ~8-12 min | ~30-60 min |
| Large repo wiki | ~30 min | ~1.5-2.5 hrs | ~1-1.5 hrs | ~3-6 hrs |
| Quality | Excellent | Very Good | Good | Good |
| Cost | API charges | Free | Free | Free |
| Privacy | Cloud | 100% Local | 100% Local | 100% Local |

---

## Configuration

### Model Cache Location

```
~/.ted-mosby/
├── models/
│   ├── qwen2.5-coder-14b-instruct-q5_k_m.gguf
│   └── qwen2.5-coder-7b-instruct-q5_k_m.gguf
├── config.json
└── local-config.json
```

### Environment Variables

```bash
# Force local mode
TED_MOSBY_FULL_LOCAL=true

# Custom model path
TED_MOSBY_MODEL_PATH=/path/to/model.gguf

# Performance tuning
TED_MOSBY_GPU_LAYERS=40
TED_MOSBY_CONTEXT_SIZE=32768
TED_MOSBY_THREADS=8

# Ollama (if using --use-ollama)
OLLAMA_HOST=http://localhost:11434
```

---

## Error Handling

### Insufficient Hardware

```
$ ted-mosby generate ./project --full-local

❌ Error: Insufficient hardware for local mode.

   Minimum requirements: 4GB VRAM or 6GB RAM
   Detected: 2GB VRAM, 4GB RAM

   Options:
   1. Use cloud mode (remove --full-local flag)
   2. Add more RAM or use a machine with a GPU
   3. Use a smaller model: --local-model qwen2.5-coder-1.5b
```

### Model Download Failed

```
$ ted-mosby generate ./project --full-local

❌ Error: Failed to download model

   URL: https://huggingface.co/...
   Reason: Network timeout

   Retry with:
   $ ted-mosby generate ./project --full-local

   Or download manually:
   $ wget -O ~/.ted-mosby/models/qwen2.5-coder-14b-instruct-q5_k_m.gguf \
       "https://huggingface.co/..."
```

### Out of Memory

```
$ ted-mosby generate ./project --full-local

❌ Error: Out of memory during inference

   The model requires more memory than available.

   Try:
   1. Reduce context size: --context-size 16384
   2. Use fewer GPU layers: --gpu-layers 20
   3. Use a smaller model: --local-model qwen2.5-coder-7b
```

---

## Implementation Checklist

### Phase 1: Foundation
- [ ] Create `src/llm/` directory structure
- [ ] Define `LLMProvider` interface and types in `types.ts`
- [ ] Extract existing Anthropic code to `anthropic-provider.ts`
- [ ] Add unit tests for provider interface

### Phase 2: Model Management
- [ ] Implement `ModelManager` class
- [ ] Add hardware detection (GPU, VRAM, RAM)
- [ ] Create model registry with download URLs
- [ ] Implement download with progress bar
- [ ] Add model caching and verification

### Phase 3: Local Provider
- [ ] Add `node-llama-cpp` dependency
- [ ] Implement `LocalLlamaProvider` class
- [ ] Handle tool/function calling conversion
- [ ] Add GPU layer auto-detection
- [ ] Test with various model sizes

### Phase 4: Ollama Backend
- [ ] Add `ollama` package dependency
- [ ] Implement `OllamaProvider` class
- [ ] Add connection testing and error messages
- [ ] Document Ollama setup for power users

### Phase 5: CLI Integration
- [ ] Add `--full-local` flag
- [ ] Add `--local-model`, `--model-path`, `--use-ollama` options
- [ ] Add performance tuning options
- [ ] Update WikiAgent to use provider factory
- [ ] Add progress indicators and status output

### Phase 6: Testing & Polish
- [ ] Integration tests with small repos
- [ ] Test on various hardware configs
- [ ] Performance benchmarking
- [ ] Documentation and README updates
- [ ] Error message refinement

---

## Future Enhancements

1. **Speculative Decoding** - Use smaller draft model for 2-3x speedup
2. **Quantization Selection** - Let users choose Q4/Q5/Q8 based on quality/speed preference
3. **Distributed Inference** - Split model across multiple GPUs/machines
4. **LoRA Support** - Allow fine-tuned adapters for specific codebases
5. **Model Comparison** - A/B test local vs cloud for quality assessment
6. **Offline Documentation** - Bundle docs for fully air-gapped usage

---

## Summary

The self-contained local mode approach provides:

| Aspect | Benefit |
|--------|---------|
| **Zero Dependencies** | Just `npm install` and go |
| **Automatic Setup** | Hardware detection, model selection, download |
| **Great UX** | Progress bars, clear errors, smart defaults |
| **Flexibility** | Power users can use Ollama or custom models |
| **Privacy** | 100% offline operation, no data leaves the machine |

The main trade-off is the initial model download (~5-20GB depending on hardware), but this is a one-time cost that enables unlimited free usage afterward.
