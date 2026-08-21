/**
 * WebMCP Playground – core logic
 *
 * Provides:
 *  - Polyfill for navigator.modelContext / document.modelContext
 *  - Tool registration & management UI
 *  - In-page tool invocation
 *  - Live activity log
 */

'use strict';

/* ──────────────────────────────────────────────────────────
   1.  Polyfill  (navigator.modelContext + document.modelContext)
   ────────────────────────────────────────────────────────── */

class ModelContextContainer {
  constructor() {
    this._tools = new Map();
  }

  /** Register a single tool descriptor */
  registerTool(descriptor) {
    const { name, description, inputSchema, execute } = descriptor;
    if (!name || typeof name !== 'string') throw new TypeError('Tool name must be a non-empty string.');
    if (typeof execute !== 'function') throw new TypeError('Tool execute must be a function.');
    this._tools.set(name, { name, description: description || '', inputSchema: inputSchema || {}, execute });
    playground.onToolRegistered(name);
  }

  /** Remove a previously registered tool */
  unregisterTool(name) {
    if (this._tools.delete(name)) playground.onToolUnregistered(name);
  }

  /** Replace all tools at once */
  provideContext(options = {}) {
    this._tools.clear();
    const tools = options.tools || [];
    for (const t of tools) this.registerTool(t);
  }

  /** @internal – get a tool by name */
  _get(name) { return this._tools.get(name); }

  /** @internal – list all tools */
  _list() { return Array.from(this._tools.values()); }
}

(function installPolyfill() {
  const container = new ModelContextContainer();

  // Prefer the official location; also expose on document for legacy compat
  if (!('modelContext' in navigator)) {
    try {
      Object.defineProperty(navigator, 'modelContext', { get: () => container, configurable: true });
    } catch (_) { /* navigator may be read-only in some envs */ }
  }
  if (!('modelContext' in document)) {
    try {
      Object.defineProperty(document, 'modelContext', { get: () => container, configurable: true });
    } catch (_) { /* ignore */ }
  }

  // Expose globally for playground scripts running via eval
  window.__mcp = container;
})();

/* ──────────────────────────────────────────────────────────
   2.  Built-in demo tools
   ────────────────────────────────────────────────────────── */

const DEMO_TOOLS = [
  {
    name: 'echo',
    description: 'Echoes any message back to the caller.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Text to echo' },
      },
      required: ['message'],
    },
    execute({ message }) {
      return { echo: message, timestamp: new Date().toISOString() };
    },
  },
  {
    name: 'math_eval',
    description: 'Safely evaluates a simple arithmetic expression (no variables).',
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'e.g. "2 + 3 * 4"' },
      },
      required: ['expression'],
    },
    execute({ expression }) {
      // Allow only digits, basic arithmetic operators, spaces/tabs, dots, and parentheses.
      // Explicitly exclude newlines so multi-statement injection via \s is not possible.
      if (!/^[\d +\-*/().]+$/.test(expression)) throw new Error('Invalid characters in expression.');
      // eslint-disable-next-line no-new-func
      const result = Function(`"use strict"; return (${expression})`)();
      return { expression, result };
    },
  },
  {
    name: 'page_title',
    description: 'Returns the current page title and URL.',
    inputSchema: { type: 'object', properties: {} },
    execute() {
      return { title: document.title, url: location.href };
    },
  },
  {
    name: 'dom_query',
    description: 'Queries the DOM with a CSS selector and returns matching element summaries.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector' },
        limit:    { type: 'number', description: 'Max results (default 5)' },
      },
      required: ['selector'],
    },
    execute({ selector, limit = 5 }) {
      const els = Array.from(document.querySelectorAll(selector)).slice(0, limit);
      return {
        count: els.length,
        elements: els.map(el => ({
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          classes: Array.from(el.classList),
          text: el.textContent.trim().slice(0, 80),
        })),
      };
    },
  },
  {
    name: 'storage_get',
    description: 'Reads a value from localStorage.',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string' } },
      required: ['key'],
    },
    execute({ key }) {
      const value = localStorage.getItem(key);
      return { key, value, found: value !== null };
    },
  },
  {
    name: 'storage_set',
    description: 'Writes a string value to localStorage.',
    inputSchema: {
      type: 'object',
      properties: {
        key:   { type: 'string' },
        value: { type: 'string' },
      },
      required: ['key', 'value'],
    },
    execute({ key, value }) {
      localStorage.setItem(key, value);
      return { key, value, success: true };
    },
  },
];

/* ──────────────────────────────────────────────────────────
   3.  Playground controller
   ────────────────────────────────────────────────────────── */

