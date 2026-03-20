const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const BotManager = require('./botManager');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const botManager = new BotManager();

// Simple health check
app.get('/health', (req, res) => {
    return res.status(200).send('OK');
});

app.get('/ping', (req, res) => {
    return res.status(200).send('pong');
});

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "wss:", "https:"]
        },
    },
}));

// CORS configuration
app.use(cors({
    origin: "*",
    credentials: true
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files
app.use(express.static(path.join(__dirname, '../../frontend')));

// Session configuration (optional)
app.use(session({
    secret: process.env.SESSION_SECRET || 'development-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    },
    name: 'roblox-bot.sid'
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// ============ API ROUTES (NO AUTHENTICATION REQUIRED) ============

app.get('/api/stats', (req, res) => {
    try {
        const stats = botManager.getStats();
        res.json(stats);
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

app.get('/api/bots', (req, res) => {
    try {
        const bots = botManager.getBots();
        res.json({
            success: true,
            count: bots.length,
            bots: bots
        });
    } catch (error) {
        console.error('Error fetching bots:', error);
        res.status(500).json({ error: 'Failed to fetch bots' });
    }
});

app.post('/api/bots/create', async (req, res) => {
    try {
        const { username, password, gameId, options = {} } = req.body;
        
        if (!username || !password || !gameId) {
            return res.status(400).json({ 
                success: false, 
                error: 'Username, password, and gameId are required' 
            });
        }
        
        if (!/^\d+$/.test(gameId)) {
            return res.status(400).json({
                success: false,
                error: 'Game ID must be a number'
            });
        }
        
        const bot = await botManager.createBot(username, password, gameId, options);
        
        console.log(`Bot created successfully: ${username} (Game: ${gameId})`);
        
        res.json({ 
            success: true, 
            bot,
            message: 'Bot created successfully'
        });
    } catch (error) {
        console.error('Bot creation error:', error);
        
        let statusCode = 500;
        let errorMessage = error.message;
        
        if (error.message.includes('login') || error.message.includes('authentication')) {
            statusCode = 401;
            errorMessage = 'Invalid Roblox credentials';
        } else if (error.message.includes('banned')) {
            statusCode = 403;
            errorMessage = 'Roblox account is banned';
        } else if (error.message.includes('rate limit')) {
            statusCode = 429;
            errorMessage = 'Rate limited by Roblox';
        }
        
        res.status(statusCode).json({ 
            success: false, 
            error: errorMessage
        });
    }
});

app.post('/api/bots/:botId/start', async (req, res) => {
    try {
        const { botId } = req.params;
        const success = await botManager.startBot(botId);
        
        if (success) {
            console.log(`Bot started: ${botId}`);
            res.json({ 
                success: true, 
                message: 'Bot started successfully' 
            });
        } else {
            res.status(404).json({ 
                success: false, 
                error: 'Bot not found' 
            });
        }
    } catch (error) {
        console.error('Error starting bot:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to start bot' 
        });
    }
});

app.post('/api/bots/:botId/stop', async (req, res) => {
    try {
        const { botId } = req.params;
        const success = await botManager.stopBot(botId);
        
        if (success) {
            console.log(`Bot stopped: ${botId}`);
            res.json({ 
                success: true, 
                message: 'Bot stopped successfully' 
            });
        } else {
            res.status(404).json({ 
                success: false, 
                error: 'Bot not found' 
            });
        }
    } catch (error) {
        console.error('Error stopping bot:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to stop bot' 
        });
    }
});

app.delete('/api/bots/:botId', async (req, res) => {
    try {
        const { botId } = req.params;
        const success = await botManager.removeBot(botId);
        
        if (success) {
            console.log(`Bot removed: ${botId}`);
            res.json({ 
                success: true, 
                message: 'Bot removed successfully' 
            });
        } else {
            res.status(404).json({ 
                success: false, 
                error: 'Bot not found' 
            });
        }
    } catch (error) {
        console.error('Error removing bot:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to remove bot' 
        });
    }
});

app.get('/api/bots/:botId/activity', async (req, res) => {
    try {
        const { botId } = req.params;
        const activity = botManager.getBotActivity(botId);
        
        res.json({ 
            success: true, 
            botId,
            activity: activity || [] 
        });
    } catch (error) {
        console.error('Error fetching bot activity:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch bot activity' 
        });
    }
});

// Root endpoint
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/index.html'));
});

// Socket.IO setup
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

// No authentication for Socket.IO
io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

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

    const botRemovedHandler = (bot) => {
        socket.emit('botRemoved', bot);
        socket.emit('stats', botManager.getStats());
    };

    botManager.on('botCreated', botCreatedHandler);
    botManager.on('botUpdate', botUpdateHandler);
    botManager.on('botActivity', botActivityHandler);
    botManager.on('botError', botErrorHandler);
    botManager.on('botStopped', botStoppedHandler);
    botManager.on('botStarted', botStartedHandler);
    botManager.on('botRemoved', botRemovedHandler);

    socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id}`);
        
        botManager.removeListener('botCreated', botCreatedHandler);
        botManager.removeListener('botUpdate', botUpdateHandler);
        botManager.removeListener('botActivity', botActivityHandler);
        botManager.removeListener('botError', botErrorHandler);
        botManager.removeListener('botStopped', botStoppedHandler);
        botManager.removeListener('botStarted', botStartedHandler);
        botManager.removeListener('botRemoved', botRemovedHandler);
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err.stack);
    res.status(500).json({ 
        error: 'Something went wrong!'
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(50));
    console.log('🚀 Roblox Bot Control Panel');
    console.log('='.repeat(50));
    console.log(`Server running on port: ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log('='.repeat(50));
});
