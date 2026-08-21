# WebMCP Lab

A lab notebook and playground for the **WebMCP** API (`document.modelContext` / `navigator.modelContext`) — five pages, all live, in a single static page.

## What is WebMCP?

[WebMCP](https://github.com/webmachinelearning/webmcp) is a proposed web standard that lets a page declare JavaScript functions as typed, AI-callable **tools**, discoverable by browser agents. Instead of an agent squinting at a screenshot and guessing which div is the submit button, the page hands it a list of verbs with names, descriptions and JSON Schemas.

## Pages

| Page | What's there |
|---|---|
| **Overview** | Why declared tools beat vision-driven clicking, the three-call protocol surface, and browser support |
| **Playground** | Three snippet tabs, a live registry sidebar with a registry timeline, an invoke panel, and a timed activity log. `Ctrl`/`Cmd` + `↵` runs |
| **Capability labs** | Ten runnable labs: register/unregister, `provideContext`, consent gating, elicitation, structured results, shared state, annotations, feature detection, security, streaming progress |
| **CRM sandbox** | A pretend helpdesk that declares 4–7 tools depending on page state, plus a scripted agent that works the queue and gets gated on `issue_refund` |
| **Reference** | Spec surface member by member, with a column for where this polyfill deliberately differs, and the known gaps |

## Running it

Everything is static, but the runtime pulls React from a CDN, so serve it over HTTP rather than opening the file directly:

```sh
python -m http.server 8137
# then open http://localhost:8137/
```

The page detects a native `modelContext` before installing anything. If Chrome ships it behind the WebMCP flag, every tool is mirrored into the native registry as well; otherwise the built-in polyfill takes over and every page still runs. The left rail tells you which one you're on.

## Quick example

```js
document.modelContext.registerTool({
  name: 'say_hello',
  description: 'Greets a person by name.',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string', description: 'Who to greet' } },
    required: ['name'],
  },
  annotations: { readOnlyHint: true },
  async execute({ name }) {
    return { content: [{ type: 'text', text: 'Hello, ' + name + '!' }] };
  },
});
```

Run it in the playground and `say_hello` appears in the registry sidebar. Click it, fill in the parameter, and invoke.

## Layout

```
index.html    the whole app — template + component logic in one Design Component
support.js    the DC runtime (loads React 18 from unpkg, then boots the component)
_ds/          the Nocturne design system: tokens, base typography, component classes
```

`index.html` is a Design Component: an `<x-dc>` template using `sc-if` / `sc-for` / `{{ }}` bindings, plus a `class Component extends DCLogic` that owns the state, the polyfill, the desk tools and the scripted agent.

## Caveats

- The sandbox agent is a scripted planner, not a model. Tool execution, schemas, throws and progress reports are real; the reasoning is theatre.
- Schema validation is shallow — nested objects and array item types pass unchecked.
- Snippets are evaluated with `Function` in the page's own tab. Fine for a lab, not a pattern to copy.

