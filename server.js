const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const ROADMAP = [
    { round: 1, type: 'open', name: '모네의 수련 🖼️', desc: '안정적인 진품 미술품 (+10점)', value: 10, category: '공개 미술품' },
    { round: 2, type: 'open', name: '고흐의 해바라기 🌻', desc: '고가로 거래되는 유명 작품 (+15점)', value: 15, category: '공개 미술품' },
    { round: 3, type: 'blind', name: '미스터리 캔버스 #1 📦', desc: '대박 명작 혹은 위조품 폭탄 (-5점)', value: 12, fakeValue: -5, isFake: true, category: '블라인드 아트' },
    { round: 4, type: 'open', name: '르누아르의 소녀 👧', desc: '우아한 감성의 클래식 작품 (+10점)', value: 10, category: '공개 미술품' },
    { round: 5, type: 'blind', name: '미스터리 캔버스 #2 📦', desc: '비밀리에 부쳐진 미지의 작품', value: 20, fakeValue: -10, isFake: false, category: '블라인드 아트' },
    { round: 6, type: 'open', name: '클림트의 키스 💋', desc: '역대급 가치의 유명 걸작 (+25점)', value: 25, category: '공개 미술품' },
    { round: 7, type: 'blind', name: '미스터리 캔버스 #3 📦', desc: '위험한 감정의 블라인드 작품', value: 15, fakeValue: -8, isFake: true, category: '블라인드 아트' },
    { round: 8, type: 'open', name: '피카소의 추상화 🧩', desc: '독창적인 모더니즘 작품 (+18점)', value: 18, category: '공개 미술품' },
    { round: 9, type: 'blind', name: '미스터리 캔버스 #4 📦', desc: '마지막 감정 미지의 작품', value: 22, fakeValue: -15, isFake: false, category: '블라인드 아트' },
    { round: 10, type: 'highlight', name: '🔥 절대자의 캔버스 (Masterpiece)', desc: '판도를 뒤집는 최종 하이라이트 경매!', value: 0, category: '하이라이트 물품' }
];

const AVATARS = ['🎨', '🎭', '🗿', '🖼️', '🖌️', '💎'];
const COLORS = ['text-amber-400', 'text-indigo-400', 'text-pink-400', 'text-emerald-400', 'text-cyan-400', 'text-purple-400'];

let rooms = {};

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
    socket.on('create_room', (data) => {
        const roomId = generateRoomCode();
        rooms[roomId] = {
            roomId: roomId,
            roomStatus: 'waiting',
            currentRound: 0,
            players: {},
            hostId: socket.id,
            roundTimer: null
        };
        joinRoom(socket, roomId, data.name);
    });

    socket.on('join_room', (data) => {
        const roomId = data.roomId ? data.roomId.trim().toUpperCase() : '';
        if (!rooms[roomId] || rooms[roomId].roomStatus !== 'waiting') {
            socket.emit('error_msg', '유효하지 않거나 이미 시작된 방입니다!');
            return;
        }
        joinRoom(socket, roomId, data.name);
    });

    socket.on('reconnect_room', (data) => {
        if (data.roomId && rooms[data.roomId]) {
            joinRoom(socket, data.roomId, data.name);
        } else {
            socket.emit('error_msg', '세션이 만료되었습니다.');
        }
    });

    socket.on('toggle_ready', () => {
        const room = rooms[socket.roomId];
        if (!room || socket.id === room.hostId) return;
        const player = room.players[socket.id];
        if (player) {
            player.isReady = !player.isReady;
            io.to(socket.roomId).emit('update_game_state', room);
        }
    });

    socket.on('start_game', () => {
        const room = rooms[socket.roomId];
        if (!room || socket.id !== room.hostId || room.roomStatus !== 'waiting') return;
        startNewRound(room);
    });

    socket.on('submit_bid', (bidAmount) => {
        const room = rooms[socket.roomId];
        if (!room || room.roomStatus !== 'bidding') return;
        const player = room.players[socket.id];
        if (!player) return;

        const bid = Number(bidAmount);
        if (isNaN(bid) || bid < 0 || bid > player.money) return;

        player.bid = bid;
        io.to(socket.roomId).emit('update_game_state', room);

        // 모든 플레이어가 입찰했는지 체크 (타입 안정성 강화)
        const players = Object.values(room.players);
        const allDone = players.every(p => typeof p.bid === 'number');

        if (allDone) {
            if (room.roundTimer) clearInterval(room.roundTimer);
            resolveRound(room);
        }
    });

    socket.on('send_chat', (msg) => {
        const room = rooms[socket.roomId];
        if (!room || !msg || !msg.trim()) return;
        const player = room.players[socket.id];
        if (!player) return;

        io.to(socket.roomId).emit('receive_chat', {
            id: socket.id,
            name: player.name,
            avatar: player.avatar,
            color: player.color,
            message: msg.trim()
        });
    });

    socket.on('leave_room', () => handleLeave(socket));
    socket.on('disconnect', () => handleLeave(socket));
});

