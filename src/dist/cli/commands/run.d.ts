export declare function runTask(task: string, options?: {
    agent?: string;
    model?: string;
    resume?: string;
    json?: boolean;
    noStream?: boolean;
}): Promise<void>;
