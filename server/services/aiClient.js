// AI client wrapper. Gemini is the primary provider (free tier), but that free tier is
// only 5 requests/minute and 20/day per model — easy to blow through with a single
// multi-step job (eligibility + resume tailoring + extraction + cold email + referral can
// be 5+ Gemini calls). On a 429 (quota) or 503 (overloaded) error, falls back to
// OpenRouter if OPENROUTER_API_KEY is configured, instead of failing the whole job.
import { GoogleGenerativeAI } from '@google/generative-ai';
import { parseJsonResponse } from './json.js';

const RETRYABLE_STATUS_PATTERN = /\[(429|503)\b/;

// OpenRouter's free models share a global rate-limit pool per model, not per account —
// any individual one can be temporarily 429'd regardless of your own usage. So instead
// of trusting a single hardcoded default, try a short list of known-working free models
// in order (whichever is configured via OPENROUTER_MODEL goes first).
const FALLBACK_FREE_MODELS = [
  'openai/gpt-oss-20b:free',
  'nvidia/nemotron-nano-9b-v2:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen3-coder:free'
];

export class AiClient {
  constructor({
    provider,
    geminiApiKey,
    geminiModel,
    openrouterApiKey,
    openrouterModel
  }) {
    this.provider = provider || 'gemini';
    this.geminiApiKey = geminiApiKey;
    this.geminiModel = geminiModel || 'gemini-2.5-flash';
    this.openrouterApiKey = openrouterApiKey;
    this.openrouterModels = [
      ...new Set([openrouterModel, ...FALLBACK_FREE_MODELS].filter(Boolean))
    ];
  }

  async generateJson(prompt, label) {
    console.log(`AI request [${label}]: prompt length ${prompt.length} chars`);
    const rawText = await this.generateText(prompt);
    console.log(`AI response [${label}]: ${rawText.slice(0, 200).replace(/\n/g, ' ')}...`);
    return parseJsonResponse(rawText, label);
  }

  async generateText(prompt) {
    if (this.provider !== 'gemini') {
      throw new Error(`Unsupported AI_PROVIDER "${this.provider}". Use "gemini" for Phase 1.`);
    }

    try {
      return await this.generateWithGemini(prompt);
    } catch (error) {
      if (!this.openrouterApiKey || !RETRYABLE_STATUS_PATTERN.test(error.message)) {
        throw error;
      }
      console.warn(`Gemini unavailable (${error.message.slice(0, 80)}...), falling back to OpenRouter.`);
      return await this.generateWithOpenRouter(prompt);
    }
  }

  async generateWithGemini(prompt) {
    if (!this.geminiApiKey) {
      throw new Error('GEMINI_API_KEY is missing. Add it to .env before running AI steps.');
    }

    const genAI = new GoogleGenerativeAI(this.geminiApiKey);
    const model = genAI.getGenerativeModel({
      model: this.geminiModel,
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json'
      }
    });

    const result = await model.generateContent(prompt);
    return result.response.text();
  }

  async generateWithOpenRouter(prompt) {
    const errors = [];
    for (const model of this.openrouterModels) {
      try {
        return await this.callOpenRouterModel(prompt, model);
      } catch (error) {
        errors.push(`${model}: ${error.message}`);
        console.warn(`OpenRouter model ${model} failed, trying next: ${error.message.slice(0, 100)}`);
      }
    }
    throw new Error(`All OpenRouter models failed.\n${errors.join('\n')}`);
  }

  async callOpenRouterModel(prompt, model) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.openrouterApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          {
            role: 'user',
            content: `${prompt}\n\nRespond with only the JSON object, no markdown fences, no commentary.`
          }
        ]
      })
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`request failed (${response.status}): ${errorBody.slice(0, 200)}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('response had no content');
    }
    return content;
  }
}
