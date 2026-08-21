/* Nocturne bundle — implements the design system's state-style attributes.
   The DC runtime passes `style-hover` / `style-focus-visible` / `style-active`
   through to the DOM untouched; this applies them and restores the previous
   inline values when the state ends. */
(() => {
  'use strict';

  const STATES = [
    { attr: 'style-hover', on: 'mouseover', off: 'mouseout', pointer: true },
    { attr: 'style-active', on: 'mousedown', off: 'mouseup', pointer: true },
    { attr: 'style-focus', on: 'focusin', off: 'focusout', pointer: false },
    { attr: 'style-focus-visible', on: 'focusin', off: 'focusout', pointer: false, visibleOnly: true }
  ];

  const saved = new WeakMap();

  function declarations(text) {
    const out = [];
    for (const chunk of String(text).split(';')) {
      const i = chunk.indexOf(':');
      if (i < 0) continue;
      const prop = chunk.slice(0, i).trim();
      const value = chunk.slice(i + 1).trim();
      if (prop && value) out.push([prop, value]);
    }
    return out;
  }

  function apply(el, attr) {
    const decls = declarations(el.getAttribute(attr) || '');
    if (!decls.length) return;
    let bucket = saved.get(el);
    if (!bucket) saved.set(el, (bucket = {}));
    if (bucket[attr]) return;
    bucket[attr] = decls.map(([prop]) => [prop, el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
    for (const [prop, value] of decls) el.style.setProperty(prop, value, 'important');
  }

  function restore(el, attr) {
    const bucket = saved.get(el);
    const prev = bucket && bucket[attr];
    if (!prev) return;
    delete bucket[attr];
    for (const [prop, value, priority] of prev) {
      if (value) el.style.setProperty(prop, value, priority);
      else el.style.removeProperty(prop);
    }
  }

  for (const state of STATES) {
    document.addEventListener(state.on, (e) => {
      const el = e.target instanceof Element ? e.target.closest('[' + state.attr + ']') : null;
      if (!el) return;
      if (state.visibleOnly && typeof el.matches === 'function' && !el.matches(':focus-visible')) return;
      apply(el, state.attr);
    }, true);

    document.addEventListener(state.off, (e) => {
      const el = e.target instanceof Element ? e.target.closest('[' + state.attr + ']') : null;
      if (!el) return;
      // mouseover/mouseout also fire when moving between children of the same element.
      if (state.pointer && state.off === 'mouseout' && e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return;
      restore(el, state.attr);
    }, true);
  }

  // A pointer that leaves the window never emits the matching `mouseup`.
  document.addEventListener('mouseleave', () => {
    document.querySelectorAll('[style-active]').forEach((el) => restore(el, 'style-active'));
  });
})();
