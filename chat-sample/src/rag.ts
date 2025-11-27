/**
 * RAG (Retrieval-Augmented Generation) - 检索增强生成组件
 *
 * 这是一个独立的组件，可以：
 * 1. 作为独立服务调用
 * 2. 被 Repository 集成
 * 3. 被 PromptEngine 调用
 */

// ==================== 类型定义 ====================

/**
 * RAG 配置
 */
export interface RAGConfig {
    /** API URL */
    url: string;
    /** API Key */
    apiKey: string;
    /** 超时时间（毫秒） */
    timeout?: number;
    /** 最大重试次数 */
    maxRetries?: number;
}

/**
 * RAG 查询参数
 */
export interface RAGQueryParams {
    /** 用户查询 */
    query: string;
    /** 上下文（可选） */
    context?: string;
    /** 过滤条件（可选） */
    filters?: Record<string, unknown>;
    /** 返回结果数量（可选） */
    topK?: number;
}

/**
 * RAG 响应
 */
export interface RAGResponse {
    /** 主要响应 */
    firstResponse: string;
    /** 补充响应 */
    secondResponse?: string;
    /** 检索到的文档片段 */
    retrievedChunks?: RetrievedChunk[];
    /** 元数据 */
    metadata?: {
        /** 检索耗时 */
        retrievalTime?: number;
        /** 生成耗时 */
        generationTime?: number;
        /** 相关性分数 */
        relevanceScore?: number;
    };
}

/**
 * 检索到的文档片段
 */
export interface RetrievedChunk {
    /** 文档ID */
    id: string;
    /** 内容 */
    content: string;
    /** 相关性分数 */
    score: number;
    /** 来源 */
    source?: string;
    /** 元数据 */
    metadata?: Record<string, unknown>;
}

/**
 * RAG 事件类型
 */
export type RAGEventType = 'query_start' | 'retrieval_complete' | 'generation_complete' | 'error';

/**
 * RAG 事件监听器
 */
export type RAGEventListener = (event: RAGEventType, data?: unknown) => void;

// ==================== RAG 类 ====================

/**
 * RAG 组件 - 检索增强生成
 *
 * 独立的 RAG 实现，可以：
 * - 单独使用
 * - 被 Repository 集成
 * - 被 PromptEngine 调用
 */
export class RAG {
    private config: RAGConfig;
    private listeners: RAGEventListener[] = [];

    constructor(config: RAGConfig) {
        this.config = {
            timeout: 30000,
            maxRetries: 3,
            ...config
        };
    }

    /**
     * 执行 RAG 查询
     */
    async query(params: RAGQueryParams): Promise<RAGResponse> {
        this.emit('query_start', params);

        let lastError: Error | null = null;

        for (let attempt = 0; attempt < (this.config.maxRetries ?? 3); attempt++) {
            try {
                const response = await this.executeQuery(params);
                this.emit('generation_complete', response);
                return response;
            } catch (error) {
                lastError = error as Error;
                if (attempt < (this.config.maxRetries ?? 3) - 1) {
                    await this.delay(1000 * (attempt + 1)); // 指数退避
                }
            }
        }

        this.emit('error', lastError);
        throw lastError;
    }

    /**
     * 仅执行检索（不生成）
     */
    async retrieve(query: string, topK: number = 5): Promise<RetrievedChunk[]> {
        // 这里可以单独调用检索 API
        // 目前简化实现，返回空数组
        this.emit('retrieval_complete', { query, topK });
        return [];
    }

    /**
     * 执行实际的 API 调用
     */
    private async executeQuery(params: RAGQueryParams): Promise<RAGResponse> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        try {
            const response = await fetch(this.config.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    api_key: this.config.apiKey,
                    user_query: params.query,
                    context: params.context,
                    filters: params.filters,
                    top_k: params.topK
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`RAG API error: ${response.status} ${response.statusText}`);
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data: any = await response.json();

            return {
                firstResponse: data.first_response || data.response || '',
                secondResponse: data.second_response,
                retrievedChunks: data.chunks?.map((chunk: { id: string; content: string; score: number; source?: string }) => ({
                    id: chunk.id,
                    content: chunk.content,
                    score: chunk.score,
                    source: chunk.source
                })),
                metadata: {
                    retrievalTime: data.retrieval_time,
                    generationTime: data.generation_time,
                    relevanceScore: data.relevance_score
                }
            };
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    /**
     * 添加事件监听器
     */
    on(listener: RAGEventListener): void {
        this.listeners.push(listener);
    }

    /**
     * 移除事件监听器
     */
    off(listener: RAGEventListener): void {
        this.listeners = this.listeners.filter(l => l !== listener);
    }

    /**
     * 触发事件
     */
    private emit(event: RAGEventType, data?: unknown): void {
        this.listeners.forEach(listener => listener(event, data));
    }

    /**
     * 延迟
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 更新配置
     */
    updateConfig(config: Partial<RAGConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * 获取当前配置
     */
    getConfig(): RAGConfig {
        return { ...this.config };
    }

    /**
     * 健康检查
     */
    async healthCheck(): Promise<boolean> {
        try {
            const response = await fetch(this.config.url.replace('/query', '/health'), {
                method: 'GET',
                signal: AbortSignal.timeout(5000)
            });
            return response.ok;
        } catch {
            return false;
        }
    }
}

// ==================== 工厂函数 ====================

/**
 * 创建 RAG 实例
 */
export function createRAG(url: string, apiKey: string, options?: Partial<RAGConfig>): RAG {
    return new RAG({
        url,
        apiKey,
        ...options
    });
}
