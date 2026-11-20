import type { CollectionSchema } from 'deepspace/schema'

export const roomMembersSchema: CollectionSchema = {
  name: 'team_members',
  columns: [
    { name: 'teamId', storage: 'text', interpretation: 'plain', immutable: true, required: true },
    {
      name: 'userId',
      storage: 'text',
      interpretation: 'plain',
      immutable: true,
      required: true,
    },
    { name: 'status', storage: 'text', interpretation: 'plain', default: 'active', required: true },
  ],
  uniqueOn: ['teamId', 'userId'],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    member: { read: false, create: false, update: false, delete: false },
    admin: { read: false, create: false, update: false, delete: false },
  },
}
