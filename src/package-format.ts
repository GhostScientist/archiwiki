/**
 * SemanticWiki Portable Package Format (.semantics)
 *
 * A portable package format that bundles:
 * - Wiki documentation (markdown files)
 * - RAG index (metadata, embeddings, BM25 index)
 * - Configuration and metadata
 *
 * The format is a gzipped tar archive with a specific structure.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { pipeline } from 'stream/promises';
import { createReadStream, createWriteStream } from 'fs';
import { glob } from 'glob';

// Package version for compatibility checking
export const PACKAGE_VERSION = '1.0.0';

export interface PackageManifest {
  version: string;
  name: string;
  description?: string;
  createdAt: string;
  sourceRepo?: string;
  sourceCommit?: string;
  wikiStats: {
    pageCount: number;
    totalSize: number;
  };
  ragStats?: {
    chunkCount: number;
    embeddingModel?: string;
    hasHybridIndex: boolean;
  };
}

export interface PackageOptions {
  wikiPath: string;
  outputPath: string;
  name?: string;
  description?: string;
  sourceRepo?: string;
  includeRag?: boolean;
}

export interface ExtractOptions {
  packagePath: string;
  outputPath: string;
  wikiOnly?: boolean;
}

/**
 * Create a SemanticWiki package from a wiki directory
 */
export async function createPackage(options: PackageOptions): Promise<string> {
  const { wikiPath, outputPath, name, description, sourceRepo, includeRag = true } = options;

  if (!fs.existsSync(wikiPath)) {
    throw new Error(`Wiki path does not exist: ${wikiPath}`);
  }

  // Collect all files
  const files: Array<{ relativePath: string; absolutePath: string }> = [];

  // Add wiki markdown files
  const mdFiles = await glob('**/*.md', { cwd: wikiPath });
  for (const file of mdFiles) {
    files.push({
      relativePath: `wiki/${file}`,
      absolutePath: path.join(wikiPath, file)
    });
  }

  // Add wiki static assets
  const assetPatterns = ['**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.svg', '**/*.css', '**/*.js'];
  for (const pattern of assetPatterns) {
    const assetFiles = await glob(pattern, { cwd: wikiPath });
    for (const file of assetFiles) {
      if (!file.includes('.semanticwiki-cache')) {
        files.push({
          relativePath: `wiki/${file}`,
          absolutePath: path.join(wikiPath, file)
        });
      }
    }
  }

  // Calculate wiki stats
  let wikiTotalSize = 0;
  for (const file of files) {
    const stat = fs.statSync(file.absolutePath);
    wikiTotalSize += stat.size;
  }

  // Add RAG index if requested and available
  const cacheDir = path.join(wikiPath, '.semanticwiki-cache');
  let ragStats: PackageManifest['ragStats'] | undefined;
  let sourceCommit: string | undefined;

  if (includeRag && fs.existsSync(cacheDir)) {
    const ragFiles = [
      'metadata.json',
      'index.faiss',
      'bm25-index.json',
      'index-state.json'
    ];

    for (const ragFile of ragFiles) {
      const ragFilePath = path.join(cacheDir, ragFile);
      if (fs.existsSync(ragFilePath)) {
        files.push({
          relativePath: `rag/${ragFile}`,
          absolutePath: ragFilePath
        });
      }
    }

    // Read RAG stats from index state
    const indexStatePath = path.join(cacheDir, 'index-state.json');
    if (fs.existsSync(indexStatePath)) {
      try {
        const indexState = JSON.parse(fs.readFileSync(indexStatePath, 'utf-8'));
        sourceCommit = indexState.commitHash;
        ragStats = {
          chunkCount: indexState.chunkCount || 0,
          embeddingModel: indexState.embeddingModel,
          hasHybridIndex: indexState.hasHybridIndex || false
        };
      } catch {
        // Ignore parse errors
      }
    }
  }

  // Create manifest
  const manifest: PackageManifest = {
    version: PACKAGE_VERSION,
    name: name || path.basename(wikiPath),
    description,
    createdAt: new Date().toISOString(),
    sourceRepo,
    sourceCommit,
    wikiStats: {
      pageCount: mdFiles.length,
      totalSize: wikiTotalSize
    },
    ragStats
  };

  // Create package using a simple JSON + files format
  // Format: [manifest_length (4 bytes)][manifest JSON][file entries...]
  // Each file entry: [path_length (2 bytes)][path][content_length (4 bytes)][content]

  const packagePath = outputPath.endsWith('.semantics') ? outputPath : `${outputPath}.semantics`;

  // Build the package buffer
  const chunks: Buffer[] = [];

  // Add manifest
  const manifestJson = JSON.stringify(manifest, null, 2);
  const manifestBuffer = Buffer.from(manifestJson, 'utf-8');
  const manifestLengthBuffer = Buffer.alloc(4);
  manifestLengthBuffer.writeUInt32LE(manifestBuffer.length, 0);
  chunks.push(manifestLengthBuffer);
  chunks.push(manifestBuffer);

  // Add files
  for (const file of files) {
    const content = fs.readFileSync(file.absolutePath);

    // Path length (2 bytes) + path
    const pathBuffer = Buffer.from(file.relativePath, 'utf-8');
    const pathLengthBuffer = Buffer.alloc(2);
    pathLengthBuffer.writeUInt16LE(pathBuffer.length, 0);
    chunks.push(pathLengthBuffer);
    chunks.push(pathBuffer);

    // Content length (4 bytes) + content
    const contentLengthBuffer = Buffer.alloc(4);
    contentLengthBuffer.writeUInt32LE(content.length, 0);
    chunks.push(contentLengthBuffer);
    chunks.push(content);
  }

  // Combine and compress
  const uncompressed = Buffer.concat(chunks);
  const compressed = zlib.gzipSync(uncompressed, { level: 9 });

  // Write package
  fs.writeFileSync(packagePath, compressed);

  console.log(`Created package: ${packagePath}`);
  console.log(`  Wiki pages: ${manifest.wikiStats.pageCount}`);
  console.log(`  Total files: ${files.length}`);
  console.log(`  Compressed size: ${(compressed.length / 1024 / 1024).toFixed(2)} MB`);
  if (ragStats) {
    console.log(`  RAG chunks: ${ragStats.chunkCount}`);
  }

  return packagePath;
}

