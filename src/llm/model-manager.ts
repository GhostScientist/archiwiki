/**
 * Model Manager
 *
 * Handles hardware detection, model selection, and model downloads
 * for the local LLM provider.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { Transform, Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { HardwareProfile, ModelRecommendation, ProgressCallback } from './types.js';

/**
 * Model family type for filtering models
 */
export type ModelFamily = 'gpt-oss';

/**
 * Extended model recommendation with family
 */
interface ModelRegistryEntry extends ModelRecommendation {
  family: ModelFamily;
}

/**
 * Registry of available models with their hardware requirements
 */
const MODEL_REGISTRY: ModelRegistryEntry[] = [
  // GPT-OSS 21B - excellent quality open source model (only supported model for now)
  {
    family: 'gpt-oss',
    modelId: 'gpt-oss-20b-q8',
    ggufFile: 'gpt-oss-20b-Q8_0.gguf',
    downloadUrl:
      'https://huggingface.co/unsloth/gpt-oss-20b-GGUF/resolve/main/gpt-oss-20b-Q8_0.gguf',
    fileSizeBytes: 12_100_000_000, // ~12.1 GB
    minVram: 14,
    minRam: 16,
    contextLength: 32768,
    quality: 'excellent',
  },
];

export class ModelManager {
  private modelsDir: string;
  private progressCallback?: ProgressCallback;

  constructor() {
    this.modelsDir = path.join(os.homedir(), '.semanticwiki', 'models');
  }

  /**
   * Set a callback for progress updates
   */
  setProgressCallback(callback: ProgressCallback): void {
    this.progressCallback = callback;
  }

  /**
   * Get the models directory path
   */
  getModelsDir(): string {
    return this.modelsDir;
  }

  /**
   * Detect hardware capabilities
   */
  async detectHardware(): Promise<HardwareProfile> {
    const systemRam = os.totalmem() / 1024 ** 3;
    const cpuCores = os.cpus().length;
    const cpuModel = os.cpus()[0]?.model || 'Unknown';

    // Try to detect GPU using node-llama-cpp if available
    let gpuVendor: HardwareProfile['gpuVendor'] = 'none';
    let gpuVram = 0;
    let gpuName: string | undefined;

    try {
      // Dynamic import to avoid hard dependency
      const { getLlama } = await import('node-llama-cpp');
      const llama = await getLlama();

      // Get GPU info from llama.cpp
      const gpuDevices = await llama.getGpuDeviceNames();

      if (gpuDevices && gpuDevices.length > 0) {
        gpuName = gpuDevices[0];

        // Detect vendor from name
        if (gpuName.toLowerCase().includes('nvidia') || gpuName.toLowerCase().includes('geforce') || gpuName.toLowerCase().includes('rtx') || gpuName.toLowerCase().includes('gtx')) {
          gpuVendor = 'nvidia';
        } else if (gpuName.toLowerCase().includes('amd') || gpuName.toLowerCase().includes('radeon')) {
          gpuVendor = 'amd';
        } else if (gpuName.toLowerCase().includes('apple') || gpuName.toLowerCase().includes('m1') || gpuName.toLowerCase().includes('m2') || gpuName.toLowerCase().includes('m3')) {
          gpuVendor = 'apple';
        } else if (gpuName.toLowerCase().includes('intel')) {
          gpuVendor = 'intel';
        }

        // Estimate VRAM based on common GPU models
        gpuVram = this.estimateVram(gpuName);
      }
    } catch {
      // node-llama-cpp not available or no GPU detected
      // Check for Apple Silicon via platform
      if (process.platform === 'darwin' && process.arch === 'arm64') {
        gpuVendor = 'apple';
        gpuName = 'Apple Silicon';
        // For Apple Silicon, unified memory is shared
        // Estimate ~70% available for GPU
        gpuVram = Math.floor(systemRam * 0.7);
      }
    }

    return {
      gpuVendor,
      gpuName,
      gpuVram,
      systemRam,
      cpuCores,
      cpuModel,
    };
  }

  /**
   * Estimate VRAM from GPU name
   */
  private estimateVram(gpuName: string): number {
    const name = gpuName.toLowerCase();

    // NVIDIA RTX 40 series
    if (name.includes('4090')) return 24;
    if (name.includes('4080')) return 16;
    if (name.includes('4070 ti')) return 12;
    if (name.includes('4070')) return 12;
    if (name.includes('4060 ti')) return 8;
    if (name.includes('4060')) return 8;

    // NVIDIA RTX 30 series
    if (name.includes('3090')) return 24;
    if (name.includes('3080 ti')) return 12;
    if (name.includes('3080')) return 10;
    if (name.includes('3070 ti')) return 8;
    if (name.includes('3070')) return 8;
    if (name.includes('3060 ti')) return 8;
    if (name.includes('3060')) return 12;

    // Apple Silicon (unified memory)
    if (name.includes('m3 max')) return 48;
    if (name.includes('m3 pro')) return 18;
    if (name.includes('m3')) return 8;
    if (name.includes('m2 max')) return 32;
    if (name.includes('m2 pro')) return 16;
    if (name.includes('m2')) return 8;
    if (name.includes('m1 max')) return 32;
    if (name.includes('m1 pro')) return 16;
    if (name.includes('m1')) return 8;

    // Default conservative estimate
    return 4;
  }

