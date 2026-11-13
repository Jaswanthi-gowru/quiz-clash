import React, { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { Zap, Trophy, Users, Copy, Crown, Clock3, Wifi, WifiOff, Sparkles, ArrowRight, RotateCcw, CheckCircle2, XCircle, Gamepad2, ShieldCheck } from 'lucide-react';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
const socket = io(SERVER_URL, { autoConnect: false, transports: ['websocket', 'polling'], reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 700, reconnectionDelayMax: 5000 });
const SESSION_KEY = 'quiz-clash-session';

export default function App() {
  const [connected, setConnected] = useState(socket.connected);
  const [screen, setScreen] = useState('home');
  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [room, setRoom] = useState(null);
  const [session, setSession] = useState(() => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [myAnswer, setMyAnswer] = useState(null);
  const [seconds, setSeconds] = useState(10);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const onConnect = () => { setConnected(true); setError(''); try { const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); if (saved?.code && saved?.sessionId) socket.emit('room:reconnect', saved); } catch {} };
    const onDisconnect = () => setConnected(false);
    const onRoom = data => { setRoom(data); setScreen('room'); };
    const onJoined = ({ sessionId, room: data }) => {
      const next = { code: data.code, sessionId };
      localStorage.setItem(SESSION_KEY, JSON.stringify(next)); setSession(next); setRoom(data); setScreen('room'); setError('');
    };
    const onUpdate = data => { setRoom(data); setMyAnswer(null); };
    const onError = ({ message }) => setError(message || 'Something went wrong.');
    const onAccepted = ({ points }) => setNotice(points > 0 ? `Answer locked · +${points} points` : 'Answer locked · 0 points');
    socket.on('connect', onConnect); socket.on('disconnect', onDisconnect); socket.on('room:joined', onJoined); socket.on('room:update', onUpdate); socket.on('game:error', onError); socket.on('answer:accepted', onAccepted);
    socket.connect();
    return () => { socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); socket.off('room:joined', onJoined); socket.off('room:update', onUpdate); socket.off('game:error', onError); socket.off('answer:accepted', onAccepted); };
  }, []);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(tick);
  }, []);
  useEffect(() => {
    if (room?.phase === 'question' && room.deadline) setSeconds(Math.max(0, Math.ceil((room.deadline - now) / 1000)));
    else setSeconds(0);
  }, [room?.phase, room?.deadline, now]);

  const me = room?.players?.find(p => p.id === session?.sessionId);
  const isHost = Boolean(me?.isHost);
  const answered = Boolean(me?.answered || myAnswer !== null);
  const progress = room ? `${room.answeredCount}/${room.answerCount}` : '0/0';

  function createRoom() {
    setError(''); setNotice('');
    if (!nickname.trim()) return setError('Enter a nickname first.');
    socket.emit('room:create', { nickname: nickname.trim() });
  }
  function joinRoom() {
    setError(''); setNotice('');
    if (!nickname.trim()) return setError('Enter a nickname first.');
    if (roomCode.trim().length !== 6) return setError('Enter the 6-character room code.');
    socket.emit('room:join', { code: roomCode.trim().toUpperCase(), nickname: nickname.trim() });
  }
  function reconnect() {
    if (!session) return;
    setError(''); socket.emit('room:reconnect', session);
  }
  function submit(answer) {
    if (!room?.question || room.phase !== 'question' || answered) return;
    setMyAnswer(answer); setNotice('Submitting answer…');
    socket.emit('answer:submit', { questionId: room.question.id, answer });
  }
  function leaveRoom() {
    socket.emit('room:leave'); localStorage.removeItem(SESSION_KEY); setSession(null); setRoom(null); setScreen('home'); setError(''); setNotice(''); setMyAnswer(null);
  }
  async function copyCode() {
    try { await navigator.clipboard.writeText(room.code); setNotice('Room code copied!'); }
    catch { setNotice(`Share this code: ${room.code}`); }
  }

  if (!room) return <main className="app-shell"><header className="topbar"><Brand/><Connection connected={connected}/></header><section className="home-layout"><div className="hero-copy"><div className="eyebrow"><Sparkles size={14}/> THE FRIENDS PARTY GAME</div><h1>Think fast.<br/><span>Clash harder.</span></h1><p className="hero-sub">A little knowledge, a little bluffing, and a lot of friendly competition. Bring 2–8 friends into one room and find out who takes the crown.</p><div className="feature-pills"><span><Zap size={15}/> 10-second rounds</span><span><Users size={15}/> 2–8 players</span><span><Trophy size={15}/> Live leaderboard</span></div><div className="hero-art"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="hero-trophy"><Trophy size={78}/><Sparkles className="spark spark-a"/><Sparkles className="spark spark-b"/></div><div className="float-card card-fast"><Zap size={15}/> SPEED BONUS <b>+150</b></div><div className="float-card card-truth"><span className="truth-dot"/> TRUE OR BLUFF</div><div className="float-card card-score"><Crown size={15}/> TOP PLAYER</div></div></div><div className="entry-card"><div className="card-kicker">READY TO PLAY?</div><h2>Enter the arena</h2><p className="muted">No account. No downloads. Just your nickname.</p><label className="field-label" htmlFor="nickname">YOUR NICKNAME</label><input id="nickname" maxLength={18} placeholder="e.g. QuizMaster" value={nickname} onChange={e=>setNickname(e.target.value)} onKeyDown={e=>e.key==='Enter'&&createRoom()}/><button className="primary-btn" onClick={createRoom} disabled={!connected}><Zap size={17}/> Create a room <ArrowRight size={17}/></button><div className="splitter"><span/> OR JOIN A ROOM <span/></div><label className="field-label" htmlFor="roomcode">ROOM CODE</label><input id="roomcode" className="code-input" maxLength={6} placeholder="ABC123" value={roomCode} onChange={e=>setRoomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''))} onKeyDown={e=>e.key==='Enter'&&joinRoom()}/><button className="secondary-btn" onClick={joinRoom} disabled={!connected}>Join friends <ArrowRight size={16}/></button>{session && <button className="text-btn" onClick={reconnect}>Reconnect to my previous room</button>}{error && <div className="error-banner">{error}</div>}<div className="privacy-note"><ShieldCheck size={14}/> Your nickname is only used in this room.</div></div></section><footer className="footer">QUIZ CLASH <span>·</span> FRIENDS BATTLE <span>·</span> 3 ROUNDS / 15 QUESTIONS</footer></main>;

  return <main className="app-shell game-shell"><header className="topbar"><Brand/><div className="room-chip"><span className="live-dot"/> ROOM <b>{room.code}</b><button className="icon-btn" title="Copy room code" onClick={copyCode}><Copy size={15}/></button></div><Connection connected={connected}/></header>
    {error && <div className="toast-error">{error}<button onClick={()=>setError('')}>×</button></div>}
    {room.phase === 'lobby' && <section className="lobby-wrap"><div className="section-heading"><div><div className="eyebrow">THE BATTLE STARTS HERE</div><h1>Waiting for <span>players.</span></h1><p className="muted">Share your room code and get the squad together.</p></div><div className="player-count"><Users size={18}/><b>{room.players.length}</b><span>/ 8 PLAYERS</span></div></div><div className="lobby-grid"><div className="lobby-main"><div className="invite-panel"><div><div className="card-kicker">YOUR ROOM CODE</div><div className="big-code">{room.code}</div><p>Friends can join from any device using this code.</p></div><button className="copy-btn" onClick={copyCode}><Copy size={17}/> Copy code</button></div><div className="players-panel"><div className="panel-title"><h3>Players in the room</h3><span>{room.players.length} joined</span></div><div className="player-grid">{room.players.map((p,i)=><PlayerTile key={p.id} player={p} index={i}/>) }{Array.from({length:Math.max(0,8-room.players.length)}).map((_,i)=><div className="empty-seat" key={`empty-${i}`}><span>+</span><small>WAITING FOR PLAYER</small></div>)}</div></div></div><aside className="lobby-side"><div className="rules-panel"><div className="card-kicker">THE GAME PLAN</div><h3>3 rounds. 1 champion.</h3><div className="round-mini"><span className="round-number">01</span><div><b>Speed Trivia</b><small>5 questions · speed bonus</small></div></div><div className="round-mini"><span className="round-number pink">02</span><div><b>Truth or Bluff</b><small>5 statements · trust your gut</small></div></div><div className="round-mini"><span className="round-number gold">03</span><div><b>Final Clash</b><small>5 mixed questions · double stakes</small></div></div><div className="rule-timer"><Clock3 size={16}/> <b>10 seconds</b> per question</div></div>{isHost ? <button className="primary-btn start-btn" onClick={()=>socket.emit('game:start')} disabled={room.players.length<2}><Zap size={18}/> Start the game <ArrowRight size={17}/></button> : <div className="host-wait"><Crown size={17}/> Waiting for <b>{room.players.find(p=>p.isHost)?.nickname || 'the host'}</b> to start…</div>}<p className="tiny-note">{room.players.length<2?'At least 2 players are needed to begin.':'All set! The host can start whenever everyone is ready.'}</p></aside></div></section>}
    {room.phase === 'question' && <section className="play-layout"><div className="game-topline"><div><div className="eyebrow">ROUND {room.round} OF 3 <span className="eyebrow-dot">·</span> QUESTION {room.questionNumber} OF 15</div><h1>{room.round===1?'Speed Trivia':room.round===2?'Truth or Bluff':'Final Clash'}</h1></div><div className={`timer ${seconds<=3?'urgent':''}`}><Clock3 size={18}/><b>{seconds}</b><small>SEC</small></div></div><div className="round-progress">{Array.from({length:15}).map((_,i)=><span key={i} className={i<room.questionNumber?'done':''}/>)}</div><div className="question-card"><div className="question-meta"><span className="category-tag">{room.question.category}</span><span className="question-type">{room.question.type==='truth'?'TRUE / FALSE':'MULTIPLE CHOICE'}</span></div><h2>{room.question.prompt}</h2>{room.question.type==='trivia'?<div className="answer-grid">{room.question.options.map((option,i)=><button key={option} className={`answer-option ${myAnswer===i?'selected':''}`} onClick={()=>submit(i)} disabled={answered}><span className="option-letter">{String.fromCharCode(65+i)}</span>{option}</button>)}</div>:<div className="truth-grid"><button className={`truth-option true-option ${myAnswer===true?'selected':''}`} onClick={()=>submit(true)} disabled={answered}><span>✓</span> TRUE</button><button className={`truth-option false-option ${myAnswer===false?'selected':''}`} onClick={()=>submit(false)} disabled={answered}><span>✕</span> FALSE</button></div>}<div className="answer-status">{answered?<><CheckCircle2 size={16}/> {notice || 'Your answer is locked in. Good luck!'}</>:<><Clock3 size={16}/> Choose your answer before time runs out.</>}</div></div><div className="live-bottom"><div className="live-score"><Trophy size={17}/><span>YOUR SCORE</span><b>{me?.score ?? 0}</b></div><div className="answer-progress"><Users size={16}/> <b>{progress}</b> players answered</div></div><Leaderboard players={room.players} myId={session?.sessionId}/></section>}
    {room.phase === 'review' && <section className="review-layout"><div className="eyebrow">ROUND {room.round} <span className="eyebrow-dot">·</span> QUESTION {room.questionNumber}</div><h1>{room.revealed?'Answer revealed.':'Time to reveal.'}</h1><div className="review-card"><div className="question-meta"><span className="category-tag">{room.question.category}</span><span className="question-type">{room.answeredCount}/{room.answerCount} ANSWERED</span></div><h2>{room.question.prompt}</h2>{room.revealed?<div className="reveal-answer"><div className="correct-label"><CheckCircle2 size={17}/> CORRECT ANSWER</div><strong>{room.question.type==='truth'?(room.question.correctAnswer?'TRUE':'FALSE'):room.question.options[room.question.correctAnswer]}</strong><p>{room.question.explanation}</p></div>:<div className="waiting-reveal"><Clock3 size={18}/> Answers are locked. The host can reveal the correct answer.</div>}</div><Leaderboard players={room.players} myId={session?.sessionId}/><div className="host-controls">{isHost?(room.revealed?<button className="primary-btn" onClick={()=>socket.emit('game:next')}>{room.questionNumber===15?'See final results':'Next question'} <ArrowRight size={17}/></button>:<button className="primary-btn" onClick={()=>socket.emit('game:reveal')}><Sparkles size={17}/> Reveal answer</button>):<div className="host-wait"><Crown size={17}/> Waiting for the host to continue…</div>}</div></section>}
    {room.phase === 'finished' && <section className="finished-layout"><div className="winner-glow"><Trophy size={58}/><Sparkles className="winner-spark s1"/><Sparkles className="winner-spark s2"/></div><div className="eyebrow">THE FINAL SCORES ARE IN</div><h1>We have a <span>champion!</span></h1><p className="muted">15 questions. Three rounds. One winner.</p><div className="podium">{room.finalScores?.slice(0,3).map((p,i)=><div className={`podium-player place-${i+1}`} key={p.id}><div className="podium-avatar">{p.nickname.slice(0,1).toUpperCase()}</div><b>{p.nickname}</b><strong>{p.score.toLocaleString()}</strong><small>{i===0?'CHAMPION':i===1?'2ND PLACE':'3RD PLACE'}</small><div className="podium-step">{i+1}</div></div>)}</div><div className="final-list"><div className="panel-title"><h3>Final leaderboard</h3><span>ALL PLAYERS</span></div>{room.finalScores?.map((p,i)=><div className="final-row" key={p.id}><span className="final-rank">{String(i+1).padStart(2,'0')}</span><span className="final-name">{p.nickname}{p.id===session?.sessionId?' (You)':''}</span><b>{p.score.toLocaleString()} pts</b></div>)}</div>{isHost?<button className="primary-btn rematch-btn" onClick={()=>socket.emit('game:rematch')}><RotateCcw size={17}/> Play again with same players</button>:<div className="host-wait"><Crown size={17}/> Waiting for the host to start a rematch…</div>}<button className="text-btn" onClick={leaveRoom}>Leave room</button></section>}
  </main>;
}