/**
 * Extract a SemanticWiki package to a directory
 */
export async function extractPackage(options: ExtractOptions): Promise<PackageManifest> {
  const { packagePath, outputPath, wikiOnly = false } = options;

  if (!fs.existsSync(packagePath)) {
    throw new Error(`Package not found: ${packagePath}`);
  }

  // Read and decompress
  const compressed = fs.readFileSync(packagePath);
  const uncompressed = zlib.gunzipSync(compressed);

  let offset = 0;

  // Read manifest
  const manifestLength = uncompressed.readUInt32LE(offset);
  offset += 4;
  const manifestJson = uncompressed.subarray(offset, offset + manifestLength).toString('utf-8');
  offset += manifestLength;
  const manifest: PackageManifest = JSON.parse(manifestJson);

  // Create output directories
  const wikiDir = path.join(outputPath, 'wiki');
  const ragDir = path.join(outputPath, '.semanticwiki-cache');
  fs.mkdirSync(wikiDir, { recursive: true });
  if (!wikiOnly) {
    fs.mkdirSync(ragDir, { recursive: true });
  }

  // Extract files
  let extractedCount = 0;
  while (offset < uncompressed.length) {
    // Read path
    const pathLength = uncompressed.readUInt16LE(offset);
    offset += 2;
    const relativePath = uncompressed.subarray(offset, offset + pathLength).toString('utf-8');
    offset += pathLength;

    // Read content
    const contentLength = uncompressed.readUInt32LE(offset);
    offset += 4;
    const content = uncompressed.subarray(offset, offset + contentLength);
    offset += contentLength;

    // Skip RAG files if wikiOnly
    if (wikiOnly && relativePath.startsWith('rag/')) {
      continue;
    }

    // Determine output path
    let targetPath: string;
    if (relativePath.startsWith('wiki/')) {
      targetPath = path.join(outputPath, relativePath);
    } else if (relativePath.startsWith('rag/')) {
      targetPath = path.join(ragDir, relativePath.replace('rag/', ''));
    } else {
      targetPath = path.join(outputPath, relativePath);
    }

    // Security: Validate that resolved path stays within output directory
    const resolvedTarget = path.resolve(targetPath);
    const resolvedOutput = path.resolve(outputPath);
    if (!resolvedTarget.startsWith(resolvedOutput + path.sep) && resolvedTarget !== resolvedOutput) {
      console.warn(`Skipping file with path traversal attempt: ${relativePath}`);
      continue;
    }

    // Create directory and write file
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content);
    extractedCount++;
  }

  console.log(`Extracted package: ${packagePath}`);
  console.log(`  Files extracted: ${extractedCount}`);
  console.log(`  Output directory: ${outputPath}`);

  return manifest;
}

/**
 * Read manifest from a package without extracting
 */
export function readPackageManifest(packagePath: string): PackageManifest {
  if (!fs.existsSync(packagePath)) {
    throw new Error(`Package not found: ${packagePath}`);
  }

  const compressed = fs.readFileSync(packagePath);
  const uncompressed = zlib.gunzipSync(compressed);

  const manifestLength = uncompressed.readUInt32LE(0);
  const manifestJson = uncompressed.subarray(4, 4 + manifestLength).toString('utf-8');

  return JSON.parse(manifestJson);
}

/**
 * List files in a package without extracting
 */
export function listPackageFiles(packagePath: string): string[] {
  if (!fs.existsSync(packagePath)) {
    throw new Error(`Package not found: ${packagePath}`);
  }

  const compressed = fs.readFileSync(packagePath);
  const uncompressed = zlib.gunzipSync(compressed);

  const files: string[] = [];
  let offset = 0;

  // Skip manifest
  const manifestLength = uncompressed.readUInt32LE(offset);
  offset += 4 + manifestLength;

  // Read file paths
  while (offset < uncompressed.length) {
    const pathLength = uncompressed.readUInt16LE(offset);
    offset += 2;
    const relativePath = uncompressed.subarray(offset, offset + pathLength).toString('utf-8');
    offset += pathLength;

    files.push(relativePath);

    // Skip content
    const contentLength = uncompressed.readUInt32LE(offset);
    offset += 4 + contentLength;
  }

  return files;
}
