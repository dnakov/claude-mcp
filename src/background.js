// Background script for the extension
// Supports both Chrome and Firefox

// Use the browser namespace for Firefox compatibility
const browserAPI = globalThis.chrome || globalThis.browser;

console.log('[Claude MCP Manager] Background script loaded');

// Initialize storage if needed
async function initializeStorage() {
  try {
    const data = await browserAPI.storage.local.get('mcpServers');
    if (!data.mcpServers) {
      await browserAPI.storage.local.set({ 
        mcpServers: []
      });
      console.log('[Claude MCP Manager] Initialized empty server list');
    } else {
      console.log(`[Claude MCP Manager] Found ${data.mcpServers.length} existing servers`);
    }
  } catch (error) {
    console.error('[Claude MCP Manager] Error initializing storage:', error);
  }
}

// Listen for messages from the popup
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'servers-updated') {
    console.log('[Claude MCP Manager] Servers updated from popup');
    sendResponse({ success: true });
  }
  
  return true; // Keep the message channel open for async response
});

// Initialize when the extension loads
initializeStorage();