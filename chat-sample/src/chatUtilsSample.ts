import * as vscode from 'vscode';
import { PromptStrategy, createFullPromptEngine, Role, RoutingRule } from './promptEngine';
import { createRAG } from './rag';
import { createRepositoryWithRAG, DataSourceType, QueryResult } from './repository';

// RAG API 配置
const RAG_API_URL = 'http://47.79.34.150:8000/rag/query';
const RAG_API_KEY = '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';

interface RAGResponse {
	first_response: string;
	second_response: string;
}

async function callRAGApi(userQuery: string): Promise<RAGResponse> {
	const response = await fetch(RAG_API_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			api_key: RAG_API_KEY,
			user_query: userQuery
		})
	});

	if (!response.ok) {
		throw new Error(`RAG API error: ${response.status} ${response.statusText}`);
	}

	return await response.json() as RAGResponse;
}

export function registerChatLibChatParticipant(context: vscode.ExtensionContext) {
	/**
	 * 架构说明：
	 *
	 * 1. RAG 可以作为独立组件使用：
	 *    const rag = createRAG(RAG_API_URL, RAG_API_KEY);
	 *    const response = await rag.query({ query: "问题" });
	 *
	 * 2. RAG 也可以放在 Repository 里面：
	 *    const repository = createRepositoryWithRAG(RAG_API_URL, RAG_API_KEY);
	 *    const results = await repository.query("问题");
	 *
	 * 3. PromptEngine 与 RAG、Repository 交互，决定路由策略：
	 *    - createPromptEngineWithRAG(): 使用独立 RAG
	 *    - createPromptEngineWithRepository(): RAG 在 Repository 里
	 *    - createFullPromptEngine(): 同时使用独立 RAG 和 Repository
	 */

	// 方式1: 使用独立 RAG 的 PromptEngine
	// const promptEngine = createPromptEngineWithRAG(RAG_API_URL, RAG_API_KEY);

	// 方式2: 使用 Repository（包含 RAG）的 PromptEngine
	// const promptEngine = createPromptEngineWithRepository(RAG_API_URL, RAG_API_KEY);

	// 方式3: 完整模式 - 同时有独立 RAG 和 Repository
	const promptEngine = createFullPromptEngine(RAG_API_URL, RAG_API_KEY);

	// 你也可以直接获取 RAG 或 Repository 组件单独使用
	const rag = promptEngine.getRAG();
	const repository = promptEngine.getRepository();

	const handler: vscode.ChatRequestHandler = async (request: vscode.ChatRequest, chatContext: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken) => {
		// 命令处理
		if (request.command === 'list') {
			stream.markdown(`## 📋 系统信息\n\n`);

			// 显示策略
			stream.markdown(`### 可用的 Prompt 增强策略：\n\n`);
			promptEngine.getAvailableStrategies().forEach(strategy => {
				stream.markdown(`- \`${strategy}\`\n`);
			});

			// 显示路由规则
			stream.markdown(`\n### 路由规则：\n\n`);
			promptEngine.getRoutingRules().forEach(rule => {
				stream.markdown(`- **${rule.name}** → \`${rule.strategy}\` (优先级: ${rule.priority})\n`);
			});

			// 显示角色
			stream.markdown(`\n### 可用的角色：\n\n`);
			promptEngine.getRoles().forEach(role => {
				stream.markdown(`- **${role.name}** (${role.id}): ${role.description}\n`);
			});

			// 显示数据源
			if (repository) {
				stream.markdown(`\n### 数据源：\n\n`);
				const stats = repository.getStats();
				stream.markdown(`- 总数: ${stats.total}, 已启用: ${stats.enabled}\n`);
				Object.entries(stats.byType).forEach(([type, count]) => {
					stream.markdown(`- ${type}: ${count}\n`);
				});
			}

			// 显示 RAG 状态
			stream.markdown(`\n### 组件状态：\n\n`);
			stream.markdown(`- RAG: ${rag ? '✅ 已配置' : '❌ 未配置'}\n`);
			stream.markdown(`- Repository: ${repository ? '✅ 已配置' : '❌ 未配置'}\n`);

			return;
		}

		// 解析策略命令
		let strategy: PromptStrategy | undefined;
		if (request.command) {
			const commandToStrategy: Record<string, PromptStrategy> = {
				'zero': PromptStrategy.ZeroShot,
				'few': PromptStrategy.FewShot,
				'cot': PromptStrategy.ChainOfThought,
				'rag': PromptStrategy.RAG,
				'role': PromptStrategy.RoleBased,
				'tot': PromptStrategy.TreeOfThought,
				'repo': PromptStrategy.Repository,
				'auto': PromptStrategy.Auto
			};
			strategy = commandToStrategy[request.command];
		}

		try {
			// 使用 PromptEngine 增强 prompt（PromptEngine 会根据路由策略与 RAG/Repository 交互）
			const augmentedResult = await promptEngine.augment(request.prompt, strategy);

			// 显示增强信息
			stream.markdown(`> 📝 **策略**: \`${augmentedResult.strategy}\`\n`);
			if (augmentedResult.matchedRole) {
				stream.markdown(`> 🎭 **角色**: ${augmentedResult.matchedRole.name}\n`);
			}
			if (augmentedResult.metadata.routingReason) {
				stream.markdown(`> 🔀 **路由原因**: ${augmentedResult.metadata.routingReason}\n`);
			}
			if (augmentedResult.metadata.ragUsed) {
				stream.markdown(`> 🔍 **RAG**: 已使用\n`);
			}
			if (augmentedResult.metadata.repositoryUsed) {
				stream.markdown(`> 📚 **Repository**: 已使用\n`);
			}
			stream.markdown(`\n---\n\n`);

			// 调用 RAG API 获取最终回答
			const ragResponse = await callRAGApi(augmentedResult.augmentedPrompt);

			// 输出响应
			stream.markdown('**🤖 AI 回答:**\n\n');
			stream.markdown(ragResponse.first_response);

			if (ragResponse.second_response) {
				stream.markdown('\n\n---\n\n');
				stream.markdown('**💡 补充说明:**\n\n');
				stream.markdown(ragResponse.second_response);
			}

			// 显示检索到的上下文（如果有）
			if (augmentedResult.retrievedContext) {
				stream.markdown('\n\n---\n\n');
				stream.markdown('<details><summary>📄 检索到的上下文</summary>\n\n');
				stream.markdown(augmentedResult.retrievedContext);
				stream.markdown('\n\n</details>\n');
			}

			// 显示 Repository 结果（如果有）
			if (augmentedResult.repositoryResults && augmentedResult.repositoryResults.length > 0) {
				stream.markdown('\n\n---\n\n');
				stream.markdown('<details><summary>📚 知识库查询结果</summary>\n\n');
				augmentedResult.repositoryResults.forEach((result, i) => {
					stream.markdown(`**[${i + 1}] ${result.sourceName}** (相关度: ${result.score.toFixed(2)})\n`);
					stream.markdown(`${result.content}\n\n`);
				});
				stream.markdown('</details>\n');
			}

			// 显示处理时间
			stream.markdown(`\n---\n> ⏱️ 处理时间: ${augmentedResult.metadata.processingTime}ms\n`);

		} catch (err) {
			if (err instanceof Error) {
				stream.markdown(`❌ **错误**: ${err.message}`);
			} else {
				stream.markdown('❌ 发生未知错误');
			}
		}

		return;
	};

	const ragParticipant = vscode.chat.createChatParticipant('chat-tools-sample.RAGtools', handler);
	ragParticipant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'PEG.png');
	context.subscriptions.push(ragParticipant);
}