function Brand(){return <div className="brand"><div className="brand-mark"><Zap size={19} fill="currentColor"/></div><div><b>QUIZ<span>CLASH</span></b><small>FRIENDS BATTLE</small></div></div>}
function Connection({connected}){return <div className={`connection ${connected?'online':'offline'}`}>{connected?<Wifi size={14}/>:<WifiOff size={14}/>} {connected?'CONNECTED':'RECONNECTING'}</div>}
function PlayerTile({player,index}){return <div className={`player-tile ${player.isHost?'is-host':''}`}><div className={`avatar avatar-${index%6}`}>{player.nickname.slice(0,1).toUpperCase()}</div><div className="player-info"><b>{player.nickname}</b><small>{player.isHost?'HOST':'PLAYER'}</small></div>{player.isHost&&<Crown size={16} className="host-crown"/>}<span className={`presence ${player.connected?'':'away'}`}/></div>}
function Leaderboard({players,myId}){const sorted=useMemo(()=>[...players].sort((a,b)=>b.score-a.score),[players]);return <div className="leaderboard"><div className="panel-title"><h3><Trophy size={16}/> Live leaderboard</h3><span>LIVE</span></div><div className="leader-list">{sorted.map((p,i)=><div className={`leader-row ${p.id===myId?'you':''}`} key={p.id}><span className="leader-rank">{i+1}</span><span className="leader-avatar">{p.nickname.slice(0,1).toUpperCase()}</span><span className="leader-name">{p.nickname}{p.id===myId?' (You)':''}{p.isHost&&<Crown size={12}/>}</span><b>{p.score.toLocaleString()}</b></div>)}</div></div>}
