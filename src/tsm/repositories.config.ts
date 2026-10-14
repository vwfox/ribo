/**
 * TSM module repositories and startup modules.
 */

import type { PluginRepository } from '@eclipse-daanse/tsm'

export const repositories: PluginRepository[] = [
  // Local modules, served by the Vite dev server (see vite.config.ts)
  {
    id: 'local',
    name: 'Local Modules',
    url: '/plugins',
    enabled: true,
    priority: 10,
  },
]

/**
 * Modules to load at startup. Dependencies are resolved automatically.
 */
export const startupModules = [
  'ribo-app', // Vue application shell, panel and action registries
  'ribo-kernel', // OpenCascade geometry kernel in a web worker
  'ribo-document', // Current design, expressions, rebuild
  'ribo-viewport', // three.js 3D view, 2D sketch view
  'ribo-sketcher', // Sketch mode: tools, constraints, dimensions
  'ribo-timeline', // Browser: parameters and feature timeline
  'ribo-properties', // Properties of the selected object
  'ribo-io', // Open, save, STL/STEP export
]
