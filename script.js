const socket = io();

// --- Local State (Unchanged Auth) ---
let currentUser = { isLoggedIn: false, name: "Guest", coins: 600, xp: 0, inventory: ['avatar_default', 'ability_none'], selectedAvatar: 'avatar_default', selectedAbility: 'ability_none' };
let currentRoomId = null;
let isHost = false;
let myPlayerId = null;

// [KEEP ALL YOUR EXISTING AUTH, VAULT, AND SHOP FUNCTIONS HERE - THEY REMAIN EXACTLY THE SAME]

// --- ROOM & GAME LOGIC ---
function createRoom() {
    const limit = document.getElementById('player-limit').value;
    const id = Math.random().toString(36).substring(2, 8).toUpperCase();
    socket.emit('joinRoom', { roomId: id, playerName: currentUser.name, avatar: currentUser.selectedAvatar, ability: currentUser.selectedAbility, maxPlayers: limit });
    enterWaitingRoom(id);
}

function joinRoom() {
    const id = document.getElementById('room-input').value.trim().toUpperCase();
    if (id) {
        socket.emit('joinRoom', { roomId: id, playerName: currentUser.name, avatar: currentUser.selectedAvatar, ability: currentUser.selectedAbility });
        enterWaitingRoom(id);
    }
}

function enterWaitingRoom(id) {
    currentRoomId = id;
    document.getElementById('lobby').classList.add('hidden');
    document.getElementById('waiting-room').classList.remove('hidden');
    document.getElementById('wait-room-id').innerText = `ROOM: ${id}`;
}

function requestStart() { socket.emit('startGameSignal', currentRoomId); }

socket.on('playerCountUpdate', (data) => {
    const me = data.players.find(p => p.id === socket.id);
    if(me) myPlayerId = me.id;
    isHost = me ? me.isHost : false;
    
    document.getElementById('player-count-text').innerText = `Players: ${data.count}/${data.max}`;
    document.getElementById('start-game-btn').classList.toggle('hidden', !isHost);
    document.getElementById('host-wait-msg').classList.toggle('hidden', isHost);
    document.getElementById('start-game-btn').disabled = (data.count < 2);
    
    document.getElementById('player-list').innerHTML = data.players.map((p, i) => {
        let colorDot = ['🔴', '🔵', '🟢', '🟣'][i] || '⚪'; 
        return `<li style="padding: 5px 0;">${colorDot} ${p.avatar === 'avatar_knight' ? '🛡️' : '👤'} ${p.name} ${p.id === socket.id ? '(You)' : ''}</li>`;
    }).join('');
});

// --- LUDO GAMEPLAY ---
socket.on('initGame', (data) => {
    document.getElementById('waiting-room').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');
    
    // Create Ludo Board Tracks
    generateLudoBoard();
    
    data.players.forEach((p, i) => {
        const div = document.getElementById(`player${i+1}`);
        div.classList.remove('hidden');
        div.innerHTML = p.avatar === 'avatar_knight' ? '🛡️' : '👤';
    });
    
    updateUI(data.players);
    updateTurnUI(data.currentTurnId);
});

function rollDice() {
    socket.emit('rollDice', currentRoomId);
}

socket.on('diceRolled', (data) => {
    const diceEl = document.getElementById('dice-display');
    diceEl.innerText = `🎲 ${data.roll}`;
    diceEl.classList.add('shake');
    setTimeout(() => diceEl.classList.remove('shake'), 300);

    showToast(`${data.player} rolled a ${data.roll}!`);
    updateUI(data.players);
    updateTurnUI(data.currentTurnId);
});

socket.on('playerKilled', (data) => {
    showToast(`⚔️ ${data.killer} sent ${data.victim} back to base!`);
});

socket.on('abilityTriggered', (data) => {
    if(data.type === 'fire_sword') showToast(`🔥 ${data.user}'s Fire Sword scorched the enemy!`);
});

function updateTurnUI(turnId) {
    const rollBtn = document.getElementById('roll-btn');
    const statusMsg = document.getElementById('status');
    
    if (turnId === myPlayerId) {
        rollBtn.classList.remove('hidden');
        statusMsg.innerText = "YOUR TURN!";
        statusMsg.style.color = "var(--accent-green)";
    } else {
        rollBtn.classList.add('hidden');
        statusMsg.innerText = "Waiting for opponent's turn...";
        statusMsg.style.color = "var(--text-dim)";
    }
}

// Map logical Ludo steps to grid cells visually
function generateLudoBoard() {
    const b = document.getElementById('board');
    if (b.querySelectorAll('.cell').length > 0) return;
    
    // Generate 53 spaces (52 track + 1 center/win)
    for (let i = 0; i <= 53; i++) {
        const c = document.createElement('div');
        c.className = 'cell'; 
        c.id = 'cell-' + i; 
        if (i === 0) c.innerText = 'BASE';
        else if (i === 53) c.innerText = 'WIN';
        else c.innerText = i;
        b.appendChild(c);
    }
}

function updateUI(players) {
    players.forEach((p) => {
        const div = document.getElementById('player' + (p.playerIndex + 1));
        let cellId = 'cell-' + p.stepsTaken; // Visually we just map their steps to the grid linearly for now
        const cell = document.getElementById(cellId);
        
        if (cell && div) {
            div.style.left = (cell.offsetLeft + 5 + (p.playerIndex * 5)) + 'px';
            div.style.top = (cell.offsetTop + 5 + (p.playerIndex * 5)) + 'px';
        }
    });
}

socket.on('gameOver', (winner) => {
    const modal = document.getElementById('game-over-modal');
    document.getElementById('winner-name').innerText = winner.name;
    document.getElementById('game-screen').classList.add('hidden');
    modal.style.display = 'block';
});

// Toast System
function showToast(msg) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast'; toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}
socket.on('playerDisconnected', (playerName) => showToast(`🚫 ${playerName} left.`));

// (Keep all your existing playGuest, login, openVault, etc. functions here exactly as they were)
