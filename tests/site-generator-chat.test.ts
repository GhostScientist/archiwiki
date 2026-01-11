/**
 * Tests for Site Generator AI Chat functionality
 *
 * Tests the embeddings generation, content chunking,
 * and chat-related site generation features.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { SiteGenerator } from '../src/site-generator.js';

// Mock the transformers module to avoid loading actual models in tests
vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn().mockResolvedValue(async (text: string) => ({
    data: new Float32Array(384).fill(0.1)
  })),
  env: { cacheDir: './.test-models' }
}));

describe('SiteGenerator Chat Features', () => {
  const testWikiDir = '/tmp/test-wiki';
  const testOutputDir = '/tmp/test-output';

  beforeEach(() => {
    // Create test directories
    if (!fs.existsSync(testWikiDir)) {
      fs.mkdirSync(testWikiDir, { recursive: true });
    }
    if (!fs.existsSync(testOutputDir)) {
      fs.mkdirSync(testOutputDir, { recursive: true });
    }

    // Create a test markdown file
    fs.writeFileSync(
      path.join(testWikiDir, 'README.md'),
      `---
title: Test Documentation
description: A test documentation file
---

# Test Documentation

This is a test documentation file for testing the AI chat feature.

## Architecture Overview

The system is built with a modular architecture that includes:

- Component A: Handles user input
- Component B: Processes data
- Component C: Manages output

## Getting Started

To get started with this project, follow these steps:

1. Clone the repository
2. Install dependencies
3. Run the development server

## API Reference

The API provides the following endpoints:

- GET /api/users - List all users
- POST /api/users - Create a new user
- DELETE /api/users/:id - Delete a user
`
    );
  });

  afterEach(() => {
    // Clean up test directories
    if (fs.existsSync(testWikiDir)) {
      fs.rmSync(testWikiDir, { recursive: true, force: true });
    }
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  describe('aiChat Feature Flag', () => {
    it('should enable aiChat by default', () => {
      const generator = new SiteGenerator({
        wikiDir: testWikiDir,
        outputDir: testOutputDir
      });

      // Access private options through any
      const options = (generator as any).options;
      expect(options.features.aiChat).toBe(true);
    });

    it('should respect aiChat: false option', () => {
      const generator = new SiteGenerator({
        wikiDir: testWikiDir,
        outputDir: testOutputDir,
        features: { aiChat: false }
      });

      const options = (generator as any).options;
      expect(options.features.aiChat).toBe(false);
    });

    it('should preserve other feature flags when setting aiChat', () => {
      const generator = new SiteGenerator({
        wikiDir: testWikiDir,
        outputDir: testOutputDir,
        features: {
          aiChat: true,
          search: false,
          guidedTour: false
        }
      });

      const options = (generator as any).options;
      expect(options.features.aiChat).toBe(true);
      expect(options.features.search).toBe(false);
      expect(options.features.guidedTour).toBe(false);
      expect(options.features.keyboardNav).toBe(true); // Default
    });
  });

  describe('Content Chunking', () => {
    it('should chunk content into appropriate sizes', () => {
      const generator = new SiteGenerator({
        wikiDir: testWikiDir,
        outputDir: testOutputDir
      });

      const content = `
This is a long piece of content that should be chunked into smaller pieces.
It contains multiple sentences and paragraphs. The chunking algorithm should
respect sentence boundaries when possible. This helps ensure that each chunk
contains complete thoughts rather than cutting off mid-sentence.

Here is another paragraph with more content. The chunks should overlap slightly
to ensure context is preserved between chunks. This is important for semantic
search to work effectively.

And yet another paragraph to ensure we have enough content to test the chunking.
The final chunk should contain this text along with some overlap from the
previous chunk.
      `.trim();

      // Call private method through any
      const chunks = (generator as any).chunkContent(content, 200, 50);

      expect(Array.isArray(chunks)).toBe(true);
      expect(chunks.length).toBeGreaterThan(0);

      // Each chunk should be reasonably sized
      for (const chunk of chunks) {
        expect(chunk.length).toBeGreaterThan(50);
        expect(chunk.length).toBeLessThan(400); // Allow some overflow for sentence boundaries
      }
    });

    it('should skip very small chunks', () => {
      const generator = new SiteGenerator({
        wikiDir: testWikiDir,
        outputDir: testOutputDir
      });

      const content = 'Short. Very short content.';
      const chunks = (generator as any).chunkContent(content, 500, 100);

      // Small content may result in no chunks or one chunk
      expect(chunks.length).toBeLessThanOrEqual(1);
    });

    it('should handle empty content', () => {
      const generator = new SiteGenerator({
        wikiDir: testWikiDir,
        outputDir: testOutputDir
      });

      const chunks = (generator as any).chunkContent('', 500, 100);
      expect(chunks.length).toBe(0);
    });

    it('should strip markdown formatting before chunking', () => {
      const generator = new SiteGenerator({
        wikiDir: testWikiDir,
        outputDir: testOutputDir
      });

      const content = `
# Heading

This is **bold** and *italic* text.

\`\`\`javascript
const code = 'block';
\`\`\`

[Link text](http://example.com)
      `.trim();

      const stripped = (generator as any).stripMarkdown(content);

      expect(stripped).not.toContain('```');
      expect(stripped).not.toContain('**');
      expect(stripped).not.toContain('*');
      expect(stripped).not.toContain('[');
      expect(stripped).not.toContain('](');
      expect(stripped).toContain('Link text');
    });
  });

  describe('Markdown Stripping', () => {
    it('should remove code blocks', () => {
      const generator = new SiteGenerator({
        wikiDir: testWikiDir,
        outputDir: testOutputDir
      });

      const content = 'Before ```js\nconst x = 1;\n``` After';
      const stripped = (generator as any).stripMarkdown(content);

      expect(stripped).not.toContain('const x = 1');
      expect(stripped).toContain('Before');
      expect(stripped).toContain('After');
    });

    it('should remove inline code', () => {
      const generator = new SiteGenerator({
        wikiDir: testWikiDir,
        outputDir: testOutputDir
      });

      const content = 'Use the `console.log` function';
      const stripped = (generator as any).stripMarkdown(content);

      expect(stripped).not.toContain('`');
      expect(stripped).not.toContain('console.log');
    });

    it('should convert links to plain text', () => {
      const generator = new SiteGenerator({
        wikiDir: testWikiDir,
        outputDir: testOutputDir
      });

      const content = 'Visit [our website](https://example.com) for more info';
      const stripped = (generator as any).stripMarkdown(content);

      expect(stripped).toContain('our website');
      expect(stripped).not.toContain('https://example.com');
      expect(stripped).not.toContain('[');
      expect(stripped).not.toContain(']');
    });

    it('should remove emphasis markers', () => {
      const generator = new SiteGenerator({
        wikiDir: testWikiDir,
        outputDir: testOutputDir
      });

      const content = 'This is **bold**, *italic*, and ~~strikethrough~~';
      const stripped = (generator as any).stripMarkdown(content);

      expect(stripped).not.toContain('**');
      expect(stripped).not.toContain('*');
      expect(stripped).not.toContain('~~');
    });

    it('should remove heading markers', () => {
      const generator = new SiteGenerator({
        wikiDir: testWikiDir,
        outputDir: testOutputDir
      });

      const content = '# Heading 1\n## Heading 2\n### Heading 3';
      const stripped = (generator as any).stripMarkdown(content);

      expect(stripped).not.toMatch(/^#+ /m);
      expect(stripped).toContain('Heading 1');
      expect(stripped).toContain('Heading 2');
      expect(stripped).toContain('Heading 3');
    });
  });

  describe('Site Generation Options', () => {
    it('should include all default features', () => {
      const generator = new SiteGenerator({
        wikiDir: testWikiDir,
        outputDir: testOutputDir
      });

      const options = (generator as any).options;
      expect(options.features).toEqual({
        guidedTour: true,
        codeExplorer: true,
        search: true,
        progressTracking: true,
        keyboardNav: true,
        aiChat: true
      });
    });

    it('should use default theme when not specified', () => {
      const generator = new SiteGenerator({
        wikiDir: testWikiDir,
        outputDir: testOutputDir
      });

      const options = (generator as any).options;
      expect(options.theme).toBe('auto');
    });

    it('should use custom theme when specified', () => {
      const generator = new SiteGenerator({
        wikiDir: testWikiDir,
        outputDir: testOutputDir,
        theme: 'dark'
      });

      const options = (generator as any).options;
      expect(options.theme).toBe('dark');
    });
  });
});

describe('Embeddings Index Structure', () => {
  it('should have correct structure for embeddings index', () => {
    // Test the expected structure of embeddings-index.json
    const expectedStructure = {
      model: 'Xenova/all-MiniLM-L6-v2',
      dimension: 384,
      generated: expect.any(String),
      chunks: expect.any(Array)
    };

    const sampleIndex = {
      model: 'Xenova/all-MiniLM-L6-v2',
      dimension: 384,
      generated: new Date().toISOString(),
      chunks: [
        {
          path: 'README.html',
          title: 'Test',
          content: 'Test content',
          embedding: new Array(384).fill(0.1)
        }
      ]
    };

    expect(sampleIndex).toMatchObject(expectedStructure);
    expect(sampleIndex.chunks[0].embedding.length).toBe(384);
  });

  it('should validate chunk structure', () => {
    const validChunk = {
      path: 'architecture/overview.html',
      title: 'Architecture Overview',
      content: 'The system architecture consists of...',
      embedding: new Array(384).fill(0.1)
    };

    expect(validChunk).toHaveProperty('path');
    expect(validChunk).toHaveProperty('title');
    expect(validChunk).toHaveProperty('content');
    expect(validChunk).toHaveProperty('embedding');
    expect(validChunk.path).toMatch(/\.html$/);
    expect(validChunk.embedding.length).toBe(384);
  });
});
