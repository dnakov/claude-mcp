<script>
  import browser from 'webextension-polyfill';

  // Simple state management
  let servers = $state([]);
  let currentServer = $state({
    name: '',
    url: '',
    env: {},
    command: '',
    args: []
  });
  let isEditing = $state(false);
  let editIndex = $state(-1);
  let showEnvEditor = $state(false);
  let envKey = $state('');
  let envValue = $state('');
  let argInput = $state('');
  let status = $state('');
  let debugLog = $state(false);
  let darkMode = $state(false);
  let showImportModal = $state(false);
  let importData = $state(null);

  // Set theme on document body
  function updateTheme() {
    document.body.setAttribute('data-theme', 'claude');
    document.body.setAttribute('data-mode', darkMode ? 'dark' : 'light');
  }

  // Load data on startup
  $effect(() => {
    loadData();
  });

  // Load all data from storage
  async function loadData() {
    try {
      const result = await browser.storage.local.get();
      
      // Convert object to array if needed (one simple line)
      servers = result.mcpServers ? Object.values(result.mcpServers) : [];
      
      debugLog = Boolean(result.mcpDebugLog);
      darkMode = result.mcpDarkMode !== undefined ? 
                Boolean(result.mcpDarkMode) : 
                window.matchMedia('(prefers-color-scheme: dark)').matches;
      
      status = `Loaded ${servers.length} servers`;
      
      // Apply theme
      updateTheme();
      
      // Add listener for dark mode changes
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (result.mcpDarkMode === undefined) {
          darkMode = e.matches;
          updateTheme();
        }
      });
    } catch (e) {
      console.error('Error loading data:', e);
      status = `Error loading: ${e.message}`;
    }
  }

  // Save a server
  function saveServer() {
    if (!currentServer.name || !currentServer.url) {
      status = 'Name and URL are required';
      return;
    }

    try {
      if (isEditing && editIndex >= 0) {
        // Update existing server - avoid spread operator
        const newServers = Array.isArray(servers) ? Array.from(servers) : [];
        newServers[editIndex] = {...currentServer};
        servers = newServers;
        status = `Updated server: ${currentServer.name}`;
      } else {
        // Add new server - avoid spread operator
        const currentServers = Array.isArray(servers) ? Array.from(servers) : [];
        const newServer = {...currentServer};
        currentServers.push(newServer);
        servers = currentServers;
        status = `Added server: ${currentServer.name}`;
      }

      // Save to storage
      saveToStorage('mcpServers', servers);
      
      // Reset form
      resetForm();
    } catch (err) {
      console.error('Error in saveServer:', err);
      status = `Error: ${err.message}`;
    }
  }

  // Delete a server
  function deleteServer(index) {
    if (confirm(`Delete server ${servers[index].name}?`)) {
      try {
        // Avoid using filter with spread operator
        const currentServers = Array.isArray(servers) ? Array.from(servers) : [];
        const updatedServers = [];
        
        // Manually filter to avoid spread issues
        for (let i = 0; i < currentServers.length; i++) {
          if (i !== index) {
            updatedServers.push(currentServers[i]);
          }
        }
        
        servers = updatedServers;
        saveToStorage('mcpServers', servers);
        status = 'Server deleted';
      } catch (err) {
        console.error('Error in deleteServer:', err);
        status = `Error: ${err.message}`;
      }
    }
  }

  // Edit server
  function editServer(index) {
    currentServer = { ...servers[index] };
    isEditing = true;
    editIndex = index;
  }

  // Reset form
  function resetForm() {
    currentServer = {
      name: '',
      url: '',
      env: {},
      command: '',
      args: []
    };
    isEditing = false;
    editIndex = -1;
    showEnvEditor = false;
    envKey = '';
    envValue = '';
    argInput = '';
  }

  // Add environment variable
  function addEnvVar() {
    if (!envKey) return;
    currentServer = {
      ...currentServer,
      env: {
        ...currentServer.env,
        [envKey]: envValue
      }
    };
    envKey = '';
    envValue = '';
  }

  // Delete environment variable
  function deleteEnvVar(key) {
    const newEnv = {...currentServer.env};
    delete newEnv[key];
    currentServer = {
      ...currentServer,
      env: newEnv
    };
  }

  // Add argument
  function addArg() {
    if (!argInput) return;
    currentServer = {
      ...currentServer,
      args: [...currentServer.args, argInput]
    };
    argInput = '';
  }

  // Delete argument
  function deleteArg(index) {
    currentServer = {
      ...currentServer,
      args: currentServer.args.filter((_, i) => i !== index)
    };
  }
  
  // Toggle dark mode
  function toggleDarkMode() {
    darkMode = !darkMode;
    updateTheme();
    saveToStorage('mcpDarkMode', darkMode);
  }

  // Helper function to save to storage with notification
  async function saveToStorage(key, value) {
    try {
      await browser.storage.local.set({ [key]: value });
      // The storage listener in isolated-content.js will handle notifying content scripts
    } catch (e) {
      status = `Error saving: ${e.message}`;
      console.error(`Error saving ${key}:`, e);
    }
  }

  // Export server configurations
  function exportSettings() {
    try {
      const exportData = {
        version: "1.0.0",
        exportDate: new Date().toISOString(),
        servers: servers,
        settings: {
          debugLog,
          darkMode
        }
      };
      
      const dataStr = JSON.stringify(exportData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `claude-mcp-settings-${new Date().toISOString().split('T')[0]}.json`;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      URL.revokeObjectURL(url);
      status = `Exported ${servers.length} servers`;
    } catch (e) {
      status = `Export failed: ${e.message}`;
      console.error('Export error:', e);
    }
  }

  // Import server configurations
  function importSettings(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        
        // Basic validation
        if (!data.servers || !Array.isArray(data.servers)) {
          throw new Error('Invalid format: servers array not found');
        }
        
        // Validate each server has required fields
        for (const server of data.servers) {
          if (!server.name || !server.url) {
            throw new Error(`Invalid server: missing name or url`);
          }
        }
        
        // Store import data and show modal
        importData = data;
        showImportModal = true;
        
        // Clear file input
        event.target.value = '';
        
      } catch (e) {
        status = `Import failed: ${e.message}`;
        console.error('Import error:', e);
        event.target.value = '';
      }
    };
    
    reader.readAsText(file);
  }

  // Handle import actions
  async function handleImportAction(action) {
    if (!importData) return;
    
    try {
      if (action === 'cancel') {
        showImportModal = false;
        importData = null;
        return;
      }
      
      let newServers;
      if (action === 'replace') {
        newServers = importData.servers;
      } else if (action === 'add') {
        // Merge: add new servers, skip duplicates by name
        const existingNames = new Set(servers.map(s => s.name));
        const newOnes = importData.servers.filter(s => !existingNames.has(s.name));
        newServers = [...servers, ...newOnes];
      }
      
      // Save servers
      servers = newServers;
      await saveToStorage('mcpServers', servers);
      
      // Import settings if available
      if (importData.settings) {
        if (importData.settings.debugLog !== undefined) {
          debugLog = importData.settings.debugLog;
          await saveToStorage('mcpDebugLog', debugLog);
        }
        if (importData.settings.darkMode !== undefined) {
          darkMode = importData.settings.darkMode;
          await saveToStorage('mcpDarkMode', darkMode);
          updateTheme();
        }
      }
      
      status = action === 'replace' ? 
        `Replaced with ${newServers.length} servers` : 
        `Added ${newServers.length - servers.length + importData.servers.length} new servers (${newServers.length} total)`;
      
      showImportModal = false;
      importData = null;
      
    } catch (e) {
      status = `Import failed: ${e.message}`;
      console.error('Import error:', e);
      showImportModal = false;
      importData = null;
    }
  }
