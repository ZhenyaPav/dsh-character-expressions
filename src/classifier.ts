import { GO_EMOTIONS, isExpressionLabel, type ExpressionLabel } from './expressions.ts'

export const DEFAULT_MODEL = 'Cohee/distilbert-base-uncased-go-emotions-onnx'

export type ModelStatus =
  | { state: 'idle' }
  | { state: 'loading'; file?: string; loaded?: number; total?: number }
  | { state: 'ready' }
  | { state: 'error'; message: string }

export interface Classification {
  label: ExpressionLabel
  score: number
}

type PipelineResult = { label: string; score: number } | Array<{ label: string; score: number }>
type Pipeline = (text: string, options?: Record<string, unknown>) => Promise<PipelineResult>

/** A singleton backend-only model runner. Concurrent warmups share one pipeline. */
export class EmotionClassifier {
  private pipeline: Promise<Pipeline> | undefined
  private _status: ModelStatus = { state: 'idle' }

  constructor(
    private readonly modelId: string,
    private readonly cacheDir: string,
    private readonly load: () => Promise<{
      pipeline: (task: 'text-classification', model: string, options: Record<string, unknown>) => Promise<Pipeline>
      env: { cacheDir: string }
    }> = () => import('@huggingface/transformers') as never,
  ) {}

  get status(): ModelStatus { return this._status }

  warm(): Promise<void> {
    return this.getPipeline().then(() => undefined)
  }

  retry(): Promise<void> {
    this.pipeline = undefined
    this._status = { state: 'idle' }
    return this.warm()
  }

  async classify(text: string): Promise<Classification | undefined> {
    if (text.trim() === '') return undefined
    const result = await (await this.getPipeline())(text, { top_k: 1 })
    const top = Array.isArray(result) ? result[0] : result
    if (top === undefined || !isExpressionLabel(top.label)) return undefined
    return { label: top.label, score: top.score }
  }

  private getPipeline(): Promise<Pipeline> {
    this.pipeline ??= this.initialize()
    return this.pipeline
  }

  private async initialize(): Promise<Pipeline> {
    this._status = { state: 'loading' }
    try {
      const transformers = await this.load()
      transformers.env.cacheDir = this.cacheDir
      const pipeline = await transformers.pipeline('text-classification', this.modelId, {
        progress_callback: (progress: { file?: string; loaded?: number; total?: number }) => {
          this._status = { state: 'loading', ...progress }
        },
      })
      this._status = { state: 'ready' }
      return pipeline
    } catch (error) {
      this._status = { state: 'error', message: error instanceof Error ? error.message : String(error) }
      this.pipeline = undefined
      throw error
    }
  }
}

export { GO_EMOTIONS }
