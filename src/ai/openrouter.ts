import { AiApiError } from '../errors.ts';
import type { AiProvider, JsonRequest, JsonResponse } from './provider.ts';

// OpenRouter exposes an OpenAI-compatible Chat Completions API. Plain fetch keeps
// this adapter dependency-free.
const BASE_URL = 'https://openrouter.ai/api/v1';
const TIMEOUT_MS = 120_000; // free models can be slow
const MAX_ATTEMPTS = 3;
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

interface ChatCompletion {
  model?: string;
  choices?: { finish_reason?: string | null; message?: { content?: string | null }; error?: { message?: string } }[];
  error?: { code?: number; message?: string };
}

export class OpenRouterProvider implements AiProvider {
  readonly name = 'openrouter';
  /** HTTP requests sent, retries included. */
  requestCount = 0;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async generateJson({ system, user, jsonSchema }: JsonRequest): Promise<JsonResponse> {
    const body = JSON.stringify({
      model: this.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0,
      response_format: { type: 'json_schema', json_schema: { name: 'notice_analysis', strict: true, schema: jsonSchema } },
      // Only route to models/endpoints that actually honor response_format.
      provider: { require_parameters: true },
    });

    for (let attempt = 1; ; attempt++) {
      let res: Response;
      this.requestCount++;
      try {
        res = await fetch(`${BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'X-Title': 'inha-notice-poc',
          },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        throw new AiApiError(`Could not reach OpenRouter: ${(err as Error).message}`, { cause: err });
      }

      const text = await res.text();
      let data: ChatCompletion;
      try {
        data = JSON.parse(text);
      } catch {
        throw new AiApiError(`OpenRouter HTTP ${res.status}: non-JSON response: ${text.slice(0, 200)}`);
      }

      // Errors arrive either as non-2xx status or as a 200 whose body/choice carries `error`.
      const errMsg = data.error?.message ?? data.choices?.[0]?.error?.message;
      const status = res.ok && errMsg ? (data.error?.code ?? 502) : res.status;
      if (!res.ok || errMsg) {
        if (RETRY_STATUSES.has(status) && attempt < MAX_ATTEMPTS) {
          const waitS = Math.min(Number(res.headers.get('retry-after')) || 2 ** attempt, 30);
          console.warn(`  [openrouter] HTTP ${status} (attempt ${attempt}/${MAX_ATTEMPTS}); retrying in ${waitS}s`);
          await new Promise((r) => setTimeout(r, waitS * 1000));
          continue;
        }
        const hint = status === 429 ? ' (free-tier rate limit: 20/min, 50/day without purchased credits)' : '';
        throw new AiApiError(`OpenRouter error ${status}${hint}: ${errMsg ?? text.slice(0, 300)}`);
      }

      const choice = data.choices?.[0];
      const finish = choice?.finish_reason ?? null;
      return {
        text: choice?.message?.content ?? '',
        // For routers like openrouter/free this is the model that actually answered.
        model: data.model ?? this.model,
        incomplete: !choice || finish !== 'stop',
        stopReason: finish,
      };
    }
  }
}
