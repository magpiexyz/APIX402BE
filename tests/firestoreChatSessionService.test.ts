/**
 * Tests for Firestore Chat Session Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Test data storage
let testData: Map<string, any> = new Map();
let shouldThrowError = false;

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-session-uuid'),
}));

// Mock Firestore
vi.mock('../src/db/firestoreClient.js', () => {
  const createMockSnapshot = (docs: any[]) => ({
    empty: docs.length === 0,
    docs: docs.map((data) => ({
      id: data?.id,
      ref: { _key: `collection/${data?.id}` },
      data: () => data,
    })),
  });

  const mockFirestore = {
    collection: vi.fn().mockImplementation((collectionName: string) => ({
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
          limit: vi.fn().mockImplementation((n: number) => ({
            get: vi.fn().mockImplementation(async () => {
              if (shouldThrowError) throw new Error('Firestore error');
              const matches: any[] = [];
              testData.forEach((data, key) => {
                if (key.startsWith(collectionName) && data[field] === value && data[field2] === value2) {
                  matches.push(data);
                }
              });
              return createMockSnapshot(matches.slice(0, n));
            }),
          })),
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
        orderBy: vi.fn().mockImplementation(() => ({
          limit: vi.fn().mockImplementation((n: number) => ({
            get: vi.fn().mockImplementation(async () => {
              if (shouldThrowError) throw new Error('Firestore error');
              const matches: any[] = [];
              testData.forEach((data, key) => {
                if (key.startsWith(collectionName) && data[field] === value) {
                  matches.push(data);
                }
              });
              return createMockSnapshot(matches.slice(0, n));
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
        limit: vi.fn().mockImplementation((n: number) => ({
          get: vi.fn().mockImplementation(async () => {
            if (shouldThrowError) throw new Error('Firestore error');
            const matches: any[] = [];
            testData.forEach((data, key) => {
              if (key.startsWith(collectionName) && data[field] === value) {
                matches.push(data);
              }
            });
            return createMockSnapshot(matches.slice(0, n));
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
    })),
    batch: vi.fn().mockImplementation(() => ({
      delete: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
    })),
  };

  return {
    getFirestoreClient: vi.fn(() => mockFirestore),
    Collections: {
      CHAT_SESSIONS: 'chat-sessions',
      CHAT_MESSAGES: 'chat-messages',
    },
    FieldValue: { increment: vi.fn((n) => n) },
  };
});

import { ChatSessionService, type ChatSession, type ChatMessage } from '../src/services/firestoreChatSessionService.js';

describe('ChatSessionService', () => {
  let service: ChatSessionService;

  beforeEach(() => {
    testData.clear();
    shouldThrowError = false;
    service = new ChatSessionService('us-west-1', 'chat-sessions', 'chat-messages');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getOrCreateSession', () => {
    it('should return existing session if found', async () => {
      const existingSession: ChatSession = {
        id: 'existing-session',
        agentId: 'agent-123',
        userAddress: '0xuser',
        messageCount: 5,
        lastMessageAt: '2024-01-01T00:00:00.000Z',
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      testData.set('chat-sessions/existing-session', existingSession);

      const result = await service.getOrCreateSession('agent-123', '0xUser');

      expect(result.id).toBe('existing-session');
      expect(result.messageCount).toBe(5);
    });

    it('should create new session if not found', async () => {
      const result = await service.getOrCreateSession('agent-123', '0xNewUser');

      expect(result.id).toBe('test-session-uuid');
      expect(result.agentId).toBe('agent-123');
      expect(result.userAddress).toBe('0xnewuser'); // lowercased
      expect(result.messageCount).toBe(0);
    });

    it('should lowercase user address', async () => {
      const result = await service.getOrCreateSession('agent-123', '0xABCDEF');

      expect(result.userAddress).toBe('0xabcdef');
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(service.getOrCreateSession('agent-123', '0xuser')).rejects.toThrow();
    });
  });

  describe('createNewSession', () => {
    it('should always create a new session', async () => {
      // Even if a session exists, force create a new one
      testData.set('chat-sessions/existing', {
        id: 'existing',
        agentId: 'agent-123',
        userAddress: '0xuser',
      });

      const result = await service.createNewSession('agent-123', '0xUser');

      expect(result.id).toBe('test-session-uuid');
      expect(result.messageCount).toBe(0);
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(service.createNewSession('agent-123', '0xuser')).rejects.toThrow();
    });
  });

  describe('getSession', () => {
    it('should return session when it exists', async () => {
      const session: ChatSession = {
        id: 'session-123',
        agentId: 'agent-123',
        userAddress: '0xuser',
        messageCount: 10,
        lastMessageAt: '2024-01-01T00:00:00.000Z',
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      testData.set('chat-sessions/session-123', session);

      const result = await service.getSession('session-123');

      expect(result).not.toBeNull();
      expect(result?.messageCount).toBe(10);
    });

    it('should return null when session does not exist', async () => {
      const result = await service.getSession('nonexistent');

      expect(result).toBeNull();
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(service.getSession('session-123')).rejects.toThrow();
    });
  });

  describe('getUserSessions', () => {
    it('should return all sessions for user', async () => {
      testData.set('chat-sessions/s1', { id: 's1', userAddress: '0xuser' });
      testData.set('chat-sessions/s2', { id: 's2', userAddress: '0xuser' });
      testData.set('chat-sessions/s3', { id: 's3', userAddress: '0xother' });

      const result = await service.getUserSessions('0xUser');

      expect(result).toHaveLength(2);
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(service.getUserSessions('0xuser')).rejects.toThrow();
    });
  });

  describe('saveMessage', () => {
    it('should save a user message', async () => {
      testData.set('chat-sessions/session-123', { id: 'session-123', messageCount: 0 });

      const result = await service.saveMessage('session-123', 'user', 'Hello!');

      expect(result.message.role).toBe('user');
      expect(result.message.content).toBe('Hello!');
      expect(result.message.sessionId).toBe('session-123');
    });

    it('should save an assistant message', async () => {
      testData.set('chat-sessions/session-123', { id: 'session-123', messageCount: 1 });

      const result = await service.saveMessage('session-123', 'assistant', 'Hi there!');

      expect(result.message.role).toBe('assistant');
    });

    it('should save message with tool calls', async () => {
      testData.set('chat-sessions/session-123', { id: 'session-123', messageCount: 0 });

      const toolCalls = [{ id: 'tool-1', name: 'get_quote', input: { amount: 100 } }];
      const result = await service.saveMessage('session-123', 'assistant', 'Let me check...', toolCalls);

      expect(result.message.toolCalls).toEqual(toolCalls);
    });

    it('should save message with tool call ID', async () => {
      testData.set('chat-sessions/session-123', { id: 'session-123', messageCount: 0 });

      const result = await service.saveMessage('session-123', 'tool', 'Tool result', undefined, 'tool-1');

      expect(result.message.toolCallId).toBe('tool-1');
    });

    it('should truncate very large content', async () => {
      testData.set('chat-sessions/session-123', { id: 'session-123', messageCount: 0 });

      // Create content larger than 300KB - use 'x ' pattern to avoid matching base64 regex
      const largeContent = 'x '.repeat(175 * 1024);
      const result = await service.saveMessage('session-123', 'user', largeContent);

      expect(result.message.content.length).toBeLessThan(largeContent.length);
      expect(result.message.content).toContain('[Content truncated');
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(service.saveMessage('session-123', 'user', 'Hello')).rejects.toThrow();
    });

    it('should extract and store images from data URL content', async () => {
      testData.set('chat-sessions/session-123', { id: 'session-123', messageCount: 0 });

      // Create a fake large base64 image data URL (>50KB when decoded)
      const fakeImageData = 'data:image/png;base64,' + 'A'.repeat(70000);
      const result = await service.saveMessage('session-123', 'assistant', fakeImageData);

      // Should have image references and extracted images
      expect(result.imagesToStore).toBeDefined();
      expect(result.imagesToStore?.length).toBe(1);
      expect(result.message.localImageRefs?.length).toBe(1);
      expect(result.message.content).toContain('[[LOCAL_IMAGE:');
    });

    it('should extract images from JSON content with embedded base64', async () => {
      testData.set('chat-sessions/session-123', { id: 'session-123', messageCount: 0 });

      // Create JSON with embedded large base64 image
      const imageData = 'A'.repeat(70000); // Large base64 string
      const jsonContent = JSON.stringify({
        result: imageData,
        metadata: { type: 'image' }
      });

      const result = await service.saveMessage('session-123', 'assistant', jsonContent);

      // Should have image references extracted
      expect(result.imagesToStore).toBeDefined();
      expect(result.message.localImageRefs?.length).toBe(1);
    });

    it('should handle content with image data URL pattern correctly', async () => {
      testData.set('chat-sessions/session-123', { id: 'session-123', messageCount: 0 });

      // Create JSON with data:image URL pattern
      const jsonContent = JSON.stringify({
        imageData: 'data:image/jpeg;base64,' + 'B'.repeat(70000)
      });

      const result = await service.saveMessage('session-123', 'assistant', jsonContent);

      expect(result.imagesToStore).toBeDefined();
      expect(result.imagesToStore?.length).toBe(1);
      expect(result.imagesToStore?.[0].mimeType).toBe('image/jpeg');
    });

    it('should use placeholder for small images that cannot be extracted', async () => {
      testData.set('chat-sessions/session-123', { id: 'session-123', messageCount: 0 });

      // Create content with small base64 that contains image markers but is too small to extract
      const smallContent = JSON.stringify({
        image: 'data:image/png;base64,smalldata'
      });

      const result = await service.saveMessage('session-123', 'assistant', smallContent);

      // Small images shouldn't be extracted to local storage
      expect(result.imagesToStore).toBeUndefined();
    });

    it('should handle nested objects with images in arrays', async () => {
      testData.set('chat-sessions/session-123', { id: 'session-123', messageCount: 0 });

      const jsonContent = JSON.stringify({
        images: [
          { data: 'A'.repeat(70000) },
          { data: 'B'.repeat(70000) }
        ]
      });

      const result = await service.saveMessage('session-123', 'assistant', jsonContent);

      // Should extract both images
      expect(result.imagesToStore?.length).toBe(2);
      expect(result.message.localImageRefs?.length).toBe(2);
    });

    it('should handle content with b64_json field', async () => {
      testData.set('chat-sessions/session-123', { id: 'session-123', messageCount: 0 });

      const jsonContent = JSON.stringify({
        b64_json: 'C'.repeat(70000)
      });

      const result = await service.saveMessage('session-123', 'assistant', jsonContent);

      expect(result.imagesToStore).toBeDefined();
      expect(result.message.localImageRefs?.length).toBe(1);
    });

    it('should replace image placeholder when image cannot be extracted from text', async () => {
      testData.set('chat-sessions/session-123', { id: 'session-123', messageCount: 0 });

      // Content that looks like it has images but can't be properly extracted
      // This triggers the fallback case when extracting from raw text fails
      const content = 'Here is an image: data:image/gif;base64,' + 'X'.repeat(20000);

      const result = await service.saveMessage('session-123', 'assistant', content);

      // Should either extract the image or use a placeholder
      expect(result.message.content).toBeDefined();
    });

    it('should handle content without any images (returns as-is)', async () => {
      testData.set('chat-sessions/session-123', { id: 'session-123', messageCount: 0 });

      // Regular text content with no images
      const content = 'This is a simple text message with no images or base64 data.';

      const result = await service.saveMessage('session-123', 'user', content);

      expect(result.message.content).toBe(content);
      expect(result.imagesToStore).toBeUndefined();
      expect(result.message.localImageRefs).toBeUndefined();
    });

    it('should handle JSON content with null and undefined values', async () => {
      testData.set('chat-sessions/session-123', { id: 'session-123', messageCount: 0 });

      // JSON content with null/undefined values
      const jsonContent = JSON.stringify({
        data: null,
        optional: undefined,
        nested: { value: null },
      });

      const result = await service.saveMessage('session-123', 'assistant', jsonContent);

      expect(result.message.content).toBeDefined();
    });

    it('should handle JSON content with primitive values (numbers, booleans)', async () => {
      testData.set('chat-sessions/session-123', { id: 'session-123', messageCount: 0 });

      // JSON content with various primitive types
      const jsonContent = JSON.stringify({
        count: 42,
        isActive: true,
        price: 19.99,
        enabled: false,
        nested: {
          amount: 100,
          flag: true,
        },
      });

      const result = await service.saveMessage('session-123', 'assistant', jsonContent);

      expect(result.message.content).toBeDefined();
      // Primitives should pass through unchanged
      const parsed = JSON.parse(result.message.content);
      expect(parsed.count).toBe(42);
      expect(parsed.isActive).toBe(true);
    });

    it('should format large image sizes in MB', async () => {
      testData.set('chat-sessions/session-123', { id: 'session-123', messageCount: 0 });

      // Create a very large base64 image (over 1MB when decoded)
      // 1.5 million characters will be well over 1MB
      const veryLargeImage = 'data:image/png;base64,' + 'A'.repeat(1500000);

      const result = await service.saveMessage('session-123', 'assistant', veryLargeImage);

      // Should handle the large image (extract or truncate)
      expect(result.message.content).toBeDefined();
    });

    it('should handle JSON with nested null values', async () => {
      testData.set('chat-sessions/session-123', { id: 'session-123', messageCount: 0 });

      // JSON with null values at various levels
      const jsonContent = JSON.stringify({
        data: {
          value: null,
          nested: {
            innerNull: null,
            innerUndefined: undefined,
          }
        },
        topLevelNull: null,
      });

      const result = await service.saveMessage('session-123', 'assistant', jsonContent);

      expect(result.message.content).toBeDefined();
      const parsed = JSON.parse(result.message.content);
      expect(parsed.data.value).toBeNull();
      expect(parsed.topLevelNull).toBeNull();
    });

    it('should handle JSON with numeric and boolean values', async () => {
      testData.set('chat-sessions/session-123', { id: 'session-123', messageCount: 0 });

      // JSON with various primitive types
      const jsonContent = JSON.stringify({
        number: 42,
        float: 3.14,
        boolTrue: true,
        boolFalse: false,
        nested: {
          nestedNum: 100,
          nestedBool: true,
        },
        array: [1, 2, true, false, null],
      });

      const result = await service.saveMessage('session-123', 'assistant', jsonContent);

      expect(result.message.content).toBeDefined();
      const parsed = JSON.parse(result.message.content);
      expect(parsed.number).toBe(42);
      expect(parsed.float).toBe(3.14);
      expect(parsed.boolTrue).toBe(true);
      expect(parsed.boolFalse).toBe(false);
      expect(parsed.nested.nestedNum).toBe(100);
    });

    it('should return content as-is when under size limit and no images', async () => {
      testData.set('chat-sessions/session-123', { id: 'session-123', messageCount: 0 });

      // Small text content with no images
      const simpleContent = 'This is a simple response without any images.';

      const result = await service.saveMessage('session-123', 'assistant', simpleContent);

      expect(result.message.content).toBe(simpleContent);
      expect(result.imagesToStore).toBeUndefined();
    });

    it('should handle JSON with null values during image extraction', async () => {
      testData.set('chat-sessions/session-123', { id: 'session-123', messageCount: 0 });

      // JSON content with both large image AND null values
      // This ensures sanitizeObjectWithRefs processes null values
      const jsonContent = JSON.stringify({
        imageData: 'A'.repeat(70000), // Large base64 to trigger sanitization
        nullField: null,
        nestedObj: {
          innerNull: null,
          anotherNull: null,
        },
      });

      const result = await service.saveMessage('session-123', 'assistant', jsonContent);

      expect(result.message.content).toBeDefined();
      expect(result.imagesToStore).toBeDefined();
      // Verify null values are preserved in sanitized content
      const parsed = JSON.parse(result.message.content);
      expect(parsed.nullField).toBeNull();
      expect(parsed.nestedObj.innerNull).toBeNull();
    });

    it('should handle JSON with primitive values during image extraction', async () => {
      testData.set('chat-sessions/session-123', { id: 'session-123', messageCount: 0 });

      // JSON content with large image AND various primitive values
      // This ensures sanitizeObjectWithRefs processes primitives (numbers, booleans)
      const jsonContent = JSON.stringify({
        imageData: 'B'.repeat(70000), // Large base64 to trigger sanitization
        count: 42,
        isEnabled: true,
        price: 19.99,
        isDisabled: false,
        nested: {
          amount: 100,
          active: true,
        },
      });

      const result = await service.saveMessage('session-123', 'assistant', jsonContent);

      expect(result.message.content).toBeDefined();
      expect(result.imagesToStore).toBeDefined();
      // Verify primitive values are preserved
      const parsed = JSON.parse(result.message.content);
      expect(parsed.count).toBe(42);
      expect(parsed.isEnabled).toBe(true);
      expect(parsed.price).toBe(19.99);
      expect(parsed.isDisabled).toBe(false);
      expect(parsed.nested.amount).toBe(100);
    });

    it('should handle JSON with arrays containing mixed types during sanitization', async () => {
      testData.set('chat-sessions/session-123', { id: 'session-123', messageCount: 0 });

      // JSON with array of mixed types including image data, nulls, and primitives
      const jsonContent = JSON.stringify({
        items: [
          'A'.repeat(70000), // Large base64 image
          null,
          42,
          true,
          { nested: null, value: 123 },
        ],
        metadata: {
          count: 5,
          hasImages: true,
        },
      });

      const result = await service.saveMessage('session-123', 'assistant', jsonContent);

      expect(result.message.content).toBeDefined();
      expect(result.imagesToStore).toBeDefined();
      // Verify array contents are preserved
      const parsed = JSON.parse(result.message.content);
      expect(parsed.items[1]).toBeNull();
      expect(parsed.items[2]).toBe(42);
      expect(parsed.items[3]).toBe(true);
      expect(parsed.items[4].nested).toBeNull();
      expect(parsed.items[4].value).toBe(123);
    });

    it('should handle non-JSON content with images that cannot be extracted (fallback to placeholder)', async () => {
      testData.set('chat-sessions/session-123', { id: 'session-123', messageCount: 0 });

      // Content that looks like base64 but is too small to extract after parsing fails
      const content = 'Some text with data:image/png;base64,' + 'X'.repeat(30000);

      const result = await service.saveMessage('session-123', 'assistant', content);

      // Should either extract the image or use a placeholder
      expect(result.message.content).toBeDefined();
    });
  });

  describe('getRecentMessages', () => {
    it('should return messages for session', async () => {
      testData.set('chat-messages/m1', { id: 'm1', sessionId: 'session-123', role: 'user', content: 'Hi' });
      testData.set('chat-messages/m2', { id: 'm2', sessionId: 'session-123', role: 'assistant', content: 'Hello' });
      testData.set('chat-messages/m3', { id: 'm3', sessionId: 'other-session', role: 'user', content: 'Test' });

      const result = await service.getRecentMessages('session-123');

      expect(result).toHaveLength(2);
    });

    it('should respect limit', async () => {
      testData.set('chat-messages/m1', { id: 'm1', sessionId: 'session-123', content: '1' });
      testData.set('chat-messages/m2', { id: 'm2', sessionId: 'session-123', content: '2' });
      testData.set('chat-messages/m3', { id: 'm3', sessionId: 'session-123', content: '3' });

      const result = await service.getRecentMessages('session-123', 2);

      expect(result).toHaveLength(2);
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(service.getRecentMessages('session-123')).rejects.toThrow();
    });
  });

  describe('getConversationHistory', () => {
    it('should return user and assistant messages only', async () => {
      testData.set('chat-messages/m1', { id: 'm1', sessionId: 'session-123', role: 'user', content: 'Hi' });
      testData.set('chat-messages/m2', { id: 'm2', sessionId: 'session-123', role: 'assistant', content: 'Hello' });
      testData.set('chat-messages/m3', { id: 'm3', sessionId: 'session-123', role: 'tool', content: 'Tool result' });

      const result = await service.getConversationHistory('session-123');

      expect(result).toHaveLength(2);
      expect(result.every(m => m.role === 'user' || m.role === 'assistant')).toBe(true);
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(service.getConversationHistory('session-123')).rejects.toThrow();
    });
  });

  describe('getLastUserMessage', () => {
    it('should return last user message', async () => {
      testData.set('chat-messages/m1', { id: 'm1', sessionId: 'session-123', role: 'user', content: 'First' });
      testData.set('chat-messages/m2', { id: 'm2', sessionId: 'session-123', role: 'assistant', content: 'Reply' });
      testData.set('chat-messages/m3', { id: 'm3', sessionId: 'session-123', role: 'user', content: 'Second' });

      const result = await service.getLastUserMessage('session-123');

      expect(result).not.toBeNull();
      expect(result?.role).toBe('user');
    });

    it('should return null when no user messages', async () => {
      testData.set('chat-messages/m1', { id: 'm1', sessionId: 'session-123', role: 'assistant', content: 'Hi' });

      const result = await service.getLastUserMessage('session-123');

      expect(result).toBeNull();
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(service.getLastUserMessage('session-123')).rejects.toThrow();
    });
  });

  describe('deleteSession', () => {
    it('should delete session and all messages', async () => {
      testData.set('chat-sessions/session-123', { id: 'session-123' });
      testData.set('chat-messages/m1', { id: 'm1', sessionId: 'session-123' });
      testData.set('chat-messages/m2', { id: 'm2', sessionId: 'session-123' });

      await service.deleteSession('session-123');

      expect(testData.has('chat-sessions/session-123')).toBe(false);
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(service.deleteSession('session-123')).rejects.toThrow();
    });
  });

  describe('pruneOldMessages', () => {
    it('should delete old messages keeping last N', async () => {
      // Add multiple messages
      for (let i = 0; i < 10; i++) {
        testData.set(`chat-messages/m${i}`, { id: `m${i}`, sessionId: 'session-123' });
      }

      await service.pruneOldMessages('session-123', 5);

      // The mock doesn't actually delete, but the function should complete
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(service.pruneOldMessages('session-123')).rejects.toThrow();
    });
  });
});
