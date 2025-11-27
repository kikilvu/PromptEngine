/**
 * PromptEngine - Prompt 增强引擎
 *
 * 核心功能：
 * 1. 与 RAG 组件交互 - 获取外部知识
 * 2. 与 Repository 交互 - 查询多个数据源
 * 3. 路由策略 - 根据用户输入选择最佳增强模式
 *
 * 架构设计：
 * - PromptEngine 是核心调度器
 * - RAG 可作为独立组件或通过 Repository 访问
 * - Repository 管理多个数据源（包括 RAG）
 */

import { RAG, RAGConfig, createRAG } from './rag';
import { Repository, QueryResult, createRepositoryWithRAG } from './repository';

// ==================== 类型定义 ====================

/**
 * Prompt 增强策略枚举
 */
export enum PromptStrategy {
    /** 零样本：直接提问，不提供示例 */
    ZeroShot = 'zero-shot',
    /** 少样本：提供示例引导模型 */
    FewShot = 'few-shot',
    /** 思维链：逐步推理 */
    ChainOfThought = 'chain-of-thought',
    /** 检索增强生成：结合外部知识（通过 RAG） */
    RAG = 'rag',
    /** 角色扮演：根据意图切换角色 */
    RoleBased = 'role-based',
    /** 思维树：探索多个推理分支 */
    TreeOfThought = 'tree-of-thought',
    /** 知识库检索：通过 Repository 查询多数据源 */
    Repository = 'repository',
    /** 自动选择：根据输入自动选择最佳策略 */
    Auto = 'auto'
}

/**
 * 角色定义
 */
export interface Role {
    id: string;
    name: string;
    description: string;
    prompt: string;
    keywords: string[];
}

/**
 * 少样本示例
 */
export interface FewShotExample {
    input: string;
    output: string;
}

/**
 * 思维链步骤
 */
export interface ChainStep {
    step: number;
    description: string;
}

/**
 * 路由规则
 */
export interface RoutingRule {
    /** 规则ID */
    id: string;
    /** 规则名称 */
    name: string;
    /** 匹配的策略 */
    strategy: PromptStrategy;
    /** 匹配条件：关键词列表 */
    keywords: string[];
    /** 匹配条件：正则表达式 */
    patterns?: RegExp[];
    /** 优先级（越高越优先） */
    priority: number;
    /** 是否启用 */
    enabled: boolean;
}

/**
 * PromptEngine 配置
 */
export interface PromptEngineConfig {
    /** 默认策略 */
    defaultStrategy: PromptStrategy;
    /** 可用角色列表 */
    roles: Role[];
    /** 少样本示例 */
    fewShotExamples: FewShotExample[];
    /** 思维链步骤模板 */
    chainSteps: ChainStep[];
    /** 路由规则 */
    routingRules: RoutingRule[];
    /** 是否启用自动路由 */
    enableAutoRouting: boolean;
}

/**
 * 增强后的 Prompt 结果
 */
export interface AugmentedPrompt {
    /** 原始用户输入 */
    originalQuery: string;
    /** 增强后的提示词 */
    augmentedPrompt: string;
    /** 使用的策略 */
    strategy: PromptStrategy;
    /** 匹配的角色（如果使用角色策略） */
    matchedRole?: Role;
    /** 检索到的上下文 */
    retrievedContext?: string;
    /** 来自 Repository 的查询结果 */
    repositoryResults?: QueryResult[];
    /** 元数据 */
    metadata: {
        processingTime: number;
        routingReason?: string;
        matchedRule?: string;
        ragUsed?: boolean;
        repositoryUsed?: boolean;
    };
}

// ==================== 默认配置 ====================

