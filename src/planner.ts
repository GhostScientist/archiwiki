import { readFile, writeFile, readdir, unlink, mkdir } from 'fs/promises';
import { join, basename } from 'path';
import { existsSync } from 'fs';

export interface PlanStep {
  id: string;
  name: string;
  action: 'read' | 'write' | 'edit' | 'command' | 'query';
  target?: string;
  purpose: string;
  risk: 'low' | 'medium' | 'high';
  status: 'pending' | 'completed' | 'failed' | 'skipped';
}

export interface Plan {
  id: string;
  created: Date;
  status: 'pending' | 'approved' | 'executing' | 'completed' | 'failed';
  query: string;
  summary: string;
  analysis: string;
  steps: PlanStep[];
  rollbackStrategy: string[];
}

export class PlanManager {
  private plansDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.plansDir = join(baseDir, '.plans');
  }

  async ensureDir(): Promise<void> {
    if (!existsSync(this.plansDir)) {
      await mkdir(this.plansDir, { recursive: true });
    }
  }

  async createPlan(query: string, summary: string, analysis: string, steps: PlanStep[], rollbackStrategy: string[]): Promise<Plan> {
    const plan: Plan = {
      id: this.generatePlanId(),
      created: new Date(),
      status: 'pending',
      query,
      summary,
      analysis,
      steps,
      rollbackStrategy
    };
    return plan;
  }

  async savePlan(plan: Plan): Promise<string> {
    await this.ensureDir();
    const slug = this.slugify(plan.summary);
    const filename = `${plan.id}-${slug}.plan.md`;
    const filepath = join(this.plansDir, filename);
    const content = this.serializePlanMarkdown(plan);
    await writeFile(filepath, content, 'utf-8');
    return filepath;
  }

  async loadPlan(planPath: string): Promise<Plan> {
    const content = await readFile(planPath, 'utf-8');
    return this.parsePlanMarkdown(content);
  }

  async listPlans(): Promise<{ path: string; plan: Plan }[]> {
    await this.ensureDir();
    const files = await readdir(this.plansDir);
    const planFiles = files.filter(f => f.endsWith('.plan.md'));

    const plans: { path: string; plan: Plan }[] = [];
    for (const file of planFiles) {
      const filepath = join(this.plansDir, file);
      try {
        const plan = await this.loadPlan(filepath);
        plans.push({ path: filepath, plan });
      } catch (e) {
        // Skip invalid plan files
      }
    }

    // Sort by creation date, newest first
    plans.sort((a, b) => new Date(b.plan.created).getTime() - new Date(a.plan.created).getTime());
    return plans;
  }

  async deletePlan(planId: string): Promise<void> {
    const plans = await this.listPlans();
    const plan = plans.find(p => p.plan.id === planId);
    if (plan) {
      await unlink(plan.path);
    }
  }

  async deleteCompleted(): Promise<number> {
    const plans = await this.listPlans();
    const completed = plans.filter(p => p.plan.status === 'completed');
    for (const p of completed) {
      await unlink(p.path);
    }
    return completed.length;
  }

  async deleteAll(): Promise<number> {
    const plans = await this.listPlans();
    for (const p of plans) {
      await unlink(p.path);
    }
    return plans.length;
  }

  async updateStatus(planId: string, status: Plan['status']): Promise<void> {
    const plans = await this.listPlans();
    const planEntry = plans.find(p => p.plan.id === planId);
    if (planEntry) {
      planEntry.plan.status = status;
      const content = this.serializePlanMarkdown(planEntry.plan);
      await writeFile(planEntry.path, content, 'utf-8');
    }
  }

  async updateStepStatus(planId: string, stepId: string, status: PlanStep['status']): Promise<void> {
    const plans = await this.listPlans();
    const planEntry = plans.find(p => p.plan.id === planId);
    if (planEntry) {
      const step = planEntry.plan.steps.find(s => s.id === stepId);
      if (step) {
        step.status = status;
        const content = this.serializePlanMarkdown(planEntry.plan);
        await writeFile(planEntry.path, content, 'utf-8');
      }
    }
  }

  private generatePlanId(): string {
    const now = new Date();
    const date = now.toISOString().split('T')[0].replace(/-/g, '');
    const time = now.toTimeString().split(' ')[0].replace(/:/g, '').slice(0, 6);
    return `plan-${date}-${time}`;
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 30)
      .replace(/-+$/, '');
  }

  private parsePlanMarkdown(content: string): Plan {
    const lines = content.split('\n');
    const frontmatterEnd = lines.findIndex((l, i) => i > 0 && l === '---');

    // Parse frontmatter
    const frontmatter: Record<string, string> = {};
    for (let i = 1; i < frontmatterEnd; i++) {
      const match = lines[i].match(/^(\w+):\s*(.+)$/);
      if (match) {
        frontmatter[match[1]] = match[2].replace(/^"(.+)"$/, '$1');
      }
    }

    // Parse body
    const body = lines.slice(frontmatterEnd + 1).join('\n');

    // Extract sections
    const summaryMatch = body.match(/## Summary\n([\s\S]*?)(?=##|$)/);
    const analysisMatch = body.match(/## Analysis\n([\s\S]*?)(?=##|$)/);
    const stepsMatch = body.match(/## Steps\n([\s\S]*?)(?=##|$)/);
    const rollbackMatch = body.match(/## Rollback Strategy\n([\s\S]*?)(?=##|$)/);

    // Parse steps
    const steps: PlanStep[] = [];
    if (stepsMatch) {
      const stepRegex = /\d+\.\s+\*\*(.+?)\*\*\n([\s\S]*?)(?=\d+\.|$)/g;
      let match;
      let stepNum = 1;
      while ((match = stepRegex.exec(stepsMatch[1])) !== null) {
        const stepName = match[1];
        const stepBody = match[2];

        const actionMatch = stepBody.match(/Action:\s*(\w+)/);
        const targetMatch = stepBody.match(/Target:\s*(.+)/);
        const purposeMatch = stepBody.match(/Purpose:\s*(.+)/);
        const riskMatch = stepBody.match(/Risk:\s*(\w+)/);
        const statusMatch = stepBody.match(/Status:\s*(\w+)/);

        steps.push({
          id: `step-${stepNum++}`,
          name: stepName.trim(),
          action: (actionMatch?.[1] || 'query') as PlanStep['action'],
          target: targetMatch?.[1]?.trim(),
          purpose: purposeMatch?.[1]?.trim() || '',
          risk: (riskMatch?.[1] || 'low') as PlanStep['risk'],
          status: (statusMatch?.[1] || 'pending') as PlanStep['status']
        });
      }
    }

    // Parse rollback
    const rollbackStrategy: string[] = [];
    if (rollbackMatch) {
      const rollbackLines = rollbackMatch[1].trim().split('\n');
      for (const line of rollbackLines) {
        const clean = line.replace(/^-\s*/, '').trim();
        if (clean) rollbackStrategy.push(clean);
      }
    }

    return {
      id: frontmatter.id || this.generatePlanId(),
      created: new Date(frontmatter.created || Date.now()),
      status: (frontmatter.status || 'pending') as Plan['status'],
      query: frontmatter.query || '',
      summary: summaryMatch?.[1]?.trim() || '',
      analysis: analysisMatch?.[1]?.trim() || '',
      steps,
      rollbackStrategy
    };
  }

  private serializePlanMarkdown(plan: Plan): string {
    const lines: string[] = [];

    // Frontmatter
    lines.push('---');
    lines.push(`id: ${plan.id}`);
    lines.push(`created: ${plan.created.toISOString()}`);
    lines.push(`status: ${plan.status}`);
    lines.push(`query: "${plan.query.replace(/"/g, '\\"')}"`);
    lines.push('---');
    lines.push('');

    // Summary
    lines.push('## Summary');
    lines.push(plan.summary);
    lines.push('');

    // Analysis
    lines.push('## Analysis');
    lines.push(plan.analysis);
    lines.push('');

    // Steps
    lines.push('## Steps');
    plan.steps.forEach((step, i) => {
      lines.push(`${i + 1}. **${step.name}**`);
      lines.push(`   - Action: ${step.action}`);
      if (step.target) lines.push(`   - Target: ${step.target}`);
      lines.push(`   - Purpose: ${step.purpose}`);
      lines.push(`   - Risk: ${step.risk}`);
      lines.push(`   - Status: ${step.status}`);
      lines.push('');
    });

    // Rollback Strategy
    lines.push('## Rollback Strategy');
    for (const strategy of plan.rollbackStrategy) {
      lines.push(`- ${strategy}`);
    }

    return lines.join('\n');
  }
}

export function formatAge(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
}
