/**
 * Repository - 知识库管理层
 *
 * 管理多个数据源，包括：
 * 1. RAG 组件（可选集成）
 * 2. 本地知识库
 * 3. 外部 API
 * 4. 文件系统
 */

import { RAG, RAGConfig, RAGResponse, RetrievedChunk, createRAG } from './rag';

// ==================== 类型定义 ====================

/**
 * 数据源类型
 */
export enum DataSourceType {
    /** RAG 服务 */
    RAG = 'rag',
    /** 本地文件 */
    LocalFile = 'local_file',
    /** 外部 API */
    ExternalAPI = 'external_api',
    /** 内存缓存 */
    Memory = 'memory',
    /** 向量数据库 */
    VectorDB = 'vector_db'
}

/**
 * 数据源配置
 */
export interface DataSource {
    /** 数据源ID */
    id: string;
    /** 数据源名称 */
    name: string;
    /** 数据源类型 */
    type: DataSourceType;
    /** 是否启用 */
    enabled: boolean;
    /** 优先级（越高越优先） */
    priority: number;
    /** 配置 */
    config: Record<string, unknown>;
}

/**
 * 查询结果
 */
export interface QueryResult {
    /** 来源数据源ID */
    sourceId: string;
    /** 来源数据源名称 */
    sourceName: string;
    /** 内容 */
    content: string;
    /** 相关性分数 */
    score: number;
    /** 元数据 */
    metadata?: Record<string, unknown>;
}

/**
 * Repository 配置
 */
export interface RepositoryConfig {
    /** 数据源列表 */
    dataSources: DataSource[];
    /** 是否启用缓存 */
    enableCache: boolean;
    /** 缓存过期时间（毫秒） */
    cacheExpiry: number;
    /** 最大返回结果数 */
    maxResults: number;
}

/**
 * 缓存条目
 */
interface CacheEntry {
    results: QueryResult[];
    timestamp: number;
}

// ==================== Repository 类 ====================

/**
 * Repository - 知识库管理
 *
 * 统一管理多个数据源，提供统一的查询接口
 */
export class Repository {
    private config: RepositoryConfig;
    private dataSources: Map<string, DataSource> = new Map();
    private ragInstances: Map<string, RAG> = new Map();
    private cache: Map<string, CacheEntry> = new Map();

    constructor(config?: Partial<RepositoryConfig>) {
        this.config = {
            dataSources: config?.dataSources ?? [],
            enableCache: config?.enableCache ?? true,
            cacheExpiry: config?.cacheExpiry ?? 5 * 60 * 1000, // 5分钟
            maxResults: config?.maxResults ?? 10
        };

        // 初始化数据源
        this.config.dataSources.forEach(ds => this.addDataSource(ds));
    }

    /**
     * 添加数据源
     */
    addDataSource(dataSource: DataSource): void {
        this.dataSources.set(dataSource.id, dataSource);

        // 如果是 RAG 类型，创建 RAG 实例
        if (dataSource.type === DataSourceType.RAG && dataSource.enabled) {
            const ragConfig = dataSource.config as unknown as RAGConfig;
            this.ragInstances.set(dataSource.id, createRAG(ragConfig.url, ragConfig.apiKey, ragConfig));
        }
    }

    /**
     * 移除数据源
     */
    removeDataSource(id: string): void {
        this.dataSources.delete(id);
        this.ragInstances.delete(id);
    }

    /**
     * 启用/禁用数据源
     */
    setDataSourceEnabled(id: string, enabled: boolean): void {
        const ds = this.dataSources.get(id);
        if (ds) {
            ds.enabled = enabled;
        }
    }

    /**
     * 查询所有启用的数据源
     */
    async query(query: string, options?: { sourceIds?: string[]; maxResults?: number }): Promise<QueryResult[]> {
        // 检查缓存
        const cacheKey = this.getCacheKey(query, options?.sourceIds);
        if (this.config.enableCache) {
            const cached = this.getFromCache(cacheKey);
            if (cached) {
                return cached;
            }
        }

        // 获取要查询的数据源
        const sources = this.getEnabledSources(options?.sourceIds);

        // 并行查询所有数据源
        const results = await Promise.all(
            sources.map(source => this.querySource(source, query))
        );

        // 合并并排序结果
        let mergedResults = results
            .flat()
            .sort((a, b) => b.score - a.score)
            .slice(0, options?.maxResults ?? this.config.maxResults);

        // 存入缓存
        if (this.config.enableCache) {
            this.setCache(cacheKey, mergedResults);
        }

        return mergedResults;
    }

    /**
     * 仅查询 RAG 数据源
     */
    async queryRAG(query: string, sourceId?: string): Promise<RAGResponse | null> {
        const ragSources = Array.from(this.dataSources.values())
            .filter(ds => ds.type === DataSourceType.RAG && ds.enabled)
            .sort((a, b) => b.priority - a.priority);

        if (ragSources.length === 0) {
            return null;
        }

        const targetSource = sourceId
            ? ragSources.find(ds => ds.id === sourceId)
            : ragSources[0];

        if (!targetSource) {
            return null;
        }

        const rag = this.ragInstances.get(targetSource.id);
        if (!rag) {
            return null;
        }

        return await rag.query({ query });
    }

    /**
     * 获取 RAG 实例（供外部直接使用）
     */
    getRAG(sourceId?: string): RAG | null {
        if (sourceId) {
            return this.ragInstances.get(sourceId) ?? null;
        }

        // 返回第一个启用的 RAG 实例
        const ragSource = Array.from(this.dataSources.values())
            .find(ds => ds.type === DataSourceType.RAG && ds.enabled);

        if (ragSource) {
            return this.ragInstances.get(ragSource.id) ?? null;
        }

        return null;
    }

