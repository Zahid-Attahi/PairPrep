# PairPrep

**Collaborative technical interview practice.**

PairPrep is a full-stack application designed to help people prepare for technical interviews together. Users can create interview practice rooms, invite other participants, work on shared notes in real time, get AI-powered coaching, and research technical topics.

## Features

- **Authentication:** Sign in to access protected application features.
- **Interview rooms:** Create practice rooms and invite other registered users.
- **Collaborative notes:** Work together in a shared notes editor with real-time synchronization powered by Yjs.
- **AI Coach:** Ask for coding hints, follow-up questions, and feedback during interview practice.
- **Technical Research:** Search for relevant technical resources and receive links to research results.
- **Room permissions:** Restrict room access and editing based on ownership and active membership.

## Technology Stack

- **Frontend:** React, TypeScript
- **Platform:** DeepSpace
- **Real-time collaboration:** Yjs
- **Build tooling:** Vite
- **Styling:** CSS
- **Version control:** Git and GitHub

## Third-Party Integrations

PairPrep uses three third-party integrations through DeepSpace:

| Integration | Purpose |
|---|---|
| OpenAI | AI-powered interview coaching |
| Exa | Technical research and search |
| Email | Sending interview room invitations |

Integration requests are handled on the server rather than exposing provider credentials in the browser.

## Security and Design Decisions

- Protected application routes require authentication.
- Room ownership and membership are checked by server-side actions.
- Room members have restricted permissions compared with room owners.
- AI Coach and research requests have server-side input limits and per-user rate limiting.
- Private collaborative notes are not sent to the AI Coach or Exa.
- Provider credentials are kept out of client-side code.

## Running Locally

### Prerequisites

- Node.js
- npm
- A DeepSpace developer account
- The required DeepSpace integrations configured for the application

### Installation

Clone the repository:

```bash
git clone https://github.com/Zahid-Attahi/PairPrep.git
cd PairPrep
```

Install dependencies:

```bash
npm install
```

Start the local development server:

```bash
npm run dev
```

Additional project commands:

```bash
npm run build
npm run lint
npm run type-check
npm run test:unit
```

Some tests and platform operations require a registered and configured DeepSpace application.

## Current Development Status

PairPrep is under active development.

The core room, membership, collaborative notes, AI Coach, and research workflows have been implemented in the codebase. However, the application has not yet been deployed or fully verified against live third-party services.

Session review history, member removal, and additional end-to-end testing remain areas for future work.

## Project Repository

[GitHub — Zahid-Attahi/PairPrep](https://github.com/Zahid-Attahi/PairPrep)

## Author

**Zahid Attahi**

Computer Science student building PairPrep as a full-stack software engineering project.