  /**
   * Get all available models in the registry
   */
  getAvailableModels(family?: ModelFamily): ModelRecommendation[] {
    if (family) {
      return MODEL_REGISTRY.filter((m) => m.family === family);
    }
    return [...MODEL_REGISTRY];
  }

  /**
   * Get models by family name
   */
  getModelsByFamily(family: ModelFamily): ModelRecommendation[] {
    return MODEL_REGISTRY.filter((m) => m.family === family);
  }

  /**
   * Get family for a model ID
   */
  getModelFamily(modelId: string): ModelFamily | undefined {
    return MODEL_REGISTRY.find((m) => m.modelId === modelId)?.family;
  }

  /**
   * Get a specific model by ID
   */
  getModelById(modelId: string): ModelRecommendation | undefined {
    return MODEL_REGISTRY.find((m) => m.modelId === modelId);
  }

  /**
   * Recommend the best model for the given hardware
   * @param hardware - Hardware profile
   * @param family - Optional model family filter ('lfm' or 'qwen')
   */
  recommendModel(hardware: HardwareProfile, family?: ModelFamily): ModelRecommendation {
    // Filter by family if specified
    const registry = family
      ? MODEL_REGISTRY.filter((m) => m.family === family)
      : MODEL_REGISTRY;

    // Find models that fit the hardware
    const candidates = registry.filter((m) => {
      // Check if GPU can handle it
      if (hardware.gpuVram >= m.minVram) return true;
      // Check if system RAM can handle it (CPU-only mode)
      if (hardware.systemRam >= m.minRam) return true;
      return false;
    }).sort((a, b) => {
      // Prefer higher quality first
      const qualityOrder = { excellent: 0, good: 1, acceptable: 2 };
      if (a.quality !== b.quality) {
        return qualityOrder[a.quality] - qualityOrder[b.quality];
      }
      // Then prefer larger context
      return b.contextLength - a.contextLength;
    });

    if (candidates.length === 0) {
      const familyNote = family ? ` in the '${family}' family` : '';
      throw new Error(
        `No suitable models${familyNote} for your hardware.\n\n` +
          `Minimum requirements: 2GB VRAM or 4GB RAM\n` +
          `Detected: ${hardware.gpuVram}GB VRAM, ${hardware.systemRam.toFixed(1)}GB RAM\n\n` +
          `Options:\n` +
          `  1. Use cloud mode (remove --full-local flag)\n` +
          `  2. Try a different model family (-m lfm or -m qwen)\n` +
          `  3. Add more RAM or use a machine with a GPU`
      );
    }

    return candidates[0];
  }

  /**
   * Check if a model is already downloaded
   */
  isModelDownloaded(modelId: string): boolean {
    const model = this.getModelById(modelId);
    if (!model) return false;

    const modelPath = path.join(this.modelsDir, model.ggufFile);
    return fs.existsSync(modelPath);
  }

  /**
   * Get the path to a downloaded model
   */
  getModelPath(modelId: string): string | null {
    const model = this.getModelById(modelId);
    if (!model) return null;

    const modelPath = path.join(this.modelsDir, model.ggufFile);
    if (fs.existsSync(modelPath)) {
      return modelPath;
    }
    return null;
  }

  /**
   * Ensure a model is downloaded, downloading if necessary
   */
  async ensureModel(model: ModelRecommendation): Promise<string> {
    const modelPath = path.join(this.modelsDir, model.ggufFile);

    if (fs.existsSync(modelPath)) {
      // Verify file size
      const stats = fs.statSync(modelPath);
      if (stats.size >= model.fileSizeBytes * 0.95) {
        // Allow 5% tolerance
        return modelPath;
      }
      // File seems incomplete, re-download
      console.log('   Model file appears incomplete, re-downloading...');
      fs.unlinkSync(modelPath);
    }

    await this.downloadModel(model, modelPath);
    return modelPath;
  }

