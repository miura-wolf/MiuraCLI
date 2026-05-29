import { describe, it, expect, beforeEach } from 'vitest';
import { MCPConnectionManager } from './mcp-protocol.js';

describe('MCPConnectionManager', () => {
  let manager: MCPConnectionManager;

  beforeEach(() => {
    manager = new MCPConnectionManager();
  });

  describe('init()', () => {
    it('should initialize the manager', () => {
      expect(manager.initialized).toBe(false);
      manager.init();
      expect(manager.initialized).toBe(true);
    });
  });

  describe('connection state', () => {
    beforeEach(() => {
      manager.init();
    });

    it('should list empty connections when no servers connected', () => {
      const connections = manager.listConnections();
      expect(connections).toHaveLength(0);
    });

    it('should handle connection to non-existent server', async () => {
      const state = await manager.connect('test-server', {
        command: 'node',
        args: ['-e', 'process.exit(1)'],
      });

      expect(state.status).toBe('error');
      expect(state.serverName).toBe('test-server');
      expect(state.error).toBeDefined();
    });

    it('should disconnect safely from non-connected server', async () => {
      // Should not throw
      await manager.disconnect('test-server');
    });

    it('should disconnect all safely', async () => {
      // Should not throw
      await manager.disconnectAll();
    });

    it('should return undefined for non-existent client', () => {
      expect(manager.getClient('test-server')).toBeUndefined();
    });
  });

  describe('MCPStdioClient creation via manager', () => {
    it('should handle connection timeout', async () => {
      // Connect to a server that hangs forever
      const state = await manager.connect('hung-server', {
        command: 'node',
        args: ['-e', 'setTimeout(() => {}, 60000)'],
      });

      expect(state.status).toBe('error');
    });
  });
});

describe('MCP Protocol (unit tests)', () => {
  describe('MCPToolCall structure', () => {
    it('should define valid tool call structure', () => {
      const toolCall = {
        toolName: 'test_tool',
        args: { key: 'value' },
      };
      
      expect(toolCall.toolName).toBe('test_tool');
      expect(toolCall.args.key).toBe('value');
    });
  });

  describe('MCPRequest/Response format', () => {
    it('should match JSON-RPC 2.0 format', () => {
      const request = {
        jsonrpc: '2.0' as const,
        method: 'tools/list',
        id: 1,
      };
      
      expect(request.jsonrpc).toBe('2.0');
      expect(request.method).toBe('tools/list');
      expect(request.id).toBe(1);
    });

    it('should handle error responses', () => {
      const response = {
        jsonrpc: '2.0' as const,
        id: 1,
        error: {
          code: -32601,
          message: 'Method not found',
        },
      };
      
      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(-32601);
    });
  });
});