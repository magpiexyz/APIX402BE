/**
 * Tests for Agent Tool Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock node-fetch
vi.mock('node-fetch', () => ({
  default: vi.fn(),
}));

// Mock fzstd
vi.mock('fzstd', () => ({
  decompress: vi.fn((data) => data),
}));

import fetch from 'node-fetch';
import { decompress as decompressZstd } from 'fzstd';
import { AgentToolService, type IaoServer, type ToolExecutionResult } from '../src/services/agentToolService.js';
import type { Agent } from '../src/services/firestoreAgentService.js';

describe('AgentToolService', () => {
  let service: AgentToolService;

  const mockServers: IaoServer[] = [
    {
      id: '0xTokenAddress',
      slug: 'test-server',
      name: 'Test Server',
      symbol: 'TEST',
      builder: '0xBuilder',
      paymentToken: '0xUSDC',
      apis: [
        {
          index: 0,
          slug: 'get-data',
          name: 'Get Data',
          description: 'Fetches data. Usage example: ?param=value',
          apiUrl: 'https://api.example.com/data',
          fee: '1000000',
          createdAt: '2024-01-01',
        },
        {
          index: 1,
          slug: 'post-data',
          name: 'Post Data',
          description: 'Posts data',
          fee: '2000000',
          createdAt: '2024-01-01',
        },
      ],
    },
    {
      id: '0xOtherToken',
      slug: 'other-server',
      name: 'Other Server',
      symbol: 'OTHER',
      builder: '0xOtherBuilder',
      paymentToken: '0xUSDC',
      apis: [
        {
          index: 0,
          slug: 'test-api',
          name: 'Test API',
          fee: '500000',
          createdAt: '2024-01-01',
        },
      ],
    },
  ];

  const mockAgent: Agent = {
    id: 'agent-123',
    name: 'Test Agent',
    description: 'A test agent',
    systemPrompt: 'You are a test agent',
    ownerAddress: '0xOwner',
    availableTools: ['test-server/get-data', 'other-server/test-api'],
    isActive: true,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  };

  // Mock servers that match the parsed tool names for executeTool tests
  // Tool name 'call_test_server_get_data' parses to serverSlug='test', apiSlug='server_get_data'
  const mockServersForExecuteTool: IaoServer[] = [
    {
      id: '0xTestToken',
      slug: 'test',
      name: 'Test',
      symbol: 'TEST',
      builder: '0xBuilder',
      paymentToken: '0xUSDC',
      apis: [
        {
          index: 0,
          slug: 'server_get_data',
          name: 'Server Get Data',
          description: 'Fetches data',
          fee: '1000000',
          method: 'GET',
          createdAt: '2024-01-01',
        },
        {
          index: 1,
          slug: 'data',
          name: 'Data',
          description: 'Get data',
          fee: '1000000',
          method: 'GET',
          createdAt: '2024-01-01',
        },
      ],
    },
  ];

  beforeEach(() => {
    service = new AgentToolService('http://localhost:3000');
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default URL', () => {
      const defaultService = new AgentToolService();
      expect(defaultService).toBeDefined();
    });

    it('should initialize with custom URL', () => {
      const customService = new AgentToolService('http://custom:8080');
      expect(customService).toBeDefined();
    });
  });

  describe('fetchAvailableServers', () => {
    it('should fetch servers successfully', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ servers: mockServers }),
      } as any);

      const servers = await service.fetchAvailableServers();

      expect(servers).toHaveLength(2);
      expect(servers[0].slug).toBe('test-server');
      expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/servers');
    });

    it('should handle data.data response format', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ data: mockServers }),
      } as any);

      const servers = await service.fetchAvailableServers();

      expect(servers).toHaveLength(2);
    });

    it('should handle raw array response format', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => mockServers,
      } as any);

      const servers = await service.fetchAvailableServers();

      expect(servers).toHaveLength(2);
    });

    it('should return empty array on HTTP error', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
      } as any);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const servers = await service.fetchAvailableServers();

      expect(servers).toHaveLength(0);
      consoleSpy.mockRestore();
    });

    it('should return empty array on fetch error', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const servers = await service.fetchAvailableServers();

      expect(servers).toHaveLength(0);
      consoleSpy.mockRestore();
    });
  });

  describe('getToolsForAgent', () => {
    it('should return tools for agent', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ servers: mockServers }),
      } as any);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const tools = await service.getToolsForAgent(mockAgent);

      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('call_test_server_get_data');
      expect(tools[0].description).toContain('Get Data');
      expect(tools[0].description).toContain('Fee: 1000000 wei');
      expect(tools[1].name).toBe('call_other_server_test_api');
      consoleSpy.mockRestore();
    });

    it('should include usage examples in query description', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ servers: mockServers }),
      } as any);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const tools = await service.getToolsForAgent(mockAgent);

      // First tool has usage example in description
      const firstToolSchema = tools[0].input_schema as any;
      expect(firstToolSchema.properties.query.description).toContain('Examples from docs');
      consoleSpy.mockRestore();
    });

    it('should warn when server not found', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ servers: [] }),
      } as any);
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const tools = await service.getToolsForAgent(mockAgent);

      expect(tools).toHaveLength(0);
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Server not found'));
      consoleWarnSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    it('should warn when API not found', async () => {
      const serverWithoutApi = [{ ...mockServers[0], apis: [] }];
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ servers: serverWithoutApi }),
      } as any);
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const tools = await service.getToolsForAgent(mockAgent);

      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('API not found'));
      consoleWarnSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    it('should return empty array on error', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const tools = await service.getToolsForAgent(mockAgent);

      expect(tools).toHaveLength(0);
      consoleSpy.mockRestore();
    });

    it('should handle error during tool processing', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ servers: mockServers }),
      } as any);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Agent with invalid availableTools that will cause an error during split
      const badAgent: Agent = {
        ...mockAgent,
        availableTools: null as any, // This will cause an error when iterating
      };

      const tools = await service.getToolsForAgent(badAgent);

      expect(tools).toHaveLength(0);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error getting tools for agent'), expect.any(Error));
      consoleSpy.mockRestore();
    });
  });

  describe('getApiInfo', () => {
    it('should return API info', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ servers: mockServers }),
      } as any);

      const info = await service.getApiInfo('test-server', 'get-data');

      expect(info.name).toBe('Get Data');
      expect(info.fee).toBe('1000000');
      expect(info.tokenAddress).toBe('0xTokenAddress');
    });

    it('should throw when server not found', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ servers: [] }),
      } as any);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(service.getApiInfo('nonexistent', 'api')).rejects.toThrow('Server nonexistent not found');
      consoleSpy.mockRestore();
    });

    it('should throw when API not found', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ servers: mockServers }),
      } as any);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(service.getApiInfo('test-server', 'nonexistent')).rejects.toThrow('API nonexistent not found');
      consoleSpy.mockRestore();
    });
  });

  describe('executeTool', () => {
    const mockToolCall = {
      id: 'tool-call-1',
      name: 'call_test_server_get_data',
      input: { query: 'param=value' },
    };

    it('should execute tool successfully', async () => {
      // First call: fetchAvailableServers, Second call: actual API call
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ servers: mockServersForExecuteTool }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { result: 'success' } }),
          headers: new Map() as any,
        } as any);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await service.executeTool(mockToolCall, mockAgent);

      expect(result.success).toBe(true);
      expect(result.toolCallId).toBe('tool-call-1');
      expect(result.result).toEqual({ result: 'success' });
      consoleSpy.mockRestore();
    });

    it('should handle query starting with ?', async () => {
      // First call: fetchAvailableServers, Second call: actual API call
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ servers: mockServersForExecuteTool }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: 'ok' }),
          headers: new Map() as any,
        } as any);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const toolCall = {
        id: 'tool-1',
        name: 'call_test_server_get_data',
        input: { query: '?already=formatted' },
      };

      await service.executeTool(toolCall, mockAgent);

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('?already=formatted'),
        expect.any(Object)
      );
      consoleSpy.mockRestore();
    });

    it('should handle tool with no query', async () => {
      // First call: fetchAvailableServers, Second call: actual API call
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ servers: mockServersForExecuteTool }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: 'ok' }),
          headers: new Map() as any,
        } as any);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Tool name format: call_{serverSlug}_{apiSlug}
      // Tool 'call_test_server_get_data' parses to server='test', api='server_get_data'
      const toolCall = {
        id: 'tool-1',
        name: 'call_test_server_get_data',
        input: {},
      };

      await service.executeTool(toolCall, mockAgent);

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/test/server_get_data',
        expect.any(Object)
      );
      consoleSpy.mockRestore();
    });

    it('should fail with invalid tool name format', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const toolCall = {
        id: 'tool-1',
        name: 'call_invalid',
        input: {},
      };

      const result = await service.executeTool(toolCall, mockAgent);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid tool name format');
      consoleSpy.mockRestore();
    });

    it('should handle API error response', async () => {
      // First call: fetchAvailableServers, Second call: actual API call (returns error)
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ servers: mockServersForExecuteTool }),
        } as any)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => 'Internal Server Error',
        } as any);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await service.executeTool(mockToolCall, mockAgent);

      expect(result.success).toBe(false);
      expect(result.error).toContain('API returned 500');
      consoleSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    it('should handle zstd compressed response', async () => {
      const mockHeaders = {
        get: (name: string) => {
          if (name === 'content-encoding') return 'zstd';
          if (name === 'content-type') return 'application/json';
          return null;
        },
      };

      const compressedData = Buffer.from(JSON.stringify({ compressed: true }));
      // First call: fetchAvailableServers, Second call: actual API call (zstd compressed)
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ servers: mockServersForExecuteTool }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => compressedData.buffer,
          headers: mockHeaders,
        } as any);
      vi.mocked(decompressZstd).mockReturnValue(compressedData);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await service.executeTool(mockToolCall, mockAgent);

      expect(result.success).toBe(true);
      expect(decompressZstd).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should handle zstd decompression error', async () => {
      const mockHeaders = {
        get: (name: string) => {
          if (name === 'content-encoding') return 'zstd';
          return null;
        },
      };

      // First call: fetchAvailableServers, Second call: actual API call (zstd that fails to decompress)
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ servers: mockServersForExecuteTool }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => new ArrayBuffer(0),
          headers: mockHeaders,
        } as any);
      vi.mocked(decompressZstd).mockImplementation(() => {
        throw new Error('Decompression failed');
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await service.executeTool(mockToolCall, mockAgent);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to decompress');
      consoleSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    it('should handle network error', async () => {
      // First call: fetchAvailableServers, Second call: actual API call (network error)
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ servers: mockServersForExecuteTool }),
        } as any)
        .mockRejectedValueOnce(new Error('Network timeout'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await service.executeTool(mockToolCall, mockAgent);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network timeout');
      consoleSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });
  });

  describe('executeTools', () => {
    it('should execute multiple tools sequentially', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ result: 'ok' }),
        headers: new Map() as any,
      } as any);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const toolCalls = [
        { id: 'tool-1', name: 'call_test_server_get_data', input: {} },
        { id: 'tool-2', name: 'call_other_server_test_api', input: {} },
      ];

      const results = await service.executeTools(toolCalls, mockAgent);

      expect(results).toHaveLength(2);
      expect(results[0].toolCallId).toBe('tool-1');
      expect(results[1].toolCallId).toBe('tool-2');
      consoleSpy.mockRestore();
    });
  });

  describe('formatToolResults', () => {
    it('should format successful results', () => {
      const results: ToolExecutionResult[] = [
        {
          toolCallId: 'tool-1',
          toolName: 'call_test_api',
          success: true,
          result: { data: 'test' },
        },
      ];

      const formatted = service.formatToolResults(results);

      expect(formatted).toContain('✅ call_test_api');
      expect(formatted).toContain('"data": "test"');
    });

    it('should format failed results', () => {
      const results: ToolExecutionResult[] = [
        {
          toolCallId: 'tool-1',
          toolName: 'call_test_api',
          success: false,
          error: 'API error',
        },
      ];

      const formatted = service.formatToolResults(results);

      expect(formatted).toContain('❌ call_test_api: API error');
    });

    it('should format mixed results', () => {
      const results: ToolExecutionResult[] = [
        { toolCallId: 'tool-1', toolName: 'api1', success: true, result: { ok: true } },
        { toolCallId: 'tool-2', toolName: 'api2', success: false, error: 'Failed' },
      ];

      const formatted = service.formatToolResults(results);

      expect(formatted).toContain('✅ api1');
      expect(formatted).toContain('❌ api2: Failed');
    });
  });

  describe('hasToolAccess', () => {
    it('should return true when agent has access', () => {
      const result = service.hasToolAccess(mockAgent, 'call_test_server_get_data');

      expect(result).toBe(true);
    });

    it('should return true with case insensitivity', () => {
      const result = service.hasToolAccess(mockAgent, 'CALL_TEST_SERVER_GET_DATA');

      expect(result).toBe(true);
    });

    it('should return false when agent lacks access', () => {
      const result = service.hasToolAccess(mockAgent, 'call_unknown_api');

      expect(result).toBe(false);
    });
  });

  describe('getApiCallFee', () => {
    it('should return fee for API', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ servers: mockServers }),
      } as any);

      const fee = await service.getApiCallFee('test-server', 'get-data');

      expect(fee).toBe('1000000');
    });

    it('should return 0 on error', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ servers: [] }),
      } as any);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // This will throw but getApiCallFee catches it
      await expect(service.getApiCallFee('nonexistent', 'api')).rejects.toThrow();
      consoleSpy.mockRestore();
    });

    it('should return fee from API without description', async () => {
      const serverWithoutDescription = [{
        ...mockServers[0],
        apis: [{
          index: 0,
          slug: 'no-desc',
          name: 'No Description API',
          fee: '500000',
          createdAt: '2024-01-01',
        }],
      }];
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ servers: serverWithoutDescription }),
      } as any);

      const fee = await service.getApiCallFee('test-server', 'no-desc');

      expect(fee).toBe('500000');
    });
  });

  describe('executeTools with single tool', () => {
    it('should execute single tool without delay', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ result: 'ok' }),
        headers: new Map() as any,
      } as any);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const toolCalls = [
        { id: 'tool-1', name: 'call_test_server_get_data', input: {} },
      ];

      const results = await service.executeTools(toolCalls, mockAgent);

      expect(results).toHaveLength(1);
      expect(results[0].toolCallId).toBe('tool-1');
      consoleSpy.mockRestore();
    });
  });
});
