const express = require('express');
    const http = require('http');
    const socketIo = require('socket.io');
    const cors = require('cors');
    const jwt = require('jsonwebtoken');
    const path = require('path');

    const app = express();
    const server = http.createServer(app);
    const io = socketIo(server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });

    app.use(cors());
    app.use(express.json());

    const PORT = process.env.PORT || 5000;

    const JWT_SECRET = 'your_jwt_secret';

    app.post('/login', (req, res) => {
      const { username } = req.body;
      const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '1h' });
      res.json({ token });
    });

    // Serve static files from the Vite build output
    app.use(express.static(path.join(__dirname, '../dist')));

    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, '../dist', 'index.html'));
    });

    io.use((socket, next) => {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Authentication error'));

      jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return next(new Error('Authentication error'));
        socket.user = decoded;
        next();
      });
    });

    io.on('connection', (socket) => {
      console.log('User connected:', socket.user.username);

      socket.on('join-room', (roomId) => {
        socket.join(roomId);
        socket.to(roomId).emit('user-connected', socket.user.username);

        socket.on('disconnect', () => {
          socket.to(roomId).emit('user-disconnected', socket.user.username);
        });
      });

      socket.on('chat-message', (roomId, message) => {
        socket.to(roomId).emit('chat-message', socket.user.username, message);
      });

      socket.on('offer', async (roomId, offer) => {
        await peerConnection.current?.setRemoteDescription(new RTCSessionDescription(offer));

        const answer = await peerConnection.current?.createAnswer();
        await peerConnection.current?.setLocalDescription(answer);

        socket.emit('answer', roomId, answer);
      });

      socket.on('answer', async (answer) => {
        await peerConnection.current?.setRemoteDescription(new RTCSessionDescription(answer));
      });

      socket.on('ice-candidate', (candidate) => {
        peerConnection.current?.addIceCandidate(new RTCIceCandidate(candidate));
      });
    });

    server.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
