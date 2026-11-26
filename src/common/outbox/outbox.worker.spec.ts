import { SyncOutboxEntity } from './infrastructure/persistence/sync-outbox.entity';
import { OutboxHandlerResult } from './outbox-handler';
import { OutboxConfig } from './outbox.config';
import { OutboxWorker } from './outbox.worker';

const CONFIG: OutboxConfig = {
  pollIntervalSeconds: 0,
  batchSize: 20,
  concurrency: 2,
  maxAttempts: 10000,
  maxAgeMs: 86_400_000,
  baseDelayMs: 1000,
  maxDelayMs: 45_000,
  lockStaleMs: 30_000,
  sentRetentionDays: 7,
};

const row = (id: string, attempts = 0) =>
  ({ id, operation: 'TRANSITION_ISSUE', attempts }) as unknown as SyncOutboxEntity;

function setup(config: Partial<OutboxConfig> = {}) {
  const service = {
    claim: jest.fn().mockResolvedValue([]),
    complete: jest.fn().mockResolvedValue(true),
    fail: jest.fn().mockResolvedValue({ outcome: 'RETRY' }),
    reclaimStale: jest.fn().mockResolvedValue([]),
    purgeSent: jest.fn().mockResolvedValue(0),
  };
  const handler = { handle: jest.fn<Promise<OutboxHandlerResult>, unknown[]>() };
  const registry = { get: jest.fn().mockReturnValue(handler) };
  const clock = { now: () => new Date('2026-11-26T10:00:00Z') };
  const worker = new OutboxWorker(
    service as never,
    registry as never,
    { ...CONFIG, ...config },
    clock,
  );
  return { worker, service, handler, registry };
}

