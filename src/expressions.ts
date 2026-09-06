/** The label set emitted by Cohee's GoEmotions classifier. */
export const GO_EMOTIONS = [
  'admiration', 'amusement', 'anger', 'annoyance', 'approval', 'caring',
  'confusion', 'curiosity', 'desire', 'disappointment', 'disapproval',
  'disgust', 'embarrassment', 'excitement', 'fear', 'gratitude', 'grief',
  'joy', 'love', 'nervousness', 'optimism', 'pride', 'realization', 'relief',
  'remorse', 'sadness', 'surprise', 'neutral',
] as const

export type ExpressionLabel = (typeof GO_EMOTIONS)[number]

export function isExpressionLabel(value: string): value is ExpressionLabel {
  return (GO_EMOTIONS as readonly string[]).includes(value)
}

/** Stable, opaque image identity kept in a workspace manifest. */
export interface Sprite {
  id: string
  file: string
  mediaType: string
}

export interface ExpressionPack {
  version: 1
  fallback: ExpressionLabel | null
  sprites: Partial<Record<ExpressionLabel, Sprite[]>>
}

export const EMPTY_PACK: ExpressionPack = { version: 1, fallback: null, sprites: {} }

/** Pick a sprite without allowing a repeated label to reroll when disabled. */
export function chooseSprite(
  pack: ExpressionPack,
  label: ExpressionLabel,
  previous: Sprite | undefined,
  rerollSameExpression: boolean,
  random: () => number = Math.random,
): Sprite | undefined {
  const direct = pack.sprites[label]
  const candidates = direct?.length ? direct : pack.fallback === null ? undefined : pack.sprites[pack.fallback]
  if (candidates === undefined || candidates.length === 0) return undefined
  if (!rerollSameExpression && direct !== undefined && previous !== undefined) {
    const stillPresent = candidates.find(sprite => sprite.id === previous.id)
    if (stillPresent !== undefined) return stillPresent
  }
  return candidates[Math.floor(random() * candidates.length)]
}

export function createPack(input: Partial<ExpressionPack>): ExpressionPack {
  return {
    version: 1,
    fallback: input.fallback ?? null,
    sprites: input.sprites ?? {},
  }
}
