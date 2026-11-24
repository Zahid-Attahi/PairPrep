import type { CollectionSchema } from 'deepspace/schema'

export const interviewRoomsSchema: CollectionSchema = {
  name: 'interviewRooms',
  columns: [
    { name: 'name', storage: 'text', interpretation: 'plain', required: true },
    {
      name: 'ownerId',
      storage: 'text',
      interpretation: 'plain',
      userBound: true,
      immutable: true,
      required: true,
    },
    { name: 'teamId', storage: 'text', interpretation: 'plain', immutable: true, required: true },
    { name: 'challengeId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'completed', storage: 'number', interpretation: 'plain' },
    {
      name: 'completedAt',
      storage: 'text',
      interpretation: 'plain',
      timestampTrigger: { field: 'completed', value: 1 },
    },
  ],
  ownerField: 'ownerId',
  teamField: 'teamId',
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    member: {
      read: 'team',
      create: false,
      update: 'team',
      delete: false,
      writableFields: ['name', 'challengeId'],
    },
    admin: {
      read: 'team',
      create: false,
      update: 'team',
      delete: false,
      writableFields: ['name', 'challengeId'],
    },
  },
}
