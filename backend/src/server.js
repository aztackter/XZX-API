const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const bcrypt = require('bcrypt');
const BotManager = require('./botManager');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: process.env.FRONTEND_URL || "*",
        methods: ["GET", "POST"],
        credentials: true
    }
});

const botManager = new BotManager();

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
}));

app.use(cors({
    origin: process.env.FRONTEND_URL || "*",
    credentials: true
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, '../../frontend')));

app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests from this IP, please try again later.'
});

app.use('/api/', limiter);

const authenticate = (req, res, next) => {
    const authToken = req.headers.authorization?.split(' ')[1] || req.session?.token;
    if (!authToken || authToken !== process.env.API_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

app.get('/api/stats', authenticate, (req, res) => {
    res.json(botManager.getStats());
});

app.get('/api/bots', authenticate, (req, res) => {
    res.json(botManager.getBots());
});

app.post('/api/bots/create', authenticate, async (req, res) => {
    try {
        const { username, password, gameId, options } = req.body;
        if (!username || !password || !gameId) {
            return res.status(400).json({ 
                success: false, 
                error: 'Username, password, and gameId are required' 
            });
        }
        const bot = await botManager.createBot(username, password, gameId, options);
        console.log(`Bot created: ${username} at ${new Date().toISOString()}`);
        res.json({ 
            success: true, 
            bot,
            message: 'Bot created successfully'
        });
    } catch (error) {
        console.error('Bot creation error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            code: error.code || 'UNKNOWN_ERROR'
        });
    }
});

app.post('/api/bots/:botId/start', authenticate, (req, res) => {
    const success = botManager.startBot(req.params.botId);
    res.json({ 
        success, 
        message: success ? 'Bot started' : 'Bot not found' 
    });
});

app.post('/api/bots/:botId/stop', authenticate, (req, res) => {
    const success = botManager.stopBot(req.params.botId);
    res.json({ 
        success, 
        message: success ? 'Bot stopped' : 'Bot not found' 
    });
});

app.delete('/api/bots/:botId', authenticate, (req, res) => {
    const success = botManager.removeBot(req.params.botId);
    res.json({ 
        success, 
        message: success ? 'Bot removed' : 'Bot not found' 
    });
});

app.get('/api/bots/:botId/activity', authenticate, (req, res) => {
    const activity = botManager.getBotActivity(req.params.botId);
    res.json({ activity });
});

app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === process.env.ADMIN_USERNAME && 
        password === process.env.ADMIN_PASSWORD) {
        req.session.token = process.env.API_TOKEN;
        res.json({ success: true, message: 'Logged in successfully' });
    } else {
        res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
});

app.post('/api/admin/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true, message: 'Logged out' });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        bots: botManager.getStats().totalBots
    });
});

io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (token === process.env.API_TOKEN) {
        next();
    } else {
        next(new Error('Authentication error'));
    }
});

io.on('connection', (socket) => {
    console.log('Authenticated client connected');
    socket.emit('stats', botManager.getStats());

    const botCreatedHandler = (bot) => {
        socket.emit('botCreated', bot);
        socket.emit('stats', botManager.getStats());
    };

    const botUpdateHandler = (bot) => {
        socket.emit('botUpdate', bot);
    };

    const botActivityHandler = (activity) => {
        socket.emit('botActivity', activity);
    };

    const botErrorHandler = (error) => {
        socket.emit('botError', error);
    };

    const botStoppedHandler = (bot) => {
        socket.emit('botStopped', bot);
        socket.emit('stats', botManager.getStats());
    };

    const botStartedHandler = (bot) => {
        socket.emit('botStarted', bot);
        socket.emit('stats', botManager.getStats());
    };

    botManager.on('botCreated', botCreatedHandler);
    botManager.on('botUpdate', botUpdateHandler);
    botManager.on('botActivity', botActivityHandler);
    botManager.on('botError', botErrorHandler);
    botManager.on('botStopped', botStoppedHandler);
    botManager.on('botStarted', botStartedHandler);

    socket.on('disconnect', () => {
        console.log('Client disconnected');
        botManager.removeListener('botCreated', botCreatedHandler);
        botManager.removeListener('botUpdate', botUpdateHandler);
        botManager.removeListener('botActivity', botActivityHandler);
        botManager.removeListener('botError', botErrorHandler);
        botManager.removeListener('botStopped', botStoppedHandler);
        botManager.removeListener('botStarted', botStartedHandler);
    });
});

app.use((err, req, res, next) => {
    console.error('Server error:', err.stack);
    res.status(500).json({ 
        error: 'Something went wrong!',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

app.use('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV}`);
    console.log(`Frontend serving from: ${path.join(__dirname, '../../frontend')}`);
});
