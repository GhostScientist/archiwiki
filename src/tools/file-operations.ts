import { readFile, writeFile, access, readdir, stat } from 'fs/promises'
import { join, resolve } from 'path'
import { glob } from 'glob'
import { PermissionManager } from '../permissions.js'

export class FileOperations {
  private permissionManager: PermissionManager;
  private baseDir: string;

  constructor(permissionManager: PermissionManager, baseDir: string = process.cwd()) {
    this.permissionManager = permissionManager;
    this.baseDir = resolve(baseDir);
  }

  /**
   * Validates that a path is within the allowed base directory.
   * Prevents directory traversal attacks and access outside sandbox.
   */
  private validatePath(filePath: string): string {
    const absolutePath = resolve(this.baseDir, filePath);
    // Ensure path is within baseDir (prevent directory traversal)
    if (!absolutePath.startsWith(this.baseDir + '/') && absolutePath !== this.baseDir) {
      throw new Error(`Access denied: Path "${filePath}" is outside the allowed directory "${this.baseDir}"`);
    }
    return absolutePath;
  }

  async readFile(filePath: string): Promise<string> {
    try {
      const safePath = this.validatePath(filePath);
      return await readFile(safePath, 'utf-8')
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Access denied:')) {
        throw error;
      }
      throw new Error(`Failed to read file ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    // Validate path first (before permission check)
    const safePath = this.validatePath(filePath);

    // Request permission before writing
    const permission = await this.permissionManager.requestPermission({
      action: 'write_file',
      resource: filePath,
      details: `Writing ${content.length} characters`
    });

    if (!permission.allowed) {
      throw new Error(`Permission denied: Cannot write to ${filePath}`);
    }

    try {
      await writeFile(safePath, content, 'utf-8')
    } catch (error) {
      throw new Error(`Failed to write file ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      const safePath = this.validatePath(filePath);
      await access(safePath)
      return true
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Access denied:')) {
        throw error;
      }
      return false
    }
  }

  async listFiles(dirPath: string): Promise<string[]> {
    try {
      const safePath = this.validatePath(dirPath);
      const entries = await readdir(safePath, { withFileTypes: true })
      return entries
        .filter(entry => entry.isFile())
        .map(entry => entry.name)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Access denied:')) {
        throw error;
      }
      throw new Error(`Failed to list files in ${dirPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async findFiles(pattern: string, cwd?: string): Promise<string[]> {
    // Block directory traversal patterns
    if (pattern.includes('..')) {
      throw new Error('Access denied: Path traversal patterns (..) not allowed');
    }

    // Always use baseDir as root, ignore cwd parameter for security
    try {
      const results = await glob(pattern, {
        cwd: this.baseDir,
        absolute: true,
        ignore: ['node_modules/**', '.git/**']
      });

      // Double-check all results are within baseDir
      return results.filter(p => p.startsWith(this.baseDir + '/') || p === this.baseDir);
    } catch (error) {
      throw new Error(`Failed to find files matching ${pattern}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async getFileStats(filePath: string): Promise<{ size: number; modified: Date; isDirectory: boolean }> {
    try {
      const safePath = this.validatePath(filePath);
      const stats = await stat(safePath)
      return {
        size: stats.size,
        modified: stats.mtime,
        isDirectory: stats.isDirectory()
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Access denied:')) {
        throw error;
      }
      throw new Error(`Failed to get stats for ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}