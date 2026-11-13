import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { Server } from 'socket.io';
import Redis from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import { QUESTION_BANK } from './questions.js';

const PORT = Number(process.env.PORT || 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const app = express();
app.use(cors({ origin: CLIENT_ORIGIN.split(',').map(s => s.trim()), credentials: true }));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'quiz-clash-server', multiplayer: 'socket.io' }));
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: CLIENT_ORIGIN.split(',').map(s => s.trim()), methods: ['GET', 'POST'], credentials: true }, pingInterval: 25000, pingTimeout: 20000 });

// Redis adapter enables Socket.IO fan-out across instances. Game state is deliberately
// single-writer/in-memory in this release; deploy one game-server instance for room authority.
if (process.env.REDIS_URL) {
  const pub = new Redis(process.env.REDIS_URL);
  const sub = pub.duplicate();
  await Promise.all([pub.ping(), sub.ping()]);
  io.adapter(createAdapter(pub, sub));
  console.log('Socket.IO Redis adapter connected');
}

const rooms = new Map();
const timers = new Map();
const ROOM_TTL_MS = 3 * 60 * 60 * 1000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
function makeCode() {
  let code;
  do { code = Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(''); } while (rooms.has(code));
  return code;
}
function publicQuestion(q, revealed = false) {
  const result = { id: q.id, round: q.round, type: q.type, category: q.category, prompt: q.prompt, options: q.options || null };
  if (revealed) { result.correctAnswer = q.answer; result.explanation = q.explanation; }
  return result;
}
function sortedPlayers(room) {
  return [...room.players.values()].sort((a, b) => b.score - a.score || a.totalCorrectTime - b.totalCorrectTime || a.joinedAt - b.joinedAt);
}
function snapshot(room) {
  const q = room.questions[room.questionIndex] || null;
  const players = sortedPlayers(room).map(p => ({ id: p.id, nickname: p.nickname, score: p.score, connected: p.connected, isHost: p.id === room.hostId, answered: Boolean(q && room.answers.has(q.id) && room.answers.get(q.id).has(p.id)) }));
  return {
    code: room.code, phase: room.phase, hostId: room.hostId, players,
    round: q?.round || (room.phase === 'finished' ? 3 : 1), questionNumber: room.phase === 'finished' ? 15 : room.questionIndex + 1,
    totalQuestions: 15, question: q ? publicQuestion(q, room.revealed) : null,
    startedAt: room.startedAt, deadline: room.deadline, revealed: room.revealed,
    answeredCount: q ? (room.answers.get(q.id)?.size || 0) : 0,
    answerCount: room.players.size,
    finalScores: room.phase === 'finished' ? players : undefined
  };
}
function emitRoom(room) { io.to(room.code).emit('room:update', snapshot(room)); }
function clearQuestionTimer(code) { const timer = timers.get(code); if (timer) clearTimeout(timer); timers.delete(code); }
function openQuestion(room) {
  clearQuestionTimer(room.code);
  const q = room.questions[room.questionIndex];
  if (!q) { room.phase = 'finished'; room.deadline = null; room.startedAt = null; room.revealed = true; emitRoom(room); return; }
  room.phase = 'question'; room.revealed = false; room.startedAt = Date.now(); room.deadline = room.startedAt + 10_000;
  timers.set(room.code, setTimeout(() => {
    const current = rooms.get(room.code);
    if (current && current.phase === 'question' && current.questionIndex === room.questionIndex) {
      current.phase = 'review'; current.deadline = null; emitRoom(current);
    }
  }, 10_000));
  emitRoom(room);
}
function isHost(socket, room) { return room.hostId === socket.data.playerId; }
function error(socket, message) { socket.emit('game:error', { message }); }
function validNickname(value) { return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 18 && !/[\u0000-\u001f]/.test(value); }
function attachPlayer(socket, room, player) {
  player.connected = true; player.socketId = socket.id; player.disconnectedAt = null;
  socket.data.roomCode = room.code; socket.data.playerId = player.id; socket.join(room.code);
  emitRoom(room);
  socket.emit('room:joined', { sessionId: player.id, room: snapshot(room) });
}

