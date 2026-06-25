// AI client wrapper. Gemini is the default provider because it has a free tier.
import { GoogleGenerativeAI } from '@google/generative-ai';
import { parseJsonResponse } from './json.js';

export class AiClient {
  constructor({ provider, geminiApiKey, geminiModel }) {
    this.provider = provider || 'gemini';
    this.geminiApiKey = geminiApiKey;
    this.geminiModel = geminiModel || 'gemini-1.5-flash';
  }

  async generateJson(prompt, label) {
    const rawText = await this.generateText(prompt);
    return parseJsonResponse(rawText, label);
  }

  async generateText(prompt) {
    if (this.provider !== 'gemini') {
      throw new Error(`Unsupported AI_PROVIDER "${this.provider}". Use "gemini" for Phase 1.`);
    }

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
}
