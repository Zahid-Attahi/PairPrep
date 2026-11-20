# PairPrep

**Collaborative technical interview practice.**

PairPrep is a full-stack application designed to help people prepare for technical interviews together. Users can create practice rooms, invite other participants, collaborate on shared notes in real time, get AI-powered coaching, and research technical topics.

## Features

- **Authentication:** Sign in to use protected application features.
- **Interview rooms:** Create rooms around a curated coding challenge and invite other registered users.
- **Collaborative notes:** Work together in a shared editor with real-time synchronization powered by Yjs.
- **AI Coach:** Ask for coding hints, concept explanations, follow-up questions, and feedback on an approach.
- **Technical Research:** Search for technical topics and view links to provider-returned research results.
- **Room permissions:** Restrict room access and editing based on room ownership and active membership.

## Technology Stack

- **Frontend:** React and TypeScript
- **Platform:** DeepSpace
- **Real-time collaboration:** Yjs
- **Build tooling:** Vite
- **Styling:** Tailwind CSS
- **Version control:** Git and GitHub

## Third-Party Integrations

PairPrep uses three third-party integrations through DeepSpace:

| Integration | Purpose |
| --- | --- |
| OpenAI | AI-powered interview coaching |
| Exa | Technical research and search |
| Email | Sending interview room invitations |

Integration requests run on the server. Provider credentials are not included in browser code. OpenAI, Exa, and Email are configured as developer-billed integrations and may consume the app owner's DeepSpace credits.

## Security and Design Decisions

- Protected application routes require authentication.
- Server-side actions verify room ownership or active membership before accessing room-specific features.
- Only room owners can invite participants; invitees must already have a PairPrep account and have signed in at least once.
- Team membership records cannot be written directly by clients.
- AI Coach and research requests have server-side input limits and share a per-user limit of 20 requests per UTC hour.
- Private collaborative notes are not sent to OpenAI or Exa.
- `.gitignore` excludes local environment files and common private-key formats.

## Running Locally

### Prerequisites

- Node.js version supported by the project
- npm
- A DeepSpace developer account
- An initialized DeepSpace app and any required platform integration credits

Install dependencies:

```bash
npm install
```

Start the local development server:

```bash
npm run dev
```

**Registration notice:** `npm run dev` invokes `deepspace dev start`. On first use, a DeepSpace app command may register the app under the account currently authenticated with the CLI. This checkout currently has the `__APP_ID__` placeholder in `wrangler.toml`; it needs a server-minted app ID before the app can build or run. Confirm the intended DeepSpace account before initializing or starting the app.

## Project Commands

```bash
npm run build
npm run lint
npm run type-check
npm run test:unit
```

The unit-test command runs Vitest directly, but its current configuration also requires a valid app ID. The browser test scripts (`npm run test:smoke`, `npm run test:api`, and `npm run test:e2e`) invoke `deepspace test run` and may register an uninitialized app. Run those only after confirming the intended account and app registration.

## Current Development Status

PairPrep is under active development. Room creation, membership and invitations, collaborative notes, the AI Coach, and technical research are implemented in the codebase. The app has not been registered or deployed, and live third-party delivery and provider behavior have not been verified.

Session review history, member removal, and additional multi-user end-to-end testing remain future work. Invitations are limited to people who already have a PairPrep account; email delivery failure does not remove the membership, but a resend flow is not implemented.

## Project Repository

[GitHub — Zahid-Attahi/PairPrep](https://github.com/Zahid-Attahi/PairPrep)

## Author

**Zahid Attahi**  
Computer Science student building PairPrep as a full-stack software engineering project.
