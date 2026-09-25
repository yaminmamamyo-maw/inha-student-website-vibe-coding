import Anthropic from '@anthropic-ai/sdk';
import { AiApiError } from '../errors.ts';
import type { AiProvider, JsonRequest, JsonResponse } from './provider.ts';

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  /** messages.create() calls made. Retries inside the SDK (default 2) aren't visible here. */
  requestCount = 0;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async generateJson({ system, user, jsonSchema }: JsonRequest): Promise<JsonResponse> {
    let res;
    this.requestCount++;
    try {
      res = await this.client.messages.create({
        model: this.model,
        max_tokens: 16000,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { format: { type: 'json_schema', schema: jsonSchema } },
      });
    } catch (err) {
      if (err instanceof Anthropic.APIConnectionError) {
        throw new AiApiError(`Could not reach Anthropic API: ${err.message}`, { cause: err });
      }
      if (err instanceof Anthropic.APIError) {
        throw new AiApiError(`Anthropic API error ${err.status ?? ''}: ${err.message}`, { cause: err });
      }
      throw new AiApiError(`Anthropic SDK error: ${(err as Error).message}`, { cause: err });
    }

    return {
      text: res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(''),
      model: res.model,
      incomplete: res.stop_reason !== 'end_turn',
      stopReason: res.stop_reason,
    };
  }
}
