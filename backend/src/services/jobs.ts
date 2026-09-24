import type { AppContext } from '../context.js';
import { one, type DbClient } from '../db/pool.js';

export type JobType = 'sms.send' | 'sms.notify' | 'mail.relay';

export interface JobRow {
  id: number;
  type: JobType;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

export type JobHandler = (ctx: AppContext, payload: Record<string, unknown>) => Promise<void>;

export async function enqueueJob(
  db: DbClient,
  type: JobType,
  payload: Record<string, unknown>,
  opts: { delaySeconds?: number; maxAttempts?: number } = {},
): Promise<void> {
  await db.query(
    `INSERT INTO jobs (type, payload, max_attempts, run_at) VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
    [type, JSON.stringify(payload), opts.maxAttempts ?? 5, opts.delaySeconds ?? 0],
  );
}

/** Polls the jobs table. Several API replicas can run workers safely thanks to SKIP LOCKED. */
export class JobWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = true;
  private lastMaintenance = 0;

  constructor(
    private readonly ctx: AppContext,
    private readonly handlers: Record<JobType, JobHandler>,
    private readonly maintenance: (ctx: AppContext) => Promise<void>,
    private readonly intervalMs = 1000,
  ) {}

  start(): void {
    this.stopped = false;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    while (this.running) await new Promise((r) => setTimeout(r, 50));
  }

  private schedule(delay: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), delay);
  }

  private async tick() {
    this.running = true;
    try {
      // Drain everything that is due, then sleep.
      while (!this.stopped && (await this.runOnce())) {
        /* keep going */
      }
      if (Date.now() - this.lastMaintenance > 10 * 60_000) {
        this.lastMaintenance = Date.now();
        await this.maintenance(this.ctx).catch((err: unknown) => this.ctx.log.error({ err }, 'maintenance failed'));
      }
    } catch (err) {
      this.ctx.log.error({ err }, 'job worker tick failed');
    } finally {
      this.running = false;
      this.schedule(this.intervalMs);
    }
  }

  /** Claims and runs a single due job. Returns false when the queue is empty. */
  async runOnce(): Promise<boolean> {
    const { db, log } = this.ctx;
    // Recover jobs whose worker died mid-flight.
    await db.query(`UPDATE jobs SET status = 'pending', locked_at = NULL WHERE status = 'running' AND locked_at < now() - interval '10 minutes'`);
    const job = await one<JobRow>(
      db,
      `UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
        WHERE id = (
          SELECT id FROM jobs WHERE status = 'pending' AND run_at <= now()
          ORDER BY run_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        RETURNING id, type, payload, attempts, max_attempts`,
    );
    if (!job) return false;

    const handler = this.handlers[job.type];
    try {
      if (!handler) throw new Error(`no handler for job type ${job.type}`);
      await handler(this.ctx, job.payload);
      await db.query(`UPDATE jobs SET status = 'done', locked_at = NULL, updated_at = now() WHERE id = $1`, [job.id]);
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      const final = job.attempts >= job.max_attempts;
      const backoff = Math.min(3600, 15 * 2 ** (job.attempts - 1));
      await db.query(
        `UPDATE jobs SET status = $2, locked_at = NULL, last_error = $3, updated_at = now(),
                run_at = now() + make_interval(secs => $4) WHERE id = $1`,
        [job.id, final ? 'failed' : 'pending', message.slice(0, 2000), backoff],
      );
      log.warn({ jobId: job.id, type: job.type, attempt: job.attempts, final, err: message }, 'job failed');
    }
    return true;
  }
}