    /**
     * 查询单个数据源
     */
    private async querySource(source: DataSource, query: string): Promise<QueryResult[]> {
        try {
            switch (source.type) {
                case DataSourceType.RAG:
                    return await this.queryRAGSource(source, query);
                case DataSourceType.Memory:
                    return this.queryMemorySource(source, query);
                case DataSourceType.LocalFile:
                    return await this.queryLocalFileSource(source, query);
                default:
                    return [];
            }
        } catch (error) {
            console.error(`Error querying source ${source.id}:`, error);
            return [];
        }
    }

    /**
     * 查询 RAG 数据源
     */
    private async queryRAGSource(source: DataSource, query: string): Promise<QueryResult[]> {
        const rag = this.ragInstances.get(source.id);
        if (!rag) {
            return [];
        }

        const response = await rag.query({ query });

        const results: QueryResult[] = [];

        if (response.firstResponse) {
            results.push({
                sourceId: source.id,
                sourceName: source.name,
                content: response.firstResponse,
                score: response.metadata?.relevanceScore ?? 1.0,
                metadata: { type: 'first_response' }
            });
        }

        if (response.secondResponse) {
            results.push({
                sourceId: source.id,
                sourceName: source.name,
                content: response.secondResponse,
                score: (response.metadata?.relevanceScore ?? 1.0) * 0.8,
                metadata: { type: 'second_response' }
            });
        }

        // 添加检索到的片段
        response.retrievedChunks?.forEach((chunk, index) => {
            results.push({
                sourceId: source.id,
                sourceName: source.name,
                content: chunk.content,
                score: chunk.score,
                metadata: { type: 'chunk', chunkId: chunk.id, index }
            });
        });

        return results;
    }

    /**
     * 查询内存数据源
     */
    private queryMemorySource(source: DataSource, query: string): QueryResult[] {
        const data = source.config.data as Array<{ content: string; keywords?: string[] }>;
        if (!Array.isArray(data)) {
            return [];
        }

        const queryLower = query.toLowerCase();
        return data
            .filter(item => {
                const contentMatch = item.content.toLowerCase().includes(queryLower);
                const keywordMatch = item.keywords?.some(kw => queryLower.includes(kw.toLowerCase()));
                return contentMatch || keywordMatch;
            })
            .map((item, index) => ({
                sourceId: source.id,
                sourceName: source.name,
                content: item.content,
                score: 0.5 + (0.5 / (index + 1)), // 简单的分数计算
                metadata: { type: 'memory' }
            }));
    }

    /**
     * 查询本地文件数据源（占位实现）
     */
    private async queryLocalFileSource(source: DataSource, query: string): Promise<QueryResult[]> {
        // TODO: 实现本地文件搜索
        return [];
    }

    /**
     * 获取启用的数据源
     */
    private getEnabledSources(sourceIds?: string[]): DataSource[] {
        let sources = Array.from(this.dataSources.values())
            .filter(ds => ds.enabled);

        if (sourceIds && sourceIds.length > 0) {
            sources = sources.filter(ds => sourceIds.includes(ds.id));
        }

        return sources.sort((a, b) => b.priority - a.priority);
    }

    /**
     * 生成缓存键
     */
    private getCacheKey(query: string, sourceIds?: string[]): string {
        const sourceKey = sourceIds ? sourceIds.sort().join(',') : 'all';
        return `${query}::${sourceKey}`;
    }

    /**
     * 从缓存获取
     */
    private getFromCache(key: string): QueryResult[] | null {
        const entry = this.cache.get(key);
        if (!entry) {
            return null;
        }

        if (Date.now() - entry.timestamp > this.config.cacheExpiry) {
            this.cache.delete(key);
            return null;
        }

        return entry.results;
    }

    /**
     * 设置缓存
     */
    private setCache(key: string, results: QueryResult[]): void {
        this.cache.set(key, {
            results,
            timestamp: Date.now()
        });
    }

    /**
     * 清除缓存
     */
    clearCache(): void {
        this.cache.clear();
    }

    /**
     * 获取所有数据源
     */
    getDataSources(): DataSource[] {
        return Array.from(this.dataSources.values());
    }

    /**
     * 获取数据源统计
     */
    getStats(): { total: number; enabled: number; byType: Record<string, number> } {
        const sources = Array.from(this.dataSources.values());
        const byType: Record<string, number> = {};

        sources.forEach(ds => {
            byType[ds.type] = (byType[ds.type] || 0) + 1;
        });

        return {
            total: sources.length,
            enabled: sources.filter(ds => ds.enabled).length,
            byType
        };
    }
}

// ==================== 工厂函数 ====================

/**
 * 创建 Repository 实例
 */
export function createRepository(config?: Partial<RepositoryConfig>): Repository {
    return new Repository(config);
}

/**
 * 创建带有 RAG 的 Repository
 */
export function createRepositoryWithRAG(
    ragUrl: string,
    ragApiKey: string,
    ragOptions?: Partial<RAGConfig>
): Repository {
    const repository = new Repository({
        dataSources: [
            {
                id: 'default-rag',
                name: 'Default RAG Service',
                type: DataSourceType.RAG,
                enabled: true,
                priority: 100,
                config: {
                    url: ragUrl,
                    apiKey: ragApiKey,
                    ...ragOptions
                }
            }
        ]
    });

    return repository;
}
