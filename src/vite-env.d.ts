/// <reference types="vite/client" />

/**
 * Vite raw import support.
 * Usage: import content from './file.md?raw'
 * Returns the file content as a plain string at build time.
 */
declare module '*.md?raw' {
  const content: string;
  export default content;
}
