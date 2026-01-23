/**
 * Tests for LLM Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Track mock behavior
let mockClaudeWithToolCalls = false;
let mockClaudeWithError = false;
let mockGptWithError = false;
let mockGeminiWithError = false;
let mockClaudeWithEmptyToolInput = false;
let mockGptWithEmptyChoices = false;
let mockGptWithMissingToolFields = false;

// Mock the Anthropic SDK with a proper class
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      stream: vi.fn().mockImplementation(async () => {
        if (mockClaudeWithError) {
          throw new Error('Claude API error');
        }
        return {
          async *[Symbol.asyncIterator]() {
            if (mockClaudeWithToolCalls) {
              // Yield tool call
              yield { type: 'content_block_start', content_block: { type: 'tool_use', id: 'tool-1', name: 'call_test_api' } };
              yield { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"query":"test"}' } };
              yield { type: 'content_block_stop' };
            } else if (mockClaudeWithEmptyToolInput) {
              // Yield tool call with empty input
              yield { type: 'content_block_start', content_block: { type: 'tool_use', id: 'tool-2', name: 'empty_tool' } };
              yield { type: 'content_block_stop' };
            } else {
              yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
              yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world!' } };
            }
            yield { type: 'message_stop' };
          },
        };
      }),
    };
  }
  return {
    Anthropic: MockAnthropic,
  };
});

// Mock OpenAI SDK
vi.mock('openai', () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: vi.fn().mockImplementation(async () => {
          if (mockGptWithError) {
            throw new Error('GPT API error');
          }
          if (mockGptWithEmptyChoices) {
            return {
              async *[Symbol.asyncIterator]() {
                yield { choices: [] }; // Empty choices
                yield { choices: null }; // Null choices
                yield {}; // No choices property
              },
            };
          }
          if (mockGptWithMissingToolFields) {
            return {
              async *[Symbol.asyncIterator]() {
                yield { choices: [{ delta: { content: 'Response' } }] };
                // Tool call with missing id, function name, and arguments
                yield { choices: [{ delta: { tool_calls: [{ function: {} }] } }] };
                // Tool call with missing arguments
                yield { choices: [{ delta: { tool_calls: [{ id: 'tool-2', function: { name: 'some_tool' } }] } }] };
              },
            };
          }
          return {
            async *[Symbol.asyncIterator]() {
              yield { choices: [{ delta: { content: 'GPT response' } }] };
              yield { choices: [{ delta: { tool_calls: [{ id: 'gpt-tool-1', function: { name: 'call_test', arguments: '{"x":1}' } }] } }] };
            },
          };
        }),
      },
    };
  }
  return {
    OpenAI: MockOpenAI,
  };
});

// Mock Google AI SDK
vi.mock('@google/generative-ai', () => {
  class MockGoogleGenerativeAI {
    constructor(_apiKey: string) {}
    getGenerativeModel(_config: any) {
      return {
        generateContentStream: vi.fn().mockImplementation(async () => {
          if (mockGeminiWithError) {
            throw new Error('Gemini API error');
          }
          return {
            stream: {
              async *[Symbol.asyncIterator]() {
                yield { text: () => 'Gemini response part 1' };
                yield { text: () => ' part 2' };
                yield { text: () => '' }; // Empty text chunk
              },
            },
          };
        }),
      };
    }
  }
  return {
    GoogleGenerativeAI: MockGoogleGenerativeAI,
  };
});

// Store original env
const originalEnv = process.env;

describe('LLMService', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    mockClaudeWithToolCalls = false;
    mockClaudeWithError = false;
    mockGptWithError = false;
    mockGeminiWithError = false;
    mockClaudeWithEmptyToolInput = false;
    mockGptWithEmptyChoices = false;
    mockGptWithMissingToolFields = false;
  });

  afterEach(() => {
    process.env = originalEnv;
    mockClaudeWithToolCalls = false;
    mockClaudeWithError = false;
    mockGptWithError = false;
    mockGeminiWithError = false;
    mockClaudeWithEmptyToolInput = false;
    mockGptWithEmptyChoices = false;
    mockGptWithMissingToolFields = false;
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize Claude client when API key is set', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      expect(service.isProviderAvailable('claude')).toBe(true);
    });

    it('should not initialize Claude when API key is missing', async () => {
      delete process.env.ANTHROPIC_API_KEY;

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      expect(service.isProviderAvailable('claude')).toBe(false);
    });

    it('should detect GPT availability', async () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      expect(service.isProviderAvailable('gpt')).toBe(true);
    });

    it('should detect Gemini availability', async () => {
      process.env.GOOGLE_AI_API_KEY = 'test-google-key';

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      expect(service.isProviderAvailable('gemini')).toBe(true);
    });
  });

  describe('getAvailableProviders', () => {
    it('should return list of available providers', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      process.env.OPENAI_API_KEY = 'test-key';
      delete process.env.GOOGLE_AI_API_KEY;

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();
      const providers = service.getAvailableProviders();

      expect(providers).toContain('claude');
      expect(providers).toContain('gpt');
      expect(providers).not.toContain('gemini');
    });

    it('should return empty array when no providers configured', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOGLE_AI_API_KEY;

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();
      const providers = service.getAvailableProviders();

      expect(providers).toHaveLength(0);
    });

    it('should include Gemini when available', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      process.env.OPENAI_API_KEY = 'test-key';
      process.env.GOOGLE_AI_API_KEY = 'test-key';

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();
      const providers = service.getAvailableProviders();

      expect(providers).toContain('claude');
      expect(providers).toContain('gpt');
      expect(providers).toContain('gemini');
      expect(providers).toHaveLength(3);
    });
  });

  describe('formatApisAsTools', () => {
    it('should convert APIs to tool definitions', async () => {
      const { LLMService } = await import('../src/services/llmService.js');

      const apis = [
        {
          serverSlug: 'magpie',
          apiSlug: 'get-quote',
          name: 'Get Quote',
          description: 'Get a swap quote from Magpie',
          fee: '1000000',
        },
      ];

      const tools = LLMService.formatApisAsTools(apis);

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('call_magpie_get_quote');
      expect(tools[0].description).toContain('Get a swap quote from Magpie');
      expect(tools[0].description).toContain('Fee: 1000000');
      expect(tools[0].input_schema.type).toBe('object');
    });

    it('should handle APIs without fee', async () => {
      const { LLMService } = await import('../src/services/llmService.js');

      const apis = [
        {
          serverSlug: 'test',
          apiSlug: 'api',
          name: 'Test API',
          description: 'A test API',
        },
      ];

      const tools = LLMService.formatApisAsTools(apis);

      expect(tools[0].description).not.toContain('Fee');
    });

    it('should replace dashes with underscores in tool names', async () => {
      const { LLMService } = await import('../src/services/llmService.js');

      const apis = [
        {
          serverSlug: 'my-server',
          apiSlug: 'my-api',
          name: 'My API',
          description: 'Description',
        },
      ];

      const tools = LLMService.formatApisAsTools(apis);

      expect(tools[0].name).toBe('call_my_server_my_api');
    });
  });

  describe('streamChat', () => {
    it('should throw for unsupported provider', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      await expect(async () => {
        for await (const chunk of service.streamChat('invalid' as any, [], [])) {
          // Should not reach here
        }
      }).rejects.toThrow('Unsupported LLM provider');
    });

    it('should throw when Claude not initialized', async () => {
      delete process.env.ANTHROPIC_API_KEY;

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      await expect(async () => {
        for await (const chunk of service.streamChat('claude', [], [])) {
          // Should not reach here
        }
      }).rejects.toThrow('Claude client not initialized');
    });

    it('should throw when GPT not configured', async () => {
      delete process.env.OPENAI_API_KEY;

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      await expect(async () => {
        for await (const chunk of service.streamChat('gpt', [], [])) {
          // Should not reach here
        }
      }).rejects.toThrow('GPT not configured');
    });

    it('should throw when Gemini not configured', async () => {
      delete process.env.GOOGLE_AI_API_KEY;

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      await expect(async () => {
        for await (const chunk of service.streamChat('gemini', [], [])) {
          // Should not reach here
        }
      }).rejects.toThrow('Gemini not configured');
    });

    it('should stream Claude responses', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      const messages = [{ role: 'user' as const, content: 'Hello' }];
      const chunks: any[] = [];

      for await (const chunk of service.streamChat('claude', messages, [])) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      const tokenChunks = chunks.filter(c => c.type === 'token');
      expect(tokenChunks.length).toBeGreaterThan(0);
    });

    it('should stream Claude responses with tool calls', async () => {
      mockClaudeWithToolCalls = true;
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      const messages = [{ role: 'user' as const, content: 'Call the API' }];
      const chunks: any[] = [];

      for await (const chunk of service.streamChat('claude', messages, [])) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      const toolChunks = chunks.filter(c => c.type === 'tool_call');
      expect(toolChunks.length).toBe(1);
      expect(toolChunks[0].tool.name).toBe('call_test_api');
      expect(toolChunks[0].tool.input).toEqual({ query: 'test' });
    });

    it('should stream GPT responses', async () => {
      process.env.OPENAI_API_KEY = 'test-key';

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      const messages = [{ role: 'user' as const, content: 'Hello' }];
      const chunks: any[] = [];

      for await (const chunk of service.streamChat('gpt', messages, [])) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      const tokenChunks = chunks.filter(c => c.type === 'token');
      expect(tokenChunks.length).toBeGreaterThan(0);
      expect(tokenChunks[0].content).toBe('GPT response');

      const toolChunks = chunks.filter(c => c.type === 'tool_call');
      expect(toolChunks.length).toBe(1);
      expect(toolChunks[0].tool.name).toBe('call_test');
    });

    it('should stream Gemini responses', async () => {
      process.env.GOOGLE_AI_API_KEY = 'test-key';

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      const messages = [{ role: 'user' as const, content: 'Hello' }];
      const chunks: any[] = [];

      for await (const chunk of service.streamChat('gemini', messages, [])) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      const tokenChunks = chunks.filter(c => c.type === 'token');
      expect(tokenChunks.length).toBe(2);
      expect(tokenChunks[0].content).toBe('Gemini response part 1');
      expect(tokenChunks[1].content).toBe(' part 2');
    });

    it('should handle Claude API errors', async () => {
      mockClaudeWithError = true;
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      const messages = [{ role: 'user' as const, content: 'Hello' }];

      await expect(async () => {
        for await (const chunk of service.streamChat('claude', messages, [])) {
          // Should not reach here
        }
      }).rejects.toThrow('Claude API error');

      consoleSpy.mockRestore();
    });

    it('should handle GPT API errors', async () => {
      mockGptWithError = true;
      process.env.OPENAI_API_KEY = 'test-key';
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      const messages = [{ role: 'user' as const, content: 'Hello' }];

      await expect(async () => {
        for await (const chunk of service.streamChat('gpt', messages, [])) {
          // Should not reach here
        }
      }).rejects.toThrow('GPT API error');

      consoleSpy.mockRestore();
    });

    it('should handle Gemini API errors', async () => {
      mockGeminiWithError = true;
      process.env.GOOGLE_AI_API_KEY = 'test-key';
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      const messages = [{ role: 'user' as const, content: 'Hello' }];

      await expect(async () => {
        for await (const chunk of service.streamChat('gemini', messages, [])) {
          // Should not reach here
        }
      }).rejects.toThrow('Gemini API error');

      consoleSpy.mockRestore();
    });

    it('should handle Claude tool calls with empty input', async () => {
      mockClaudeWithEmptyToolInput = true;
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      const messages = [{ role: 'user' as const, content: 'Call the tool' }];
      const chunks: any[] = [];

      for await (const chunk of service.streamChat('claude', messages, [])) {
        chunks.push(chunk);
      }

      const toolChunks = chunks.filter(c => c.type === 'tool_call');
      expect(toolChunks.length).toBe(1);
      expect(toolChunks[0].tool.name).toBe('empty_tool');
      expect(toolChunks[0].tool.input).toEqual({});
    });
  });

  describe('chat', () => {
    it('should collect streamed response', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      const messages = [{ role: 'user' as const, content: 'Hello' }];
      const response = await service.chat('claude', messages, []);

      expect(response.content).toBe('Hello world!');
      expect(response.toolCalls).toHaveLength(0);
      expect(response.stop_reason).toBe('end_turn');
    });

    it('should collect tool calls from stream', async () => {
      mockClaudeWithToolCalls = true;
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      const messages = [{ role: 'user' as const, content: 'Call the API' }];
      const response = await service.chat('claude', messages, []);

      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls[0].name).toBe('call_test_api');
      expect(response.stop_reason).toBe('tool_use');
    });
  });

  describe('isProviderAvailable', () => {
    it('should return false for unknown provider', async () => {
      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      expect(service.isProviderAvailable('unknown' as any)).toBe(false);
    });

    it('should return true for claude when configured', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOGLE_AI_API_KEY;

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      expect(service.isProviderAvailable('claude')).toBe(true);
      expect(service.isProviderAvailable('gpt')).toBe(false);
      expect(service.isProviderAvailable('gemini')).toBe(false);
    });
  });

  describe('constructor warnings', () => {
    it('should warn when GPT and Gemini not configured', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      process.env.ANTHROPIC_API_KEY = 'test-key';
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOGLE_AI_API_KEY;

      const { LLMService } = await import('../src/services/llmService.js');
      new LLMService();

      const calls = consoleSpy.mock.calls.map(c => c[0]);
      expect(calls.some((c: string) => c.includes('OPENAI_API_KEY not set'))).toBe(true);
      expect(calls.some((c: string) => c.includes('GOOGLE_AI_API_KEY not set'))).toBe(true);
      consoleSpy.mockRestore();
    });
  });

  describe('formatApisAsTools edge cases', () => {
    it('should use API name as fallback when description is empty', async () => {
      const { LLMService } = await import('../src/services/llmService.js');

      const apis = [
        {
          serverSlug: 'server',
          apiSlug: 'api',
          name: 'API Name',
          description: '',
        },
      ];

      const tools = LLMService.formatApisAsTools(apis);

      expect(tools[0].description).toContain('API Name');
    });
  });

  describe('Gemini role mapping', () => {
    it('should map assistant role to model for Gemini', async () => {
      process.env.GOOGLE_AI_API_KEY = 'test-key';

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      // Include assistant message to test role mapping
      const messages = [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi there!' },
        { role: 'user' as const, content: 'How are you?' },
      ];
      const chunks: any[] = [];

      for await (const chunk of service.streamChat('gemini', messages, [])) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      const doneChunk = chunks.find(c => c.type === 'done');
      expect(doneChunk).toBeDefined();
    });
  });

  describe('chat method done handling', () => {
    it('should set stop_reason to end_turn when no tool calls and done received', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      const messages = [{ role: 'user' as const, content: 'Hello' }];
      const response = await service.chat('claude', messages, []);

      // Verify done handling sets proper stop_reason
      expect(response.stop_reason).toBe('end_turn');
      expect(response.toolCalls).toHaveLength(0);
    });

    it('should set stop_reason to tool_use when tool calls present', async () => {
      mockClaudeWithToolCalls = true;
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      const messages = [{ role: 'user' as const, content: 'Call the API' }];
      const response = await service.chat('claude', messages, []);

      // Verify done handling sets tool_use when tools were called
      expect(response.stop_reason).toBe('tool_use');
      expect(response.toolCalls.length).toBeGreaterThan(0);
    });
  });

  describe('GPT streaming edge cases', () => {
    it('should stream GPT with assistant messages', async () => {
      process.env.OPENAI_API_KEY = 'test-key';

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      // Include assistant message in conversation
      const messages = [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi!' },
        { role: 'user' as const, content: 'How are you?' },
      ];
      const chunks: any[] = [];

      for await (const chunk of service.streamChat('gpt', messages, [])) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should handle GPT responses with tool calls', async () => {
      process.env.OPENAI_API_KEY = 'test-key';

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      const messages = [{ role: 'user' as const, content: 'Call the test tool' }];
      const chunks: any[] = [];

      for await (const chunk of service.streamChat('gpt', messages, [])) {
        chunks.push(chunk);
      }

      // GPT mock returns both content and tool calls
      const toolChunks = chunks.filter(c => c.type === 'tool_call');
      expect(toolChunks.length).toBeGreaterThan(0);
      expect(toolChunks[0].tool.input).toEqual({ x: 1 });
    });

    it('should handle GPT responses with empty or missing choices', async () => {
      mockGptWithEmptyChoices = true;
      process.env.OPENAI_API_KEY = 'test-key';

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      const messages = [{ role: 'user' as const, content: 'Hello' }];
      const chunks: any[] = [];

      for await (const chunk of service.streamChat('gpt', messages, [])) {
        chunks.push(chunk);
      }

      // Should still complete with done chunk
      const doneChunk = chunks.find(c => c.type === 'done');
      expect(doneChunk).toBeDefined();
      // No token chunks because choices were empty
      const tokenChunks = chunks.filter(c => c.type === 'token');
      expect(tokenChunks).toHaveLength(0);
    });

    it('should handle GPT tool calls with missing fields (fallback values)', async () => {
      mockGptWithMissingToolFields = true;
      process.env.OPENAI_API_KEY = 'test-key';

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      const messages = [{ role: 'user' as const, content: 'Call tools' }];
      const chunks: any[] = [];

      for await (const chunk of service.streamChat('gpt', messages, [])) {
        chunks.push(chunk);
      }

      const toolChunks = chunks.filter(c => c.type === 'tool_call');
      expect(toolChunks).toHaveLength(2);

      // First tool call has missing id and name - should use fallbacks
      expect(toolChunks[0].tool.id).toMatch(/^tool-\d+$/); // Generated id
      expect(toolChunks[0].tool.name).toBe('unknown'); // Default name
      expect(toolChunks[0].tool.input).toEqual({}); // Empty input

      // Second tool call has missing arguments - should use empty object
      expect(toolChunks[1].tool.id).toBe('tool-2');
      expect(toolChunks[1].tool.name).toBe('some_tool');
      expect(toolChunks[1].tool.input).toEqual({});
    });
  });

  describe('Claude streaming edge cases', () => {
    it('should handle Claude with custom system prompt', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      const messages = [{ role: 'user' as const, content: 'Hello' }];
      const customPrompt = 'You are a helpful assistant for API testing.';
      const chunks: any[] = [];

      for await (const chunk of service.streamChat('claude', messages, [], customPrompt)) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should handle Claude with tools defined', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      const messages = [{ role: 'user' as const, content: 'Hello' }];
      const tools = [
        {
          name: 'test_tool',
          description: 'A test tool',
          input_schema: {
            type: 'object' as const,
            properties: { query: { type: 'string' } },
            required: [] as string[],
          },
        },
      ];
      const chunks: any[] = [];

      for await (const chunk of service.streamChat('claude', messages, tools)) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe('Gemini streaming with system prompt', () => {
    it('should handle Gemini with custom system prompt', async () => {
      process.env.GOOGLE_AI_API_KEY = 'test-key';

      const { LLMService } = await import('../src/services/llmService.js');
      const service = new LLMService();

      const messages = [{ role: 'user' as const, content: 'Hello' }];
      const customPrompt = 'You are a helpful API assistant.';
      const chunks: any[] = [];

      for await (const chunk of service.streamChat('gemini', messages, [], customPrompt)) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
    });
  });
});
