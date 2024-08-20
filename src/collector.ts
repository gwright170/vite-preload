import fs from 'node:fs/promises';
import fs1 from 'node:fs';
import type { ModuleNode, ViteDevServer } from 'vite';
import {
    createHtmlTag,
    createLinkHeader,
    Preload,
    sortPreloads,
} from './utils';
import React from 'react';
import debug from 'debug';
import { ModuleCollectorContext } from './__internal';
 
const log = debug('vite-preload');

interface Chunk {
    src: string;
    name: string;
    file: string;
    isEntry?: boolean;
    imports?: string[];
    dynamicImports?: string[];
    css?: string[];
    assets?: string[];
}

type Manifest = Record<string, Chunk>;

interface ModuleCollectorOptions {
    /**
     * The manifest.json, NOT ssr-manifest.json as it does not include dynamic imports!
     *
     * Optional, not used in dev
     */
    manifest?: Manifest;

    /**
     * The client entrypoint for your vite application.
     *
     * Defaults to `index.html`
     */
    entrypoint?: string;

    viteDevServer?: ViteDevServer;
}


export default class ChunkCollector {
    /**
     * Detected module IDs
     */
    modulesIds = new Set<string>();

    modules = new Map<string, Preload>();

    constructor(private options: ModuleCollectorOptions = {}) {
        this.__context_collectModuleId =
            this.__context_collectModuleId.bind(this);
        this.getSortedModules = this.getSortedModules.bind(this);
        this.getTags = this.getTags.bind(this);
        this.getLinkHeader = this.getLinkHeader.bind(this);

        this.options.entrypoint ||= 'index.html';

        if (options.manifest) {
            // Manifest is not available in dev so we need to check the dev variant of that and check that as well
            // to not bring any surprise in prod builds
            validateEntry(this.options.entrypoint, options.manifest);

            collectModules(this.options.entrypoint, this.options, this.modules);
        }
    }

    /**
     * Function is called by `ChunkCollectorContext`
     */
    __context_collectModuleId(moduleId: string) {
        this.modulesIds.add(moduleId);
        collectModules(moduleId, this.options, this.modules);
    }

    getSortedModules() {
        return sortPreloads(Array.from(this.modules.values()));
    }

    /**
     * Returns all HTML tags for preload hints and stylesheets.
     *
     * If `includeEntrypoint` is set, entry <script module> and CSS will be included.
     * If not, it's assumed that you use the template html generated by Vite in `options.entrypoint`, that already includes the entrypoint tags.
     */
    getTags(includeEntrypoint?: boolean): string {
        const modules = this.getSortedModules();

        return modules
            .filter((m) => includeEntrypoint || !m.isEntry)
            .map(createHtmlTag)
            .filter(Boolean)
            .join('\n');
    }

    /**
     * Returns a `Link` header with all chunks to preload,
     * including entry chunks.
     */
    getLinkHeader(): string {
        const modules = this.getSortedModules();
        return createLinkHeader(modules);
    }
}

/*
  url: '/src/pages/Browse/index.ts',
  id: '/<absolute>/src/pages/Browse/index.ts',
  file: '/<absolute>/src/pages/Browse/index.ts',
*/
/**
 * https://vitejs.dev/guide/backend-integration
 * https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-react#consistent-components-exports
 * https://github.com/vitejs/vite-plugin-vue/blob/main/playground/ssr-vue/src/entry-server.js
 */

/**
 * This function figures out what modules are used based on the modules rendered by React.
 *
 * It follows https://vitejs.dev/guide/backend-integration
 */
function collectModules(
    moduleId: string,
    { manifest, entrypoint, viteDevServer }: ModuleCollectorOptions,
    preloads = new Map<string, Preload>()
) {
    if (viteDevServer) {
        return new Map();
        let m: ModuleNode;

        const urls = {};

        const i1 = viteDevServer.moduleGraph.idToModuleMap.get(moduleId);
        const i2 = viteDevServer.moduleGraph.urlToModuleMap.get(moduleId);

        console.log('i1', i1);
        console.log('i2', i2);

        // const first = await vite.moduleGraph.getModuleByUrl(moduleId);
        // console.log('first', first);
        // await recursive(urls, first);
        // console.log('id', urls);

        const tags = [];
        // Object.values(urls).forEach(v => {
        //   tags.push(getTag(v));
        // });
        return [];
    } else {
        if (!manifest) {
            throw new Error(
                'No manifest.json provided. Set build.manifest to true in your vite config.'
            );
        }

        // The reported module ID is not in it's own chunk
        if (!manifest[moduleId]) {
            return preloads;
        }

        const chunks = new Map<string, Chunk>();

        collectChunksRecursively(manifest, moduleId, chunks);

        for (const chunk of chunks.values()) {
            if (preloads.has(chunk.file)) {
                continue;
            }
            
            const isPrimaryModule = chunk.src === entrypoint;
            preloads.set(chunk.file, {
                // Only the entrypoint module is used as <script module>, everything else is <link rel=modulepreload>
                rel: isPrimaryModule ? 'module' : 'modulepreload',
                href: chunk.file,
                comment: `chunk: ${chunk.name}, isEntry: ${chunk.isEntry}`,
                isEntry: chunk.isEntry,
            });
           
            for (const cssFile of chunk.css || []) {
                // TODO In what order do we place CSS chunks in the DOM to avoid CSS ordering issues?
                if (preloads.has(cssFile)) continue;
                preloads.set(cssFile, {
                    rel: 'stylesheet',
                    href: cssFile,
                    comment: `chunk: ${chunk.name}, isEntry: ${chunk.isEntry}`,
                    isEntry: chunk.isEntry,
                });
            }

            // Assets such as svg, png imports
            for (const asset of chunk.assets || []) {
                preloads.set(asset, {
                    rel: 'preload',
                    href: asset,
                    comment: `Asset from chunk ${chunk.name}: ${chunk.file}`,
                });
            }
        }

        return preloads;
    }
}

function collectChunksRecursively(
    manifest: Manifest,
    moduleId: string,
    chunks = new Map<string, Chunk>(),
    isEntry?: boolean
) {
    const chunk = manifest[moduleId];

    if (!chunk) {
        throw new Error(`Missing chunk '${moduleId}'`);
    }

    if (chunks.has(moduleId)) {
        return;
    }

    chunks.set(moduleId, { ...chunk, isEntry: isEntry || chunk.isEntry });

    for (const importName of chunk.imports || []) {
        collectChunksRecursively(
            manifest,
            importName,
            chunks,
            isEntry || chunk.isEntry
        );
    }

    return chunks;
}

function validateEntry(entry: string, manifest: Manifest) {
    if (!manifest[entry]) {
        throw new Error(`Manifest does not contain key "${entry}"`);
    }

    if (!manifest[entry].isEntry) {
        throw new Error(`Module "${entry}" is not an entry module`);
    }
}
