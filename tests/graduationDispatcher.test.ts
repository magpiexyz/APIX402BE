import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockCreateTask = vi.fn();
const mockQueuePath = vi.fn().mockReturnValue('projects/test-project/locations/us-central1/queues/graduation-queue');

vi.mock('@google-cloud/tasks', () => ({
  CloudTasksClient: class {
    createTask = mockCreateTask;
    queuePath = mockQueuePath;
  },
}));

import { dispatchGraduationTask, type GraduationTaskPayload } from '../src/services/graduationDispatcher.js';

describe('graduationDispatcher', () => {
  const originalEnv = process.env;

  const defaultPayload: GraduationTaskPayload = {
    tokenAddress: '0xabc123def456',
    chainId: '84532',
    virtualDistributed: '625000000000000000000000000',
    totalFeesCollected: '100000000',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      GCP_PROJECT_ID: 'test-project',
      CLOUD_RUN_SERVICE_URL: 'https://test-service.run.app',
      GRADUATION_QUEUE_NAME: 'graduation-queue',
      GRADUATION_QUEUE_LOCATION: 'us-central1',
      GRADUATION_INTERNAL_SECRET: 'test-secret',
    };
    mockCreateTask.mockResolvedValue({});
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should dispatch a graduation task successfully', async () => {
    await dispatchGraduationTask(defaultPayload);

    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    const call = mockCreateTask.mock.calls[0][0];

    expect(call.parent).toBe('projects/test-project/locations/us-central1/queues/graduation-queue');
    expect(call.task.name).toContain('graduate-0xabc123def456');
    expect(call.task.httpRequest.url).toBe('https://test-service.run.app/internal/graduate/0xabc123def456');
    expect(call.task.httpRequest.httpMethod).toBe('POST');
    expect(call.task.httpRequest.headers['Content-Type']).toBe('application/json');
    expect(call.task.httpRequest.headers['X-Graduation-Secret']).toBe('test-secret');

    // Verify body is base64-encoded JSON
    const decodedBody = JSON.parse(Buffer.from(call.task.httpRequest.body, 'base64').toString());
    expect(decodedBody).toEqual(defaultPayload);
  });

  it('should sanitize token address for task name', async () => {
    await dispatchGraduationTask({
      ...defaultPayload,
      tokenAddress: '0xABC.DEF/123',
    });

    const call = mockCreateTask.mock.calls[0][0];
    // Non-alphanumeric chars replaced with dashes, lowercased
    expect(call.task.name).toContain('graduate-0xabc-def-123');
  });

  it('should silently handle ALREADY_EXISTS error (gRPC code 6)', async () => {
    const alreadyExistsErr: any = new Error('ALREADY_EXISTS');
    alreadyExistsErr.code = 6;
    mockCreateTask.mockRejectedValue(alreadyExistsErr);

    // Should not throw
    await expect(dispatchGraduationTask(defaultPayload)).resolves.toBeUndefined();
  });

  it('should throw on non-dedup errors', async () => {
    const otherErr: any = new Error('PERMISSION_DENIED');
    otherErr.code = 7;
    mockCreateTask.mockRejectedValue(otherErr);

    await expect(dispatchGraduationTask(defaultPayload)).rejects.toThrow('PERMISSION_DENIED');
  });

  it('should return early when GCP_PROJECT_ID is missing', async () => {
    delete process.env.GCP_PROJECT_ID;

    await dispatchGraduationTask(defaultPayload);

    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('should return early when CLOUD_RUN_SERVICE_URL is missing', async () => {
    delete process.env.CLOUD_RUN_SERVICE_URL;

    await dispatchGraduationTask(defaultPayload);

    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('should omit X-Graduation-Secret header when env var is not set', async () => {
    delete process.env.GRADUATION_INTERNAL_SECRET;

    await dispatchGraduationTask(defaultPayload);

    const call = mockCreateTask.mock.calls[0][0];
    expect(call.task.httpRequest.headers['X-Graduation-Secret']).toBeUndefined();
  });

  it('should use default queue name and location when env vars are missing', async () => {
    delete process.env.GRADUATION_QUEUE_NAME;
    delete process.env.GRADUATION_QUEUE_LOCATION;

    await dispatchGraduationTask(defaultPayload);

    expect(mockQueuePath).toHaveBeenCalledWith('test-project', 'us-central1', 'graduation-queue');
  });

  it('should set scheduleTime to now', async () => {
    const before = Math.floor(Date.now() / 1000);
    await dispatchGraduationTask(defaultPayload);
    const after = Math.floor(Date.now() / 1000);

    const call = mockCreateTask.mock.calls[0][0];
    expect(call.task.scheduleTime.seconds).toBeGreaterThanOrEqual(before);
    expect(call.task.scheduleTime.seconds).toBeLessThanOrEqual(after);
  });
});
