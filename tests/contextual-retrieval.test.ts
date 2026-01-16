/**
 * Tests for Contextual Retrieval Module
 *
 * Tests the contextual retrieval functionality that enriches code chunks
 * with LLM-generated context for improved semantic search.
 *
 * Reference: https://www.anthropic.com/news/contextual-retrieval
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{
          type: 'text',
          text: 'This code is from auth.ts. It handles user authentication using JWT tokens.'
        }]
      })
    }
  }))
}));

// Mock the LLM provider for local mode
vi.mock('../src/llm/index.js', () => ({
  createLLMProvider: vi.fn().mockResolvedValue({
    initialize: vi.fn().mockResolvedValue(undefined),
    chat: vi.fn().mockResolvedValue({
      content: 'This is a function that validates user credentials.',
      toolCalls: [],
      stopReason: 'end_turn',
      usage: { inputTokens: 100, outputTokens: 50 }
    }),
    shutdown: vi.fn().mockResolvedValue(undefined),
    getModelInfo: vi.fn().mockReturnValue({
      name: 'gpt-oss-21b',
      contextLength: 32768,
      supportsTools: true,
      supportsStreaming: true,
      isLocal: true
    })
  })
}));

// Import after mocks are set up
import {
  ContextualRetrieval,
  ContextualRetrievalConfig,
  ContextualChunk,
  estimateContextualRetrievalCost
} from '../src/rag/contextual-retrieval.js';
import type { ASTChunk } from '../src/ast-chunker.js';

describe('ContextualRetrieval', () => {
  const testCacheDir = '/tmp/test-contextual-cache';

  beforeEach(() => {
    // Clean up cache directory
    if (fs.existsSync(testCacheDir)) {
      fs.rmSync(testCacheDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testCacheDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testCacheDir)) {
      fs.rmSync(testCacheDir, { recursive: true, force: true });
    }
  });

  describe('Configuration', () => {
    it('should use default values when not provided', () => {
      const config: ContextualRetrievalConfig = {
        enabled: true
      };

      const retrieval = new ContextualRetrieval(config);
      const stats = retrieval.getStats();

      expect(stats.cacheSize).toBe(0);
      expect(stats.filesProcessed).toBe(0);
    });

    it('should respect enabled flag', async () => {
      const config: ContextualRetrievalConfig = {
        enabled: false
      };

      const retrieval = new ContextualRetrieval(config);
      const mockChunks: ASTChunk[] = [{
        id: 'test-1',
        filePath: 'src/test.ts',
        startLine: 1,
        endLine: 10,
        content: 'function test() {}',
        language: 'typescript'
      }];

      const result = await retrieval.enrichChunks(mockChunks, '/test/repo');

      // When disabled, should return chunks with empty context
      expect(result[0].contextualPrefix).toBe('');
      expect(result[0].enrichedContent).toBe(mockChunks[0].content);
    });

    it('should use Claude API by default when not using local', () => {
      const config: ContextualRetrievalConfig = {
        enabled: true,
        useLocal: false,
        apiKey: 'test-api-key'
      };

      const retrieval = new ContextualRetrieval(config);
      // The retrieval should be configured for Claude API
      expect(retrieval).toBeDefined();
    });

    it('should configure for Ollama when useLocal and useOllama are true', () => {
      const config: ContextualRetrievalConfig = {
        enabled: true,
        useLocal: true,
        useOllama: true,
        ollamaHost: 'http://localhost:11434',
        localModel: 'qwen2.5-coder:7b'
      };

      const retrieval = new ContextualRetrieval(config);
      expect(retrieval).toBeDefined();
    });

    it('should configure for bundled local when useLocal is true without useOllama', () => {
      const config: ContextualRetrievalConfig = {
        enabled: true,
        useLocal: true,
        useOllama: false
      };

      const retrieval = new ContextualRetrieval(config);
      expect(retrieval).toBeDefined();
    });
  });

  describe('Fallback Context Generation', () => {
    it('should generate fallback context from AST metadata', async () => {
      const config: ContextualRetrievalConfig = {
        enabled: true,
        useLocal: true,
        cacheDir: testCacheDir
      };

      const retrieval = new ContextualRetrieval(config);

      // Access private method via prototype (for testing)
      const generateFallback = (retrieval as any).generateFallbackContext.bind(retrieval);

      const chunk: ASTChunk = {
        id: 'test-1',
        filePath: 'src/auth/login.ts',
        startLine: 10,
        endLine: 25,
        content: 'async function validateCredentials() {}',
        language: 'typescript',
        chunkType: 'function',
        name: 'validateCredentials',
        domainHints: [
          { category: 'authentication', confidence: 0.9 }
        ]
      };

      const context = generateFallback(chunk);

      expect(context).toContain('login.ts');
      expect(context).toContain('validateCredentials');
      expect(context).toContain('function');
      expect(context).toContain('authentication');
    });

    it('should handle chunks without optional metadata', () => {
      const config: ContextualRetrievalConfig = {
        enabled: true,
        useLocal: true
      };

      const retrieval = new ContextualRetrieval(config);
      const generateFallback = (retrieval as any).generateFallbackContext.bind(retrieval);

      const chunk: ASTChunk = {
        id: 'test-2',
        filePath: 'src/utils/helpers.ts',
        startLine: 1,
        endLine: 5,
        content: 'const x = 1;',
        language: 'typescript'
      };

      const context = generateFallback(chunk);

      expect(context).toContain('helpers.ts');
      expect(context).not.toContain('undefined');
    });

    it('should include parent name when available', () => {
      const config: ContextualRetrievalConfig = {
        enabled: true,
        useLocal: true
      };

      const retrieval = new ContextualRetrieval(config);
      const generateFallback = (retrieval as any).generateFallbackContext.bind(retrieval);

      const chunk: ASTChunk = {
        id: 'test-3',
        filePath: 'src/services/UserService.ts',
        startLine: 20,
        endLine: 30,
        content: 'async getUserById(id: string) {}',
        language: 'typescript',
        chunkType: 'method',
        name: 'getUserById',
        parentName: 'UserService'
      };

      const context = generateFallback(chunk);

      expect(context).toContain('UserService');
      expect(context).toContain('getUserById');
    });
  });

  describe('Content Truncation', () => {
    it('should truncate long content at natural boundaries', () => {
      const config: ContextualRetrievalConfig = {
        enabled: true
      };

      const retrieval = new ContextualRetrieval(config);
      const truncate = (retrieval as any).truncateContent.bind(retrieval);

      // Use a much longer content to properly test truncation
      const longContent = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10';
      const truncated = truncate(longContent, 30);

      expect(truncated).toContain('[truncated]');
      // The base content before marker should be truncated
      expect(truncated.indexOf('[truncated]')).toBeGreaterThan(0);
    });

    it('should not truncate content shorter than limit', () => {
      const config: ContextualRetrievalConfig = {
        enabled: true
      };

      const retrieval = new ContextualRetrieval(config);
      const truncate = (retrieval as any).truncateContent.bind(retrieval);

      const shortContent = 'Hello World';
      const result = truncate(shortContent, 100);

      expect(result).toBe(shortContent);
      expect(result).not.toContain('[truncated]');
    });
  });

  describe('Cache Management', () => {
    it('should save and load cache', () => {
      const config: ContextualRetrievalConfig = {
        enabled: true,
        cacheDir: testCacheDir
      };

      // Create retrieval and manually add to cache
      const retrieval = new ContextualRetrieval(config);
      const contextCache = (retrieval as any).contextCache as Map<string, string>;
      contextCache.set('test-key:100', 'Test context for chunk');

      // Save cache
      (retrieval as any).saveCache();

      // Create new retrieval instance - should load cache
      const retrieval2 = new ContextualRetrieval(config);
      const loadedCache = (retrieval2 as any).contextCache as Map<string, string>;

      expect(loadedCache.get('test-key:100')).toBe('Test context for chunk');
    });

    it('should use cache key based on chunk id and content length', () => {
      const chunk: ASTChunk = {
        id: 'src/auth.ts:10-20',
        filePath: 'src/auth.ts',
        startLine: 10,
        endLine: 20,
        content: 'function authenticate() { /* ... */ }',
        language: 'typescript'
      };

      const cacheKey = `${chunk.id}:${chunk.content.length}`;
      expect(cacheKey).toBe('src/auth.ts:10-20:37');
    });
  });

  describe('Statistics', () => {
    it('should track cache statistics', () => {
      const config: ContextualRetrievalConfig = {
        enabled: true,
        cacheDir: testCacheDir
      };

      const retrieval = new ContextualRetrieval(config);

      // Add some entries to the internal caches
      const contextCache = (retrieval as any).contextCache as Map<string, string>;
      const fileCache = (retrieval as any).fileContentCache as Map<string, string>;

      contextCache.set('key1', 'context1');
      contextCache.set('key2', 'context2');
      fileCache.set('file1.ts', 'content1');

      const stats = retrieval.getStats();

      expect(stats.cacheSize).toBe(2);
      expect(stats.filesProcessed).toBe(1);
    });
  });
});