io.on('connection', socket => {
  socket.on('room:create', ({ nickname } = {}) => {
    if (!validNickname(nickname)) return error(socket, 'Choose a nickname between 1 and 18 characters.');
    const code = makeCode();
    const player = { id: makeId(), nickname: nickname.trim(), score: 0, connected: true, socketId: socket.id, joinedAt: Date.now(), totalCorrectTime: 0 };
    const room = { code, hostId: player.id, players: new Map([[player.id, player]]), phase: 'lobby', questions: [], questionIndex: 0, answers: new Map(), revealed: false, startedAt: null, deadline: null, createdAt: Date.now() };
    rooms.set(code, room); attachPlayer(socket, room, player);
  });

  socket.on('room:join', ({ code, nickname } = {}) => {
    const normalized = String(code || '').trim().toUpperCase();
    const room = rooms.get(normalized);
    if (!room) return error(socket, 'Room not found. Check the code and try again.');
    if (!validNickname(nickname)) return error(socket, 'Choose a nickname between 1 and 18 characters.');
    if (room.phase !== 'lobby') return error(socket, 'This game has already started.');
    if (room.players.size >= 8) return error(socket, 'This room is full (maximum 8 players).');
    if ([...room.players.values()].some(p => p.nickname.toLowerCase() === nickname.trim().toLowerCase())) return error(socket, 'That nickname is already being used in this room.');
    const player = { id: makeId(), nickname: nickname.trim(), score: 0, connected: true, socketId: socket.id, joinedAt: Date.now(), totalCorrectTime: 0 };
    room.players.set(player.id, player); attachPlayer(socket, room, player);
  });

  socket.on('room:reconnect', ({ code, sessionId } = {}) => {
    const room = rooms.get(String(code || '').toUpperCase());
    const player = room?.players.get(sessionId);
    if (!room || !player) return error(socket, 'Your previous game session could not be found.');
    attachPlayer(socket, room, player);
  });

  socket.on('game:start', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !isHost(socket, room)) return error(socket, 'Only the host can start the game.');
    if (room.phase !== 'lobby') return error(socket, 'The game has already started.');
    if (room.players.size < 2) return error(socket, 'At least 2 players are required.');
    room.questions = [...QUESTION_BANK];
    room.questionIndex = 0; room.answers = new Map();
    for (const p of room.players.values()) { p.score = 0; p.totalCorrectTime = 0; }
    openQuestion(room);
  });

  socket.on('answer:submit', ({ questionId, answer } = {}) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.get(socket.data.playerId);
    if (!room || !player || !player.connected) return error(socket, 'You are not an active player in this room.');
    if (room.phase !== 'question') return error(socket, 'Answers are not being accepted right now.');
    const q = room.questions[room.questionIndex];
    if (!q || questionId !== q.id) return error(socket, 'That answer belongs to an expired question.');
    const now = Date.now();
    if (now > room.deadline) { room.phase = 'review'; room.deadline = null; clearQuestionTimer(room.code); emitRoom(room); return error(socket, 'Time is up.'); }
    let submitted;
    if (q.type === 'trivia') {
      if (!Number.isInteger(answer) || answer < 0 || answer >= q.options.length) return error(socket, 'Invalid answer choice.');
      submitted = answer;
    } else {
      if (typeof answer !== 'boolean') return error(socket, 'Choose True or False.');
      submitted = answer;
    }
    let qAnswers = room.answers.get(q.id);
    if (!qAnswers) { qAnswers = new Map(); room.answers.set(q.id, qAnswers); }
    if (qAnswers.has(player.id)) return error(socket, 'Your answer has already been recorded.');
    const elapsedMs = Math.max(0, now - room.startedAt);
    const correct = submitted === q.answer;
    let points = 0;
    if (correct && q.type === 'truth') points = 100;
    if (correct && q.type === 'trivia' && q.round === 1) points = elapsedMs <= 2000 ? 150 : elapsedMs <= 5000 ? 125 : elapsedMs <= 8000 ? 110 : 100;
    if (correct && q.type === 'trivia' && q.round === 3) points = elapsedMs <= 2000 ? 200 : elapsedMs <= 6000 ? 150 : 100;
    // Node's event loop serializes this check-and-write section; one Map entry per player
    // makes simultaneous duplicate submissions idempotently reject rather than double-score.
    qAnswers.set(player.id, { answer: submitted, correct, points, elapsedMs });
    player.score += points;
    if (correct) player.totalCorrectTime += elapsedMs;
    socket.emit('answer:accepted', { questionId: q.id, correct, points });
    if (qAnswers.size >= room.players.size) { room.phase = 'review'; room.deadline = null; clearQuestionTimer(room.code); }
    emitRoom(room);
  });

  socket.on('game:reveal', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !isHost(socket, room)) return error(socket, 'Only the host can reveal the answer.');
    if (room.phase !== 'review') return error(socket, 'Wait until the question is complete or time expires.');
    room.revealed = true; emitRoom(room);
  });

  socket.on('game:next', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !isHost(socket, room)) return error(socket, 'Only the host can advance the game.');
    if (room.phase !== 'review' || !room.revealed) return error(socket, 'Reveal the answer before moving on.');
    room.questionIndex += 1;
    if (room.questionIndex >= room.questions.length) { room.phase = 'finished'; room.deadline = null; room.startedAt = null; room.revealed = true; emitRoom(room); }
    else openQuestion(room);
  });

  socket.on('game:rematch', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !isHost(socket, room)) return error(socket, 'Only the host can start a rematch.');
    if (room.phase !== 'finished') return error(socket, 'The current game is not finished yet.');
    room.phase = 'lobby'; room.questions = []; room.questionIndex = 0; room.answers.clear(); room.revealed = false; room.deadline = null; room.startedAt = null;
    for (const p of room.players.values()) { p.score = 0; p.totalCorrectTime = 0; }
    emitRoom(room);
  });

  socket.on('room:leave', () => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.get(socket.data.playerId);
    if (!room || !player) return;
    room.players.delete(player.id);
    if (room.hostId === player.id) {
      const successor = [...room.players.values()].filter(p => p.connected).sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (successor) room.hostId = successor.id;
    }
    if (room.players.size === 0) { clearQuestionTimer(room.code); rooms.delete(room.code); }
    else {
      const q = room.questions[room.questionIndex];
      if (room.phase === 'question' && q && (room.answers.get(q.id)?.size || 0) >= room.players.size) { room.phase = 'review'; room.deadline = null; clearQuestionTimer(room.code); }
      emitRoom(room);
    }
    socket.leave(room.code); socket.data.roomCode = null; socket.data.playerId = null;
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.get(socket.data.playerId);
    if (!room || !player || player.socketId !== socket.id) return;
    player.connected = false; player.disconnectedAt = Date.now();
    if (room.hostId === player.id) {
      const successor = [...room.players.values()].filter(p => p.connected).sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (successor) room.hostId = successor.id;
    }
    emitRoom(room);
    // Keep the seat/session for reconnection; remove stale empty rooms after three hours.
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.createdAt > ROOM_TTL_MS && [...room.players.values()].every(p => !p.connected)) {
      clearQuestionTimer(code); rooms.delete(code);
    }
  }
}, 60_000).unref();

httpServer.listen(PORT, () => console.log(`Quiz Clash server listening on :${PORT}`));
