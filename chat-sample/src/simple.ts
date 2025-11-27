import * as vscode from 'vscode';

const PEG_NAMES_COMMAND_ID = 'peg.namesInEditor';
const PEG_PARTICIPANT_ID = 'chat-sample.PEG';

interface IPEGChatResult extends vscode.ChatResult {
	metadata: {
		command: string;
	}
}

export function registerSimpleParticipant(context: vscode.ExtensionContext) {

	// Define a PEG (PromptEngine) chat handler.
	const handler: vscode.ChatRequestHandler = async (request: vscode.ChatRequest, context: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<IPEGChatResult> => {
		// To talk to an LLM in your subcommand handler implementation, your
		// extension can use VS Code's `requestChatAccess` API to access the Copilot API.
		// The GitHub Copilot Chat extension implements this provider.
		if (request.command === 'teach') {
			stream.progress('Loading PEG usage guide...');

			// 显示 PEG 的完整使用指南
			stream.markdown(`# 🚀 PromptEngine (PEG) 使用指南

PEG 是一个强大的 Prompt 增强引擎，支持多种策略和功能。

---

## 🎯 可用的聊天参与者

| 参与者 | 说明 |
|---------|------|
| \`@PEG\` | 基础 PEG 参与者，提供智能对话 |
| \`@RAGtools\` | RAG 增强版，支持多种 Prompt 策略 |
| \`@tools\` | 工具调用参与者 |

---

## 📝 @RAGtools 命令列表

### 基础命令
- \`/list\` - 查看所有可用策略、角色和数据源

### Prompt 策略命令
| 命令 | 策略 | 说明 |
|------|------|------|
| \`/zero\` | Zero-Shot | 直接提问，不提供示例 |
| \`/few\` | Few-Shot | 提供示例引导模型 |
| \`/cot\` | Chain-of-Thought | 逐步推理，适合复杂问题 |
| \`/rag\` | RAG | 检索增强生成，结合外部知识 |
| \`/role\` | Role-Based | 根据意图自动切换角色 |
| \`/tree\` | Tree-of-Thought | 探索多个推理分支 |
| \`/repo\` | Repository | 查询多个数据源 |
| \`/auto\` | Auto | 自动选择最佳策略 |

---

## 🏭 架构组件

### 1️⃣ RAG 组件
独立的检索增强生成组件，连接外部知识库。

### 2️⃣ Repository 组件
管理多个数据源，支持：
- RAG API
- 本地文件
- 外部 API
- 内存缓存
- 向量数据库

### 3️⃣ PromptEngine 核心
调度器，负责：
- 路由策略选择
- Prompt 增强
- 角色匹配
- 与 RAG/Repository 交互

---

## 👥 内置角色

| 角色 | 触发关键词 |
|------|------------|
| 💻 程序员助手 | 代码, 编程, bug, 函数, API |
| 👩‍🏫 教师 | 解释, 什么是, 为什么, 如何 |
| 📊 分析师 | 分析, 数据, 趋势, 比较 |
| ✍️ 写作助手 | 写, 文章, 文案, 创意 |
| 🤖 通用助手 | 默认角色 |

---

## 💡 使用示例

\`\`\`
@RAGtools /auto 如何使用 Python 实现链表？
@RAGtools /cot 比较 React 和 Vue 的优缺点
@RAGtools /rag 最新的 TypeScript 特性有哪些？
@RAGtools /role 帮我分析这段代码的性能
\`\`\`

---

## ⚙️ 路由规则（自动模式）

当使用 \`/auto\` 时，系统会根据关键词自动选择：

| 关键词 | 触发策略 |
|--------|----------|
| 怎么, 如何, 步骤 | Chain-of-Thought |
| 比较, 对比, 区别 | Tree-of-Thought |
| 最新, 当前, 新闻 | RAG |
| 举例, 示例 | Few-Shot |
| 搜索, 查找 | Repository |

---

有任何问题，直接向我提问即可！ 🎉
`);

			logger.logUsage('request', { kind: 'teach' });
			return { metadata: { command: 'teach' } };
		} else {
			try {
				const messages = [
					vscode.LanguageModelChatMessage.User(`You are PromptEngine (PEG)! Think carefully and step by step.
                        Your job is to explain computer science concepts in a clear and engaging way. Always start your response by stating what concept you are explaining. Always include code samples.`),
					vscode.LanguageModelChatMessage.User(request.prompt)
				];

				const chatResponse = await request.model.sendRequest(messages, {}, token);
				for await (const fragment of chatResponse.text) {
					// Process the output from the language model
					stream.markdown(fragment);
				}
			} catch (err) {
				handleError(logger, err, stream);
			}

			logger.logUsage('request', { kind: '' });
			return { metadata: { command: '' } };
		}
	};

	// Chat participants appear as top-level options in the chat input
	// when you type `@`, and can contribute sub-commands in the chat input
	// that appear when you type `/`.
	const peg = vscode.chat.createChatParticipant(PEG_PARTICIPANT_ID, handler);
	peg.iconPath = vscode.Uri.joinPath(context.extensionUri, 'PEG.png');

	const logger = vscode.env.createTelemetryLogger({
		sendEventData(eventName, data) {
			// Capture event telemetry
			console.log(`Event: ${eventName}`);
			console.log(`Data: ${JSON.stringify(data)}`);
		},
		sendErrorData(error, data) {
			// Capture error telemetry
			console.error(`Error: ${error}`);
			console.error(`Data: ${JSON.stringify(data)}`);
		}
	});

	context.subscriptions.push(peg.onDidReceiveFeedback((feedback: vscode.ChatResultFeedback) => {
		// Log chat result feedback to be able to compute the success matric of the participant
		// unhelpful / totalRequests is a good success metric
		logger.logUsage('chatResultFeedback', {
			kind: feedback.kind
		});
	}));

	context.subscriptions.push(
		peg,
		// Register the command handler for the /play followup
		vscode.commands.registerTextEditorCommand(PEG_NAMES_COMMAND_ID, async (textEditor: vscode.TextEditor) => {
			// Replace all variables in active editor with creative names using PEG
			const text = textEditor.document.getText();

			let chatResponse: vscode.LanguageModelChatResponse | undefined;
			try {
				// Use gpt-4o since it is fast and high quality.
				const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
				if (!model) {
					console.log('Model not found. Please make sure the GitHub Copilot Chat extension is installed and enabled.');
					return;
				}

				const messages = [
					vscode.LanguageModelChatMessage.User(`You are PromptEngine (PEG)! Think carefully and step by step.
                    Your job is to replace all variable names in the following code with creative, descriptive variable names. Be creative. IMPORTANT respond just with code. Do not use markdown!`),
					vscode.LanguageModelChatMessage.User(text)
				];
				chatResponse = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);

			} catch (err) {
				if (err instanceof vscode.LanguageModelError) {
					console.log(err.message, err.code, err.cause);
				} else {
					throw err;
				}
				return;
			}

			// Clear the editor content before inserting new content
			await textEditor.edit(edit => {
				const start = new vscode.Position(0, 0);
				const end = new vscode.Position(textEditor.document.lineCount - 1, textEditor.document.lineAt(textEditor.document.lineCount - 1).text.length);
				edit.delete(new vscode.Range(start, end));
			});

			// Stream the code into the editor as it is coming in from the Language Model
			try {
				for await (const fragment of chatResponse.text) {
					await textEditor.edit(edit => {
						const lastLine = textEditor.document.lineAt(textEditor.document.lineCount - 1);
						const position = new vscode.Position(lastLine.lineNumber, lastLine.text.length);
						edit.insert(position, fragment);
					});
				}
			} catch (err) {
				// async response stream may fail, e.g network interruption or server side error
				await textEditor.edit(edit => {
					const lastLine = textEditor.document.lineAt(textEditor.document.lineCount - 1);
					const position = new vscode.Position(lastLine.lineNumber, lastLine.text.length);
					edit.insert(position, (err as Error).message);
				});
			}
		}),
	);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleError(logger: vscode.TelemetryLogger, err: any, stream: vscode.ChatResponseStream): void {
	// making the chat request might fail because
	// - model does not exist
	// - user consent not given
	// - quote limits exceeded
	logger.logError(err);

	if (err instanceof vscode.LanguageModelError) {
		console.log(err.message, err.code, err.cause);
		if (err.cause instanceof Error && err.cause.message.includes('off_topic')) {
			stream.markdown(vscode.l10n.t('I\'m sorry, I can only explain computer science concepts.'));
		}
	} else {
		// re-throw other errors so they show up in the UI
		throw err;
	}
}
