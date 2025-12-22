import { spawn } from 'child_process'
import { promisify } from 'util'
import { PermissionManager } from '../permissions.js'

export interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
  command: string
}

export class CommandRunner {
  private permissionManager: PermissionManager;

  constructor(permissionManager: PermissionManager) {
    this.permissionManager = permissionManager;
  }

  async execute(command: string, options?: { cwd?: string; timeout?: number }): Promise<CommandResult> {
    // Request permission before executing command (HIGH RISK)
    const permission = await this.permissionManager.requestPermission({
      action: 'run_command',
      resource: command,
      details: `Executing command in ${options?.cwd || 'current directory'}`
    });

    if (!permission.allowed) {
      throw new Error(`Permission denied: Cannot execute command "${command}"`);
    }

    return new Promise((resolve, reject) => {
      const [cmd, ...args] = command.split(' ')
      const child = spawn(cmd, args, {
        cwd: options?.cwd || process.cwd(),
        stdio: 'pipe',
        shell: true
      })

      let stdout = ''
      let stderr = ''

      child.stdout?.on('data', (data) => {
        stdout += data.toString()
      })

      child.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      const timeout = options?.timeout || 30000
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`Command timed out after ${timeout}ms: ${command}`))
      }, timeout)

      child.on('close', (exitCode) => {
        clearTimeout(timer)
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: exitCode || 0,
          command
        })
      })

      child.on('error', (error) => {
        clearTimeout(timer)
        reject(new Error(`Failed to execute command ${command}: ${error.message}`))
      })
    })
  }

  formatResult(result: CommandResult): string {
    let output = `Command: ${result.command}\n`
    output += `Exit Code: ${result.exitCode}\n`
    
    if (result.stdout) {
      output += `\nSTDOUT:\n${result.stdout}\n`
    }
    
    if (result.stderr) {
      output += `\nSTDERR:\n${result.stderr}\n`
    }
    
    return output
  }

  async executeShell(script: string, options?: { cwd?: string; timeout?: number }): Promise<CommandResult> {
    return this.execute(script, options)
  }
}