const DEFAULT_ROLES: Role[] = [
    {
        id: 'programmer',
        name: '程序员助手',
        description: '帮助解决编程问题',
        prompt: '你是一位经验丰富的高级程序员。请用专业但易懂的方式回答编程相关问题。提供代码示例时，请确保代码可运行且遵循最佳实践。',
        keywords: ['代码', '编程', '程序', 'bug', '错误', '函数', '类', 'API', 'code', 'programming', 'debug', 'function']
    },
    {
        id: 'teacher',
        name: '教师',
        description: '解释概念和教学',
        prompt: '你是一位耐心的教师。请用简单易懂的语言解释概念，使用类比和示例帮助理解。如果内容复杂，请分步骤讲解。',
        keywords: ['解释', '什么是', '为什么', '如何', '教我', '学习', 'explain', 'what is', 'why', 'how', 'teach']
    },
    {
        id: 'analyst',
        name: '分析师',
        description: '数据分析和洞察',
        prompt: '你是一位数据分析师。请提供基于数据和逻辑的分析，考虑多个角度，并给出清晰的结论和建议。',
        keywords: ['分析', '数据', '趋势', '比较', '统计', 'analyze', 'data', 'trend', 'compare', 'statistics']
    },
    {
        id: 'writer',
        name: '写作助手',
        description: '帮助写作和创意',
        prompt: '你是一位专业的写作助手。请帮助用户优化文字表达，提供创意建议，确保内容清晰、有吸引力。',
        keywords: ['写', '文章', '文案', '创意', '故事', '内容', 'write', 'article', 'content', 'story', 'creative']
    },
    {
        id: 'general',
        name: '通用助手',
        description: '通用问答',
        prompt: '你是一位知识渊博的AI助手。请根据用户的问题提供准确、有帮助的回答。',
        keywords: []
    }
];

const DEFAULT_FEW_SHOT_EXAMPLES: FewShotExample[] = [
    {
        input: '什么是变量？',
        output: '变量是编程中用于存储数据的容器。就像一个贴有标签的盒子，标签是变量名，盒子里的内容是变量的值。例如：`let age = 25;` 这里 `age` 是变量名，`25` 是它的值。'
    },
    {
        input: '如何优化代码性能？',
        output: '优化代码性能可以从以下几个方面入手：\n1. 算法优化：选择更高效的算法\n2. 减少不必要的计算：缓存重复计算的结果\n3. 内存管理：避免内存泄漏\n4. 异步处理：利用并发提高效率\n5. 代码剖析：使用性能分析工具找出瓶颈'
    }
];

const DEFAULT_CHAIN_STEPS: ChainStep[] = [
    { step: 1, description: '理解问题：首先，让我确保我理解了问题的核心。' },
    { step: 2, description: '分析要素：接下来，让我分析问题涉及的关键要素。' },
    { step: 3, description: '制定方案：基于分析，我将制定解决方案。' },
    { step: 4, description: '验证结果：最后，让我验证这个方案的可行性。' }
];

const DEFAULT_ROUTING_RULES: RoutingRule[] = [
    {
        id: 'step-by-step',
        name: '分步骤问题',
        strategy: PromptStrategy.ChainOfThought,
        keywords: ['怎么', '如何', '步骤', '过程', '流程', 'how to', 'step by step', 'process'],
        priority: 80,
        enabled: true
    },
    {
        id: 'comparison',
        name: '比较分析',
        strategy: PromptStrategy.TreeOfThought,
        keywords: ['比较', '对比', '区别', '优缺点', '哪个更好', 'compare', 'difference', 'versus', 'vs'],
        priority: 80,
        enabled: true
    },
    {
        id: 'knowledge',
        name: '需要外部知识',
        strategy: PromptStrategy.RAG,
        keywords: ['最新', '当前', '现在', '今天', '新闻', 'latest', 'current', 'today', 'news'],
        priority: 90,
        enabled: true
    },
    {
        id: 'examples',
        name: '需要示例',
        strategy: PromptStrategy.FewShot,
        keywords: ['举例', '示例', '例子', '比如', 'example', 'for instance', 'such as'],
        priority: 70,
        enabled: true
    },
    {
        id: 'search',
        name: '搜索查询',
        strategy: PromptStrategy.Repository,
        keywords: ['搜索', '查找', '查询', '找到', 'search', 'find', 'lookup', 'query'],
        priority: 85,
        enabled: true
    }
];

// ==================== PromptEngine 类 ====================

/**
 * PromptEngine - Prompt 增强引擎
 *
 * 核心调度器，负责：
 * 1. 路由策略选择
 * 2. 与 RAG 组件交互
 * 3. 与 Repository 交互
 * 4. Prompt 增强
 */
export class PromptEngine {
    private config: PromptEngineConfig;
    private rag: RAG | null = null;
    private repository: Repository | null = null;

