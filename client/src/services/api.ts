import type { ModelDefinition, ModelDefinitionDocument, Record as ModelRecord } from '@modeler/shared';

/**
 * API クライアント。fetch を直接コンポーネントから呼ばず、ここに集約する。
 *
 * なぜ集約するか:
 *   - エンドポイントの URL を 1 箇所に閉じ込めると、変更が容易。
 *   - レスポンスの型を呼び出し側で書き直さなくて良い。
 *   - テストでは ApiClient を差し替えるだけで全画面を切り替えられる。
 *
 * インターフェース化している理由:
 *   ViewModel のテストで「実 fetch を叩かない」スタブを作りたいから。
 *   依存性逆転 (Dependency Inversion) — UI が抽象に依存し、実装は外から差す。
 */

export interface ApiClient {
  deploy(doc: ModelDefinitionDocument): Promise<{ deployed: ModelDefinition[] }>;
  listModels(): Promise<ModelDefinition[]>;
  list(modelName: string): Promise<ModelRecord[]>;
  create(modelName: string, body: Record<string, unknown>): Promise<ModelRecord>;
  update(modelName: string, id: string, body: Record<string, unknown>): Promise<ModelRecord>;
  remove(modelName: string, id: string): Promise<void>;
}

export class HttpApiClient implements ApiClient {
  constructor(private readonly baseUrl: string = '') {}

  async deploy(doc: ModelDefinitionDocument) {
    return this.request<{ deployed: ModelDefinition[] }>('POST', '/meta/deploy', doc);
  }
  async listModels() {
    const res = await this.request<{ models: ModelDefinition[] }>('GET', '/meta/models');
    return res.models;
  }
  async list(modelName: string) {
    return this.request<ModelRecord[]>('GET', `/api/${modelName}`);
  }
  async create(modelName: string, body: Record<string, unknown>) {
    return this.request<ModelRecord>('POST', `/api/${modelName}`, body);
  }
  async update(modelName: string, id: string, body: Record<string, unknown>) {
    return this.request<ModelRecord>('PUT', `/api/${modelName}/${id}`, body);
  }
  async remove(modelName: string, id: string) {
    await this.request<void>('DELETE', `/api/${modelName}/${id}`);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      // サーバーが返す { errors: [...] } をそのまま投げてあげると UI で表示しやすい
      const text = await res.text();
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { parsed = text; }
      throw new ApiError(res.status, parsed);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly payload: unknown) {
    super(`API error ${status}`);
    this.name = 'ApiError';
  }
  /** UI に出すための文字列。サーバー側のバリデーションメッセージ配列を平坦化。 */
  toMessages(): string[] {
    if (this.payload && typeof this.payload === 'object' && 'errors' in this.payload) {
      const errors = (this.payload as { errors?: unknown }).errors;
      if (Array.isArray(errors)) return errors.map(String);
    }
    return [`HTTP ${this.status}`];
  }
}
