const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { MongoClient, ServerApiVersion } = require('mongodb');
const dotenv = require('dotenv');

dotenv.config();

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
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';
const DB_USERNAME = process.env.DB_USERNAME || 'gadsdencode';
const DB_PASSWORD = process.env.DB_PASSWORD || 'def3defdefdef';
const MONGODB_URI = `mongodb+srv://${DB_USERNAME}:${DB_PASSWORD}@llm-admin-db.evsyl.mongodb.net/?retryWrites=true&w=majority&appName=llm-admin-db`;

// MongoDB connection setup
const mongoClient = new MongoClient(MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// MongoDB connection with retries
const connectWithRetry = async (retries = 5, delay = 5000) => {
  for (let i = 0; i < retries; i++) {
    try {
      await mongoClient.connect();
      await mongoClient.db("admin").command({ ping: 1 });
      console.log("Successfully connected to MongoDB!");
      
      // Set up mongoose connection using the established client
      await mongoose.connect(MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverApi: {
          version: ServerApiVersion.v1,
          strict: true,
          deprecationErrors: true,
        }
      });
      
      return;
    } catch (err) {
      if (i === retries - 1) {
        console.error('Failed to connect to MongoDB. Using in-memory storage as fallback.');
        global.users = new Map();
        return;
      }
      console.log(`Failed to connect to MongoDB. Retrying in ${delay/1000}s...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

// Connect to MongoDB
connectWithRetry().catch(console.dir);

// Graceful shutdown
process.on('SIGINT', async () => {
  try {
    await mongoClient.close();
    await mongoose.connection.close();
    console.log('MongoDB connection closed.');
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err);
    process.exit(1);
  }
});

// User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date },
  profilePicture: { type: String },
  isOnline: { type: Boolean, default: false }
});

const User = mongoose.model('User', userSchema);

// Store active rooms and their participants
const rooms = new Map();

// Helper function to handle user operations with fallback
const handleUserOperation = async (operation) => {
  try {
    if (mongoose.connection.readyState === 1) {
      return await operation();
    } else {
      // Fallback to in-memory storage
      return await operation(global.users);
    }
  } catch (err) {
    console.error('Error in user operation:', err);
    throw err;
  }
};

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token.' });
  }
};

// User registration
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    const userOperation = async (storage = User) => {
      let existingUser;
      if (storage instanceof Map) {
        existingUser = Array.from(storage.values()).find(u => u.username === username || u.email === email);
      } else {
        existingUser = await storage.findOne({ $or: [{ username }, { email }] });
      }

      if (existingUser) {
        throw new Error('Username or email already exists.');
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      const userData = {
        username,
        email,
        password: hashedPassword,
        createdAt: new Date(),
        isOnline: false
      };

      let user;
      if (storage instanceof Map) {
        const id = Date.now().toString();
        userData.id = id;
        storage.set(id, userData);
        user = userData;
      } else {
        user = await new storage(userData).save();
      }

      const token = jwt.sign(
        { id: user.id || user._id, username: user.username },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      return { token, user: { id: user.id || user._id, username: user.username, email: user.email } };
    };

    const result = await handleUserOperation(userOperation);
    res.status(201).json(result);
  } catch (err) {
    console.error('Registration error:', err);
    res.status(400).json({ error: err.message || 'Server error during registration.' });
  }
});

// User login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const userOperation = async (storage = User) => {
      let user;
      if (storage instanceof Map) {
        user = Array.from(storage.values()).find(u => u.username === username);
      } else {
        user = await storage.findOne({ username });
      }

      if (!user) {
        throw new Error('Invalid username or password.');
      }

      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        throw new Error('Invalid username or password.');
      }

      if (storage instanceof Map) {
        user.lastLogin = new Date();
        user.isOnline = true;
        storage.set(user.id, user);
      } else {
        user.lastLogin = new Date();
        user.isOnline = true;
        await user.save();
      }

      const token = jwt.sign(
        { id: user.id || user._id, username: user.username },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      return { token, user: { id: user.id || user._id, username: user.username, email: user.email } };
    };

    const result = await handleUserOperation(userOperation);
    res.json(result);
  } catch (err) {
    console.error('Login error:', err);
    res.status(401).json({ error: err.message || 'Invalid credentials.' });
  }
});

// Get user profile
app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const userOperation = async (storage = User) => {
      let user;
      if (storage instanceof Map) {
        user = storage.get(req.user.id);
        if (!user) throw new Error('User not found.');
        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword;
      } else {
        user = await storage.findById(req.user.id).select('-password');
        if (!user) throw new Error('User not found.');
        return user;
      }
    };

    const result = await handleUserOperation(userOperation);
    res.json(result);
  } catch (err) {
    console.error('Profile fetch error:', err);
    res.status(404).json({ error: err.message || 'User not found.' });
  }
});

// Update user profile
app.put('/api/profile', authenticateToken, async (req, res) => {
  try {
    const { email, profilePicture } = req.body;

    const userOperation = async (storage = User) => {
      let user;
      if (storage instanceof Map) {
        user = storage.get(req.user.id);
        if (!user) throw new Error('User not found.');
        if (email) user.email = email;
        if (profilePicture) user.profilePicture = profilePicture;
        storage.set(req.user.id, user);
        const { password, ...userWithoutPassword } = user;
        return { message: 'Profile updated successfully.', user: userWithoutPassword };
      } else {
        user = await storage.findById(req.user.id);
        if (!user) throw new Error('User not found.');
        if (email) user.email = email;
        if (profilePicture) user.profilePicture = profilePicture;
        await user.save();
        return { message: 'Profile updated successfully.', user };
      }
    };

    const result = await handleUserOperation(userOperation);
    res.json(result);
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(400).json({ error: err.message || 'Server error while updating profile.' });
  }
});

// Serve static files from the Vite build output
app.use(express.static(path.join(__dirname, '../dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist', 'index.html'));
});

// Socket.io authentication middleware
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error'));

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.user.username);

  socket.on('join-room', async (roomId) => {
    socket.join(roomId);
    
    // Initialize room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    
    const room = rooms.get(roomId);
    room.add(socket.user.username);

    // Update user's online status
    await User.findByIdAndUpdate(socket.user.id, { isOnline: true });

    // Notify others in the room
    socket.to(roomId).emit('user-connected', {
      username: socket.user.username,
      participants: Array.from(room)
    });

    // Send offer to the new participant
    socket.to(roomId).emit('initiate-call', socket.user.username);

    socket.on('disconnect', async () => {
      const room = rooms.get(roomId);
      if (room) {
        room.delete(socket.user.username);
        if (room.size === 0) {
          rooms.delete(roomId);
        }
      }

      // Update user's online status
      await User.findByIdAndUpdate(socket.user.id, { isOnline: false });

      socket.to(roomId).emit('user-disconnected', {
        username: socket.user.username,
        participants: Array.from(room || [])
      });
    });
  });

  // Handle WebRTC signaling
  socket.on('offer', (roomId, offer) => {
    socket.to(roomId).emit('offer', {
      offer,
      from: socket.user.username
    });
  });

  socket.on('answer', (roomId, answer) => {
    socket.to(roomId).emit('answer', {
      answer,
      from: socket.user.username
    });
  });

  socket.on('ice-candidate', (roomId, candidate) => {
    socket.to(roomId).emit('ice-candidate', {
      candidate,
      from: socket.user.username
    });
  });

  // Handle chat messages
  socket.on('chat-message', (roomId, message) => {
    io.to(roomId).emit('chat-message', socket.user.username, message);
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
