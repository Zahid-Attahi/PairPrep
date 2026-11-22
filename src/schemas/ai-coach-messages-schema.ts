import type { CollectionSchema } from 'deepspace/schema'

export const aiCoachMessagesSchema: CollectionSchema = {
  name: 'aiCoachMessages',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true, required: true },
    { name: 'roomId', storage: 'text', interpretation: 'plain', immutable: true, required: true },
    { name: 'role', storage: 'text', interpretation: 'plain', immutable: true, required: true },
    { name: 'content', storage: 'text', interpretation: 'plain', immutable: true, required: true },
    { name: 'createdAt', storage: 'text', interpretation: 'plain', immutable: true, required: true },
  ],
  ownerField: 'userId',
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    member: { read: 'own', create: false, update: false, delete: false },
    admin: { read: 'own', create: false, update: false, delete: false },
  },
}