  /**
   * Download a model with progress reporting
   */
  private async downloadModel(model: ModelRecommendation, destPath: string): Promise<void> {
    const sizeGB = (model.fileSizeBytes / 1e9).toFixed(1);

    console.log(`\n📦 Downloading model: ${model.modelId}`);
    console.log(`   Size: ${sizeGB} GB`);
    console.log(`   Destination: ${destPath}`);
    console.log(`\n   This is a one-time download. Models are cached for future use.\n`);

    // Create directory if needed
    await mkdir(path.dirname(destPath), { recursive: true });

    // Start download
    const response = await fetch(model.downloadUrl, {
      headers: {
        'User-Agent': 'semanticwiki/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download model: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('No response body received');
    }

    const totalBytes = model.fileSizeBytes;
    let downloadedBytes = 0;
    let lastProgressUpdate = Date.now();
    let lastBytes = 0;

    // Capture reference to the progress callback
    const progressCallback = this.progressCallback;

    // Create progress tracking transform stream
    const progressTracker = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        downloadedBytes += chunk.length;
        const now = Date.now();
        const elapsed = (now - lastProgressUpdate) / 1000;

        if (elapsed >= 0.5) {
          // Update every 500ms
          const bytesPerSec = (downloadedBytes - lastBytes) / elapsed;
          const percent = (downloadedBytes / totalBytes) * 100;
          const downloaded = (downloadedBytes / 1e9).toFixed(1);
          const total = (totalBytes / 1e9).toFixed(1);
          const speed = (bytesPerSec / 1e6).toFixed(1);
          const remaining = (totalBytes - downloadedBytes) / bytesPerSec;
          const eta = formatTime(remaining);

          // Create progress bar
          const barWidth = 30;
          const filled = Math.round((percent / 100) * barWidth);
          const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);

          process.stdout.write(
            `\r   [${bar}] ${percent.toFixed(1)}%  |  ${downloaded}/${total} GB  |  ${speed} MB/s  |  ETA ${eta}  `
          );

          lastProgressUpdate = now;
          lastBytes = downloadedBytes;

          // Call progress callback if set
          if (progressCallback) {
            progressCallback({
              phase: 'downloading',
              percent,
              message: `${downloaded}/${total} GB`,
            });
          }
        }

        callback(null, chunk);
      },
    });

    // Pipe response to file with progress tracking
    const fileStream = createWriteStream(destPath);

    try {
      // Convert web stream to node stream and pipe through
      const nodeStream = convertWebStreamToNodeStream(response.body);
      await pipeline(nodeStream, progressTracker, fileStream);

      console.log('\n\n   ✅ Download complete!\n');
    } catch (error) {
      // Clean up partial file on error
      if (fs.existsSync(destPath)) {
        fs.unlinkSync(destPath);
      }
      throw error;
    }
  }

  /**
   * Delete a downloaded model
   */
  deleteModel(modelId: string): boolean {
    const modelPath = this.getModelPath(modelId);
    if (modelPath && fs.existsSync(modelPath)) {
      fs.unlinkSync(modelPath);
      return true;
    }
    return false;
  }

  /**
   * List all downloaded models
   */
  listDownloadedModels(): Array<{ model: ModelRecommendation; path: string; sizeBytes: number }> {
    const downloaded: Array<{ model: ModelRecommendation; path: string; sizeBytes: number }> = [];

    for (const model of MODEL_REGISTRY) {
      const modelPath = path.join(this.modelsDir, model.ggufFile);
      if (fs.existsSync(modelPath)) {
        const stats = fs.statSync(modelPath);
        downloaded.push({
          model,
          path: modelPath,
          sizeBytes: stats.size,
        });
      }
    }

    return downloaded;
  }

  /**
   * Format hardware profile for display
   */
  formatHardwareProfile(hardware: HardwareProfile): string {
    const lines: string[] = [];

    if (hardware.gpuVendor !== 'none' && hardware.gpuName) {
      lines.push(`GPU: ${hardware.gpuName} (${hardware.gpuVram} GB VRAM)`);
    } else if (hardware.gpuVendor !== 'none') {
      lines.push(`GPU: ${hardware.gpuVendor} (${hardware.gpuVram} GB VRAM)`);
    } else {
      lines.push('GPU: None detected (CPU-only mode)');
    }

    lines.push(`RAM: ${hardware.systemRam.toFixed(0)} GB`);
    lines.push(`CPU: ${hardware.cpuModel} (${hardware.cpuCores} cores)`);

    return lines.join('\n');
  }
}

/**
 * Convert a Web ReadableStream to a Node.js Readable stream
 */
function convertWebStreamToNodeStream(
  webStream: ReadableStream<Uint8Array>
): NodeJS.ReadableStream {
  const reader = webStream.getReader();

  return new Readable({
    async read() {
      try {
        const { done, value } = await reader.read();
        if (done) {
          this.push(null);
        } else {
          this.push(Buffer.from(value));
        }
      } catch (error) {
        this.destroy(error as Error);
      }
    },
  });
}

/**
 * Format seconds into human-readable time
 */
function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '--:--';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

export default ModelManager;
