/**
 * RAG (Retrieval Augmented Generation) System for ArchitecturalWiki
 *
 * Uses FAISS for vector similarity search over codebase embeddings.
 * Chunks code at logical boundaries and indexes for semantic retrieval.
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import Anthropic from '@anthropic-ai/sdk';

// FAISS types (faiss-node)
let faiss: any;
try {
  faiss = require('faiss-node');
} catch (e) {
  console.warn('Warning: faiss-node not available, using fallback similarity search');
}

export interface RAGConfig {
  storePath: string;
  repoPath: string;
  chunkSize?: number;
  chunkOverlap?: number;
  embeddingModel?: string;
}

export interface CodeChunk {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  language: string;
}

export interface SearchResult extends CodeChunk {
  score: number;
}

export interface SearchOptions {
  maxResults?: number;
  fileTypes?: string[];
  excludeTests?: boolean;
}

interface StoredMetadata {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  language: string;
}

// File extensions to index
const INDEXABLE_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyx',
  '.go',
  '.rs',
  '.java', '.kt', '.scala',
  '.rb',
  '.php',
  '.c', '.cpp', '.h', '.hpp',
  '.cs',
  '.swift',
  '.vue', '.svelte',
  '.json', '.yaml', '.yml', '.toml',
  '.md', '.mdx'
];

// Patterns to exclude
const EXCLUDE_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/coverage/**',
  '**/__pycache__/**',
  '**/venv/**',
  '**/.venv/**',
  '**/vendor/**',
  '**/*.min.js',
  '**/*.bundle.js',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml'
];

export class RAGSystem {
  private config: RAGConfig;
  private anthropic: Anthropic;
  private index: any = null;  // FAISS index
  private metadata: Map<number, StoredMetadata> = new Map();
  private embeddingDimension = 1024;  // Voyage embeddings dimension
  private documentCount = 0;

  constructor(config: RAGConfig) {
    this.config = {
      chunkSize: 1500,
      chunkOverlap: 200,
      ...config
    };

    this.anthropic = new Anthropic();

    // Ensure cache directory exists
    if (!fs.existsSync(this.config.storePath)) {
      fs.mkdirSync(this.config.storePath, { recursive: true });
    }
  }

  /**
   * Index the repository for semantic search
   */
  async indexRepository(): Promise<void> {
    const cachedIndexPath = path.join(this.config.storePath, 'index.faiss');
    const cachedMetaPath = path.join(this.config.storePath, 'metadata.json');

    // Try to load cached index
    if (fs.existsSync(cachedIndexPath) && fs.existsSync(cachedMetaPath) && faiss) {
      try {
        this.index = faiss.read_index(cachedIndexPath);
        const metaData = JSON.parse(fs.readFileSync(cachedMetaPath, 'utf-8'));
        this.metadata = new Map(Object.entries(metaData).map(([k, v]) => [parseInt(k), v as StoredMetadata]));
        this.documentCount = this.metadata.size;
        console.log(`Loaded cached index with ${this.documentCount} chunks`);
        return;
      } catch (e) {
        console.warn('Could not load cached index, rebuilding...');
      }
    }

    // Discover files
    console.log('  Discovering files...');
    const files = await this.discoverFiles();
    console.log(`  Found ${files.length} files to index`);

    // Chunk files with progress
    const chunks: CodeChunk[] = [];
    let lastProgress = -1;

    for (let i = 0; i < files.length; i++) {
      // Yield to event loop every 10 files to allow Ctrl+C
      if (i % 10 === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }

      const file = files[i];

      // Show progress every 5%
      const progress = Math.floor((i + 1) / files.length * 100);
      if (progress >= lastProgress + 5) {
        console.log(`  Chunking... ${i + 1}/${files.length} (${progress}%)`);
        lastProgress = progress;
      }

      try {
        const fileChunks = await this.chunkFile(file);
        chunks.push(...fileChunks);
      } catch (err) {
        // Skip files that fail to chunk
      }
    }
    console.log(`  Chunking complete: ${chunks.length} chunks from ${files.length} files`);

    if (chunks.length === 0) {
      console.warn('No code chunks to index');
      return;
    }

    // Generate embeddings
    console.log(`  Generating embeddings for ${chunks.length} chunks...`);
    const embeddings = await this.generateEmbeddings(chunks);

    // Build FAISS index
    console.log(`  Building search index...`);
    if (faiss && embeddings.length > 0) {
      this.index = new faiss.IndexFlatIP(this.embeddingDimension);  // Inner product for cosine similarity

      // Add all embeddings
      for (let i = 0; i < embeddings.length; i++) {
        // Normalize for cosine similarity
        const normalized = this.normalizeVector(embeddings[i]);
        this.index.add([normalized]);
        this.metadata.set(i, {
          id: chunks[i].id,
          filePath: chunks[i].filePath,
          startLine: chunks[i].startLine,
          endLine: chunks[i].endLine,
          content: chunks[i].content,
          language: chunks[i].language
        });
      }

      // Save index and metadata
      faiss.write_index(this.index, cachedIndexPath);
      fs.writeFileSync(
        cachedMetaPath,
        JSON.stringify(Object.fromEntries(this.metadata)),
        'utf-8'
      );

      this.documentCount = chunks.length;
      console.log(`  ✓ Indexed ${this.documentCount} chunks with FAISS`);
    } else {
      // Fallback: just store chunks for simple search
      chunks.forEach((chunk, i) => {
        this.metadata.set(i, {
          id: chunk.id,
          filePath: chunk.filePath,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          content: chunk.content,
          language: chunk.language
        });
      });
      this.documentCount = chunks.length;
      console.log(`  ✓ Indexed ${this.documentCount} chunks (keyword search mode)`);
    }
  }