    constructor(config?: Partial<PromptEngineConfig>) {
        this.config = {
            defaultStrategy: config?.defaultStrategy ?? PromptStrategy.Auto,
            roles: config?.roles ?? DEFAULT_ROLES,
            fewShotExamples: config?.fewShotExamples ?? DEFAULT_FEW_SHOT_EXAMPLES,
            chainSteps: config?.chainSteps ?? DEFAULT_CHAIN_STEPS,
            routingRules: config?.routingRules ?? DEFAULT_ROUTING_RULES,
            enableAutoRouting: config?.enableAutoRouting ?? true
        };
    }

    // ==================== RAG 集成 ====================

    /**
     * 设置独立的 RAG 组件
     * RAG 可以作为独立组件直接使用
     */
    setRAG(rag: RAG): void {
        this.rag = rag;
    }

    /**
     * 通过配置创建 RAG 组件
     */
    configureRAG(url: string, apiKey: string, options?: Partial<RAGConfig>): void {
        this.rag = createRAG(url, apiKey, options);
    }

    /**
     * 获取 RAG 组件（供外部直接使用）
     */
    getRAG(): RAG | null {
        // 优先返回独立的 RAG，其次从 Repository 获取
        if (this.rag) {
            return this.rag;
        }
        if (this.repository) {
            return this.repository.getRAG();
        }
        return null;
    }

    // ==================== Repository 集成 ====================

    /**
     * 设置 Repository
     * Repository 可以包含 RAG 作为数据源之一
     */
    setRepository(repository: Repository): void {
        this.repository = repository;
    }

    /**
     * 获取 Repository
     */
    getRepository(): Repository | null {
        return this.repository;
    }

    // ==================== 核心方法 ====================

    /**
     * 增强用户的 Prompt
     *
     * @param userQuery 用户原始输入
     * @param strategy 指定策略（可选，默认自动选择）
     */
    async augment(userQuery: string, strategy?: PromptStrategy): Promise<AugmentedPrompt> {
        const startTime = Date.now();
        const selectedStrategy = strategy ?? this.config.defaultStrategy;

        let result: AugmentedPrompt;

        if (selectedStrategy === PromptStrategy.Auto) {
            result = await this.autoRoute(userQuery);
        } else {
            result = await this.applyStrategy(userQuery, selectedStrategy);
        }

        result.metadata.processingTime = Date.now() - startTime;
        return result;
    }

    /**
     * 自动路由：根据用户输入和配置的规则选择最佳策略
     */
    private async autoRoute(userQuery: string): Promise<AugmentedPrompt> {
        const query = userQuery.toLowerCase();

        // 按优先级排序的规则
        const sortedRules = [...this.config.routingRules]
            .filter(rule => rule.enabled)
            .sort((a, b) => b.priority - a.priority);

        // 尝试匹配规则
        for (const rule of sortedRules) {
            if (this.matchRule(query, rule)) {
                // 检查策略是否可用
                if (this.isStrategyAvailable(rule.strategy)) {
                    const result = await this.applyStrategy(userQuery, rule.strategy);
                    result.metadata.routingReason = `匹配规则: ${rule.name}`;
                    result.metadata.matchedRule = rule.id;
                    return result;
                }
            }
        }

        // 尝试角色匹配
        const matchedRole = this.matchRole(query);
        if (matchedRole) {
            const result = await this.applyStrategy(userQuery, PromptStrategy.RoleBased);
            result.metadata.routingReason = `匹配角色: ${matchedRole.name}`;
            return result;
        }

        // 默认使用零样本
        const result = await this.applyStrategy(userQuery, PromptStrategy.ZeroShot);
        result.metadata.routingReason = '使用默认零样本策略';
        return result;
    }

    /**
     * 检查策略是否可用
     */
    private isStrategyAvailable(strategy: PromptStrategy): boolean {
        switch (strategy) {
            case PromptStrategy.RAG:
                return this.rag !== null || this.repository?.getRAG() !== null;
            case PromptStrategy.Repository:
                return this.repository !== null;
            default:
                return true;
        }
    }

    /**
     * 匹配路由规则
     */
    private matchRule(query: string, rule: RoutingRule): boolean {
        // 关键词匹配
        const keywordMatch = rule.keywords.some(kw => query.includes(kw.toLowerCase()));
        if (keywordMatch) {
            return true;
        }

        // 正则匹配
        if (rule.patterns) {
            return rule.patterns.some(pattern => pattern.test(query));
        }

        return false;
    }