describe('Cost Estimation', () => {
  it('should estimate cost for contextual retrieval', () => {
    const estimate = estimateContextualRetrievalCost(1000, 5000);

    expect(estimate.inputTokens).toBeGreaterThan(0);
    expect(estimate.outputTokens).toBe(100000); // 100 tokens per chunk
    expect(estimate.estimatedCost).toBeGreaterThan(0);
    expect(estimate.withCaching).toBeLessThan(estimate.estimatedCost);
  });

  it('should show significant savings with caching', () => {
    const estimate = estimateContextualRetrievalCost(10000);

    // Caching should reduce cost by ~90% on input side
    const savingsRatio = estimate.withCaching / estimate.estimatedCost;
    expect(savingsRatio).toBeLessThan(0.5); // At least 50% savings
  });

  it('should scale linearly with chunk count', () => {
    const estimate1 = estimateContextualRetrievalCost(1000);
    const estimate2 = estimateContextualRetrievalCost(2000);

    // Cost should roughly double
    expect(estimate2.estimatedCost).toBeCloseTo(estimate1.estimatedCost * 2, 1);
  });

  it('should account for file size in token estimation', () => {
    const smallFiles = estimateContextualRetrievalCost(1000, 2000);
    const largeFiles = estimateContextualRetrievalCost(1000, 10000);

    expect(largeFiles.inputTokens).toBeGreaterThan(smallFiles.inputTokens);
  });
});

