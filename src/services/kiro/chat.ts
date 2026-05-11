import { CodeWhispererStreaming, AccessDeniedException, ThrottlingException, GenerateAssistantResponseCommand } from "@aws/codewhisperer-streaming-client"
import type { ChatMessage, Tool, ToolResult } from "@aws/codewhisperer-streaming-client"
import { Origin, ChatTriggerType, ToolResultStatus } from "@aws/codewhisperer-streaming-client"
import { NodeHttpHandler } from "@smithy/node-http-handler"
import https from "https"
import { UpstreamError } from "~/lib/error"
import { authStore } from "~/services/auth/store"
import type { ProviderAccount } from "~/services/auth/types"
import type { ClaudeMessage, ClaudeTool, ContentBlock } from "~/lib/translator"
import { refreshKiroAccountIfNeeded, getKiroEndpoint, getKiroRegion } from "./oauth"

const KIRO_DEFAULT_MODEL = "auto"
const KIRO_COMPLETION_TIMEOUT_MS = 120_000

const KIRO_STATIC_MODELS = [
    { id: "auto", name: "Auto" },
    { id: "claude-opus-4.7", name: "Claude Opus 4.7" },
    { id: "claude-opus-4.6", name: "Claude Opus 4.6" },
    { id: "claude-opus-4.5", name: "Claude Opus 4.5" },
    { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
    { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
    { id: "claude-sonnet-4.0", name: "Claude Sonnet 4.0" },
    { id: "claude-haiku-4.5", name: "Claude Haiku 4.5" },
    { id: "glm-5", name: "GLM-5" },
    { id: "deepseek-3.2", name: "DeepSeek 3.2" },
    { id: "minimax-m2.5", name: "MiniMax M2.5" },
    { id: "minimax-m2.1", name: "MiniMax M2.1" },
    { id: "qwen3-coder-next", name: "Qwen3 Coder Next" },
]

export interface KiroModelInfo {
    id: string
    name: string
}

function messageText(message: ClaudeMessage): string {
    if (typeof message.content === "string") return message.content
    return message.content
        .filter(block => block.type === "text")
        .map(block => block.text || "")
        .join("\n")
        .trim()
}

function toolResultsFromMessage(message: ClaudeMessage): ToolResult[] {
    if (typeof message.content === "string") return []
    return message.content
        .filter(block => block.type === "tool_result")
        .map(block => ({
            toolUseId: block.tool_use_id,
            content: [{ text: typeof block.content === "string" ? block.content : JSON.stringify(block.content || "") }],
            status: (block as any).is_error ? ToolResultStatus.ERROR : ToolResultStatus.SUCCESS,
        }))
}

function toKiroTools(tools?: ClaudeTool[]): Tool[] | undefined {
    if (!tools || tools.length === 0) return undefined
    return tools.map(tool => ({
        toolSpecification: {
            name: tool.name,
            description: tool.description,
            inputSchema: { json: tool.input_schema || { type: "object", properties: {} } },
        },
    }))
}

function toKiroMessages(messages: ClaudeMessage[], tools?: ClaudeTool[]): { history: ChatMessage[]; currentMessage: ChatMessage } {
    const history: ChatMessage[] = []
    const allTools = toKiroTools(tools)

    for (const message of messages.slice(0, -1)) {
        if (message.role === "assistant") {
            history.push({
                assistantResponseMessage: {
                    content: messageText(message),
                },
            })
            continue
        }

        const toolResults = toolResultsFromMessage(message)
        history.push({
            userInputMessage: {
                origin: Origin.AI_EDITOR,
                content: messageText(message) || "continue",
                userInputMessageContext: {
                    editorState: {},
                    ...(toolResults.length > 0 ? { toolResults } : {}),
                    ...(allTools ? { tools: allTools } : {}),
                },
            },
        })
    }

    const latest = messages[messages.length - 1]
    const latestToolResults = latest ? toolResultsFromMessage(latest) : []
    return {
        history,
        currentMessage: {
            userInputMessage: {
                origin: Origin.AI_EDITOR,
                content: latest ? messageText(latest) || "continue" : "continue",
                userInputMessageContext: {
                    editorState: {},
                    ...(latestToolResults.length > 0 ? { toolResults: latestToolResults } : {}),
                    ...(allTools ? { tools: allTools } : {}),
                },
                modelId: undefined,
            },
        },
    }
}

function safeParseJson(value: string): unknown {
    if (!value) return {}
    try {
        return JSON.parse(value)
    } catch {
        return {}
    }
}

function mapKiroError(error: unknown): never {
    const status = error instanceof AccessDeniedException ? 403 : error instanceof ThrottlingException ? 429 : 500
    const message = error instanceof Error ? error.message : String(error)
    throw new UpstreamError("kiro", status, message)
}

export function listKiroModelsForAccount(_account: ProviderAccount): Promise<KiroModelInfo[]> {
    return Promise.resolve(KIRO_STATIC_MODELS)
}

export async function createKiroCompletion(
    account: ProviderAccount,
    model: string,
    messages: ClaudeMessage[],
    tools?: ClaudeTool[],
    maxTokens?: number
) {
    const effectiveAccount = await refreshKiroAccountIfNeeded(account)
    const client = new CodeWhispererStreaming({
        region: getKiroRegion(effectiveAccount),
        endpoint: getKiroEndpoint(effectiveAccount),
        token: { token: effectiveAccount.accessToken },
        maxAttempts: 1,
        requestHandler: new NodeHttpHandler({
            httpsAgent: new https.Agent({ keepAlive: true, keepAliveMsecs: 30_000, maxSockets: 20 }),
            requestTimeout: KIRO_COMPLETION_TIMEOUT_MS,
        }),
        customUserAgent: `KiroIDE ${process.env.ANTI_API_KIRO_VERSION || "0.0.0"} anti-api`,
    })

    const { history, currentMessage } = toKiroMessages(messages, tools)
    const modelId = model || KIRO_DEFAULT_MODEL
    try {
        const response = await client.send(new GenerateAssistantResponseCommand({
            profileArn: effectiveAccount.projectId,
            conversationState: {
                conversationId: crypto.randomUUID(),
                history,
                currentMessage: {
                    userInputMessage: {
                        ...currentMessage.userInputMessage!,
                        modelId,
                    },
                },
                chatTriggerType: ChatTriggerType.MANUAL,
            },
            ...(maxTokens ? { additionalModelRequestFields: { max_tokens: maxTokens } } : {}),
        }))

        const contentBlocks: ContentBlock[] = []
        const toolInputs = new Map<string, { name: string; input: string }>()
        let text = ""

        if (!response.generateAssistantResponseResponse) {
            throw new UpstreamError("kiro", 502, "Kiro returned an empty response stream.")
        }

        for await (const event of response.generateAssistantResponseResponse) {
            if (event.assistantResponseEvent?.content) {
                text += event.assistantResponseEvent.content
            }
            if (event.toolUseEvent?.toolUseId && event.toolUseEvent.name) {
                const current = toolInputs.get(event.toolUseEvent.toolUseId) || { name: event.toolUseEvent.name, input: "" }
                current.input += event.toolUseEvent.input || ""
                toolInputs.set(event.toolUseEvent.toolUseId, current)
                if (event.toolUseEvent.stop) {
                    contentBlocks.push({
                        type: "tool_use",
                        id: event.toolUseEvent.toolUseId,
                        name: current.name,
                        input: safeParseJson(current.input),
                    })
                    toolInputs.delete(event.toolUseEvent.toolUseId)
                }
            }
            if (event.error) {
                throw new UpstreamError("kiro", 500, event.error.message || "Kiro stream error")
            }
        }

        if (text) {
            contentBlocks.unshift({ type: "text", text })
        }
        for (const [id, tool] of toolInputs.entries()) {
            contentBlocks.push({ type: "tool_use", id, name: tool.name, input: safeParseJson(tool.input) })
        }

        authStore.markSuccess("kiro", effectiveAccount.id)
        return {
            contentBlocks,
            stopReason: contentBlocks.some(block => block.type === "tool_use") ? "tool_use" : "end_turn",
            usage: {
                inputTokens: 0,
                outputTokens: 0,
            },
        }
    } catch (error) {
        if (error instanceof UpstreamError) throw error
        mapKiroError(error)
    }
}