function joinRoom(socket, roomId, name) {
    socket.join(roomId);
    socket.roomId = roomId;
    const room = rooms[roomId];
    const pKeys = Object.keys(room.players);

    room.players[socket.id] = {
        id: socket.id,
        name: name || `딜러${pKeys.length + 1}`, avatar: AVATARS[pKeys.length \% AVATARS.length], color: COLORS[pKeys.length \% COLORS.length], money: 50, score: 0, bid: null, isReady: socket.id === room.hostId };  socket.emit('joined_room', { roomId, name: room.players[socket.id].name }); io.to(roomId).emit('update_game_state', room); }  function handleLeave(socket) { const room = rooms[socket.roomId]; if (!room) return; delete room.players[socket.id]; socket.leave(socket.roomId);  if (Object.keys(room.players).length === 0) { if (room.roundTimer) clearInterval(room.roundTimer); delete rooms[socket.roomId]; } else { if (socket.id === room.hostId) { room.hostId = Object.keys(room.players)[0]; room.players[room.hostId].isReady = true; } io.to(socket.roomId).emit('update_game_state', room); } }  function startNewRound(room) { room.roomStatus = 'bidding'; Object.values(room.players).forEach(p => p.bid = null); io.to(room.roomId).emit('game_started', { roadmap: ROADMAP }); io.to(room.roomId).emit('update_game_state', room);  if (room.roundTimer) clearInterval(room.roundTimer); let time = 300; room.roundTimer = setInterval(() => { time--; io.to(room.roomId).emit('timer_update', time); if (time <= 0) { clearInterval(room.roundTimer); Object.values(room.players).forEach(p => { if (p.bid === null) p.bid = 0; }); resolveRound(room); } }, 1000); }  function resolveRound(room) { if (room.roomStatus !== 'bidding') return; room.roomStatus = 'revealing';  const item = ROADMAP[room.currentRound]; const players = Object.values(room.players); players.sort((a, b) => b.bid - a.bid); const winner = players[0];  winner.money -= winner.bid; let msg = '';  if (item.type === 'highlight') { winner.score += 30; msg = `🔥 ${winner.avatar} ${winner.name}님이 절대자의 캔버스 낙찰! (+30점)`; } else { let val = item.type === 'blind' ? (item.isFake ? item.fakeValue : item.value) : item.value; winner.score += val; msg = `🏛️ ${winner.avatar} ${winner.name}님이 [${item.name}] 낙찰 (${winner.bid}P) ->${val > 0 ? '+' + val : val}점`;
    }

    io.to(room.roomId).emit('round_result', { resultMsg: msg, roomState: room });

    setTimeout(() => {
        room.currentRound++;
        if (room.currentRound >= ROADMAP.length) {
            room.roomStatus = 'ended';
            io.to(room.roomId).emit('update_game_state', room);
        } else {
            startNewRound(room);
        }
    }, 4000);
}

server.listen(process.env.PORT || 3000);
