/**
 * Collection Schemas
 *
 * All collections with columns and RBAC permissions.
 * Single source of truth — imported by both worker and frontend.
 *
 * Add schemas by creating a file in src/schemas/ and importing it here.
 */

import type { CollectionSchema } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'
import { interviewRoomsSchema } from './schemas/interview-rooms-schema'
import { interviewReviewsSchema } from './schemas/interview-reviews-schema'
import { roomMembersSchema } from './schemas/room-members-schema'
import { aiCoachRateLimitsSchema } from './schemas/ai-coach-rate-limits-schema'
import { aiCoachMessagesSchema } from './schemas/ai-coach-messages-schema'

export const schemas: CollectionSchema[] = [
  usersSchema,
  settingsSchema,
  interviewRoomsSchema,
  roomMembersSchema,
  aiCoachRateLimitsSchema,
  aiCoachMessagesSchema,
  interviewReviewsSchema,
]
