const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

// 10라운드 갤러리 경매 로드맵
const ROADMAP = [
    { round: 1, type: 'open', name: '모네의 수련', desc: '안정적인 진품 미술품 (+10점)', value: 10, category: '공개 미술품' },
    { round: 2, type: 'open', name: '고흐의 해바라기', desc: '고가로 거래되는 유명 작품 (+15점)', value: 15, category: '공개 미술품' },
    { round: 3, type: 'blind', name: '미스터리 캔버스 #1', desc: '대박 명작 혹은 위조품 폭탄 (-5점)', value: 12, fakeValue: -5, isFake: true, category: '블라인드 아트' },
    { round: 4, type: 'open', name: '르누아르의 소녀', desc: '우아한 감성의 클래식 작품 (+10점)', value: 10, category: '공개 미술품' },
    { round: 5, type: 'blind', name: '미스터리 캔버스 #2', desc: '비밀리에 부쳐진 미지의 작품', value: 20, fakeValue: -10, isFake: false, category: '블라인드 아트' },
    { round: 6, type: 'open', name: '클림트의 키스', desc: '역대급 가치의 유명 걸작 (+25점)', value: 25, category: '공개 미술품' },
    { round: 7, type: 'blind', name: '미스터리 캔버스 #3', desc: '위험한 감정의 블라인드 작품', value: 15, fakeValue: -8, isFake: true, category: '블라인드 아트' },
    { round: 8, type: 'open', name: '피카소의 추상화', desc: '독창적인 모더니즘 작품 (+18점)', value: 18, category: '공개 미술품' },
    { round: 9, type: 'blind', name: '미스터리 캔버스 #4', desc: '마지막 감정 미지의 작품', value: 22, fakeValue: -15, isFake: false, category: '블라인드 아트' },
    { round: 10, type: 'highlight', name: '🔥 절대자의 캔버스 (Masterpiece)', desc: '판도를 뒤집는 최종 하이라이트 경매!', value: 0, category: '하이라이트 물품' }
];

const AVATARS = ['🎨', '🎭', '🗿', '🖼️', '🖌️', '💎'];
const COLORS = ['text-amber-400', 'text-indigo-400', 'text-pink-400', 'text-emerald-400', 'text-cyan-400', 'text-purple-400'];

let gameState = {
    roomStatus: 'waiting', // waiting, bidding, revealing, ended
    currentRound: 0,
    players: {}, 
    bidsSubmittedCount: 0
};

io.on('connection', (socket) => {
    console.log(`플레이어 접속: ${socket.id}`);

    // 플레이어 입장
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
            bid: null
        };

        io.emit('update_game_state', gameState);
    });

    // 게임 시작 (방장 또는 누구나 가능)
    socket.on('start_game', () => {
        const playerKeys = Object.keys(gameState.players);
        if (playerKeys.length > 0 && gameState.roomStatus === 'waiting') {
            gameState.roomStatus = 'bidding';
            gameState.currentRound = 0;
            gameState.bidsSubmittedCount = 0;
            playerKeys.forEach(id => {
                gameState.players[id].money = 50;
                gameState.players[id].score = 0;
                gameState.players[id].bid = null;
            });
            io.emit('game_started', { roadmap: ROADMAP });
            io.emit('update_game_state', gameState);
        }
    });

    // 비밀 입찰 제출
    socket.on('submit_bid', (bidAmount) => {
        const player = gameState.players[socket.id];
        if (!player || gameState.roomStatus !== 'bidding') return;
        
        // 유효성 검사 (음수 불가, 보유 자금 초과 불가)
        if (isNaN(bidAmount) || bidAmount < 0 || bidAmount > player.money) return;

        // 이미 제출했으면 중복 카운트 방지
        if (player.bid === null) {
            gameState.bidsSubmittedCount++;
        }

        player.bid = bidAmount;
        io.emit('update_game_state', gameState);

        // 모든 접속 플레이어가 입찰을 완료했는지 확인
        const activePlayers = Object.values(gameState.players);
        if (gameState.bidsSubmittedCount >= activePlayers.length) {
            resolveRound();
        }
    });

    // 채팅 메시지 전송
    socket.on('send_chat', (msg) => {
        const player = gameState.players[socket.id];
        if (!player || !msg.trim()) return;

        io.emit('receive_chat', {
            name: player.name,
            avatar: player.avatar,
            color: player.color,
            message: msg.trim()
        });
    });

    // 연결 종료 처리
    socket.on('disconnect', () => {
        if (gameState.players[socket.id]) {
            delete gameState.players[socket.id];
            io.emit('update_game_state', gameState);
            console.log(`플레이어 퇴장: ${socket.id}`);

            // 플레이어가 다 나가면 대기실 상태로 리셋
            if (Object.keys(gameState.players).length === 0) {
                gameState.roomStatus = 'waiting';
                gameState.currentRound = 0;
                gameState.bidsSubmittedCount = 0;
            }
        }
    });
});

// 라운드 정산 및 판정 함수
function resolveRound() {
    gameState.roomStatus = 'revealing';
    const item = ROADMAP[gameState.currentRound];
    const players = Object.values(gameState.players);

    // 입찰 금액 기준 내림차순 정렬 (동점 시 먼저 제출한 사람 등은 단순화하여 첫 번째 사람 낙찰)
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

    // 4.5초 후 다음 라운드로 전환 또는 게임 종료
    setTimeout(() => {
        gameState.currentRound++;
        gameState.bidsSubmittedCount = 0;
        Object.values(gameState.players).forEach(p => p.bid = null);

        if (gameState.currentRound >= ROADMAP.length) {
            gameState.roomStatus = 'ended';
        } else {
            gameState.roomStatus = 'bidding';
        }
        io.emit('update_game_state', gameState);
    }, 4500);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[블라인드 마켓 멀티플레이 서버 실행 중] http://localhost:${PORT}`);
});