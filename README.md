# Quiz Clash — Friends Battle

A browser-based real-time party quiz for 2–8 players. Players join from their own devices with a six-character room code and nickname; no account or installation is required.

## Included

- Public room creation and code-based joining
- Host/player lobby with 2–8 player capacity
- Three rounds and 15 bundled questions
- 10-second server-enforced question deadlines
- Speed-based trivia scoring and Truth-or-Bluff scoring
- Server-authoritative answer validation and duplicate-answer rejection
- Live leaderboard updates after each submission
- Host-controlled reveal and next-question progression
- Reconnection using a browser-stored session token
- Rematch with the same room players
- Responsive mobile/tablet/desktop interface
- Health endpoint at `/health`

## Requirements

- Node.js 20 or newer
- npm 10 or newer

## Run locally

```bash
npm install
cp .env.example server/.env
cp client/.env.example client/.env
npm run dev
```

Open `http://localhost:5173` in multiple browser windows/devices. The API and Socket.IO server listens on `http://localhost:3001`.

For testing across phones on the same Wi-Fi, set `VITE_SERVER_URL` in `client/.env` to the computer's LAN address (for example `http://192.168.1.20:3001`) and set `CLIENT_ORIGIN` in `server/.env` to the Vite URL reachable by those phones. Allow the ports through the computer firewall.

## Production build

```bash
npm install
npm run build
npm start
```

Serve the generated `client/dist` folder from a static host and deploy the `server` workspace as a persistent Node service. Set `VITE_SERVER_URL` at frontend build time to the public HTTPS API origin, and set `CLIENT_ORIGIN` on the server to the deployed frontend origin. Use WSS/HTTPS in production.

## Multiplayer state and scaling note

The game server is authoritative. Answer validation and score mutation occur in one synchronous event-loop critical section; each question stores one answer per player, so duplicate submissions cannot score twice and simultaneous events are serialized. Timers are enforced by server timestamps, not client clocks.

The optional Socket.IO Redis adapter is wired through `REDIS_URL` for event fan-out. **This initial implementation keeps authoritative room/game state in process memory and therefore must run as one game-server instance.** Redis adapter alone does not make room state shared across replicas. For horizontal scaling or recovery after server restart, move room state and answer claims into Redis (atomic Lua/transactions) before enabling multiple game-server replicas. Reconnection is supported while the room process remains alive; process restarts clear active rooms.

## Game flow

- Host creates a room; guests join with code and nickname.
- Host starts when at least two players have joined.
- Each question runs for 10 seconds. When all players answer or time expires, the phase changes to review.
- Host reveals the answer and explanation, then advances to the next question.
- After question 15, the final leaderboard and winner are shown.
- Host can reset the same room for a rematch.

## Scoring

- Round 1 trivia: 150 points at <=2s, 125 at <=5s, 110 at <=8s, otherwise 100 for a correct answer.
- Round 2 truth/bluff: 100 points for a correct answer.
- Round 3 mixed: trivia gives 200 at <=2s, 150 at <=6s, otherwise 100; truth/bluff gives 100.
- Incorrect and unanswered questions score zero.
- Ties are sorted by cumulative response time on correct answers, then join order.

## Important current limitations

- The included question bank is a small starter set of 15 questions; replace or expand `server/src/questions.js` for a larger randomized library.
- Nickname uniqueness is enforced within a room; there is no account system or persistent match history.
- If the host disconnects or leaves, the earliest-connected remaining player becomes host.
- Active rooms are not persisted across server restarts.