  /**
   * Discover all indexable files in the repository
   */
  private async discoverFiles(): Promise<string[]> {
    const files: string[] = [];

    // Process extensions one at a time with event loop yields
    for (let i = 0; i < INDEXABLE_EXTENSIONS.length; i++) {
      const ext = INDEXABLE_EXTENSIONS[i];

      // Yield to event loop to allow Ctrl+C to work
      await new Promise(resolve => setImmediate(resolve));

      try {
        const matches = await glob(`**/*${ext}`, {
          cwd: this.config.repoPath,
          ignore: EXCLUDE_PATTERNS,
          absolute: false
        });
        files.push(...matches);

        // Show progress for large repos
        if (matches.length > 0) {
          console.log(`    Found ${matches.length} ${ext} files`);
        }
      } catch (err) {
        // Skip on error, continue with other extensions
      }
    }

    return [...new Set(files)];  // Remove duplicates
  }

  /**
   * Chunk a file into logical segments
   */
  private async chunkFile(filePath: string): Promise<CodeChunk[]> {
    const fullPath = path.join(this.config.repoPath, filePath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    const ext = path.extname(filePath);
    const language = this.getLanguage(ext);

    const chunks: CodeChunk[] = [];
    const chunkSize = this.config.chunkSize!;
    const overlap = this.config.chunkOverlap!;

    // Simple line-based chunking with overlap
    // TODO: Enhance with AST-aware chunking for better boundaries
    let startLine = 0;

    while (startLine < lines.length) {
      // Calculate chunk boundaries
      let endLine = startLine;
      let charCount = 0;

      while (endLine < lines.length && charCount < chunkSize) {
        charCount += lines[endLine].length + 1;  // +1 for newline
        endLine++;
      }

      // Try to end at a logical boundary (empty line, closing brace)
      const lookAhead = Math.min(endLine + 10, lines.length);
      for (let i = endLine; i < lookAhead; i++) {
        const line = lines[i].trim();
        if (line === '' || line === '}' || line === '};' || line === 'end') {
          endLine = i + 1;
          break;
        }
      }

      const chunkContent = lines.slice(startLine, endLine).join('\n');

      if (chunkContent.trim().length > 50) {  // Skip tiny chunks
        chunks.push({
          id: `${filePath}:${startLine + 1}-${endLine}`,
          filePath,
          startLine: startLine + 1,  // 1-indexed
          endLine,
          content: chunkContent,
          language
        });
      }

      // Move to next chunk with overlap
      const prevStartLine = startLine;
      startLine = endLine - Math.floor(overlap / 50);  // Overlap in lines

      // Prevent infinite loop - ensure we always make progress
      if (startLine <= prevStartLine) {
        startLine = endLine;
      }
    }

    return chunks;
  }

  /**
   * Generate embeddings for code chunks using Anthropic's Voyage embeddings via their SDK
   */
  private async generateEmbeddings(chunks: CodeChunk[]): Promise<number[][]> {
    const embeddings: number[][] = [];

    // Process in batches
    const batchSize = 20;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);

      try {
        // Use Anthropic to generate embeddings via message
        // Note: Anthropic doesn't have a direct embedding API, so we use a workaround
        // In production, you'd use Voyage AI or OpenAI embeddings
        const batchEmbeddings = await this.generateSimpleEmbeddings(batch);
        embeddings.push(...batchEmbeddings);

        // Progress update every batch
        const processed = Math.min(i + batchSize, chunks.length);
        const percent = Math.floor(processed / chunks.length * 100);
        console.log(`  Embedding... ${processed}/${chunks.length} (${percent}%)`);

      } catch (error) {
        console.warn(`Embedding error at batch ${i}: ${error}`);
        // Add zero vectors as fallback
        for (let j = 0; j < batch.length; j++) {
          embeddings.push(new Array(this.embeddingDimension).fill(0));
        }
      }
    }

