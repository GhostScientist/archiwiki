import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';
import chalk from 'chalk';
import ora from 'ora';
import type { PermissionManager } from './permissions.js';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

export interface WorkflowStep {
  name: string;
  tool?: string;
  prompt?: string;
  input?: any;
  forEach?: string;
  output?: string;
  retry?: {
    maxAttempts: number;
    backoff: 'linear' | 'exponential';
    retryOn?: string[];
  };
  onError?: 'stop' | 'continue' | 'skip';
}

export interface WorkflowDefinition {
  name: string;
  description: string;
  arguments: Array<{
    name: string;
    type: string;
    required?: boolean;
    default?: any;
    description: string;
  }>;
  workflow: {
    steps: WorkflowStep[];
  };
  permissions: string[];
  requiresApproval?: boolean;
}

export interface WorkflowContext {
  variables: Map<string, any>;
  agent: any;
  permissionManager: PermissionManager;
}

export class WorkflowExecutor {
  constructor(private permissionManager: PermissionManager) {}

  async execute(
    workflow: WorkflowDefinition,
    args: Record<string, any>,
    context: WorkflowContext
  ): Promise<any> {
    // Initialize context with arguments
    for (const [key, value] of Object.entries(args)) {
      context.variables.set(key, value);
    }

    // Add timestamp variable
    context.variables.set('timestamp', new Date().toISOString().replace(/[:.]/g, '-'));

    const spinner = ora({ text: `Executing workflow: ${workflow.name}`, spinner: 'dots' }).start();

    try {
      for (let i = 0; i < workflow.workflow.steps.length; i++) {
        const step = workflow.workflow.steps[i];
        spinner.text = `Step ${i + 1}/${workflow.workflow.steps.length}: ${step.name}`;

        // Execute step
        const result = await this.executeStep(step, context);

        // Store result in context
        if (step.output) {
          const varName = this.extractVariableName(step.output);
          context.variables.set(varName, result);
        }
      }

      spinner.succeed('Workflow completed successfully');
      return context.variables.get('$result') || context.variables.get('$output');
    } catch (error) {
      spinner.fail(`Workflow failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async executeStep(step: WorkflowStep, context: WorkflowContext): Promise<any> {
    const maxAttempts = step.retry?.maxAttempts || 1;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.executeStepInternal(step, context);
      } catch (error) {
        lastError = error as Error;

        if (attempt < maxAttempts && this.shouldRetry(error, step.retry)) {
          const delay = this.calculateBackoff(attempt, step.retry?.backoff);
          console.log(chalk.yellow(`  Retrying in ${delay}ms (attempt ${attempt + 1}/${maxAttempts})...`));
          await this.sleep(delay);
          continue;
        }

        // Handle based on onError strategy
        if (step.onError === 'continue') {
          console.warn(chalk.yellow(`  Step ${step.name} failed, continuing: ${lastError.message}`));
          return null;
        } else if (step.onError === 'skip') {
          return undefined;
        }

        throw lastError;
      }
    }
  }

  async executeStepInternal(step: WorkflowStep, context: WorkflowContext): Promise<any> {
    // Resolve template variables in input
    const resolvedInput = this.resolveTemplates(step.input, context);

    if (step.forEach) {
      // Parallel execution for forEach
      const pattern = this.resolveTemplates(step.forEach, context);
      const items = await this.resolvePath(pattern, context);

      return await Promise.all(
        items.map(item => this.executeStepInternal({ ...step, input: item, forEach: undefined }, context))
      );
    } else if (step.tool) {
      // Call tool directly via agent
      return await this.callTool(step.tool, resolvedInput, context.agent);
    } else if (step.prompt) {
      // Query agent with prompt
      const prompt = this.resolveTemplates(step.prompt, context);
      return await this.queryAgent(prompt, context.agent);
    }

    throw new Error(`Step ${step.name} has no executable action (tool or prompt)`);
  }

  async callTool(toolName: string, input: any, agent: any): Promise<any> {
    // This is a simplified implementation
    // In a real implementation, we'd need to call the tool through the agent's tool system
    console.log(chalk.gray(`  → Calling tool: ${toolName}`));

    // For now, we'll just return the input
    // This would need to be implemented to actually call tools
    return { success: true, tool: toolName, input };
  }

  async queryAgent(prompt: string, agent: any): Promise<any> {
    console.log(chalk.gray('  → Querying agent...'));

    let result = '';
    for await (const message of agent.query(prompt)) {
      if (message.type === 'stream_event') {
        if (message.event?.type === 'content_block_delta' && message.event.delta?.type === 'text_delta') {
          const text = message.event.delta.text || '';
          process.stdout.write(text);
          result += text;
        }
      }
    }
    process.stdout.write('\n');

    return result;
  }

  async resolvePath(pattern: string, context: WorkflowContext): Promise<string[]> {
    try {
      const files = await glob(pattern);
      return files;
    } catch (error) {
      console.error(chalk.red(`Failed to resolve path pattern: ${pattern}`));
      return [];
    }
  }

  resolveTemplates(template: any, context: WorkflowContext): any {
    if (typeof template !== 'string') {
      return template;
    }

    return template.replace(/\{\{([^}]+)\}\}/g, (_, varName) => {
      const trimmed = varName.trim();
      const value = context.variables.get(trimmed);
      return value !== undefined ? String(value) : `{{${trimmed}}}`;
    });
  }

  extractVariableName(output: string): string {
    const match = output.match(/\{\{([^}]+)\}\}/);
    return match ? match[1].trim() : output;
  }

  shouldRetry(error: any, retry?: WorkflowStep['retry']): boolean {
    if (!retry || !retry.retryOn) {
      return true; // Retry all errors if retry is configured
    }

    const errorType = error?.constructor?.name || 'Error';
    return retry.retryOn.includes(errorType);
  }

  calculateBackoff(attempt: number, backoff: 'linear' | 'exponential' = 'linear'): number {
    if (backoff === 'exponential') {
      return Math.min(1000 * Math.pow(2, attempt - 1), 30000);
    }
    return 1000 * attempt;
  }

  sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async loadWorkflow(commandName: string): Promise<WorkflowDefinition> {
    // Resolve path relative to project root, not current working directory
    const workflowPath = join(PROJECT_ROOT, '.commands', `${commandName}.json`);

    if (!existsSync(workflowPath)) {
      throw new Error(`Workflow not found: ${commandName} (looked in ${workflowPath})`);
    }

    try {
      const content = readFileSync(workflowPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to load workflow: ${commandName} - ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
