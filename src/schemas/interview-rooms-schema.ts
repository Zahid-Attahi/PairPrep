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
  ],
  ownerField: 'ownerId',
  teamField: 'teamId',
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    member: {
      read: 'team',
      create: false,
      update: 'team',
      delete: 'own',
      writableFields: ['name', 'challengeId'],
    },
    admin: {
      read: 'team',
      create: false,
      update: 'team',
      delete: 'own',
      writableFields: ['name', 'challengeId'],
    },
  },
}