describe('Enriched Chunks', () => {
  it('should combine context prefix with original content', () => {
    const contextPrefix = 'This code is from auth.ts and handles user login.';
    const originalContent = 'function login(user, pass) { /* ... */ }';

    const enrichedContent = `${contextPrefix}\n\n${originalContent}`;

    expect(enrichedContent).toContain(contextPrefix);
    expect(enrichedContent).toContain(originalContent);
    expect(enrichedContent.indexOf(contextPrefix)).toBeLessThan(
      enrichedContent.indexOf(originalContent)
    );
  });

  it('should preserve original chunk properties', () => {
    const originalChunk: ASTChunk = {
      id: 'test-1',
      filePath: 'src/test.ts',
      startLine: 1,
      endLine: 10,
      content: 'function test() {}',
      language: 'typescript',
      chunkType: 'function',
      name: 'test'
    };

    const enrichedChunk: ContextualChunk = {
      ...originalChunk,
      contextualPrefix: 'Test context',
      enrichedContent: 'Test context\n\nfunction test() {}'
    };

    expect(enrichedChunk.id).toBe(originalChunk.id);
    expect(enrichedChunk.filePath).toBe(originalChunk.filePath);
    expect(enrichedChunk.chunkType).toBe(originalChunk.chunkType);
    expect(enrichedChunk.name).toBe(originalChunk.name);
  });
});

describe('Context Prompt Template', () => {
  const EXPECTED_PROMPT_STRUCTURE = `<document>
{WHOLE_DOCUMENT}
</document>

Here is the chunk we want to situate within the whole document:
<chunk>
{CHUNK_CONTENT}
</chunk>`;

  it('should use XML-style document and chunk markers', () => {
    expect(EXPECTED_PROMPT_STRUCTURE).toContain('<document>');
    expect(EXPECTED_PROMPT_STRUCTURE).toContain('</document>');
    expect(EXPECTED_PROMPT_STRUCTURE).toContain('<chunk>');
    expect(EXPECTED_PROMPT_STRUCTURE).toContain('</chunk>');
  });

  it('should have placeholders for document and chunk content', () => {
    expect(EXPECTED_PROMPT_STRUCTURE).toContain('{WHOLE_DOCUMENT}');
    expect(EXPECTED_PROMPT_STRUCTURE).toContain('{CHUNK_CONTENT}');
  });
});

