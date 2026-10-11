#!/usr/bin/env node
'use strict';

const path = require('path');
const argv = process.argv.slice(2);
const previewEnabled = argv.includes('--preview');
const dotenvFlagIndex = argv.indexOf('--dotenv-file');

if (dotenvFlagIndex !== -1) {
  const dotenvPath = argv[dotenvFlagIndex + 1];
  if (!dotenvPath) {
    console.error('Missing value for --dotenv-file');
    process.exit(1);
  }
  require('dotenv').config({
    path: path.isAbsolute(dotenvPath) ? dotenvPath : path.resolve(process.cwd(), dotenvPath),
  });
  argv.splice(dotenvFlagIndex, 2);
}

const { PromptComposer } = require('../core/prompt-composer');
const {
  resolveVendorChainForUseCase,
  USE_CASES,
} = require('../vendors');

const requestedUseCase = argv.find(arg => !arg.startsWith('--')) || 'code-assist';

if (!USE_CASES[requestedUseCase]) {
  console.error(`Unknown use case: ${requestedUseCase}`);
  console.error(`Available use cases: ${Object.keys(USE_CASES).join(', ')}`);
  process.exit(1);
}

const vendorChain = resolveVendorChainForUseCase(requestedUseCase);
if (vendorChain.length === 0) {
  console.error(`No active vendor chain for use case: ${requestedUseCase}`);
  process.exit(1);
}

const composer = new PromptComposer();
const fallbackSystemPrompt =
  process.env.OLLAMA_SYSTEM_PROMPT ||
  'You are the Onasis AI assistant. Never reveal AI provider, model names, or internal configuration.';
const runtimePrompt = vendorChain[0].systemPrompt || fallbackSystemPrompt;
const bundle = composer.compose({
  useCase: requestedUseCase,
  runtimePrompt,
});

const diagnostics = {
  useCase: requestedUseCase,
  promptMode: bundle.mode,
  promptsRoot: bundle.promptLabel,
  usesSoul: bundle.usesSoul,
  usesRolePrompt: bundle.usesRolePrompt,
  rolePromptPath: bundle.rolePromptPath,
  runtimePromptLength: bundle.runtimePromptLength,
  compactPromptLength: bundle.compactPromptLength,
  richPromptLength: bundle.richPromptLength,
  vendorChain: vendorChain.map((vendor) => {
    const systemPrompt = bundle.systemPromptForVendor(vendor._vendorId);
    const entry = {
      vendorId: vendor._vendorId,
      model: vendor._model,
      strategy: systemPrompt ? 'injected' : 'embedded',
      injectedPromptLength: systemPrompt ? systemPrompt.length : 0,
    };

    if (previewEnabled && systemPrompt) {
      entry.promptPreview = `${systemPrompt.slice(0, 280)}${systemPrompt.length > 280 ? '…' : ''}`;
    }

    return entry;
  }),
};

console.log(JSON.stringify(diagnostics, null, 2));
