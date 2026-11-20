import type { CollectionSchema } from 'deepspace/schema'

export const aiCoachRateLimitsSchema: CollectionSchema = {
  name: 'aiCoachRateLimits',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'windowStart', storage: 'text', interpretation: 'plain', required: true },
    { name: 'slot', storage: 'number', interpretation: 'plain', required: true },
  ],
  uniqueOn: ['userId', 'windowStart', 'slot'],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    member: { read: false, create: false, update: false, delete: false },
    admin: { read: false, create: false, update: false, delete: false },
  },
}
