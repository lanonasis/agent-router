/**
 * Shared document re-exports for backward compatibility.
 *
 * MIGRATION NOTE:
 * The canonical shared docs (SOUL, Policies, Identity Layer) are now
 * build-imported via docManifest.ts. This file re-exports them as
 * AgentDocSection format for any remaining consumers.
 *
 * New code should import from docManifest.ts directly.
 */

import { AgentDocSection } from './agentDocTypes';
import { SHARED_DOCS_MANIFEST } from './docManifest';

function findSharedDoc(label: string): AgentDocSection {
  const entry = SHARED_DOCS_MANIFEST.find(d => d.label === label);
  return entry
    ? { title: entry.label, content: entry.content }
    : { title: label, content: 'Document unavailable.' };
}

/** @deprecated Use SHARED_DOCS_MANIFEST from docManifest.ts instead */
export const soulDoc = findSharedDoc('Soul Identity');

/** @deprecated Use SHARED_DOCS_MANIFEST from docManifest.ts instead */
export const policiesDoc = findSharedDoc('Policies & Safety');

/** @deprecated Use SHARED_DOCS_MANIFEST from docManifest.ts instead */
export const identityLayerDoc = findSharedDoc('Identity Layer');
