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
    console.log(`플레이어 접속: ${socket.id}`);

    socket.on('create_room', (data) => {
        const roomId = generateRoomCode();
        rooms[roomId] = {
            roomId: roomId,
            roomStatus: 'waiting',
            currentRound: 0,
            players: {},
            bidsSubmittedCount: 0,
            hostId: socket.id,
            roundTimer: null
        };
        joinRoom(socket, roomId, data.name);
    });

    socket.on('join_room', (data) => {
        const roomId = data.roomId ? data.roomId.trim().toUpperCase() : '';
        if (!rooms[roomId]) {
            socket.emit('error_msg', '존재하지 않거나 만료된 방 코드입니다!');
            return;
        }
        if (rooms[roomId].roomStatus !== 'waiting') {
            socket.emit('error_msg', '이미 게임이 진행 중인 방입니다!');
            return;
        }
        if (Object.keys(rooms[roomId].players).length >= 6) {
            socket.emit('error_msg', '방이 꽉 찼습니다! (최대 6명)');
            return;
        }
        joinRoom(socket, roomId, data.name);
    });

    // 준비 상태 토글
    socket.on('toggle_ready', () => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;

        const room = rooms[roomId];
        const player = room.players[socket.id];
        if (player && socket.id !== room.hostId) {
            player.isReady = !player.isReady;
            io.to(roomId).emit('update_game_state', room);
        }
    });

    // 방장 게임 시작 (모든 참여자가 준비 완료 상태여야 함)
    socket.on('start_game', () => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;

        const room = rooms[roomId];
        if (socket.id !== room.hostId) return;

        const players = Object.values(room.players);
        if (players.length < 2) {
            socket.emit('error_msg', '최소 2명 이상의 플레이어가 필요합니다!');
            return;
        }

        // 방장을 제외한 모든 참여자가 레디를 완료했는지 검사
        const unreadyPlayers = players.filter(p => p.id !== room.hostId && !p.isReady);
        if (unreadyPlayers.length > 0) {
            socket.emit('error_msg', '모든 플레이어가 [게임 준비]를 완료해야 시작할 수 있습니다!');
            return;
        }

        if (room.roomStatus === 'waiting') {
            startNewRound(room);
        }
    });

    socket.on('submit_bid', (bidAmount) => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;

        const room = rooms[roomId];
        const player = room.players[socket.id];
        if (!player || room.roomStatus !== 'bidding') return;
        
        if (isNaN(bidAmount) || bidAmount < 0 || bidAmount > player.money) return;

        if (player.bid === null) {
            room.bidsSubmittedCount++;
        }

        player.bid = bidAmount;
        io.to(roomId).emit('update_game_state', room);

        const activePlayers = Object.values(room.players);
        if (room.bidsSubmittedCount >= activePlayers.length) {
            if (room.roundTimer) clearInterval(room.roundTimer);
            resolveRound(room);
        }
    });

    socket.on('send_chat', (msg) => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;

        const room = rooms[roomId];
        const player = room.players[socket.id];
        if (!player || !msg.trim()) return;

        io.to(roomId).emit('receive_chat', {
            id: socket.id,
            name: player.name,
            avatar: player.avatar,
            color: player.color,
            message: msg.trim()
        });
    });

    socket.on('disconnect', () => {
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            const wasHost = socket.id === room.hostId;
            delete room.players[socket.id];

            const remainingKeys = Object.keys(room.players);
            if (remainingKeys.length === 0) {
                if (room.roundTimer) clearInterval(room.roundTimer);
                delete rooms[roomId];
            } else {
                if (wasHost) {
                    room.hostId = remainingKeys[0];
                    room.players[room.hostId].isReady = true;
                }
                io.to(roomId).emit('update_game_state', room);
            }
        }
    });
});

