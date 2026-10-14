/**
 * TSM integration: module discovery, dependency resolution and lifecycle.
 *
 * Trimmed from gene's src/tsm/index.ts.
 */

import {
  PluginRegistry,
  ModuleLoader,
  DependencyResolver,
  DefaultServiceRegistry,
  type ModuleManifest,
  type PluginRepository,
  type ServiceRegistry,
  type ModuleLogger,
} from '@eclipse-daanse/tsm'

export interface TsmPluginSystemOptions {
  repositories?: PluginRepository[]
  logger?: Console
}

function prefixedLogger(logger: Console, prefix: string): ModuleLogger {
  return {
    debug: (msg: string, ...args: unknown[]) => logger.debug(prefix, msg, ...args),
    info: (msg: string, ...args: unknown[]) => logger.info(prefix, msg, ...args),
    warn: (msg: string, ...args: unknown[]) => logger.warn(prefix, msg, ...args),
    error: (msg: string, ...args: unknown[]) => logger.error(prefix, msg, ...args),
  }
}

export class TsmPluginSystem {
  private readonly registry: PluginRegistry
  private readonly loader: ModuleLoader
  private readonly resolver = new DependencyResolver()
  private readonly services: ServiceRegistry = new DefaultServiceRegistry()
  private readonly logger: Console

  constructor(options: TsmPluginSystemOptions = {}) {
    this.logger = options.logger ?? console
    this.registry = new PluginRegistry({ logger: prefixedLogger(this.logger, '[TSM Registry]') })
    this.loader = new ModuleLoader({
      serviceRegistry: this.services,
      logger: prefixedLogger(this.logger, '[TSM Loader]'),
    })
    for (const repo of options.repositories ?? []) this.registry.addRepository(repo)
  }

  /** Discovers the modules of all registered repositories. */
  async init(): Promise<void> {
    const discovered = await this.registry.discoverAll()
    this.logger.info(`[TSM] Discovered ${discovered.length} modules`)
  }

  /** Loads the given modules and their dependencies in dependency order. */
  async loadModules(moduleIds: string[]): Promise<void> {
    const manifests = new Map(this.registry.getManifests().map((m) => [m.id, m]))
    const toLoad: ModuleManifest[] = []
    const visited = new Set<string>()

    const collect = (id: string) => {
      if (visited.has(id)) return
      visited.add(id)
      const manifest = manifests.get(id)
      if (!manifest) {
        this.logger.warn(`[TSM] Module not found: ${id}`)
        return
      }
      for (const dep of manifest.dependencies ?? []) collect(typeof dep === 'string' ? dep : dep.id)
      toLoad.push(manifest)
    }
    moduleIds.forEach(collect)

    const result = this.resolver.resolve(toLoad)
    for (const missing of result.missing) {
      this.logger.error(`[TSM] Missing dependency: ${missing.missingDep} required by ${missing.moduleId}`)
    }

    this.loader.register(result.loadOrder)
    for (const manifest of result.loadOrder) {
      await this.loader.loadModule(manifest)
    }
  }

  getService<T>(serviceId: string): T | undefined {
    return this.services.get<T>(serviceId)
  }

  registerService<T>(serviceId: string, service: T): void {
    this.services.register(serviceId, service)
  }

  getLoadedModuleIds(): string[] {
    return this.loader.getLoadedModuleIds()
  }

  onModuleEvent(listener: Parameters<ModuleLoader['addEventListener']>[0]): void {
    this.loader.addEventListener(listener)
  }
}
