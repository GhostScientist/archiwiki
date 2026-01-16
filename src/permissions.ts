import inquirer from 'inquirer';
import chalk from 'chalk';
import { appendFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';

export type PermissionAction = 'read_file' | 'write_file' | 'run_command' | 'delete_file' | 'modify_file' | 'network_request';
export type PermissionPolicy = 'restrictive' | 'balanced' | 'permissive';

export interface PermissionRequest {
  action: PermissionAction;
  resource: string;
  details?: string;
}

export interface PermissionResponse {
  allowed: boolean;
  remember?: boolean;
}

export interface PermissionOptions {
  policy?: PermissionPolicy;
  auditPath?: string;
}

export class PermissionManager {
  private allowedActions: Set<string> = new Set();
  private deniedActions: Set<string> = new Set();
  private alwaysAllow: Set<PermissionAction> = new Set();
  private alwaysDeny: Set<PermissionAction> = new Set();
  private policy: PermissionPolicy;
  private auditPath: string;

  constructor(options: PermissionOptions = {}) {
    this.policy = options.policy || 'permissive';
    this.auditPath = options.auditPath || join(homedir(), '.semanticwiki', 'audit.log');
  }

  async requestPermission(request: PermissionRequest): Promise<PermissionResponse> {
    const actionKey = `${request.action}:${request.resource}`;
    const policyDecision = this.applyPolicy(request.action);

    if (policyDecision !== 'ask') {
      const allowed = policyDecision === 'allow';
      const response = { allowed, remember: true };
      await this.audit(request, response, 'policy');
      return response;
    }

    if (this.allowedActions.has(actionKey)) {
      const response = { allowed: true, remember: true };
      await this.audit(request, response, 'cached');
      return response;
    }

    if (this.deniedActions.has(actionKey)) {
      const response = { allowed: false, remember: true };
      await this.audit(request, response, 'cached');
      return response;
    }

    if (this.alwaysAllow.has(request.action)) {
      const response = { allowed: true, remember: true };
      await this.audit(request, response, 'always');
      return response;
    }

    if (this.alwaysDeny.has(request.action)) {
      const response = { allowed: false, remember: true };
      await this.audit(request, response, 'always');
      return response;
    }

    const response = await this.promptUser(request, actionKey);
    await this.audit(request, response, 'prompt');
    return response;
  }

  private async promptUser(request: PermissionRequest, actionKey: string): Promise<PermissionResponse> {
    console.log(chalk.yellow('\n⚠️  Permission Required'));
    console.log(chalk.white(`Action: ${this.formatActionName(request.action)}`));
    console.log(chalk.white(`Resource: ${request.resource}`));
    if (request.details) {
      console.log(chalk.gray(`Details: ${request.details}`));
    }

    const { decision } = await inquirer.prompt([
      {
        type: 'list',
        name: 'decision',
        message: 'Do you want to allow this action?',
        choices: [
          { name: 'Allow once', value: 'allow_once' },
          { name: 'Allow always for this resource', value: 'allow_resource' },
          { name: `Always allow ${this.formatActionName(request.action)}`, value: 'allow_action' },
          { name: 'Deny once', value: 'deny_once' },
          { name: 'Deny always for this resource', value: 'deny_resource' },
          { name: `Always deny ${this.formatActionName(request.action)}`, value: 'deny_action' },
        ],
        default: 'allow_once'
      }
    ]);

    switch (decision) {
      case 'allow_once':
        return { allowed: true, remember: false };
      case 'allow_resource':
        this.allowedActions.add(actionKey);
        return { allowed: true, remember: true };
      case 'allow_action':
        this.alwaysAllow.add(request.action);
        return { allowed: true, remember: true };
      case 'deny_once':
        return { allowed: false, remember: false };
      case 'deny_resource':
        this.deniedActions.add(actionKey);
        return { allowed: false, remember: true };
      case 'deny_action':
        this.alwaysDeny.add(request.action);
        return { allowed: false, remember: true };
      default:
        return { allowed: false, remember: false };
    }
  }

  private applyPolicy(action: PermissionAction): 'allow' | 'deny' | 'ask' {
    const highRisk: PermissionAction[] = ['run_command', 'delete_file'];
    const mediumRisk: PermissionAction[] = ['write_file', 'modify_file', 'network_request'];
    const lowRisk: PermissionAction[] = ['read_file'];

    if (this.policy === 'restrictive') {
      if (highRisk.includes(action)) return 'deny';
      if (mediumRisk.includes(action)) return 'ask';
      if (lowRisk.includes(action)) return 'allow';
    }

    if (this.policy === 'balanced') {
      if (highRisk.includes(action)) return 'ask';
      if (mediumRisk.includes(action)) return 'ask';
      return 'allow';
    }

    if (this.policy === 'permissive') {
      return 'allow';
    }

    return 'ask';
  }

  private async audit(request: PermissionRequest, response: PermissionResponse, source: 'policy' | 'prompt' | 'cached' | 'always') {
    try {
      await mkdir(dirname(this.auditPath), { recursive: true });
      const line = JSON.stringify({
        timestamp: new Date().toISOString(),
        action: request.action,
        resource: request.resource,
        details: request.details,
        allowed: response.allowed,
        remember: response.remember,
        mode: this.policy,
        source
      }) + '\n';
      await appendFile(this.auditPath, line, { encoding: 'utf-8' });
    } catch (error) {
      console.warn('Failed to write audit log', error);
    }
  }

  private formatActionName(action: PermissionAction): string {
    switch (action) {
      case 'read_file':
        return 'file read';
      case 'write_file':
        return 'file writing';
      case 'run_command':
        return 'command execution';
      case 'delete_file':
        return 'file deletion';
      case 'modify_file':
        return 'file modification';
      case 'network_request':
        return 'network requests';
      default:
        return action;
    }
  }

  isHighRisk(action: PermissionAction): boolean {
    return ['run_command', 'delete_file'].includes(action);
  }

  reset(): void {
    this.allowedActions.clear();
    this.deniedActions.clear();
    this.alwaysAllow.clear();
    this.alwaysDeny.clear();
  }
}