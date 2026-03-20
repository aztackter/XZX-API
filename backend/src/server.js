const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const bcrypt = require('bcrypt');
const os = require('os');
const BotManager = require('./botManager');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const botManager = new BotManager();

// Get client IP for logging
const getClientIp = (req) => {
    return req.headers['x-forwarded-for'] || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress || 
           'unknown';
};

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
const corsOptions = {
    origin: process.env.FRONTEND_URL || "*",
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files
app.use(express.static(path.join(__dirname, '../../frontend')));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'development-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'lax'
    },
    name: 'roblox-bot.sid'
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        return req.headers['x-forwarded-for'] || req.ip || 'unknown';
    }
});
app.use('/api/', limiter);

// Request logging middleware
app.use((req, res, next) => {
    const clientIp = getClientIp(req);
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - IP: ${clientIp}`);
    next();
});

// Authentication middleware
const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    const sessionToken = req.session?.token;
    
    if (!token && !sessionToken) {
        return res.status(401).json({ error: 'No authentication token provided' });
    }
    
    const validToken = token || sessionToken;
    if (validToken !== process.env.API_TOKEN) {
        return res.status(403).json({ error: 'Invalid authentication token' });
    }
    
    next();
};

// Health check endpoint
app.get('/health', (req, res) => {
    const stats = botManager.getStats();
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: os.loadavg(),
        bots: {
            total: stats.totalBots,
            active: stats.activeBots
        },
        environment: process.env.NODE_ENV
    });
});

// Ping endpoint for basic connectivity
app.get('/ping', (req, res) => {
    res.status(200).send('pong');
});

// Root endpoint - serve frontend or API info
app.get('/', (req, res) => {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
        res.json({
            name: 'Roblox Bot Control Panel API',
            version: '1.0.0',
            status: 'running',
            endpoints: {
                health: '/health',
                ping: '/ping',
                api: '/api/*'
            }
        });
    } else {
        res.sendFile(path.join(__dirname, '../../frontend/index.html'));
    }
});

// API Routes
app.get('/api/stats', authenticate, (req, res) => {
    try {
        const stats = botManager.getStats();
        res.json({
            success: true,
            ...stats
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch stats' 
        });
    }
});

app.get('/api/bots', authenticate, (req, res) => {
    try {
        const bots = botManager.getBots();
        res.json({
            success: true,
            count: bots.length,
            bots: bots
        });
    } catch (error) {
        console.error('Error fetching bots:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch bots' 
        });
    }
});

app.post('/api/bots/create', authenticate, async (req, res) => {
    try {
        const { username, password, gameId, options = {} } = req.body;
        
        // Validate required fields
        if (!username || !password || !gameId) {
            return res.status(400).json({ 
                success: false, 
                error: 'Username, password, and gameId are required' 
            });
        }
        
        // Validate gameId format (should be numeric)
        if (!/^\d+$/.test(gameId)) {
            return res.status(400).json({
                success: false,
                error: 'Game ID must be a number'
            });
        }
        
        // Create bot
        const bot = await botManager.createBot(username, password, gameId, options);
        
        // Log success
        console.log(`Bot created successfully: ${username} (Game: ${gameId}) at ${new Date().toISOString()}`);
        
        res.json({ 
            success: true, 
            bot,
            message: 'Bot created successfully'
        });
    } catch (error) {
        console.error('Bot creation error:', error);
        
        // Determine error type for better client feedback
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
            error: errorMessage,
            code: error.code || 'UNKNOWN_ERROR'
        });
    }
});

app.post('/api/bots/:botId/start', authenticate, (req, res) => {
    try {
        const { botId } = req.params;
        const success = botManager.startBot(botId);
        
        if (success) {
            console.log(`Bot started: ${botId} at ${new Date().toISOString()}`);
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

app.post('/api/bots/:botId/stop', authenticate, (req, res) => {
    try {
        const { botId } = req.params;
        const success = botManager.stopBot(botId);
        
        if (success) {
            console.log(`Bot stopped: ${botId} at ${new Date().toISOString()}`);
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

app.delete('/api/bots/:botId', authenticate, (req, res) => {
    try {
        const { botId } = req.params;
        const success = botManager.removeBot(botId);
        
        if (success) {
            console.log(`Bot removed: ${botId} at ${new Date().toISOString()}`);
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

app.get('/api/bots/:botId/activity', authenticate, (req, res) => {
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

// Admin authentication routes
app.post('/api/admin/login', (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ 
                success: false, 
                error: 'Username and password required' 
            });
        }
        
        // Simple comparison (in production, use bcrypt compare)
        if (username === process.env.ADMIN_USERNAME && 
            password === process.env.ADMIN_PASSWORD) {
            
            // Regenerate session for security
            req.session.regenerate((err) => {
                if (err) {
                    console.error('Session regeneration error:', err);
                    return res.status(500).json({ 
                        success: false, 
                        error: 'Login failed' 
                    });
                }
                
                req.session.token = process.env.API_TOKEN;
                req.session.username = username;
                
                res.json({ 
                    success: true, 
                    message: 'Logged in successfully',
                    user: { username }
                });
            });
        } else {
            res.status(401).json({ 
                success: false, 
                error: 'Invalid credentials' 
            });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Login failed' 
        });
    }
});

app.post('/api/admin/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({ 
                success: false, 
                error: 'Logout failed' 
            });
        }
        
        res.clearCookie('roblox-bot.sid');
        res.json({ 
            success: true, 
            message: 'Logged out successfully' 
        });
    });
});

app.get('/api/admin/verify', authenticate, (req, res) => {
    res.json({ 
        success: true, 
        authenticated: true,
        user: { username: req.session.username || 'admin' }
    });
});

// Socket.IO setup
const io = socketIO(server, {
    cors: {
        origin: process.env.FRONTEND_URL || "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

// Socket.IO authentication middleware
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    
    if (token === process.env.API_TOKEN) {
        next();
    } else {
        next(new Error('Authentication error'));
    }
});

// Socket.IO connection handler
io.on('connection', (socket) => {
    const clientIp = socket.handshake.address;
    console.log(`Socket connected: ${socket.id} from ${clientIp}`);

    // Send initial stats
    socket.emit('stats', botManager.getStats());

    // Bot event handlers
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

    // Register event listeners
    botManager.on('botCreated', botCreatedHandler);
    botManager.on('botUpdate', botUpdateHandler);
    botManager.on('botActivity', botActivityHandler);
    botManager.on('botError', botErrorHandler);
    botManager.on('botStopped', botStoppedHandler);
    botManager.on('botStarted', botStartedHandler);
    botManager.on('botRemoved', botRemovedHandler);

    // Handle client disconnect
    socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id}`);
        
        // Clean up event listeners
        botManager.removeListener('botCreated', botCreatedHandler);
        botManager.removeListener('botUpdate', botUpdateHandler);
        botManager.removeListener('botActivity', botActivityHandler);
        botManager.removeListener('botError', botErrorHandler);
        botManager.removeListener('botStopped', botStoppedHandler);
        botManager.removeListener('botStarted', botStartedHandler);
        botManager.removeListener('botRemoved', botRemovedHandler);
    });

    // Handle socket errors
    socket.on('error', (error) => {
        console.error(`Socket error for ${socket.id}:`, error);
    });
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
    res.status(404).json({ 
        success: false, 
        error: 'API endpoint not found' 
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.stack);
    
    // Don't expose internal error details in production
    const message = process.env.NODE_ENV === 'production' 
        ? 'Internal server error' 
        : err.message;
    
    res.status(500).json({ 
        success: false, 
        error: message,
        ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    });
});

// Catch-all route to serve frontend (for client-side routing)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/index.html'));
});

// Graceful shutdown handler
const gracefulShutdown = () => {
    console.log('Received shutdown signal, cleaning up...');
    
    // Stop all bots
    const bots = botManager.getBots();
    bots.forEach(bot => {
        botManager.stopBot(bot.id);
    });
    
    // Close server
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
    
    // Force exit after 10 seconds
    setTimeout(() => {
        console.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 10000);
};

// Listen for shutdown signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    gracefulShutdown();
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(50));
    console.log('🚀 Roblox Bot Control Panel');
    console.log('='.repeat(50));
    console.log(`Server running on port: ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Frontend serving from: ${path.join(__dirname, '../../frontend')}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`Ping test: http://localhost:${PORT}/ping`);
    console.log('='.repeat(50));
    
    // Log warning about MemoryStore
    console.log('\n⚠️  Note: Using MemoryStore for sessions (not recommended for production)');
    console.log('   Consider adding MongoDB for production use\n');
});
