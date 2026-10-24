'use strict';

/**
 * @lanonasis/agent-runtime — LanguageModelV2 adapter for VoltAgent
 *
 * Exports the LangAdapter class and factory function.
 *
 * Usage:
 *   const { createLangAdapter } = require('@lanonasis/agent-runtime');
 *   const model = createLangAdapter();
 *   // Use with VoltAgent or any AI SDK v6 harness:
 *   // const agent = new Agent({ model });
 */

const { LangAdapter, createLangAdapter } = require('./lang-adapter');

module.exports = {
  LangAdapter,
  createLangAdapter,
};
