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
    // 방 생성
    socket.on('create_room', (data) => {
        const roomId = generateRoomCode();
        rooms[roomId] = {
            roomId: roomId,
            roomStatus: 'waiting',
            currentRound: 0,
            players: {}, // key: socket.id (또는 고유 token)
            hostSocketId: socket.id,
            roundTimer: null
        };
        addPlayerToRoom(socket, roomId, data.name);
    });

    // 방 참가
    socket.on('join_room', (data) => {
        const roomId = data.roomId ? data.roomId.trim().toUpperCase() : '';
        if (!rooms[roomId]) {
            socket.emit('error_msg', '존재하지 않는 방 코드입니다!');
            return;
        }
        if (rooms[roomId].roomStatus !== 'waiting') {
            socket.emit('error_msg', '이미 진행 중인 게임입니다!');
            return;
        }
        if (Object.keys(rooms[roomId].players).length >= 6) {
            socket.emit('error_msg', '방이 꽉 찼습니다!');
            return;
        }
        addPlayerToRoom(socket, roomId, data.name);
    });

    // 모바일 재연결 시 세션 복구 (핵심 수정)
    socket.on('restore_session', (data) => {
        const { roomId, name } = data;
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            // 기존에 같은 이름의 플레이어가 있는지 확인하여 소켓 매핑 갱신
            let existingKey = Object.keys(room.players).find(k => room.players[k].name === name);
            
            if (existingKey) {
                // 기존 플레이어 데이터 유지하면서 socket.id만 교체
                const playerData = room.players[existingKey];
                delete room.players[existingKey];
                playerData.id = socket.id;
                room.players[socket.id] = playerData;
                
                if (room.hostSocketId === existingKey) {
                    room.hostSocketId = socket.id;
                }
            } else {
                // 새로 등록
                addPlayerToRoom(socket, roomId, name);
                return;
            }

            socket.join(roomId);
            socket.roomId = roomId;
            socket.emit('joined_room', { roomId, name });
            io.to(roomId).emit('update_game_state', room);
        } else {
            socket.emit('error_msg', '만료된 세션입니다. 로비로 이동합니다.');
            socket.emit('force_home');
        }
    });

    // 준비 토글
    socket.on('toggle_ready', () => {
        const room = rooms[socket.roomId];
        if (!room || socket.id === room.hostSocketId) return;
        const p = room.players[socket.id];
        if (p) {
            p.isReady = !p.isReady;
            io.to(socket.roomId).emit('update_game_state', room);
        }
    });

    // 게임 시작
    socket.on('start_game', () => {
        const room = rooms[socket.roomId];
        if (!room || socket.id !== room.hostSocketId || room.roomStatus !== 'waiting') return;
        startNewRound(room);
    });

    // 입찰 제출 (강력한 정산 로직)
    socket.on('submit_bid', (bidAmount) => {
        const room = rooms[socket.roomId];
        if (!room || room.roomStatus !== 'bidding') return;
        const p = room.players[socket.id];
        if (!p) return;

        const bid = Number(bidAmount);
        if (isNaN(bid) || bid < 0 || bid > p.money) return;

        p.bid = bid;
        io.to(socket.roomId).emit('update_game_state', room);

        // 모든 플레이어가 입찰했는지 체크
        const players = Object.values(room.players);
        const allDone = players.every(pl => typeof pl.bid === 'number');

        if (allDone) {
            if (room.roundTimer) clearInterval(room.roundTimer);
            resolveRound(room);
        }
    });

    // 채팅
    socket.on('send_chat', (msg) => {
        const room = rooms[socket.roomId];
        if (!room || !msg || !msg.trim()) return;
        const p = room.players[socket.id];
        if (!p) return;

        io.to(socket.roomId).emit('receive_chat', {
            id: socket.id,
            name: p.name,
            avatar: p.avatar,
            color: p.color,
            message: msg.trim()
        });
    });

    socket.on('disconnect', () => {
        // 모바일 화면 전환 시 바로 방에서 추방하지 않고 5초 유예 또는 유지 처리 가능하나,
        // 여기서는 소켓 연결 해제 시 세션 유지를 위해 즉시 삭제하지 않고 로그만 남김
        console.log(`소켓 연결 끊김 (백그라운드 전환 등): ${socket.id}`);
    });
});

function addPlayerToRoom(socket, roomId, name) {
    socket.join(roomId);
    socket.roomId = roomId;
    const room = rooms[roomId];
    const pKeys = Object.keys(room.players);

    room.players[socket.id] = {
        id: socket.id,
        name: name || `딜러${pKeys.length + 1}`, avatar: AVATARS[pKeys.length \% AVATARS.length], color: COLORS[pKeys.length \% COLORS.length], money: 50, score: 0, bid: null, isReady: socket.id === room.hostSocketId };  socket.emit('joined_room', { roomId, name: room.players[socket.id].name }); io.to(roomId).emit('update_game_state', room); }  function startNewRound(room) { room.roomStatus = 'bidding'; Object.values(room.players).forEach(p => p.bid = null); io.to(room.roomId).emit('game_started', { roadmap: ROADMAP }); io.to(room.roomId).emit('update_game_state', room);  if (room.roundTimer) clearInterval(room.roundTimer); let time = 300; room.roundTimer = setInterval(() => { time--; io.to(room.roomId).emit('timer_update', time); if (time <= 0) { clearInterval(room.roundTimer); Object.values(room.players).forEach(p => { if (p.bid === null) p.bid = 0; }); resolveRound(room); } }, 1000); }  function resolveRound(room) { if (room.roomStatus !== 'bidding') return; room.roomStatus = 'revealing';  const item = ROADMAP[room.currentRound]; const players = Object.values(room.players); players.sort((a, b) => b.bid - a.bid); const winner = players[0];  winner.money -= winner.bid; let msg = '';  if (item.type === 'highlight') { winner.score += 30; msg = `🔥 ${winner.avatar} ${winner.name}님이 절대자의 캔버스 낙찰! (+30점)`; } else { let val = item.type === 'blind' ? (item.isFake ? item.fakeValue : item.value) : item.value; winner.score += val; msg = `🏛️ ${winner.avatar} ${winner.name}님이 [${item.name}] 낙찰 (${winner.bid}P) ->${val > 0 ? '+' + val : val}점`;
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

server.listen(process.env.PORT || 3000, () => {
    console.log('서버 실행 중...');
});