</script>

<div class="w-full max-w-2xl p-3 bg-[hsl(var(--bg-100))] text-[hsl(var(--text-100))] rounded-lg">
  <h1 class="text-lg font-bold mb-2 pb-1 border-b border-[hsl(var(--border-100))] text-[hsl(var(--text-000))]">MCP Server Manager</h1>
  
  <div class="status-bar">{status}</div>
  
  <!-- Server Form -->
  <div class="mb-3">
    <h2 class="text-base font-semibold mb-2 text-[hsl(var(--text-000))]">{isEditing ? 'Edit Server' : 'Add Server'}</h2>
    
    <div class="grid grid-cols-3 gap-2 mb-2">
      <div>
        <label for="name" class="block mb-0.5 text-xs font-medium text-[hsl(var(--text-300))]">Name:</label>
        <input 
          id="name" 
          bind:value={currentServer.name} 
          placeholder="server name" 
          class="input-field"
        />
      </div>
      
      <div>
        <label for="url" class="block mb-0.5 text-xs font-medium text-[hsl(var(--text-300))]">URL:</label>
        <input 
          id="url" 
          bind:value={currentServer.url} 
          placeholder="SSE URL" 
          class="input-field"
        />
      </div>
      
      <div>
        <label for="command" class="block mb-0.5 text-xs font-medium text-[hsl(var(--text-300))]">Command:</label>
        <input 
          id="command" 
          bind:value={currentServer.command} 
          placeholder="command to execute" 
          class="input-field"
        />
      </div>
    </div>
    
    <div class="flex gap-2 mb-2">
      <!-- Environment Variables -->
      <div class="flex-1 p-2 border border-[hsl(var(--border-100))] rounded-lg bg-[hsl(var(--bg-200))]">
        <div class="flex justify-between items-center mb-1">
          <h3 class="text-xs font-medium text-[hsl(var(--text-300))]">Environment Variables</h3>
          <button 
            onclick={() => showEnvEditor = !showEnvEditor}
            class="px-1.5 py-0.5 text-xs bg-[hsl(var(--bg-300))] hover:bg-[hsl(var(--bg-400))] rounded-md text-[hsl(var(--text-200))]"
          >
            {showEnvEditor ? 'Hide' : 'Show'}
          </button>
        </div>
        
        {#if showEnvEditor}
          <div class="mt-1">
            <div class="flex gap-1 mb-1">
              <input 
                bind:value={envKey} 
                placeholder="Key" 
                class="flex-1 p-1 bg-[hsl(var(--bg-100))] border border-[hsl(var(--border-100))] rounded-md text-[hsl(var(--text-200))] text-xs focus:outline-none focus:ring-1 focus:ring-[hsl(var(--accent-main-100))] focus:border-[hsl(var(--accent-main-100))]"
              />
              <input 
                bind:value={envValue} 
                placeholder="Value" 
                class="flex-1 p-1 bg-[hsl(var(--bg-100))] border border-[hsl(var(--border-100))] rounded-md text-[hsl(var(--text-200))] text-xs focus:outline-none focus:ring-1 focus:ring-[hsl(var(--accent-main-100))] focus:border-[hsl(var(--accent-main-100))]"
              />
              <button 
                onclick={addEnvVar}
                class="w-8 bg-[hsl(var(--accent-main-100))] hover:bg-[hsl(var(--accent-main-000))] rounded-md text-white text-sm"
              >+</button>
            </div>
            
            <div class="max-h-24 overflow-y-auto bg-[hsl(var(--bg-100))] border border-[hsl(var(--border-100))] rounded-md">
              {#each Object.entries(currentServer.env || {}) as [key, value]}
                <div class="flex items-center p-1 border-b border-[hsl(var(--border-100))]">
                  <div class="font-medium text-[hsl(var(--text-300))] mr-1 text-xs">{key}:</div>
                  <div class="flex-1 text-xs text-[hsl(var(--text-200))] truncate">{value}</div>
                  <button 
                    onclick={() => deleteEnvVar(key)}
                    class="w-6 h-6 text-[hsl(var(--danger-100))] hover:bg-[hsl(var(--danger-100))/0.1] rounded-md text-base"
                  >×</button>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
      
      <!-- Arguments -->
      <div class="flex-1 p-2 border border-[hsl(var(--border-100))] rounded-lg bg-[hsl(var(--bg-200))]">
        <h3 class="text-xs font-medium text-[hsl(var(--text-300))]">Arguments</h3>
        
        <div class="flex gap-1 mb-1">
          <input 
            bind:value={argInput} 
            placeholder="Add argument" 
            class="flex-1 p-1 bg-[hsl(var(--bg-100))] border border-[hsl(var(--border-100))] rounded-md text-[hsl(var(--text-200))] text-xs focus:outline-none focus:ring-1 focus:ring-[hsl(var(--accent-main-100))] focus:border-[hsl(var(--accent-main-100))]"
          />
          <button 
            onclick={addArg}
            class="w-8 bg-[hsl(var(--accent-main-100))] hover:bg-[hsl(var(--accent-main-000))] rounded-md text-white text-sm"
          >+</button>
        </div>
        
        <div class="max-h-24 overflow-y-auto bg-[hsl(var(--bg-100))] border border-[hsl(var(--border-100))] rounded-md">
          {#each currentServer.args || [] as arg, i}
            <div class="flex items-center p-1 border-b border-[hsl(var(--border-100))]">
              <div class="flex-1 text-xs text-[hsl(var(--text-200))] truncate">{arg}</div>
              <button 
                onclick={() => deleteArg(i)}
                class="w-6 h-6 text-[hsl(var(--danger-100))] hover:bg-[hsl(var(--danger-100))/0.1] rounded-md text-base"
              >×</button>
            </div>
          {/each}
        </div>
      </div>
    </div>
    
    <div class="flex gap-2">
      <button 
        onclick={saveServer}
        class="btn-primary"
      >{isEditing ? 'Update' : 'Add'}</button>
      <button 
        onclick={resetForm}
        class="btn-secondary"
      >Cancel</button>
    </div>
  </div>
  
  <!-- Server List -->
  <div class="mt-3">
    <h2 class="text-base font-semibold mb-2 text-[hsl(var(--text-000))]">Servers ({Array.isArray(servers) ? servers.length : 0})</h2>
    
    {#if !Array.isArray(servers) || servers.length === 0}
      <div class="p-2 bg-[hsl(var(--bg-200))] border border-[hsl(var(--border-100))] border-dashed rounded-md text-center italic text-[hsl(var(--text-300))] text-xs">
        No servers configured
      </div>
    {:else}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {#each servers as server, i}
          <div class="p-2 bg-[hsl(var(--bg-200))] border border-[hsl(var(--border-100))] rounded-lg hover:border-[hsl(var(--border-200))] transition-all">
            <div class="flex justify-between">
              <div>
                <div class="font-semibold text-[hsl(var(--text-000))] text-sm">{server.name}</div>
                <div class="text-xs text-[hsl(var(--text-300))]">{server.url}</div>
              </div>
              <div class="flex gap-1">
                <button 
                  onclick={() => editServer(i)}
                  class="px-2 py-0.5 text-xs bg-[hsl(var(--bg-300))] hover:bg-[hsl(var(--bg-400))] rounded-md text-[hsl(var(--text-200))]"
                >Edit</button>
                <button 
                  onclick={() => deleteServer(i)}
                  class="btn-danger"
                >Delete</button>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
  
  <!-- Footer Controls -->
  <div class="mt-4 pt-3 border-t border-[hsl(var(--border-100))] space-y-3">
    <!-- Import/Export Section -->
    <div class="flex items-center justify-between">
      <div class="flex gap-2">
        <button 
          onclick={exportSettings}
          class="px-3 py-1 text-xs bg-[hsl(var(--accent-main-100))] hover:bg-[hsl(var(--accent-main-000))] text-white rounded-md font-medium"
        >
          Export Settings
        </button>
        
        <label class="relative cursor-pointer">
          <input 
            type="file" 
            accept=".json"
            onchange={importSettings}
            class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          <span class="block px-3 py-1 text-xs bg-[hsl(var(--bg-300))] hover:bg-[hsl(var(--bg-400))] text-[hsl(var(--text-200))] rounded-md font-medium">
            Import Settings
          </span>
        </label>
      </div>
      
      <button 
        onclick={toggleDarkMode}
        class="px-2 py-1 text-xs bg-[hsl(var(--bg-300))] hover:bg-[hsl(var(--bg-400))] rounded-md text-[hsl(var(--text-200))]"
      >
        {darkMode ? "Light Mode" : "Dark Mode"}
      </button>
    </div>
    
    <!-- Debug Settings -->
    <div class="flex items-center justify-between">
      <label class="flex items-center cursor-pointer">
        <input 
          type="checkbox" 
          bind:checked={debugLog} 
          onchange={() => saveToStorage('mcpDebugLog', debugLog)}
          class="form-checkbox h-4 w-4 bg-[hsl(var(--bg-100))] border-[hsl(var(--border-100))] rounded text-[hsl(var(--accent-main-100))] focus:ring-[hsl(var(--accent-main-100))] focus:ring-opacity-25 focus:ring-offset-0"
        />
        <span class="ml-2 text-xs text-[hsl(var(--text-200))]">Enable Debug Logging</span>
      </label>
      
      <div class="text-xs text-[hsl(var(--text-300))]">
        {servers.length} server{servers.length !== 1 ? 's' : ''} configured
      </div>
    </div>
  </div>
</div>

<!-- Import Modal -->
{#if showImportModal && importData}
  <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div class="bg-[hsl(var(--bg-100))] border border-[hsl(var(--border-100))] rounded-lg p-4 max-w-md mx-4">
      <h3 class="text-base font-semibold mb-3 text-[hsl(var(--text-000))]">Import Settings</h3>
      
      <div class="mb-4 text-sm text-[hsl(var(--text-200))]">
        <p class="mb-2">Found <strong>{importData.servers.length}</strong> servers to import.</p>
        <p class="mb-2">You currently have <strong>{servers.length}</strong> servers.</p>
        <p class="text-[hsl(var(--text-300))]">What would you like to do?</p>
      </div>
      
      <div class="flex gap-2 justify-end">
        <button 
          onclick={() => handleImportAction('cancel')}
          class="px-3 py-2 text-sm bg-[hsl(var(--bg-300))] hover:bg-[hsl(var(--bg-400))] text-[hsl(var(--text-200))] rounded-md"
        >
          Cancel
        </button>
        <button 
          onclick={() => handleImportAction('replace')}
          class="px-3 py-2 text-sm bg-[hsl(var(--danger-100))] hover:bg-[hsl(var(--danger-200))] text-white rounded-md"
        >
          Replace
        </button>
        <button 
          onclick={() => handleImportAction('add')}
          class="px-3 py-2 text-sm bg-[hsl(var(--accent-main-100))] hover:bg-[hsl(var(--accent-main-000))] text-white rounded-md"
        >
          Add
        </button>
      </div>
    </div>
  </div>
{/if}
