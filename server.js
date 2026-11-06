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
            hostToken: null,
            roundTimer: null
        };
        handleLogin(socket, roomId, data.name, data.token);
    });

    socket.on('join_room', (data) => {
        const roomId = data.roomId ? data.roomId.trim().toUpperCase() : '';
        if (!rooms[roomId]) {
            socket.emit('error_msg', '존재하지 않는 방 코드입니다!');
            return;
        }
        handleLogin(socket, roomId, data.name, data.token);
    });

    socket.on('leave_room', (token) => {
        handleLeaveRoom(socket, token);
    });

    socket.on('toggle_ready', (token) => {
        const room = rooms[socket.roomId];
        if (!room) return;
        const player = Object.values(room.players).find(p => p.token === token);
        if (player && player.token !== room.hostToken) {
            player.isReady = !player.isReady;
            io.to(socket.roomId).emit('update_game_state', room);
        }
    });

    socket.on('start_game', (token) => {
        const room = rooms[socket.roomId];
        if (!room || room.hostToken !== token || room.roomStatus !== 'waiting') return;
        startNewRound(room);
    });

    socket.on('submit_bid', (data) => {
        const room = rooms[socket.roomId];
        if (!room || room.roomStatus !== 'bidding') return;
        
        const player = Object.values(room.players).find(p => p.token === data.token);
        if (!player) return;

        const bid = Number(data.bidAmount);
        if (isNaN(bid) || bid < 0 || bid > player.money) return;

        player.bid = bid;
        io.to(socket.roomId).emit('update_game_state', room);

        const players = Object.values(room.players);
        const allDone = players.every(p => typeof p.bid === 'number' && !isNaN(p.bid));

        if (allDone && room.roomStatus === 'bidding') {
            if (room.roundTimer) clearInterval(room.roundTimer);
            resolveRound(room);
        }
    });

    socket.on('send_chat', (data) => {
        const room = rooms[socket.roomId];
        if (!room || !data.msg || !data.msg.trim()) return;
        const player = Object.values(room.players).find(p => p.token === data.token);
        if (!player) return;

        io.to(socket.roomId).emit('receive_chat', {
            name: player.name,
            avatar: player.avatar,
            color: player.color,
            message: data.msg.trim()
        });
    });

    socket.on('disconnect', () => {});
});

function handleLogin(socket, roomId, name, token) {
    const room = rooms[roomId];
    let playerToken = token;
    
    let existingPlayer = Object.values(room.players).find(p => p.token === playerToken);

    if (!existingPlayer && name) {
        existingPlayer = Object.values(room.players).find(p => p.name === name);
        if (existingPlayer) {
            playerToken = existingPlayer.token;
        }
    }

    if (!existingPlayer) {
        playerToken = 'tok_' + Math.random().toString(36).substring(2, 9);
        const pKeys = Object.keys(room.players);
        
        if (pKeys.length >= 6 && room.roomStatus !== 'waiting') {
            socket.emit('error_msg', '방이 꽉 찼거나 이미 진행 중입니다!');
            return;
        }

        if (pKeys.length === 0) {
            room.hostToken = playerToken;
        }

        room.players[socket.id] = {
            socketId: socket.id,
            token: playerToken,
            name: name || `딜러${pKeys.length + 1}`,
            avatar: AVATARS[pKeys.length % AVATARS.length],
            color: COLORS[pKeys.length % COLORS.length],
            money: 50,
            score: 0,
            bid: null,
            isReady: pKeys.length === 0
        };
    } else {
        delete room.players[existingPlayer.socketId];
        existingPlayer.socketId = socket.id;
        room.players[socket.id] = existingPlayer;
    }

    socket.join(roomId);
    socket.roomId = roomId;

    socket.emit('joined_room', { roomId, token: playerToken, name: room.players[socket.id].name });
    io.to(roomId).emit('update_game_state', room);
}

function handleLeaveRoom(socket, token) {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];
    let targetSocketId = null;
    for (const [sId, p] of Object.entries(room.players)) {
        if (p.token === token) {
            targetSocketId = sId;
            break;
        }
    }

    if (targetSocketId) {
        delete room.players[targetSocketId];
    }

    socket.leave(roomId);
    socket.roomId = null;
    socket.emit('left_room');

    if (Object.keys(room.players).length === 0) {
        if (room.roundTimer) clearInterval(room.roundTimer);
        delete rooms[roomId];
    } else {
        if (room.hostToken === token) {
            const nextPlayer = Object.values(room.players)[0];
            room.hostToken = nextPlayer.token;
            nextPlayer.isReady = true;
        }
        io.to(roomId).emit('update_game_state', room);
    }
}

function startNewRound(room) {
    room.roomStatus = 'bidding';
    Object.values(room.players).forEach(p => p.bid = null);
    io.to(room.roomId).emit('game_started', { roadmap: ROADMAP });
    io.to(room.roomId).emit('update_game_state', room);

    if (room.roundTimer) clearInterval(room.roundTimer);
    let time = 300;
    room.roundTimer = setInterval(() => {
        time--;
        io.to(room.roomId).emit('timer_update', time);
        if (time <= 0) {
            clearInterval(room.roundTimer);
            Object.values(room.players).forEach(p => {
                if (p.bid === null) p.bid = 0;
            });
            resolveRound(room);
        }
    }, 1000);
}

function resolveRound(room) {
    if (room.roomStatus !== 'bidding') return;
    room.roomStatus = 'revealing';

    const item = ROADMAP[room.currentRound];
    const players = Object.values(room.players);
    players.sort((a, b) => b.bid - a.bid);
    const winner = players[0];

    winner.money -= winner.bid;
    let msg = '';

    if (item.type === 'highlight') {
        winner.score += 30;
        msg = `🔥 ${winner.avatar} ${winner.name}님이 절대자의 캔버스 낙찰! (+30점)`;
    } else {
        let val = item.type === 'blind' ? (item.isFake ? item.fakeValue : item.value) : item.value;
        winner.score += val;
        msg = `🏛️ ${winner.avatar} ${winner.name}님이 [${item.name}] 낙찰 (${winner.bid}P) -> ${val > 0 ? '+' + val : val}점`;
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