function joinRoom(socket, roomId, name) {
    socket.join(roomId);
    socket.roomId = roomId;

    const room = rooms[roomId];
    const playerKeys = Object.keys(room.players);
    const playerIndex = playerKeys.length;

    room.players[socket.id] = {
        id: socket.id,
        name: name || `딜러${playerIndex + 1}`,
        avatar: AVATARS[playerIndex % AVATARS.length],
        color: COLORS[playerIndex % COLORS.length],
        money: 50,
        score: 0,
        bid: null,
        isReady: socket.id === room.hostId // 방장은 자동 준비
    };

    socket.emit('joined_room', { roomId: roomId });
    io.to(roomId).emit('update_game_state', room);
}

function startNewRound(room) {
    room.roomStatus = 'bidding';
    room.bidsSubmittedCount = 0;
    Object.values(room.players).forEach(p => p.bid = null);
    
    io.to(room.roomId).emit('game_started', { roadmap: ROADMAP, timeLimit: 300 });
    io.to(room.roomId).emit('update_game_state', room);

    if (room.roundTimer) clearInterval(room.roundTimer);

    let timeLeft = 300;
    room.roundTimer = setInterval(() => {
        timeLeft--;
        io.to(room.roomId).emit('timer_update', timeLeft);

        if (timeLeft <= 0) {
            clearInterval(room.roundTimer);
            Object.values(room.players).forEach(p => {
                if (p.bid === null) p.bid = 0;
            });
            resolveRound(room);
        }
    }, 1000);
}

function resolveRound(room) {
    room.roomStatus = 'revealing';
    const item = ROADMAP[room.currentRound];
    const players = Object.values(room.players);

    players.sort((a, b) => b.bid - a.bid);
    const winner = players[0];
    let resultMsg = '';

    if (item.type === 'highlight') {
        const effects = ['x2', '/2', 'bankruptcy', 'power'];
        const chosenEffect = effects[Math.floor(Math.random() * effects.length)];
        winner.money -= winner.bid;

        if (chosenEffect === 'x2') {
            winner.score *= 2;
            resultMsg = `🔥 ${winner.avatar} ${winner.name}님이 하이라이트 낙찰! [최종 점수 2배 잭팟!]`;
        } else if (chosenEffect === '/2') {
            winner.score = Math.floor(winner.score / 2);
            resultMsg = `🔥 ${winner.avatar} ${winner.name}님이 하이라이트 낙찰! [반토막 저주 폭삭 ㅠㅠ]`;
        } else if (chosenEffect === 'bankruptcy') {
            winner.money = 0;
            resultMsg = `🔥 ${winner.avatar} ${winner.name}님이 하이라이트 낙찰! [전 재산 파산 폭탄!]`;
        } else {
            winner.score += 30;
            resultMsg = `🔥 ${winner.avatar} ${winner.name}님이 하이라이트 낙찰! [절대 권력 +30점 획득!]`;
        }
    } else {
        let actualValue = item.value;
        if (item.type === 'blind') {
            actualValue = item.isFake ? item.fakeValue : item.value;
        }

        winner.money -= winner.bid;
        winner.score += actualValue;

        const itemTypeStr = item.type === 'blind' ? (item.isFake ? '가짜 위조품 🎭' : '대박 명작 💎') : '진품 미술품 🖼️';
        resultMsg = `🏛️ ${winner.avatar} ${winner.name}님이 [${item.name}] 낙찰 (${winner.bid}P 지불) -> ${itemTypeStr} (${actualValue > 0 ? '+' + actualValue : actualValue}점)`;
    }

    io.to(room.roomId).emit('round_result', { resultMsg, roomState: room });

    setTimeout(() => {
        room.currentRound++;
        if (room.currentRound >= ROADMAP.length) {
            room.roomStatus = 'ended';
            io.to(room.roomId).emit('update_game_state', room);
        } else {
            startNewRound(room);
        }
    }, 4500);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[블라인드 마켓 서버 실행 중] http://localhost:${PORT}`);
});
