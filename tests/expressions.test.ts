import assert from 'node:assert/strict'
import test from 'node:test'
import { EmotionClassifier } from '../src/classifier.ts'
import { chooseSprite, createPack } from '../src/expressions.ts'

test('same-label reroll preference retains the displayed sprite', () => {
  const first = { id: 'first', file: 'sprites/first.png', mediaType: 'image/png' }
  const second = { id: 'second', file: 'sprites/second.png', mediaType: 'image/png' }
  const pack = createPack({ sprites: { joy: [first, second] } })
  assert.equal(chooseSprite(pack, 'joy', first, false, () => 0.9), first)
  assert.equal(chooseSprite(pack, 'joy', first, true, () => 0.9), second)
})

test('a configured fallback handles absent predicted sprites', () => {
  const fallback = { id: 'joy', file: 'sprites/joy.png', mediaType: 'image/png' }
  const pack = createPack({ fallback: 'joy', sprites: { joy: [fallback] } })
  assert.equal(chooseSprite(pack, 'anger', undefined, true), fallback)
})

test('concurrent classifier warmups create one backend pipeline', async () => {
  let creates = 0
  const classifier = new EmotionClassifier('fixture', '/tmp/deep-tavern-tests', async () => ({
    env: { cacheDir: '' },
    pipeline: async () => {
      creates++
      return async () => [{ label: 'joy', score: 0.91 }]
    },
  }))
  await Promise.all([classifier.warm(), classifier.warm(), classifier.warm()])
  assert.equal(creates, 1)
  assert.deepEqual(await classifier.classify('A happy answer.'), { label: 'joy', score: 0.91 })
})

test('classifier refuses unknown model labels', async () => {
  const classifier = new EmotionClassifier('fixture', '/tmp/deep-tavern-tests', async () => ({
    env: { cacheDir: '' },
    pipeline: async () => async () => [{ label: 'LABEL_42', score: 1 }],
  }))
  assert.equal(await classifier.classify('text'), undefined)
})
