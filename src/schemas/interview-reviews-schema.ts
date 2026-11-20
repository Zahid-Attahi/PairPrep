import type { CollectionSchema } from 'deepspace/schema'

export const interviewReviewsSchema: CollectionSchema = {
  name: 'interviewReviews',
  columns: [
    {
      name: 'candidateId',
      storage: 'text',
      interpretation: 'plain',
      userBound: true,
      immutable: true,
      required: true,
    },
    { name: 'roomId', storage: 'text', interpretation: 'plain', immutable: true, required: true },
    { name: 'feedback', storage: 'text', interpretation: 'plain', required: true },
    { name: 'score', storage: 'number', interpretation: 'plain' },
  ],
  ownerField: 'candidateId',
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    member: { read: 'own', create: true, update: false, delete: false },
    admin: { read: 'own', create: true, update: false, delete: false },
  },
}
