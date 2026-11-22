# PairPrep demo

## Set up before presenting

1. Sign in to the DeepSpace CLI with the intended developer account and start `PAIRPREP_MOCK_INTEGRATIONS=1 npm run dev -- --host 127.0.0.1`.
2. Open the printed local URL followed by `/api/integrations`. Confirm it returns `{"mode":"pairprep-local-mock"}` before inviting anyone or using the coach or research.
3. Open the local app in two separate browser profiles and sign in as Alice and Bob using usable test accounts. Load the workspace in both so both accounts are available for invitations. Keep Alice’s room and Bob’s browser side by side.
4. Tell the audience that sign-in, records, WebSockets, and permission enforcement are real. Email delivery, OpenAI replies, and Exa results are deterministic local mocks. This walkthrough sends no email and incurs no provider calls.

## Walkthrough · about 4 minutes

| Time | Show | Say |
| --- | --- | --- |
| 0:00–0:35 | Open Alice’s workspace. Point out Interview rooms and Interview history. Create a room named **Two Sum practice** and select **Two Sum**. | PairPrep uses private rooms for practice and records completed sessions separately on the dashboard. |
| 0:35–1:20 | Invite Bob by his test account email. Open the room URL in Bob’s browser. Type “Track the complement of each number” in Alice’s shared notes and watch it appear in Bob’s editor. | DeepSpace authorizes the team-scoped room. Both browsers sync the Yjs document through the records WebSocket, and the Durable Object persists it. The invitation action adds membership and receives a simulated email acknowledgement. |
| 1:20–2:05 | Ask AI Coach “How can I look up the complement?” Then search Technical Research for “JavaScript Map.” Show the mock reply and source link. | The Worker checks room access and reserves one of 20 shared account slots per UTC hour before either integration. It saves the coach conversation per user and room. The shared editor text never enters either request. |
| 2:05–3:15 | Click **Mark session complete**. Save a review with a summary, strength, and improvement. Refresh, return to the workspace, and follow **View reviews** from history. | Completion has a server-recorded timestamp. Reviews persist in DeepSpace and are readable only by their author, even when another participant can open the room. |
| 3:15–4:00 | In Alice’s room, remove Bob. Show that Bob’s live view changes to **Room unavailable** and remains unavailable after reload. | The Worker checks that Alice owns the room. Removing the existing membership revokes access, then reconnects active records clients so they resubscribe under current permissions. |

Close by noting that unit tests cover action boundaries and invalid requests, and two-account Playwright tests exercise the signed-in flows with local provider mocks.
