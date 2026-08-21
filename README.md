# WebMCP Playground

An interactive in-browser playground for the **WebMCP** API (`navigator.modelContext` / `document.modelContext`).

## What is WebMCP?

[WebMCP](https://github.com/webmachinelearning/webmcp) is a proposed web standard that lets web pages expose JavaScript functions as structured, AI-callable **tools** discoverable by browser agents and AI assistants — no server required.

## Features

| Feature | Details |
|---|---|
| **Polyfill** | `navigator.modelContext` and `document.modelContext` are polyfilled so the API works in any browser today |
| **Tool registration** | `registerTool()`, `unregisterTool()`, `provideContext()` all supported |
| **Snippet editor** | Write and run JavaScript snippets with `Ctrl+Enter` (or `Cmd+Enter`) |
| **Tool sidebar** | All registered tools listed live; click to open the invoke panel |
| **Invoke panel** | Fill in parameters and invoke any tool in one click |
| **Activity log** | Colour-coded log of every registration, invocation, and result |
| **Demo tools** | 6 built-in demo tools (echo, math_eval, dom_query, page_title, storage_get, storage_set) |
| **Templates** | Five ready-to-run code templates in the toolbar dropdown |

## Usage

1. Open `index.html` in any modern browser (no build step needed).
2. Click **Load demos** to register the built-in tools, or write your own in the editor.
3. Press **▶ Run** (or `Ctrl+Enter`) to execute the snippet.
4. Click a tool in the sidebar to open the invoke panel, fill in parameters, and click **▶ Run**.

## Quick example

```js
navigator.modelContext.registerTool({
  name: 'say_hello',
  description: 'Greets a user by name.',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  },
  execute({ name }) {
    return { greeting: `Hello, ${name}!` };
  },
});
```

After running the snippet, `say_hello` appears in the sidebar. Click it, enter a name, and hit **▶ Run** to see the result in the activity log.

## API reference (polyfilled)

```ts
// Both are available:
navigator.modelContext  // ModelContextContainer
document.modelContext   // same instance

// Methods:
modelContext.registerTool(descriptor: ToolDescriptor): void
modelContext.unregisterTool(name: string): void
modelContext.provideContext({ tools: ToolDescriptor[] }): void
```

## File structure

```
index.html     – application shell
style.css      – dark-mode UI styles
playground.js  – polyfill + playground controller
README.md      – this file
```

