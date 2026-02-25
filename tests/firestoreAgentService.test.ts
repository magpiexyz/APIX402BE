/**
 * Tests for Firestore Agent Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Test data storage
let testData: Map<string, any> = new Map();
let shouldThrowError = false;

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-agent-uuid'),
}));

// Mock Firestore
vi.mock('../src/db/firestoreClient.js', () => {
  const createMockSnapshot = (docs: any[]) => ({
    empty: docs.length === 0,
    docs: docs.map((data) => ({
      id: data?.id,
      data: () => data,
    })),
  });

  const mockFirestore = {
    collection: vi.fn().mockImplementation((collectionName: string) => {
      const baseQuery = {
        doc: vi.fn().mockImplementation((docId: string) => {
          const key = `${collectionName}/${docId}`;
          return {
            get: vi.fn().mockImplementation(async () => {
              if (shouldThrowError) throw new Error('Firestore error');
              const data = testData.get(key);
              return { exists: data !== undefined, data: () => data };
            }),
            set: vi.fn().mockImplementation(async (data: any) => {
              if (shouldThrowError) throw new Error('Firestore error');
              testData.set(key, data);
            }),
            update: vi.fn().mockImplementation(async (updates: any) => {
              if (shouldThrowError) throw new Error('Firestore error');
              const existing = testData.get(key) || {};
              testData.set(key, { ...existing, ...updates });
            }),
            delete: vi.fn().mockImplementation(async () => {
              if (shouldThrowError) throw new Error('Firestore error');
              testData.delete(key);
            }),
          };
        }),
        where: vi.fn().mockImplementation((field: string, op: string, value: any) => ({
          where: vi.fn().mockImplementation((field2: string, op2: string, value2: any) => ({
            get: vi.fn().mockImplementation(async () => {
              if (shouldThrowError) throw new Error('Firestore error');
              const matches: any[] = [];
              testData.forEach((data, key) => {
                if (key.startsWith(collectionName) && data[field] === value && data[field2] === value2) {
                  matches.push(data);
                }
              });
              return createMockSnapshot(matches);
            }),
          })),
          get: vi.fn().mockImplementation(async () => {
            if (shouldThrowError) throw new Error('Firestore error');
            const matches: any[] = [];
            testData.forEach((data, key) => {
              if (key.startsWith(collectionName) && data[field] === value) {
                matches.push(data);
              }
            });
            return createMockSnapshot(matches);
          }),
        })),
        get: vi.fn().mockImplementation(async () => {
          if (shouldThrowError) throw new Error('Firestore error');
          const matches: any[] = [];
          testData.forEach((data, key) => {
            if (key.startsWith(collectionName)) {
              matches.push(data);
            }
          });
          return createMockSnapshot(matches);
        }),
      };
      return baseQuery;
    }),
  };

  return {
    getFirestoreClient: vi.fn(() => mockFirestore),
    Collections: {
      AGENTS: 'agents',
    },
    FieldValue: { increment: vi.fn((n) => n) },
  };
});

import { AgentService, type Agent, type CreateAgentParams } from '../src/services/firestoreAgentService.js';

describe('AgentService', () => {
  let service: AgentService;

  beforeEach(() => {
    testData.clear();
    shouldThrowError = false;
    service = new AgentService('us-west-1', 'agents');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createAgent', () => {
    it('should create a new agent', async () => {
      const params: CreateAgentParams = {
        name: 'Test Agent',
        description: 'A test agent',
        creator: '0xCreator',
        llmProvider: 'claude',
        availableTools: ['magpie/get-quote'],
        starterPrompts: ['Hello!'],
      };

      const result = await service.createAgent(params);

      expect(result.id).toBe('test-agent-uuid');
      expect(result.name).toBe('Test Agent');
      expect(result.creator).toBe('0xcreator'); // lowercased
      expect(result.llmProvider).toBe('claude');
      expect(result.totalMessages).toBe(0);
      expect(result.totalUsers).toBe(0);
      expect(result.totalToolCalls).toBe(0);
      expect(result.isPublic).toBe(true); // default
    });

    it('should set isPublic to false when specified', async () => {
      const params: CreateAgentParams = {
        name: 'Private Agent',
        description: 'A private agent',
        creator: '0xCreator',
        llmProvider: 'gpt',
        availableTools: [],
        starterPrompts: [],
        isPublic: false,
      };

      const result = await service.createAgent(params);

      expect(result.isPublic).toBe(false);
    });

    it('should include system instructions when provided', async () => {
      const params: CreateAgentParams = {
        name: 'System Agent',
        description: 'Agent with instructions',
        systemInstructions: 'Be helpful',
        creator: '0xCreator',
        llmProvider: 'gemini',
        availableTools: [],
        starterPrompts: [],
      };

      const result = await service.createAgent(params);

      expect(result.systemInstructions).toBe('Be helpful');
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      const params: CreateAgentParams = {
        name: 'Error Agent',
        description: 'Will fail',
        creator: '0xCreator',
        llmProvider: 'claude',
        availableTools: [],
        starterPrompts: [],
      };

      await expect(service.createAgent(params)).rejects.toThrow();
    });
  });

  describe('getAgent', () => {
    it('should return agent when it exists', async () => {
      const agent: Agent = {
        id: 'agent-123',
        name: 'Existing Agent',
        description: 'Test',
        creator: '0xcreator',
        llmProvider: 'claude',
        availableTools: [],
        starterPrompts: [],
        isPublic: true,
        totalMessages: 10,
        totalUsers: 5,
        totalToolCalls: 20,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      testData.set('agents/agent-123', agent);

      const result = await service.getAgent('agent-123');

      expect(result).not.toBeNull();
      expect(result?.name).toBe('Existing Agent');
    });

    it('should return null when agent does not exist', async () => {
      const result = await service.getAgent('nonexistent');

      expect(result).toBeNull();
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(service.getAgent('agent-123')).rejects.toThrow();
    });
  });

  describe('listAgents', () => {
    it('should return all agents when no filters', async () => {
      testData.set('agents/agent-1', { id: 'agent-1', name: 'Agent 1', creator: '0xcreator' });
      testData.set('agents/agent-2', { id: 'agent-2', name: 'Agent 2', creator: '0xother' });

      const result = await service.listAgents();

      expect(result).toHaveLength(2);
    });

    it('should filter by creator', async () => {
      testData.set('agents/agent-1', { id: 'agent-1', name: 'Agent 1', creator: '0xcreator' });
      testData.set('agents/agent-2', { id: 'agent-2', name: 'Agent 2', creator: '0xother' });

      const result = await service.listAgents({ creator: '0xCreator' });

      expect(result).toHaveLength(1);
      expect(result[0].creator).toBe('0xcreator');
    });

    it('should filter by isPublic', async () => {
      testData.set('agents/agent-1', { id: 'agent-1', isPublic: true });
      testData.set('agents/agent-2', { id: 'agent-2', isPublic: false });

      const result = await service.listAgents({ isPublic: true });

      expect(result).toHaveLength(1);
      expect(result[0].isPublic).toBe(true);
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(service.listAgents()).rejects.toThrow();
    });
  });

  describe('getAgentsByCreator', () => {
    it('should return agents for creator', async () => {
      testData.set('agents/agent-1', { id: 'agent-1', creator: '0xcreator' });
      testData.set('agents/agent-2', { id: 'agent-2', creator: '0xcreator' });
      testData.set('agents/agent-3', { id: 'agent-3', creator: '0xother' });

      const result = await service.getAgentsByCreator('0xCreator');

      expect(result).toHaveLength(2);
    });
  });

  describe('getPublicAgents', () => {
    it('should return only public agents', async () => {
      testData.set('agents/agent-1', { id: 'agent-1', isPublic: true });
      testData.set('agents/agent-2', { id: 'agent-2', isPublic: false });
      testData.set('agents/agent-3', { id: 'agent-3', isPublic: true });

      const result = await service.getPublicAgents();

      expect(result).toHaveLength(2);
      expect(result.every(a => a.isPublic)).toBe(true);
    });
  });

  describe('updateAgent', () => {
    it('should update agent fields', async () => {
      testData.set('agents/agent-123', {
        id: 'agent-123',
        name: 'Old Name',
        description: 'Old description',
        totalMessages: 0,
      });

      const result = await service.updateAgent('agent-123', {
        name: 'New Name',
        description: 'New description',
      });

      const stored = testData.get('agents/agent-123');
      expect(stored.name).toBe('New Name');
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(service.updateAgent('agent-123', { name: 'Test' })).rejects.toThrow();
    });
  });

  describe('deleteAgent', () => {
    it('should delete agent when creator matches', async () => {
      testData.set('agents/agent-123', {
        id: 'agent-123',
        creator: '0xcreator',
      });

      await service.deleteAgent('agent-123', '0xCreator');

      expect(testData.has('agents/agent-123')).toBe(false);
    });

    it('should throw when agent not found', async () => {
      await expect(service.deleteAgent('nonexistent', '0xCreator')).rejects.toThrow('Agent nonexistent not found');
    });

    it('should throw when creator does not match', async () => {
      testData.set('agents/agent-123', {
        id: 'agent-123',
        creator: '0xowner',
      });

      await expect(service.deleteAgent('agent-123', '0xOther')).rejects.toThrow('Unauthorized');
    });
  });

  describe('incrementMetric', () => {
    it('should increment totalMessages', async () => {
      testData.set('agents/agent-123', {
        id: 'agent-123',
        totalMessages: 10,
      });

      await service.incrementMetric('agent-123', 'totalMessages');

      const stored = testData.get('agents/agent-123');
      expect(stored.totalMessages).toBe(1); // FieldValue.increment mock returns the value
    });

    it('should increment totalUsers', async () => {
      testData.set('agents/agent-123', { id: 'agent-123', totalUsers: 5 });

      await service.incrementUserCount('agent-123');

      const stored = testData.get('agents/agent-123');
      expect(stored.totalUsers).toBe(1);
    });

    it('should increment totalToolCalls with amount', async () => {
      testData.set('agents/agent-123', { id: 'agent-123', totalToolCalls: 10 });

      await service.incrementToolCallCount('agent-123', 5);

      const stored = testData.get('agents/agent-123');
      expect(stored.totalToolCalls).toBe(5);
    });

    it('should return partial agent on error', async () => {
      shouldThrowError = true;

      const result = await service.incrementMetric('agent-123', 'totalMessages');

      expect(result.id).toBe('agent-123');
    });
  });

  describe('getAgentMetrics', () => {
    it('should return metrics for agent', async () => {
      testData.set('agents/agent-123', {
        id: 'agent-123',
        totalMessages: 100,
        totalUsers: 25,
        totalToolCalls: 500,
      });

      const result = await service.getAgentMetrics('agent-123');

      expect(result).not.toBeNull();
      expect(result?.totalMessages).toBe(100);
      expect(result?.totalUsers).toBe(25);
      expect(result?.totalToolCalls).toBe(500);
    });

    it('should return null when agent not found', async () => {
      const result = await service.getAgentMetrics('nonexistent');

      expect(result).toBeNull();
    });

    it('should return zeros for missing metric fields', async () => {
      testData.set('agents/agent-123', { id: 'agent-123' });

      const result = await service.getAgentMetrics('agent-123');

      expect(result?.totalMessages).toBe(0);
      expect(result?.totalUsers).toBe(0);
      expect(result?.totalToolCalls).toBe(0);
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(service.getAgentMetrics('agent-123')).rejects.toThrow();
    });
  });
});
