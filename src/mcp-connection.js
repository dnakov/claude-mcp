import { log } from './utils';
export class MCPConnection {
  constructor(name, config) {
    this.name = name;
    this.config = {
      // Default configuration
      connectionType: 'sse',
      transportType: 'stdio',
      ...config
    };
    this.eventSource = null;
    this.messageEndpoint = null;
    this.initialized = false;
    this.capabilities = null;
    this.serverInfo = null;
    this.resources = new Map();
    this.tools = new Map();
    this.subscriptions = new Map();
    
    // Log configuration
    log(`[MCP ${this.name}] Initialized with config:`, {
      connectionType: this.config.connectionType,
      transportType: this.config.transportType,
      command: this.config.command,
      args: this.config.args,
      env: this.config.env ? '(env data present)' : undefined,
      url: this.config.url
    });
  }

  // Initialize connection and handle lifecycle
  async connect(handler) {
    log(`[MCP ${this.name}] Connecting with config:`, this.config);
    log(`[MCP ${this.name}] Connection type:`, this.config.connectionType || 'default (ws)');
    
    if (this.config.connectionType === 'sse') {
      log(`[MCP ${this.name}] Using SSE connection`);
      return this.connectSSE(handler);
    } else {
      console.error(`[MCP ${this.name}] Unsupported connection type:`, this.config.connectionType);
      return null;
    }
  }

  async connectSSE(handler) {
    try {
      // Parse and validate URL
      const sseUrl = new URL(this.config.url);
      
      if(this.config.command?.trim()?.length > 0) {
        // Add transportType parameter (required for SSE)
        if (!sseUrl.searchParams.has('transportType')) {
          sseUrl.searchParams.set('transportType', this.config.transportType || 'stdio');
        }
        
        // Add command parameter if specified and not empty
        if (this.config.command && this.config.command.trim()) {
          sseUrl.searchParams.set('command', this.config.command);
        }
        
        // Add args parameter if specified and not empty
        if (this.config.args) {
          let argsValue = '';
          if (Array.isArray(this.config.args)) {
            argsValue = this.config.args.filter(arg => arg).join(' ');
          } else if (typeof this.config.args === 'string') {
            argsValue = this.config.args.trim();
          }
          
          if (argsValue) {
            sseUrl.searchParams.set('args', argsValue);
          }
        }
      }
      
      // Add environment variables as query parameters if specified
      if (this.config.env) {
        let envData = this.config.env;
        
        // If env is already a string and looks like JSON, parse it
        if (typeof envData === 'string') {
          try {
            envData = JSON.parse(envData);
          } catch (e) {
            console.error(`[MCP ${this.name}] Invalid JSON in env string:`, e);
            envData = {};
          }
        }
        
        // Only add env parameter if it's not an empty object
        if (typeof envData === 'object' && Object.keys(envData).length > 0) {
          sseUrl.searchParams.set('env', encodeURIComponent(JSON.stringify(envData)));
        }
      }
      
      log(`[MCP ${this.name}] Connecting to SSE URL:`, sseUrl.toString());
      log(`[MCP ${this.name}] Query parameters:`, Object.fromEntries(sseUrl.searchParams));

      return new Promise((resolve, reject) => {
        // Create EventSource - don't try to add auth headers here
        this.eventSource = new EventSource(sseUrl.toString());
        
        this.eventSource.onopen = () => {
          log(`[MCP ${this.name}] SSE connection opened`);
          this.initialized = true;
        };

        // Handle endpoint event
        this.eventSource.addEventListener('endpoint', (event) => {
          try {
            this.messageEndpoint = new URL(event.data, sseUrl.origin);
            log(`[MCP ${this.name}] Got message endpoint:`, this.messageEndpoint);
          } catch (e) {
            console.error(`[MCP ${this.name}] Failed to parse endpoint:`, e);
            this.disconnect();
            reject(e);
          }
        });

        // Handle regular messages
        this.eventSource.addEventListener('message', (event) => {
          try {
            const message = JSON.parse(event.data);
            log(`[MCP ${this.name}] SSE message:`, message);
            handler(message);
          } catch (e) {
            console.error(`[MCP ${this.name}] Failed to parse message:`, e);
            this.disconnect();
            reject(e);
          }
        });

        this.eventSource.onerror = (error) => {
          console.error(`[MCP ${this.name}] SSE error:`, error);
          this.disconnect();
          reject(new Error('SSE connection failed'));
        };

        // Set connection timeout
        setTimeout(() => {
          if (!this.initialized) {
            log(`[MCP ${this.name}] Connection timeout`);
            this.disconnect();
            reject(new Error('Connection timeout'));
          }
        }, 10000);
      });
    } catch (error) {
      console.error(`[MCP ${this.name}] SSE connection error:`, error);
      throw error;
    }
  }
  // Handle incoming messages
  async handleMessage(message, resolve, reject) {
    log('Received message:', message);
    if(this.onMessage) {
      return this.onMessage(message);
    }
    return;
  }

  async sendRequest(request) {
    if (this.config.connectionType === 'sse') {
      log(`[MCP ${this.name}] Sending SSE request to ${this.messageEndpoint}:`, request);
      try {
        const response = await fetch(this.messageEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.config.authHeader ? { 'Authorization': this.config.authHeader } : {})
          },
          body: JSON.stringify(request)
        });

        // Check if response is JSON
        const contentType = response.headers.get('content-type');
        log(`[MCP ${this.name}] Response content type:`, contentType);
        
        if (contentType && contentType.includes('application/json')) {
          const json = await response.json();
          log(`[MCP ${this.name}] JSON response:`, json);
          return json;
        }
        
        // If not JSON, just return success object
        if (response.ok) {
          log(`[MCP ${this.name}] Non-JSON success response`);
          return { result: { success: true } };
        }
        
        // If error, return error object
        const errorText = await response.text();
        console.error(`[MCP ${this.name}] Request error:`, response.status, errorText);
        return { 
          error: { 
            code: response.status,
            message: errorText
          }
        };
      } catch (error) {
        console.error(`[MCP ${this.name}] Request failed:`, error);
        return {
          error: {
            code: -1,
            message: error.message
          }
        };
      }
    } else {
      return new Promise((resolve, reject) => {
        const id = request.id;
        const handler = (event) => {
          try {
            const response = JSON.parse(event.data);
            if (response.id === id) {
              this.ws.removeEventListener('message', handler);
              resolve(response);
            }
          } catch (e) {
            reject(e);
          }
        };
        this.ws.addEventListener('message', handler);
        this.ws.send(JSON.stringify(request));
      });
    }
  }

  // Get next request ID
  getNextId() {
    return Math.floor(Math.random() * 1000000);
  }

  // Notify about resource changes
  notifyResourcesChanged() {
    // This method would trigger any listeners or callbacks for resource changes
    log(`[MCP ${this.name}] Resources changed, now have ${this.resources.size} resources`);
  }
  
  // Notify about tool changes
  notifyToolsChanged() {
    // This method would trigger any listeners or callbacks for tool changes
    log(`[MCP ${this.name}] Tools changed, now have ${this.tools.size} tools`);
  }
  
  // Disconnect and cleanup
  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.initialized = false;
    this.capabilities = null;
    this.serverInfo = null;
    this.resources.clear();
    this.tools.clear();
    this.subscriptions.clear();
    
    log(`[MCP ${this.name}] Disconnected`);
  }
} 