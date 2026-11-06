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

let gameState = {
    roomStatus: 'waiting', // waiting, bidding, revealing, ended
    currentRound: 0,
    players: {}, 
    bidsSubmittedCount: 0,
    hostId: null // 방장 소켓 ID
};

let roundTimer = null;
const ROUND_TIME_LIMIT = 300; // 5분 (300초)

io.on('connection', (socket) => {
    console.log(`플레이어 접속: ${socket.id}`);

    // 첫 번째로 들어온 사람이 자동으로 방장이 됨
    if (!gameState.hostId && gameState.roomStatus === 'waiting') {
        gameState.hostId = socket.id;
    }

    socket.on('join_game', (data) => {
        const playerKeys = Object.keys(gameState.players);
        if (playerKeys.length >= 6) {
            socket.emit('error_msg', '방이 꽉 찼습니다! (최대 6명)');
            return;
        }

        const playerIndex = playerKeys.length;
        gameState.players[socket.id] = {
            id: socket.id,
            name: data.name || `딜러${playerIndex + 1}`,
            avatar: AVATARS[playerIndex % AVATARS.length],
            color: COLORS[playerIndex % COLORS.length],
            money: 50,
            score: 0,
            bid: null,
            isReady: socket.id === gameState.hostId // 방장은 자동 준비
        };

        io.emit('update_game_state', gameState);
    });

    // 준비 토글 (레디 버튼)
    socket.on('toggle_ready', () => {
        const player = gameState.players[socket.id];
        if (player && socket.id !== gameState.hostId) {
            player.isReady = !player.isReady;
            io.emit('update_game_state', gameState);
        }
    });

    // 방장 전용 시작 버튼
    socket.on('start_game', () => {
        if (socket.id !== gameState.hostId) return;

        const playerKeys = Object.keys(gameState.players);
        if (playerKeys.length < 2) {
            socket.emit('error_msg', '최소 2명 이상의 플레이어가 필요합니다!');
            return;
        }

        if (gameState.roomStatus === 'waiting') {
            startNewRound();
        }
    });

    socket.on('submit_bid', (bidAmount) => {
        const player = gameState.players[socket.id];
        if (!player || gameState.roomStatus !== 'bidding') return;
        
        if (isNaN(bidAmount) || bidAmount < 0 || bidAmount > player.money) return;

        if (player.bid === null) {
            gameState.bidsSubmittedCount++;
        }

        player.bid = bidAmount;
        io.emit('update_game_state', gameState);

        const activePlayers = Object.values(gameState.players);
        if (gameState.bidsSubmittedCount >= activePlayers.length) {
            if (roundTimer) clearInterval(roundTimer);
            resolveRound();
        }
    });

    socket.on('send_chat', (msg) => {
        const player = gameState.players[socket.id];
        if (!player || !msg.trim()) return;

        io.emit('receive_chat', {
            id: socket.id,
            name: player.name,
            avatar: player.avatar,
            color: player.color,
            message: msg.trim()
        });
    });

    socket.on('disconnect', () => {
        if (gameState.players[socket.id]) {
            const wasHost = socket.id === gameState.hostId;
            delete gameState.players[socket.id];
            console.log(`플레이어 퇴장: ${socket.id}`);

            const remainingKeys = Object.keys(gameState.players);
            if (remainingKeys.length === 0) {
                gameState.roomStatus = 'waiting';
                gameState.currentRound = 0;
                gameState.bidsSubmittedCount = 0;
                gameState.hostId = null;
                if (roundTimer) clearInterval(roundTimer);
            } else if (wasHost) {
                // 방장이 나가면 남은 사람 중 첫 번째 사람에게 방장 위임
                gameState.hostId = remainingKeys[0];
                gameState.players[gameState.hostId].isReady = true;
            }

            io.emit('update_game_state', gameState);
        }
    });
});

function startNewRound() {
    gameState.roomStatus = 'bidding';
    gameState.bidsSubmittedCount = 0;
    Object.values(gameState.players).forEach(p => p.bid = null);
    
    io.emit('game_started', { roadmap: ROADMAP, timeLimit: ROUND_TIME_LIMIT });
    io.emit('update_game_state', gameState);

    if (roundTimer) clearInterval(roundTimer);

    let timeLeft = ROUND_TIME_LIMIT;
    roundTimer = setInterval(() => {
        timeLeft--;
        io.emit('timer_update', timeLeft);

        if (timeLeft <= 0) {
            clearInterval(roundTimer);
            Object.values(gameState.players).forEach(p => {
                if (p.bid === null) {
                    p.bid = 0;
                }
            });
            resolveRound();
        }
    }, 1000);
}

function resolveRound() {
    gameState.roomStatus = 'revealing';
    const item = ROADMAP[gameState.currentRound];
    const players = Object.values(gameState.players);

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

    io.emit('round_result', { resultMsg, gameState });

    setTimeout(() => {
        gameState.currentRound++;
        if (gameState.currentRound >= ROADMAP.length) {
            gameState.roomStatus = 'ended';
            io.emit('update_game_state', gameState);
        } else {
            startNewRound();
        }
    }, 4500);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[블라인드 마켓 서버 실행 중] http://localhost:${PORT}`);
});