    /**
     * 应用指定的增强策略
     */
    private async applyStrategy(userQuery: string, strategy: PromptStrategy): Promise<AugmentedPrompt> {
        switch (strategy) {
            case PromptStrategy.ZeroShot:
                return this.applyZeroShot(userQuery);
            case PromptStrategy.FewShot:
                return this.applyFewShot(userQuery);
            case PromptStrategy.ChainOfThought:
                return this.applyChainOfThought(userQuery);
            case PromptStrategy.RAG:
                return await this.applyRAG(userQuery);
            case PromptStrategy.RoleBased:
                return this.applyRoleBased(userQuery);
            case PromptStrategy.TreeOfThought:
                return this.applyTreeOfThought(userQuery);
            case PromptStrategy.Repository:
                return await this.applyRepository(userQuery);
            default:
                return this.applyZeroShot(userQuery);
        }
    }

    // ==================== 策略实现 ====================

    private applyZeroShot(userQuery: string): AugmentedPrompt {
        return {
            originalQuery: userQuery,
            augmentedPrompt: `请回答以下问题：\n\n${userQuery}`,
            strategy: PromptStrategy.ZeroShot,
            metadata: { processingTime: 0 }
        };
    }

    private applyFewShot(userQuery: string): AugmentedPrompt {
        const examples = this.config.fewShotExamples
            .slice(0, 3)
            .map(ex => `问：${ex.input}\n答：${ex.output}`)
            .join('\n\n');

        return {
            originalQuery: userQuery,
            augmentedPrompt: `以下是一些问答示例：

${examples}

现在请回答这个问题：
问：${userQuery}
答：`,
            strategy: PromptStrategy.FewShot,
            metadata: { processingTime: 0 }
        };
    }

    private applyChainOfThought(userQuery: string): AugmentedPrompt {
        const steps = this.config.chainSteps
            .map(s => `步骤 ${s.step}: ${s.description}`)
            .join('\n');

        return {
            originalQuery: userQuery,
            augmentedPrompt: `请按照以下步骤逐步思考并回答问题：

${steps}

问题：${userQuery}

请逐步分析并给出答案：`,
            strategy: PromptStrategy.ChainOfThought,
            metadata: { processingTime: 0 }
        };
    }

    /**
     * RAG 策略：通过 RAG 组件获取外部知识
     */
    private async applyRAG(userQuery: string): Promise<AugmentedPrompt> {
        let retrievedContext = '';
        let ragUsed = false;

        // 优先使用独立的 RAG，其次从 Repository 获取
        const rag = this.getRAG();

        if (rag) {
            try {
                const response = await rag.query({ query: userQuery });
                retrievedContext = response.firstResponse || '';
                if (response.secondResponse) {
                    retrievedContext += '\n\n' + response.secondResponse;
                }
                ragUsed = true;
            } catch (error) {
                console.error('RAG query failed:', error);
            }
        }

        const augmentedPrompt = retrievedContext
            ? `基于以下相关信息回答问题：

<retrieved_context>
${retrievedContext}
</retrieved_context>

问题：${userQuery}

请结合上述信息给出准确的回答：`
            : `请回答以下问题：\n\n${userQuery}`;

        return {
            originalQuery: userQuery,
            augmentedPrompt,
            strategy: PromptStrategy.RAG,
            retrievedContext: retrievedContext || undefined,
            metadata: { processingTime: 0, ragUsed }
        };
    }

    private applyRoleBased(userQuery: string): AugmentedPrompt {
        const matchedRole = this.matchRole(userQuery) || this.config.roles.find(r => r.id === 'general')!;

        return {
            originalQuery: userQuery,
            augmentedPrompt: `${matchedRole.prompt}

用户问题：${userQuery}

请根据你的角色定位回答：`,
            strategy: PromptStrategy.RoleBased,
            matchedRole,
            metadata: { processingTime: 0 }
        };
    }