describe('OutboxWorker', () => {
  it('completes a SENT row with the handler result', async () => {
    const { worker, service, handler } = setup();
    service.claim.mockResolvedValueOnce([row('r1')]);
    handler.handle.mockResolvedValue({ status: 'SENT', result: { outcome: 'transitioned' } });
    await expect(worker.runOnce()).resolves.toBe(1);
    expect(service.complete).toHaveBeenCalledWith('r1', worker.workerId, {
      outcome: 'transitioned',
    });
  });

  it('passes the 1-based attempt number and a deadline to the handler', async () => {
    const { worker, service, handler } = setup();
    service.claim.mockResolvedValueOnce([row('r1', 4)]);
    handler.handle.mockResolvedValue({ status: 'SENT' });
    await worker.runOnce();
    expect(handler.handle.mock.calls[0][1]).toMatchObject({ attempt: 5 });
    expect(service.complete).toHaveBeenCalledWith('r1', worker.workerId, null);
  });

  it('fails a row through the service and notifies listeners when it became DEAD', async () => {
    const { worker, service, handler } = setup();
    const dead = row('r1');
    const listener = jest.fn();
    worker.onDeadLettered(listener);
    service.claim.mockResolvedValueOnce([dead]);
    service.fail.mockResolvedValue({ outcome: 'DEAD', row: dead });
    handler.handle.mockResolvedValue({
      status: 'FAILED',
      retryable: false,
      errorCode: 'no_transition_path',
      error: 'nope',
    });
    await worker.runOnce();
    expect(service.fail).toHaveBeenCalledWith(dead, worker.workerId, expect.any(Object));
    expect(listener).toHaveBeenCalledWith(dead);
  });

  it('does not notify listeners for a retry', async () => {
    const { worker, service, handler } = setup();
    const listener = jest.fn();
    worker.onDeadLettered(listener);
    service.claim.mockResolvedValueOnce([row('r1')]);
    handler.handle.mockResolvedValue({
      status: 'FAILED',
      retryable: true,
      errorCode: 'jira_error',
      error: '503',
    });
    await worker.runOnce();
    expect(listener).not.toHaveBeenCalled();
  });

  it('dead-letters a row whose operation has no handler', async () => {
    const { worker, service, registry } = setup();
    registry.get.mockReturnValue(undefined);
    service.claim.mockResolvedValueOnce([row('r1')]);
    await worker.runOnce();
    expect(service.fail).toHaveBeenCalledWith(
      expect.anything(),
      worker.workerId,
      expect.objectContaining({ retryable: false, errorCode: 'handler_missing' }),
    );
  });

  it('treats a throwing handler as a retryable failure', async () => {
    const { worker, service, handler } = setup();
    service.claim.mockResolvedValueOnce([row('r1')]);
    handler.handle.mockRejectedValue(new Error('boom'));
    await worker.runOnce();
    expect(service.fail).toHaveBeenCalledWith(
      expect.anything(),
      worker.workerId,
      expect.objectContaining({ retryable: true, errorCode: 'handler_error', error: 'boom' }),
    );
  });

  it('claims at most the free concurrency slots', async () => {
    const { worker, service } = setup({ concurrency: 2, batchSize: 20 });
    await worker.runOnce();
    expect(service.claim).toHaveBeenCalledWith(worker.workerId, 2);
    const small = setup({ concurrency: 10, batchSize: 3 });
    await small.worker.runOnce();
    expect(small.service.claim).toHaveBeenCalledWith(small.worker.workerId, 3);
  });

  it('reclaims stale locks and announces rows that became DEAD', async () => {
    const { worker, service } = setup();
    const dead = row('stale');
    const listener = jest.fn();
    worker.onDeadLettered(listener);
    service.reclaimStale.mockResolvedValueOnce([dead]);
    await worker.runOnce();
    expect(listener).toHaveBeenCalledWith(dead);
  });

  it('keeps going when a dead-letter listener throws', async () => {
    const { worker, service } = setup();
    const second = jest.fn();
    worker.onDeadLettered(() => {
      throw new Error('listener down');
    });
    worker.onDeadLettered(second);
    service.reclaimStale.mockResolvedValueOnce([row('stale')]);
    await worker.runOnce();
    expect(second).toHaveBeenCalled();
  });

  it('drain runs rounds until nothing is claimable', async () => {
    const { worker, service, handler } = setup();
    service.claim
      .mockResolvedValueOnce([row('a')])
      .mockResolvedValueOnce([row('b')])
      .mockResolvedValue([]);
    handler.handle.mockResolvedValue({ status: 'SENT' });
    await worker.drain();
    expect(service.complete).toHaveBeenCalledTimes(2);
    expect(service.claim).toHaveBeenCalledTimes(3);
  });

  it('start/kick/stop: the background loop claims and stop waits for the in-flight row', async () => {
    const { worker, service, handler } = setup({ pollIntervalSeconds: 3600 });
    let release: () => void = () => undefined;
    handler.handle.mockReturnValue(
      new Promise<OutboxHandlerResult>((resolve) => {
        release = () => resolve({ status: 'SENT' });
      }),
    );
    service.claim.mockResolvedValueOnce([row('r1')]).mockResolvedValue([]);
    worker.onApplicationBootstrap();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(service.reclaimStale).toHaveBeenCalled();
    expect(service.purgeSent).toHaveBeenCalledTimes(1);
    expect(handler.handle).toHaveBeenCalledTimes(1);

    const stopped = worker.stop(2000);
    release();
    await stopped;
    expect(service.complete).toHaveBeenCalledTimes(1);

    const before = service.claim.mock.calls.length;
    worker.kick();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(service.claim.mock.calls.length).toBe(before);
  });

  it('does not start the loop when polling is disabled', () => {
    const { worker, service } = setup({ pollIntervalSeconds: 0 });
    worker.onApplicationBootstrap();
    worker.kick();
    expect(service.claim).not.toHaveBeenCalled();
  });

  it('survives a failing claim', async () => {
    const { worker, service } = setup({ pollIntervalSeconds: 3600 });
    service.claim.mockRejectedValue(new Error('db down'));
    worker.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await worker.stop();
    expect(service.claim).toHaveBeenCalled();
  });
});
