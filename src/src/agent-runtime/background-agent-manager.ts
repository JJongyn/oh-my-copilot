import type { ChatMessage } from '../provider/types';

export interface BackgroundAgentTask {
  id: string;
  agent: string;
  task: string;
  status: 'running' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
  result?: string;
  error?: string;
}

interface SpawnOptions {
  agent: string;
  task: string;
  run: (agent: string, task: string) => Promise<string>;
}

let taskCounter = 0;
function nextTaskId(): string {
  taskCounter += 1;
  return `bg-${taskCounter.toString().padStart(4, '0')}`;
}

export class BackgroundAgentManager {
  private tasks = new Map<string, BackgroundAgentTask>();
  private pendingNotifications: ChatMessage[] = [];
  private readonly maxConcurrent: number;

  constructor(maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent;
  }

  runningCount(): number {
    return this.list().filter(task => task.status === 'running').length;
  }

  spawn(opts: SpawnOptions): BackgroundAgentTask {
    if (this.runningCount() >= this.maxConcurrent) {
      throw new Error(`Background agent limit reached (${this.maxConcurrent} running). Wait for a task to finish or inspect with list_background_agents.`);
    }

    const task: BackgroundAgentTask = {
      id: nextTaskId(),
      agent: opts.agent,
      task: opts.task,
      status: 'running',
      createdAt: new Date().toISOString(),
    };
    this.tasks.set(task.id, task);

    void opts.run(opts.agent, opts.task)
      .then((result) => {
        task.status = 'completed';
        task.result = result;
        task.completedAt = new Date().toISOString();
        this.pendingNotifications.push({
          role: 'user',
          content: `[BACKGROUND COMPLETED]
Task ID: ${task.id}
Agent: ${task.agent}

Result:
${result}

Incorporate this result if it is relevant, then continue working.`,
        });
      })
      .catch((error) => {
        task.status = 'failed';
        task.error = error instanceof Error ? error.message : String(error);
        task.completedAt = new Date().toISOString();
        this.pendingNotifications.push({
          role: 'user',
          content: `[BACKGROUND FAILED]
Task ID: ${task.id}
Agent: ${task.agent}
Error: ${task.error}

Decide whether to retry, use a different agent, or continue without this result.`,
        });
      });

    return task;
  }

  list(): BackgroundAgentTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get(id: string): BackgroundAgentTask | undefined {
    return this.tasks.get(id);
  }

  consumeNotifications(): ChatMessage[] {
    const notifications = [...this.pendingNotifications];
    this.pendingNotifications = [];
    return notifications;
  }

  maxConcurrentCount(): number {
    return this.maxConcurrent;
  }
}