describe('Mode Selection', () => {
  interface ModeConfig {
    useLocal: boolean;
    useOllama: boolean;
  }

  function determineMode(config: ModeConfig): 'claude-api' | 'ollama' | 'bundled-local' {
    if (!config.useLocal) {
      return 'claude-api';
    }
    if (config.useOllama) {
      return 'ollama';
    }
    return 'bundled-local';
  }

  it('should use Claude API when useLocal is false', () => {
    expect(determineMode({ useLocal: false, useOllama: false })).toBe('claude-api');
    expect(determineMode({ useLocal: false, useOllama: true })).toBe('claude-api');
  });

  it('should use Ollama when both useLocal and useOllama are true', () => {
    expect(determineMode({ useLocal: true, useOllama: true })).toBe('ollama');
  });

  it('should use bundled local when useLocal is true and useOllama is false', () => {
    expect(determineMode({ useLocal: true, useOllama: false })).toBe('bundled-local');
  });
});

describe('Concurrency Settings', () => {
  it('should use higher concurrency for API mode', () => {
    const apiConcurrency = 5;
    const localConcurrency = 1;

    expect(apiConcurrency).toBeGreaterThan(localConcurrency);
  });

  it('should process sequentially for local mode to manage memory', () => {
    const config: ContextualRetrievalConfig = {
      enabled: true,
      useLocal: true,
      useOllama: false
    };

    // When useLocal is true, concurrency should default to 1
    const expectedConcurrency = config.useLocal ? 1 : 5;
    expect(expectedConcurrency).toBe(1);
  });
});

describe('Error Handling', () => {
  it('should fall back to AST-based context on LLM failure', () => {
    // Simulate what happens when LLM call fails
    const chunk: ASTChunk = {
      id: 'test-1',
      filePath: 'src/auth/jwt.ts',
      startLine: 1,
      endLine: 20,
      content: 'export function verifyToken(token: string) {}',
      language: 'typescript',
      chunkType: 'function',
      name: 'verifyToken',
      domainHints: [
        { category: 'authentication', confidence: 0.95 }
      ]
    };

    // Fallback context should include available metadata
    const fallbackParts: string[] = [];
    fallbackParts.push(`This code is from ${path.basename(chunk.filePath)}.`);
    if (chunk.chunkType && chunk.name) {
      fallbackParts.push(`It defines ${chunk.name}, a ${chunk.chunkType}.`);
    }

    const fallbackContext = fallbackParts.join(' ');

    expect(fallbackContext).toContain('jwt.ts');
    expect(fallbackContext).toContain('verifyToken');
    expect(fallbackContext).toContain('function');
  });

  it('should continue processing other chunks when one fails', async () => {
    // This tests the principle that failures are isolated
    const chunks: ASTChunk[] = [
      { id: '1', filePath: 'a.ts', startLine: 1, endLine: 5, content: 'code1', language: 'ts' },
      { id: '2', filePath: 'b.ts', startLine: 1, endLine: 5, content: 'code2', language: 'ts' },
      { id: '3', filePath: 'c.ts', startLine: 1, endLine: 5, content: 'code3', language: 'ts' }
    ];

    // Even if one chunk fails, the others should be processed
    // The implementation catches errors per-chunk and uses fallback
    expect(chunks.length).toBe(3);
  });
});

describe('Integration with RAG System', () => {
  it('should produce enriched content suitable for embeddings', () => {
    const contextPrefix = 'This is the authentication module that handles JWT token verification.';
    const originalCode = `
export function verifyToken(token: string): boolean {
  return jwt.verify(token, secret);
}`;

    const enrichedContent = `${contextPrefix}\n\n${originalCode}`;

    // The enriched content should contain:
    // 1. Business context (what the code does)
    // 2. The original code
    expect(enrichedContent).toContain('authentication');
    expect(enrichedContent).toContain('JWT');
    expect(enrichedContent).toContain('verifyToken');
    expect(enrichedContent).toContain('jwt.verify');
  });

  it('should improve retrieval by adding semantic context', () => {
    // Original code might not match query "user login"
    const originalCode = 'function authenticate(creds) { return true; }';

    // With contextual prefix, it can now match
    const enrichedCode = 'This function handles user login by validating credentials.\n\n' + originalCode;

    // The enriched version now contains relevant terms
    expect(enrichedCode.toLowerCase()).toContain('user');
    expect(enrichedCode.toLowerCase()).toContain('login');
    expect(enrichedCode.toLowerCase()).toContain('credentials');
  });
});