    console.log(`  Embedding complete: ${embeddings.length} vectors generated`);
    return embeddings;
  }

  /**
   * Simple TF-IDF-like embedding for fallback when API embedding isn't available
   * This is a simplified implementation - production should use proper embeddings
   */
  private async generateSimpleEmbeddings(chunks: CodeChunk[]): Promise<number[][]> {
    return chunks.map(chunk => {
      // Create a simple bag-of-words vector
      const words = chunk.content.toLowerCase()
        .replace(/[^a-z0-9_]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2);

      // Simple hash-based embedding
      const vector = new Array(this.embeddingDimension).fill(0);
      for (const word of words) {
        const hash = this.simpleHash(word) % this.embeddingDimension;
        vector[hash] += 1;
      }

      return this.normalizeVector(vector);
    });
  }

  /**
   * Simple string hash function
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  /**
   * Normalize a vector for cosine similarity
   */
  private normalizeVector(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (norm === 0) return vector;
    return vector.map(val => val / norm);
  }

  /**
   * Search the codebase for relevant code
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const maxResults = options.maxResults || 10;

    if (this.metadata.size === 0) {
      return [];
    }

    // Generate query embedding
    const [queryEmbedding] = await this.generateSimpleEmbeddings([{
      id: 'query',
      filePath: '',
      startLine: 0,
      endLine: 0,
      content: query,
      language: ''
    }]);

    let results: SearchResult[] = [];

    if (this.index && faiss) {
      // FAISS search
      const normalized = this.normalizeVector(queryEmbedding);
      const { distances, labels } = this.index.search([normalized], maxResults * 2);

      for (let i = 0; i < labels[0].length; i++) {
        const label = labels[0][i];
        if (label === -1) continue;

        const meta = this.metadata.get(label);
        if (!meta) continue;

        // Apply filters
        if (options.excludeTests && this.isTestFile(meta.filePath)) continue;
        if (options.fileTypes && !options.fileTypes.some(ext => meta.filePath.endsWith(ext))) continue;

        results.push({
          ...meta,
          score: distances[0][i]
        });

        if (results.length >= maxResults) break;
      }
    } else {
      // Fallback: simple keyword matching
      const queryTerms = query.toLowerCase().split(/\s+/);

      const scored: Array<{ meta: StoredMetadata; score: number }> = [];
      for (const [, meta] of this.metadata) {
        // Apply filters
        if (options.excludeTests && this.isTestFile(meta.filePath)) continue;
        if (options.fileTypes && !options.fileTypes.some(ext => meta.filePath.endsWith(ext))) continue;

        // Simple relevance score
        const content = meta.content.toLowerCase();
        let score = 0;
        for (const term of queryTerms) {
          const matches = (content.match(new RegExp(term, 'g')) || []).length;
          score += matches;
        }

        if (score > 0) {
          scored.push({ meta, score });
        }
      }

      // Sort by score descending
      scored.sort((a, b) => b.score - a.score);

      results = scored.slice(0, maxResults).map(s => ({
        ...s.meta,
        score: s.score
      }));
    }

    return results;
  }

  /**
   * Check if a file is a test file
   */
  private isTestFile(filePath: string): boolean {
    const testPatterns = [
      /\.test\./,
      /\.spec\./,
      /_test\./,
      /test_/,
      /__tests__/,
      /tests\//,
      /\.stories\./,
      /__mocks__/
    ];
    return testPatterns.some(pattern => pattern.test(filePath));
  }

  /**
   * Get language from file extension
   */
  private getLanguage(ext: string): string {
    const langMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'tsx',
      '.js': 'javascript',
      '.jsx': 'jsx',
      '.py': 'python',
      '.go': 'go',
      '.rs': 'rust',
      '.java': 'java',
      '.kt': 'kotlin',
      '.rb': 'ruby',
      '.php': 'php',
      '.c': 'c',
      '.cpp': 'cpp',
      '.h': 'c',
      '.hpp': 'cpp',
      '.cs': 'csharp',
      '.swift': 'swift',
      '.vue': 'vue',
      '.svelte': 'svelte',
      '.json': 'json',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.md': 'markdown'
    };
    return langMap[ext] || '';
  }

  /**
   * Get the number of indexed documents
   */
  getDocumentCount(): number {
    return this.documentCount;
  }
}
