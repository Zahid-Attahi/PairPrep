export const codingChallenges = [
  {
    id: 'two-sum',
    title: 'Two Sum',
    topic: 'Arrays · Hash maps',
    difficulty: 'Easy',
  },
  {
    id: 'valid-parentheses',
    title: 'Valid Parentheses',
    topic: 'Stacks · Strings',
    difficulty: 'Easy',
  },
  {
    id: 'merge-intervals',
    title: 'Merge Intervals',
    topic: 'Sorting · Intervals',
    difficulty: 'Medium',
  },
] as const

export type ChallengeId = (typeof codingChallenges)[number]['id']

export function getChallenge(challengeId: string) {
  return codingChallenges.find((challenge) => challenge.id === challengeId)
}

export function isChallengeId(value: unknown): value is ChallengeId {
  return typeof value === 'string' && codingChallenges.some((challenge) => challenge.id === value)
}