    private applyTreeOfThought(userQuery: string): AugmentedPrompt {
        return {
            originalQuery: userQuery,
            augmentedPrompt: `请从多个角度分析以下问题：

问题：${userQuery}

分析要求：
1. 首先，列出至少3种不同的思考角度或解决方案
2. 对每种方案分析其优缺点
3. 综合评估后，选择最佳方案
4. 详细阐述选择的理由和具体实施建议

请开始你的多角度分析：`,
            strategy: PromptStrategy.TreeOfThought,
            metadata: { processingTime: 0 }
        };
    }

    /**
     * Repository 策略：通过 Repository 查询多数据源
     */
    private async applyRepository(userQuery: string): Promise<AugmentedPrompt> {
        let results: QueryResult[] = [];
        let repositoryUsed = false;

        if (this.repository) {
            try {
                results = await this.repository.query(userQuery);
                repositoryUsed = true;
            } catch (error) {
                console.error('Repository query failed:', error);
            }
        }

        let contextStr = '';
        if (results.length > 0) {
            contextStr = results
                .map((r) => `[来源: ${r.sourceName}]\n${r.content}`)
                .join('\n\n---\n\n');
        }

        const augmentedPrompt = contextStr
            ? `基于以下多个来源的信息回答问题：

<knowledge_base>
${contextStr}
</knowledge_base>

问题：${userQuery}

请综合上述信息给出全面的回答：`
            : `请回答以下问题：\n\n${userQuery}`;

        return {
            originalQuery: userQuery,
            augmentedPrompt,
            strategy: PromptStrategy.Repository,
            repositoryResults: results.length > 0 ? results : undefined,
            metadata: { processingTime: 0, repositoryUsed }
        };
    }

    // ==================== 辅助方法 ====================

    private matchRole(query: string): Role | undefined {
        const lowerQuery = query.toLowerCase();

        for (const role of this.config.roles) {
            if (role.keywords.length === 0) continue;

            for (const keyword of role.keywords) {
                if (lowerQuery.includes(keyword.toLowerCase())) {
                    return role;
                }
            }
        }

        return undefined;
    }

    // ==================== 配置方法 ====================

    addRole(role: Role): void {
        this.config.roles.push(role);
    }

    addFewShotExample(example: FewShotExample): void {
        this.config.fewShotExamples.push(example);
    }

    addRoutingRule(rule: RoutingRule): void {
        this.config.routingRules.push(rule);
    }

    setDefaultStrategy(strategy: PromptStrategy): void {
        this.config.defaultStrategy = strategy;
    }

    getRoles(): Role[] {
        return [...this.config.roles];
    }

    getRoutingRules(): RoutingRule[] {
        return [...this.config.routingRules];
    }

    getAvailableStrategies(): PromptStrategy[] {
        return Object.values(PromptStrategy);
    }
}

// ==================== 工厂函数 ====================

/**
 * 创建 PromptEngine（仅基础配置）
 */
export function createPromptEngine(config?: Partial<PromptEngineConfig>): PromptEngine {
    return new PromptEngine(config);
}

/**
 * 创建带有独立 RAG 的 PromptEngine
 */
export function createPromptEngineWithRAG(
    ragUrl: string,
    ragApiKey: string,
    config?: Partial<PromptEngineConfig>
): PromptEngine {
    const engine = new PromptEngine(config);
    engine.configureRAG(ragUrl, ragApiKey);
    return engine;
}

/**
 * 创建带有 Repository 的 PromptEngine
 * Repository 中包含 RAG 作为数据源
 */
export function createPromptEngineWithRepository(
    ragUrl: string,
    ragApiKey: string,
    config?: Partial<PromptEngineConfig>
): PromptEngine {
    const engine = new PromptEngine(config);
    const repository = createRepositoryWithRAG(ragUrl, ragApiKey);
    engine.setRepository(repository);
    return engine;
}

/**
 * 创建完整配置的 PromptEngine
 * 包含独立 RAG 和 Repository
 */
export function createFullPromptEngine(
    ragUrl: string,
    ragApiKey: string,
    config?: Partial<PromptEngineConfig>
): PromptEngine {
    const engine = new PromptEngine(config);

    // 设置独立的 RAG
    engine.configureRAG(ragUrl, ragApiKey);

    // 设置 Repository（也包含 RAG）
    const repository = createRepositoryWithRAG(ragUrl, ragApiKey);
    engine.setRepository(repository);

    return engine;
}
