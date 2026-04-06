const express = require('express');
const mysql = require('mysql2');
const path = require('path');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
require('dotenv').config();

app.use(express.static(path.join(__dirname, 'public')));

const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306
});

const rooms = {}; 
const socketToRoom = {};

// Ludo Path Length (0 is base, 1-52 is track, 53 is win)
const MAX_STEPS = 53; 
// Starting offsets on the track for Player 1, 2, 3, 4
const START_OFFSETS = [1, 14, 27, 40]; 

io.on('connection', (socket) => {
    
    // --- AUTHENTICATION (Unchanged) ---
    socket.on('auth_register', (data) => {
        const { user, pass } = data;
        db.query('SELECT * FROM users WHERE username = ?', [user], (err, results) => {
            if (results.length > 0) return socket.emit('auth_error', 'Username exists.');
            db.query('INSERT INTO users (username, password, inventory) VALUES (?, ?, ?)', 
            [user, pass, JSON.stringify(['avatar_default', 'ability_none'])], () => {
                socket.emit('auth_success', {
                    username: user, coins: 600, xp: 0,
                    inventory: ['avatar_default', 'ability_none'],
                    selectedAvatar: 'avatar_default', selectedAbility: 'ability_none'
                });
            });
        });
    });

    socket.on('auth_login', (data) => {
        const { user, pass } = data;
        db.query('SELECT * FROM users WHERE username = ? AND password = ?', [user, pass], (err, results) => {
            if (results.length > 0) {
                const u = results[0];
                socket.emit('auth_success', {
                    username: u.username, coins: u.coins, xp: u.xp,
                    inventory: typeof u.inventory === 'string' ? JSON.parse(u.inventory) : u.inventory,
                    selectedAvatar: u.selectedAvatar, selectedAbility: u.selectedAbility
                });
                socket.username = u.username;
            } else socket.emit('auth_error', 'Invalid credentials.');
        });
    });

    socket.on('save_data', (data) => {
        if (socket.username) {
            db.query(`UPDATE users SET coins = ?, xp = ?, inventory = ?, selectedAvatar = ?, selectedAbility = ? WHERE username = ?`,
                [data.coins, data.xp, JSON.stringify(data.inventory), data.selectedAvatar, data.selectedAbility, socket.username]);
        }
    });

    // --- LUDO GAME LOGIC ---
    socket.on('joinRoom', (data) => {
        const { roomId, playerName, maxPlayers, avatar, ability } = data;
        if (!rooms[roomId]) rooms[roomId] = { players: [], maxPlayers: parseInt(maxPlayers) || 2, currentTurn: 0, isPlaying: false };
        const room = rooms[roomId];
        
        if (room.players.length < room.maxPlayers && !room.isPlaying) {
            socket.join(roomId);
            socketToRoom[socket.id] = roomId;
            room.players.push({ 
                id: socket.id, name: playerName, 
                avatar: avatar || 'avatar_default', ability: ability || 'ability_none',
                isHost: room.players.length === 0, 
                stepsTaken: 0, // 0 = at base
                playerIndex: room.players.length // 0, 1, 2, or 3
            });
            io.to(roomId).emit('playerCountUpdate', { count: room.players.length, max: room.maxPlayers, players: room.players });
        }
    });

    socket.on('startGameSignal', (roomId) => {
        const room = rooms[roomId];
        if (room) {
            room.isPlaying = true;
            io.to(roomId).emit('initGame', { players: room.players, currentTurnId: room.players[0].id });
        }
    });

    socket.on('rollDice', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;
        
        const currentPlayer = room.players[room.currentTurn];
        if (currentPlayer.id !== socket.id) return; // Not your turn!

        const diceValue = Math.floor(Math.random() * 6) + 1;
        
        // --- Movement Logic ---
        // If at base (0), need a 6 to start
        if (currentPlayer.stepsTaken === 0) {
            if (diceValue === 6) currentPlayer.stepsTaken = 1;
        } else {
            // Move forward
            if (currentPlayer.stepsTaken + diceValue <= MAX_STEPS) {
                currentPlayer.stepsTaken += diceValue;
            }
        }

        // --- Collision Logic (Send back to base) ---
        let killedSomeone = false;
        if (currentPlayer.stepsTaken > 0 && currentPlayer.stepsTaken < MAX_STEPS) {
            const myAbsolutePos = calculateAbsolutePosition(currentPlayer.stepsTaken, currentPlayer.playerIndex);
            
            room.players.forEach(rival => {
                if (rival.id !== currentPlayer.id && rival.stepsTaken > 0 && rival.stepsTaken < MAX_STEPS) {
                    const rivalPos = calculateAbsolutePosition(rival.stepsTaken, rival.playerIndex);
                    if (myAbsolutePos === rivalPos) {
                        rival.stepsTaken = 0; // Send rival to base!
                        killedSomeone = true;
                        io.to(roomId).emit('playerKilled', { victim: rival.name, killer: currentPlayer.name });
                        
                        // Fire Sword Ability: Bonus if they kill someone
                        if (currentPlayer.ability === 'ability_fire_sword') {
                            io.to(roomId).emit('abilityTriggered', { user: currentPlayer.name, type: 'fire_sword' });
                        }
                    }
                }
            });
        }

        // --- Check Win ---
        if (currentPlayer.stepsTaken === MAX_STEPS) {
            io.to(roomId).emit('diceRolled', { player: currentPlayer.name, roll: diceValue, players: room.players });
            setTimeout(() => {
                io.to(roomId).emit('gameOver', currentPlayer);
                delete rooms[roomId];
            }, 1000);
            return;
        }

        // --- Next Turn ---
        // If they rolled a 6, they get another turn. Otherwise, pass turn.
        if (diceValue !== 6) {
            room.currentTurn = (room.currentTurn + 1) % room.players.length;
        }

        io.to(roomId).emit('diceRolled', { 
            player: currentPlayer.name, roll: diceValue, 
            players: room.players, currentTurnId: room.players[room.currentTurn].id 
        });
    });

    function calculateAbsolutePosition(steps, playerIdx) {
        if (steps === 0) return -1; // Base
        const startOffset = START_OFFSETS[playerIdx];
        let pos = startOffset + steps - 1;
        if (pos > 52) pos = pos - 52; // Loop around the board
        return pos;
    }

    socket.on('disconnect', () => {
        const roomId = socketToRoom[socket.id];
        if (roomId && rooms[roomId]) {
            const disconnectedPlayer = rooms[roomId].players.find(p => p.id === socket.id);
            if (disconnectedPlayer) io.to(roomId).emit('playerDisconnected', disconnectedPlayer.name);
            rooms[roomId].players = rooms[roomId].players.filter(p => p.id !== socket.id);
            if (rooms[roomId].players.length === 0) delete rooms[roomId];
            delete socketToRoom[socket.id];
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