const playground = (() => {
  /* ── DOM refs ──────────────────────────────────────────── */
  const toolList      = document.getElementById('tool-list');
  const editor        = document.getElementById('editor');
  const output        = document.getElementById('output');
  const invokePanel   = document.getElementById('invoke-panel');
  const invokeTitle   = document.getElementById('invoke-title');
  const invokeParams  = document.getElementById('invoke-params');
  const invokeActions = document.getElementById('invoke-actions');
  const toolCount     = document.getElementById('tool-count');
  const statusBadge   = document.getElementById('status-badge');

  let selectedTool = null;

  /* ── Logging ───────────────────────────────────────────── */
  function log(level, tag, msg) {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const line = document.createElement('div');
    line.className = `log-line ${level}`;
    line.innerHTML = `<span class="log-ts">${ts}</span><span class="log-tag">[${tag}]</span><span class="log-msg">${escHtml(msg)}</span>`;
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ── Status badge ──────────────────────────────────────── */
  function updateStatusBadge() {
    // Use `in` (not hasOwnProperty) – native implementations expose modelContext
    // on the Navigator prototype, not as an own property.
    const isNative = ('modelContext' in navigator) &&
                     !(navigator.modelContext instanceof ModelContextContainer);
    if (isNative) {
      statusBadge.textContent = '✓ Native support';
      statusBadge.className = 'status-badge supported';
    } else if (navigator.modelContext) {
      statusBadge.textContent = '⚡ Polyfilled';
      statusBadge.className = 'status-badge polyfilled';
    } else {
      statusBadge.textContent = '✗ Unsupported';
      statusBadge.className = 'status-badge unsupported';
    }
  }

  /* ── Tool list ─────────────────────────────────────────── */
  function refreshToolList() {
    const tools = navigator.modelContext._list();
    toolCount.textContent = tools.length;

    if (tools.length === 0) {
      toolList.innerHTML = '<p class="empty-state">No tools registered yet.<br>Run a snippet to add tools.</p>';
      return;
    }

    toolList.innerHTML = '';
    for (const tool of tools) {
      const item = document.createElement('div');
      item.className = 'tool-item' + (selectedTool === tool.name ? ' active' : '');
      item.dataset.name = tool.name;
      item.innerHTML = `
        <div class="tool-item-name">${escHtml(tool.name)}</div>
        <div class="tool-item-desc">${escHtml(tool.description)}</div>
        <span class="tool-item-badge">▶ invoke</span>
      `;
      item.addEventListener('click', () => selectTool(tool.name));
      toolList.appendChild(item);
    }
  }

  /* ── Tool selection / invoke panel ────────────────────────── */
  function selectTool(name) {
    selectedTool = name;
    refreshToolList();

    const tool = navigator.modelContext._get(name);
    if (!tool) return;

    invokeTitle.textContent = `Invoke: ${name}`;
    invokePanel.classList.add('visible');
    invokeParams.innerHTML = '';

    const props = (tool.inputSchema && tool.inputSchema.properties) || {};
    const required = (tool.inputSchema && tool.inputSchema.required) || [];

    if (Object.keys(props).length === 0) {
      invokeParams.innerHTML = '<p style="color:var(--text-muted);font-size:12px;">No parameters.</p>';
    }

    for (const [key, schema] of Object.entries(props)) {
      const row = document.createElement('div');
      row.className = 'param-row';
      const req = required.includes(key) ? '<span style="color:var(--error)">*</span>' : '';
      row.innerHTML = `
        <label>${escHtml(key)}${req} <span style="color:var(--text-muted);font-weight:400;">(${escHtml(schema.type || 'any')})</span></label>
        <input type="text" data-param-key="${escHtml(key)}" placeholder="${escHtml(schema.description || '')}" />
      `;
      invokeParams.appendChild(row);
    }

    invokeActions.innerHTML = '';
    const runBtn = document.createElement('button');
    runBtn.className = 'btn btn-primary';
    runBtn.textContent = '▶ Run';
    runBtn.addEventListener('click', () => invokeTool(name, props));

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn-secondary';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => {
      invokePanel.classList.remove('visible');
      selectedTool = null;
      refreshToolList();
    });

    invokeActions.appendChild(runBtn);
    invokeActions.appendChild(closeBtn);
  }

  function invokeTool(name, props) {
    const tool = navigator.modelContext._get(name);
    if (!tool) { log('error', 'INVOKE', `Tool "${name}" not found.`); return; }

    const params = {};
    for (const key of Object.keys(props)) {
      const el = invokeParams.querySelector(`[data-param-key="${CSS.escape(key)}"]`);
      if (el) {
        const raw = el.value.trim();
        // Attempt JSON parse; fall back to raw string
        try { params[key] = JSON.parse(raw); } catch (_) { params[key] = raw; }
      }
    }

    log('info', 'INVOKE', `${name}(${JSON.stringify(params)})`);

    try {
      const result = tool.execute(params, makeAgent());
      if (result && typeof result.then === 'function') {
        result.then(r => {
          log('result', 'RESULT', JSON.stringify(r, null, 2));
        }).catch(e => {
          log('error', 'ERROR', String(e));
        });
      } else {
        log('result', 'RESULT', JSON.stringify(result, null, 2));
      }
    } catch (e) {
      log('error', 'ERROR', String(e));
    }
  }

  function makeAgent() {
    return {
      requestUserInteraction(cb) {
        log('warn', 'AGENT', 'requestUserInteraction called — running immediately in playground.');
        cb();
      },
    };
  }

  /* ── Public callbacks (called by ModelContextContainer) ── */
  function onToolRegistered(name) {
    log('success', 'REG', `Tool registered: ${name}`);
    refreshToolList();
  }

  function onToolUnregistered(name) {
    log('warn', 'UNREG', `Tool unregistered: ${name}`);
    if (selectedTool === name) {
      invokePanel.classList.remove('visible');
      selectedTool = null;
    }
    refreshToolList();
  }

  /* ── Editor / snippet runner ──────────────────────────── */
  function runSnippet() {
    const code = editor.value.trim();
    if (!code) { log('warn', 'RUN', 'Editor is empty.'); return; }
    log('info', 'RUN', 'Executing snippet…');
    try {
      // Provide convenience aliases inside the snippet scope
      // eslint-disable-next-line no-new-func
      const fn = new Function('modelContext', 'navigator', 'document', 'log', code);
      fn(navigator.modelContext, navigator, document, (msg) => log('info', 'LOG', msg));
      log('success', 'RUN', 'Snippet executed successfully.');
    } catch (e) {
      log('error', 'RUN', String(e));
    }
  }

  function clearTools() {
    const names = navigator.modelContext._list().map(t => t.name);
    for (const n of names) navigator.modelContext.unregisterTool(n);
    invokePanel.classList.remove('visible');
    selectedTool = null;
    log('warn', 'CLEAR', `Removed ${names.length} tool(s).`);
    refreshToolList();
  }

  function clearLog() {
    output.innerHTML = '';
  }

  /* ── Snippet templates ────────────────────────────────── */
  const TEMPLATES = {
    blank: `// Register a custom tool using navigator.modelContext
// Then click it in the sidebar to invoke it.

navigator.modelContext.registerTool({
  name: 'my_tool',
  description: 'A custom tool.',
  inputSchema: {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'Any string' }
    },
    required: ['input']
  },
  execute({ input }) {
    return { result: 'You said: ' + input };
  }
});`,

    provideContext: `// Use provideContext() to batch-register (replaces existing tools)

navigator.modelContext.provideContext({
  tools: [
    {
      name: 'greet',
      description: 'Greet someone by name.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name']
      },
      execute({ name }) { return { greeting: \`Hello, \${name}!\` }; }
    },
    {
      name: 'time',
      description: 'Return current time.',
      inputSchema: { type: 'object', properties: {} },
      execute() { return { time: new Date().toLocaleTimeString() }; }
    }
  ]
});`,

    listTools: `// Inspect registered tools

const tools = navigator.modelContext._list();
log('Registered tools: ' + tools.map(t => t.name).join(', '));`,

    unregister: `// Unregister a tool by name

navigator.modelContext.unregisterTool('my_tool');`,

    async: `// Async execute is supported – return a Promise

navigator.modelContext.registerTool({
  name: 'fetch_ip',
  description: 'Fetches your public IP address.',
  inputSchema: { type: 'object', properties: {} },
  async execute() {
    const res = await fetch('https://api.ipify.org?format=json');
    const data = await res.json();
    return { ip: data.ip };
  }
});`,
  };

  /* ── Init ─────────────────────────────────────────────── */
  function init() {
    updateStatusBadge();
    refreshToolList();

    // Wire buttons
    document.getElementById('btn-run').addEventListener('click', runSnippet);
    document.getElementById('btn-clear-tools').addEventListener('click', clearTools);
    document.getElementById('btn-clear-log').addEventListener('click', clearLog);
    document.getElementById('btn-load-demos').addEventListener('click', loadDemos);

    // Template selector
    document.getElementById('template-select').addEventListener('change', (e) => {
      if (e.target.value && TEMPLATES[e.target.value]) {
        editor.value = TEMPLATES[e.target.value];
        e.target.value = '';
      }
    });

    // Keyboard shortcut: Ctrl+Enter / Cmd+Enter to run
    editor.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        runSnippet();
      }
      // Tab key → insert spaces
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end);
        editor.selectionStart = editor.selectionEnd = start + 2;
      }
    });

    // Load default snippet
    editor.value = TEMPLATES.blank;

    log('info', 'INIT', 'WebMCP Playground ready.');
    log('info', 'INIT', `navigator.modelContext available: ${!!navigator.modelContext}`);
    log('info', 'INIT', `document.modelContext available: ${!!document.modelContext}`);
    log('info', 'INIT', 'Tip: Press Ctrl+Enter (or Cmd+Enter) to run a snippet.');
  }

  function loadDemos() {
    for (const t of DEMO_TOOLS) {
      if (!navigator.modelContext._get(t.name)) {
        navigator.modelContext.registerTool(t);
      }
    }
    log('success', 'DEMOS', `Loaded ${DEMO_TOOLS.length} demo tool(s).`);
  }

  return { init, onToolRegistered, onToolUnregistered };
})();

/* ──────────────────────────────────────────────────────────
   4.  Bootstrap
   ────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => playground.init());
