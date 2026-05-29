import { describe, it, expect, beforeEach } from 'vitest';
import { MCPConnectionManager } from './mcp-protocol.js';
import { MCPBridge } from './bridge.js';

describe('MCPBridge', () => {
  let connectionManager: MCPConnectionManager;
  let bridge: MCPBridge;

  beforeEach(() => {
    connectionManager = new MCPConnectionManager();
    connectionManager.init();
    bridge = new MCPBridge(connectionManager);
  });

  describe('handler management', () => {
    it('should return empty handlers when no servers connected', () => {
      const handlers = bridge.getHandlers();
      expect(handlers).toHaveLength(0);
    });

    it('should return undefined for unknown handler', () => {
      const handler = bridge.getHandler('unknown_tool');
      expect(handler).toBeUndefined();
    });

    it('should clear all handlers', () => {
      // Clear should work even when no handlers exist
      bridge.clear();
      expect(bridge.getHandlers()).toHaveLength(0);
    });

    it('should unregister server handlers safely', () => {
      // Unregistering non-existent server should not throw
      bridge.unregisterServer('unknown-server');
      expect(bridge.getHandlers()).toHaveLength(0);
    });
  });

  describe('tool handler creation', () => {
    it('should create handler with correct name prefix', () => {
      // Access the private createHandler method through prototype
      const handler = (bridge as any).createHandler('filesystem', {
        name: 'read_file',
        description: 'Read a file from the filesystem',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
          },
        },
      });

      expect(handler.name).toBe('mcp_filesystem_read_file');
      expect(handler.description).toContain('[MCP:filesystem]');
      expect(handler.definition).toBeDefined();
      expect(handler.definition.name).toBe('mcp_filesystem_read_file');
    });

    it('should register server tools that return error when server not connected', async () => {
      // Trying to register tools from a non-connected server should fail
      await expect(
        (bridge as any).registerServerTools('non-existent')
      ).rejects.toThrow('not connected');
    });
  });
});