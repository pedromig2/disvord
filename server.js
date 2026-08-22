const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const USERS_FILE = './users.json';
const SERVERS_FILE = './servers.json';
const activeUsers = {};

function getUsers() {
    if (!fs.existsSync(USERS_FILE)) return {};
    return JSON.parse(fs.readFileSync(USERS_FILE));
}

function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function getServers() {
    if (!fs.existsSync(SERVERS_FILE)) return {};
    return JSON.parse(fs.readFileSync(SERVERS_FILE));
}

function saveServers(servers) {
    fs.writeFileSync(SERVERS_FILE, JSON.stringify(servers, null, 2));
}

io.on('connection', (socket) => {
    socket.on('register', ({ username, password }) => {
        const users = getUsers();
        if (users[username]) {
            socket.emit('auth-response', { success: false, message: 'Usuário já existe!' });
        } else {
            users[username] = { 
                password, 
                friends: [], 
                pendingIncoming: [], 
                pendingOutgoing: [], 
                servers: [],
                displayName: username,
                bio: 'Olá! Estou usando o Discord Clone.',
                avatar: '',
                accentColor: '#5865F2'
            };
            saveUsers(users);
            socket.emit('auth-response', { success: true, message: 'Conta criada com sucesso!' });
        }
    });

    socket.on('login', ({ username, password }) => {
        const users = getUsers();
        if (users[username] && users[username].password === password) {
            socket.data.username = username;
            activeUsers[socket.id] = username;
            socket.emit('auth-response', { success: true, username, profile: users[username] });
            updateUserData(username);
        } else {
            socket.emit('auth-response', { success: false, message: 'Usuário ou senha incorretos!' });
        }
    });

    socket.on('auto-login', ({ username }) => {
        const users = getUsers();
        if (users[username]) {
            socket.data.username = username;
            activeUsers[socket.id] = username;
            socket.emit('auth-response', { success: true, username, profile: users[username] });
            updateUserData(username);
        }
    });

    // Sistema de Atualização de Perfil
    socket.on('update-profile', ({ displayName, bio, avatar, accentColor }) => {
        const username = socket.data.username;
        const users = getUsers();
        if (users[username]) {
            users[username].displayName = displayName || username;
            users[username].bio = bio || '';
            users[username].avatar = avatar || '';
            users[username].accentColor = accentColor || '#5865F2';
            saveUsers(users);
            socket.emit('profile-updated', { success: true, message: 'Perfil atualizado com sucesso!', profile: users[username] });
            updateUserData(username);
        }
    });

    // Sistema de Servidores e Convites
    socket.on('create-server', ({ serverName }) => {
        const username = socket.data.username;
        const servers = getServers();
        const users = getUsers();

        const serverId = 'srv_' + Math.random().toString(36).substr(2, 9);
        const inviteCode = Math.random().toString(36).substr(2, 6).toUpperCase();

        servers[serverId] = {
            id: serverId,
            name: serverName,
            owner: username,
            members: [username],
            inviteCode: inviteCode,
            channels: ['geral', 'jogos', 'voz']
        };

        if (!users[username].servers) users[username].servers = [];
        users[username].servers.push(serverId);

        saveServers(servers);
        saveUsers(users);

        socket.emit('server-created', servers[serverId]);
        updateUserData(username);
    });

    socket.on('join-server-invite', ({ inviteCode }) => {
        const username = socket.data.username;
        const servers = getServers();
        const users = getUsers();

        let targetServer = null;
        for (let id in servers) {
            if (servers[id].inviteCode === inviteCode) {
                targetServer = servers[id];
                break;
            }
        }

        if (!targetServer) {
            socket.emit('server-action-response', { success: false, message: 'Convite inválido ou expirado!' });
            return;
        }

        if (targetServer.members.includes(username)) {
            socket.emit('server-action-response', { success: false, message: 'Você já está neste servidor!' });
            return;
        }

        targetServer.members.push(username);
        if (!users[username].servers) users[username].servers = [];
        users[username].servers.push(targetServer.id);

        saveServers(servers);
        saveUsers(users);

        socket.emit('server-joined', targetServer);
        updateUserData(username);
    });

    socket.on('get-my-servers', () => {
        const username = socket.data.username;
        const users = getUsers();
        const servers = getServers();

        if (users[username] && users[username].servers) {
            const userServers = users[username].servers.map(id => servers[id]).filter(Boolean);
            socket.emit('load-servers', userServers);
        }
    });

    // Sistema de Amigos
    socket.on('send-friend-request', (targetUsername) => {
        const users = getUsers();
        const myUsername = socket.data.username;

        if (!users[targetUsername]) {
            socket.emit('friend-action-response', { success: false, message: 'Usuário não encontrado!' });
            return;
        }
        if (targetUsername === myUsername) {
            socket.emit('friend-action-response', { success: false, message: 'Você não pode se adicionar!' });
            return;
        }
        if (users[myUsername].friends.includes(targetUsername)) {
            socket.emit('friend-action-response', { success: false, message: 'Vocês já são amigos!' });
            return;
        }

        users[myUsername].pendingOutgoing.push(targetUsername);
        users[targetUsername].pendingIncoming.push(myUsername);
        saveUsers(users);

        socket.emit('friend-action-response', { success: true, message: 'Pedido enviado!' });
        updateUserData(myUsername);
        updateUserData(targetUsername);
    });

    socket.on('accept-friend', (friendUsername) => {
        const users = getUsers();
        const myUsername = socket.data.username;

        if (users[myUsername].pendingIncoming.includes(friendUsername)) {
            users[myUsername].pendingIncoming = users[myUsername].pendingIncoming.filter(u => u !== friendUsername);
            users[myUsername].friends.push(friendUsername);

            if (users[friendUsername]) {
                users[friendUsername].pendingOutgoing = users[friendUsername].pendingOutgoing.filter(u => u !== myUsername);
                users[friendUsername].friends.push(myUsername);
            }
            saveUsers(users);
            updateUserData(myUsername);
            updateUserData(friendUsername);
        }
    });

    socket.on('reject-friend', (friendUsername) => {
        const users = getUsers();
        const myUsername = socket.data.username;

        users[myUsername].pendingIncoming = users[myUsername].pendingIncoming.filter(u => u !== friendUsername);
        if (users[friendUsername]) {
            users[friendUsername].pendingOutgoing = users[friendUsername].pendingOutgoing.filter(u => u !== myUsername);
        }
        saveUsers(users);
        updateUserData(myUsername);
        updateUserData(friendUsername);
    });

    socket.on('join-room', (room) => {
        socket.join(room);
    });

    socket.on('chat-message', (data) => {
        const users = getUsers();
        const sender = socket.data.username;
        const profile = users[sender] || {};
        
        io.to(data.room).emit('chat-message', { 
            user: sender, 
            displayName: profile.displayName || sender,
            avatar: profile.avatar || '',
            text: data.text 
        });
    });

    socket.on('typing', ({ room, isTyping }) => {
        const users = getUsers();
        const sender = socket.data.username;
        const profile = users[sender] || {};
        socket.to(room).emit('typing', { user: profile.displayName || sender, isTyping });
    });

    socket.on('webrtc-signal', (data) => {
        socket.broadcast.emit('webrtc-signal', data);
    });

    socket.on('disconnect', () => {
        delete activeUsers[socket.id];
    });
});

function updateUserData(username) {
    const users = getUsers();
    const userSocketId = Object.keys(activeUsers).find(id => activeUsers[id] === username);
    if (userSocketId && users[username]) {
        const userData = users[username];
        const friendsWithStatus = userData.friends.map(friend => {
            const friendData = users[friend] || {};
            return {
                name: friend,
                displayName: friendData.displayName || friend,
                avatar: friendData.avatar || '',
                online: Object.values(activeUsers).includes(friend)
            };
        });

        io.to(userSocketId).emit('update-friends-list', {
            friends: friendsWithStatus,
            pendingIncoming: userData.pendingIncoming,
            pendingOutgoing: userData.pendingOutgoing
        });
    }
}

// DEPOIS (compatível com a nuvem do Railway):
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
});
