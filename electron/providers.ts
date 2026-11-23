import type { ModelConfig } from "../src/shared";
export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}
export interface Generation {
  text: string;
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}
export const estimateTokens = (text: string) =>
  Math.ceil(
    [...text].reduce((n, c) => n + (c.charCodeAt(0) > 127 ? 1.5 : 0.3), 0),
  );
export async function* sse(
  body: ReadableStream<Uint8Array>,
  onDone = () => {},
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let pos;
      while ((pos = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, pos);
        buffer = buffer.slice(pos + 2);
        const data = block
          .split("\n")
          .filter((x) => x.startsWith("data:"))
          .map((x) => x.slice(5).trimStart())
          .join("\n");
        if (data === "[DONE]") onDone();
        if (data && data !== "[DONE]") {
          try {
            yield JSON.parse(data);
          } catch {
            throw new ApiError("模型返回了无法解析的流式数据");
          }
        }
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}
export async function generate(
  config: ModelConfig,
  key: string,
  messages: Message[],
  signal: AbortSignal,
  onDelta: (text: string) => void = () => {},
  fetcher: typeof fetch = fetch,
): Promise<Generation> {
  const input = estimateTokens(messages.map((m) => m.content).join(""));
  if (input + config.outputLimit > config.contextLimit)
    throw new ApiError(
      "上下文超过该模型限制，请提高已配置的上下文限制或缩短资料",
    );
  const base = config.baseUrl.replace(/\/+$/, "");
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
  const chat = messages.filter((m) => m.role !== "system");
  let url: string;
  let body: any;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (config.protocol === "openai") {
    url = `${base}/chat/completions`;
    headers.authorization = `Bearer ${key}`;
    body = {
      model: config.model,
      messages,
      stream: true,
      max_tokens: config.outputLimit,
      stream_options: { include_usage: true },
    };
  } else if (config.protocol === "anthropic") {
    url = `${base}/messages`;
    headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model: config.model,
      system,
      messages: chat,
      max_tokens: config.outputLimit,
      stream: true,
    };
  } else {
    url = `${base}/models/${encodeURIComponent(config.model.replace(/^models\//, ""))}:streamGenerateContent?alt=sse`;
    headers["x-goog-api-key"] = key;
    body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: chat.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig: { maxOutputTokens: config.outputLimit },
    };
  }
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
      redirect: "error",
    });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new ApiError("连接模型失败，请检查 API 地址、网络或代理配置", true);
  }
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as any;
    const code = String(error?.error?.code || error?.error?.type || "");
    const noBalance =
      response.status === 402 ||
      /insufficient_quota|insufficient_balance|credit_balance|billing_hard_limit/i.test(
        code,
      );
    throw new ApiError(
      response.status === 401 || response.status === 403
        ? "模型鉴权失败，请检查密钥与权限"
        : noBalance
          ? "模型账户余额不足"
          : `模型接口返回 HTTP ${response.status}`,
      !noBalance && (response.status === 429 || response.status >= 500),
    );
  }
  if (!response.body) throw new ApiError("模型返回了空响应");
  let text = "";
  let inputTokens = input;
  let outputTokens = 0;
  let estimated = true;
  let truncated = false;
  let finished = false;
  try {
    for await (const event of sse(response.body, () => {
      finished = true;
    })) {
      signal.throwIfAborted();
      let delta = "";
      if (event.error || event.type === "error")
        throw new ApiError("模型流式输出中断或服务返回错误");
      if (config.protocol === "openai") {
        delta = event.choices?.[0]?.delta?.content || "";
        finished ||= !!event.choices?.[0]?.finish_reason;
        truncated ||= event.choices?.[0]?.finish_reason === "length";
        if (event.usage) {
          inputTokens = event.usage.prompt_tokens ?? inputTokens;
          outputTokens = event.usage.completion_tokens ?? 0;
          estimated = false;
        }
      } else if (config.protocol === "anthropic") {
        finished ||=
          event.type === "message_stop" || !!event.delta?.stop_reason;
        if (
          event.type === "content_block_delta" &&
          event.delta?.type === "text_delta"
        )
          delta = event.delta.text;
        if (event.message?.usage) {
          inputTokens = event.message.usage.input_tokens;
          estimated = false;
        }
        if (event.usage?.output_tokens !== undefined)
          outputTokens = event.usage.output_tokens;
        truncated ||= event.delta?.stop_reason === "max_tokens";
      } else {
        finished ||= !!event.candidates?.[0]?.finishReason;
        delta = (event.candidates?.[0]?.content?.parts || [])
          .filter((x: any) => !x.thought)
          .map((x: any) => x.text || "")
          .join("");
        truncated ||= event.candidates?.[0]?.finishReason === "MAX_TOKENS";
        if (event.usageMetadata) {
          inputTokens = event.usageMetadata.promptTokenCount || inputTokens;
          outputTokens =
            (event.usageMetadata.candidatesTokenCount || 0) +
            (event.usageMetadata.thoughtsTokenCount || 0);
          estimated = false;
        }
      }
      if (typeof delta === "string" && delta) {
        text += delta;
        onDelta(delta);
      }
    }
  } catch (e) {
    if (signal.aborted || e instanceof ApiError) throw e;
    throw new ApiError("模型输出连接中断，已保留草稿", true);
  }
  if (!text.trim())
    throw new ApiError("模型未返回正文，可能被服务拒绝或接口格式不兼容");
  if (truncated)
    throw new ApiError("输出达到模型上限，草稿已保留；请提高输出限制后重试");
  if (!finished)
    throw new ApiError("流式响应提前结束，未收到完成标志；已保留草稿", true);
  return {
    text,
    inputTokens,
    outputTokens: estimated ? estimateTokens(text) : outputTokens,
    estimated,
  };
}
export function parseJSON(text: string) {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(stripped);
}
