const noblox = require('noblox.js');
const EventEmitter = require('events');
const crypto = require('crypto');
const HttpsProxyAgent = require('https-proxy-agent');
const { RateLimiter } = require('limiter');
const { Pool } = require('pg');
const http = require('http');
const https = require('https');

class BotManager extends EventEmitter {
    constructor() {
        super();
        this.bots = new Map();
        this.proxies = [];
        this.tempProxy = null;
        this.pool = null;
        this.stats = {
            totalBots: 0,
            activeBots: 0,
            totalRequests: 0,
            errors: 0,
            bannedAccounts: 0,
            totalPlayTime: 0
        };
        this.rateLimiter = new RateLimiter({
            tokensPerInterval: 10,
            interval: 'second'
        });
        this.loadProxies();
        this.initDatabase();
    }

    loadProxies() {
        const proxyList = process.env.PROXY_LIST?.split(',') || [];
        this.proxies = proxyList.map(proxy => ({
            url: proxy,
            inUse: false,
            lastUsed: null
        }));
    }

    getAvailableProxy() {
        const proxy = this.proxies.find(p => !p.inUse);
        if (proxy) {
            proxy.inUse = true;
            proxy.lastUsed = new Date();
            return new HttpsProxyAgent(proxy.url);
        }
        return null;
    }

    releaseProxy(proxyUrl) {
        const proxy = this.proxies.find(p => p.url === proxyUrl);
        if (proxy) {
            proxy.inUse = false;
        }
    }

    // Create a temporary agent for a specific IP address
    createTempIPAgent(ipAddress) {
        // Create a custom agent that binds to a specific IP
        const agent = new http.Agent({
            localAddress: ipAddress,
            family: 4 // IPv4
        });
        
        const httpsAgent = new https.Agent({
            localAddress: ipAddress,
            family: 4
        });
        
        return { httpAgent: agent, httpsAgent: httpsAgent };
    }

    // Use temporary IP for a single request
    async makeRequestWithTempIP(url, options = {}, ipAddress = '24.145.49.159') {
        const agents = this.createTempIPAgent(ipAddress);
        
        const fetchOptions = {
            ...options,
            agent: (url) => {
                if (url.protocol === 'https:') {
                    return agents.httpsAgent;
                }
                return agents.httpAgent;
            }
        };
        
        const response = await fetch(url, fetchOptions);
        return response;
    }

    async initDatabase() {
        if (!process.env.DATABASE_URL) {
            console.log('No DATABASE_URL found, bots will not persist across restarts');
            return;
        }

        try {
            this.pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });

            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS bots (
                    id TEXT PRIMARY KEY,
                    username TEXT NOT NULL,
                    display_name TEXT,
                    game_id TEXT NOT NULL,
                    status TEXT DEFAULT 'offline',
                    stats JSONB DEFAULT '{"actions":0,"playTime":0,"errors":0,"requests":0}',
                    behavior JSONB DEFAULT '{"position":{"x":0,"y":0,"z":0},"currentServer":null,"pathHistory":[]}',
                    settings JSONB DEFAULT '{"actionInterval":8000,"randomDelay":true,"humanLikeBehavior":true,"autoReconnect":true}',
                    proxy TEXT,
                    created_at TIMESTAMP DEFAULT NOW(),
                    last_active TIMESTAMP DEFAULT NOW()
                )
            `);

            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_bots_status ON bots(status);
                CREATE INDEX IF NOT EXISTS idx_bots_created_at ON bots(created_at);
            `);

            console.log('Database initialized successfully');
            await this.loadSavedBots();
        } catch (error) {
            console.error('Database initialization failed:', error.message);
        }
    }

    async loadSavedBots() {
        if (!this.pool) return;

        try {
            const result = await this.pool.query('SELECT * FROM bots ORDER BY created_at DESC');
            
            for (const row of result.rows) {
                const bot = {
                    id: row.id,
                    username: row.username,
                    displayName: row.display_name || row.username,
                    gameId: row.game_id,
                    status: row.status,
                    stats: row.stats,
                    behavior: row.behavior,
                    settings: row.settings,
                    proxy: row.proxy,
                    createdAt: new Date(row.created_at),
                    lastActive: new Date(row.last_active),
                    activityLog: [],
                    security: {
                        cookie: null,
                        lastLogin: null,
                        loginAttempts: 0,
                        banned: false
                    }
                };
                
                this.bots.set(bot.id, bot);
                this.stats.totalBots++;
                if (bot.status === 'online') this.stats.activeBots++;
                this.stats.totalPlayTime += bot.stats.playTime || 0;
            }
            
            console.log(`Loaded ${result.rows.length} saved bots from database`);
            this.emit('botsLoaded', result.rows.length);
        } catch (error) {
            console.error('Failed to load bots from database:', error.message);
        }
    }

    async saveBotToDatabase(bot) {
        if (!this.pool) return;

        try {
            await this.pool.query(`
                INSERT INTO bots (id, username, display_name, game_id, status, stats, behavior, settings, proxy, last_active)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
                ON CONFLICT (id) DO UPDATE SET
                    username = EXCLUDED.username,
                    display_name = EXCLUDED.display_name,
                    game_id = EXCLUDED.game_id,
                    status = EXCLUDED.status,
                    stats = EXCLUDED.stats,
                    behavior = EXCLUDED.behavior,
                    settings = EXCLUDED.settings,
                    proxy = EXCLUDED.proxy,
                    last_active = NOW()
            `, [
                bot.id,
                bot.username,
                bot.displayName || bot.username,
                bot.gameId,
                bot.status,
                bot.stats,
                bot.behavior,
                bot.settings,
                bot.proxy || null
            ]);
        } catch (error) {
            console.error('Failed to save bot to database:', error.message);
        }
    }

    async deleteBotFromDatabase(botId) {
        if (!this.pool) return;

        try {
            await this.pool.query('DELETE FROM bots WHERE id = $1', [botId]);
        } catch (error) {
            console.error('Failed to delete bot from database:', error.message);
        }
    }

    async updateBotInDatabase(botId, updates) {
        const bot = this.bots.get(botId);
        if (bot && this.pool) {
            Object.assign(bot, updates);
            await this.saveBotToDatabase(bot);
        }
    }

    async createBot(username, password, gameId, options = {}) {
        let tempProxyUsed = false;
        
        try {
            await this.rateLimiter.removeTokens(1);
            
            if (!username || !password || !gameId) {
                throw new Error('Username, password, and gameId are required');
            }
            
            if (!/^\d+$/.test(gameId)) {
                throw new Error('Game ID must be a number');
            }
            
            const botId = `bot_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
            
            // Use temporary IP for creation only
            const useTempIP = options.useTempIP !== false;
            let tempAgents = null;
            
            if (useTempIP) {
                console.log(`Using temporary IP 24.145.49.159 for bot creation...`);
                tempAgents = this.createTempIPAgent('24.145.49.159');
                tempProxyUsed = true;
            }
            
            const bot = {
                id: botId,
                username: username.trim(),
                gameId: gameId.trim(),
                status: 'initializing',
                createdAt: new Date(),
                lastActive: new Date(),
                proxy: useTempIP ? 'temp_ip_24.145.49.159' : null,
                stats: {
                    requests: 0,
                    errors: 0,
                    playTime: 0,
                    actions: 0
                },
                settings: {
                    actionInterval: options.actionInterval || 8000,
                    randomDelay: options.randomDelay !== false,
                    humanLikeBehavior: options.humanLikeBehavior !== false,
                    autoReconnect: options.autoReconnect !== false
                },
                behavior: {
                    lastAction: null,
                    currentServer: null,
                    position: { x: 0, y: 0, z: 0 },
                    pathHistory: []
                },
                security: {
                    cookie: null,
                    lastLogin: null,
                    loginAttempts: 0,
                    banned: false
                },
                activityLog: []
            };

            // Store original noblox functions to restore later
            const originalFetch = global.fetch;
            
            // Override fetch to use temp IP if needed
            if (tempAgents) {
                global.fetch = async (url, fetchOptions = {}) => {
                    const finalOptions = { ...fetchOptions };
                    if (!finalOptions.agent) {
                        if (url.startsWith('https://')) {
                            finalOptions.agent = tempAgents.httpsAgent;
                        } else {
                            finalOptions.agent = tempAgents.httpAgent;
                        }
                    }
                    return originalFetch(url, finalOptions);
                };
            }

            console.log(`Attempting to login to Roblox as: ${username} via temporary IP`);
            
            let user;
            try {
                user = await noblox.login({
                    username: username.trim(),
                    password: password
                });
            } catch (loginError) {
                console.error('Roblox login error:', loginError.message);
                
                let errorMsg = 'Invalid Roblox credentials. ';
                if (loginError.message.includes('invalid')) {
                    errorMsg += 'Username or password is incorrect.';
                } else if (loginError.message.includes('captcha')) {
                    errorMsg += 'Roblox requires captcha verification. Try logging in manually first.';
                } else if (loginError.message.includes('2FA') || loginError.message.includes('two-step')) {
                    errorMsg += 'Account has Two-Factor Authentication (2FA) enabled. Bot accounts cannot have 2FA.';
                } else {
                    errorMsg += loginError.message;
                }
                throw new Error(errorMsg);
            }
            
            const csrf = await noblox.getCSRFToken();
            
            // Restore original fetch
            if (tempAgents) {
                global.fetch = originalFetch;
            }
            
            bot.security.cookie = user;
            bot.security.csrf = csrf;
            bot.security.lastLogin = new Date();
            bot.status = 'online';
            
            const userInfo = await noblox.getCurrentUser();
            bot.userId = userInfo.UserID;
            bot.displayName = userInfo.UserName;
            
            // Remove proxy reference after creation (bot no longer uses temp IP)
            bot.proxy = null;
            
            this.bots.set(bot.id, bot);
            this.stats.totalBots++;
            this.stats.activeBots++;
            
            await this.saveBotToDatabase(bot);
            
            this.emit('botCreated', this.sanitizeBot(bot));
            this.logBotActivity(bot.id, `Bot created and logged in successfully as ${bot.displayName}`);
            this.logBotActivity(bot.id, `Temporary IP 24.145.49.159 used for creation only - removed after login`);
            this.startBotBehavior(bot.id);
            
            console.log(`Bot created successfully. Temp IP removed. Bot now using normal network.`);
            
            return this.sanitizeBot(bot);
        } catch (error) {
            console.error(`Failed to create bot ${username}:`, error);
            
            let errorMessage = error.message;
            let statusCode = 500;
            
            if (error.message.includes('credentials')) {
                statusCode = 401;
                errorMessage = 'Invalid Roblox credentials. Please check: 1) Username is correct 2) Password is correct 3) Account does NOT have 2FA enabled 4) Account email is verified';
            } else if (error.message.includes('banned')) {
                statusCode = 403;
                errorMessage = 'Roblox account is banned or locked';
                this.stats.bannedAccounts++;
            } else if (error.message.includes('captcha')) {
                statusCode = 429;
                errorMessage = 'Roblox requires captcha verification. Please log into Roblox website first to verify the account.';
            } else if (error.message.includes('2FA')) {
                statusCode = 401;
                errorMessage = 'Account has Two-Factor Authentication (2FA) enabled. Bot accounts cannot have 2FA enabled.';
            }
            
            this.emit('botError', {
                username,
                error: errorMessage,
                timestamp: new Date(),
                statusCode
            });
            throw new Error(errorMessage);
        }
    }

    sanitizeBot(bot) {
        const sanitized = { ...bot };
        delete sanitized.security;
        delete sanitized.activityLog;
        return sanitized;
    }

    async startBotBehavior(botId) {
        const bot = this.bots.get(botId);
        if (!bot) return;

        const runBehavior = async () => {
            if (bot.status !== 'online') return;

            try {
                await this.rateLimiter.removeTokens(1);
                
                if (bot.settings.randomDelay) {
                    const delay = this.getRandomDelay(bot.settings.actionInterval);
                    await this.sleep(delay);
                }

                const action = await this.performHumanLikeAction(bot);
                
                bot.stats.actions++;
                bot.lastActive = new Date();
                bot.stats.playTime += bot.settings.actionInterval / 1000;
                this.stats.totalPlayTime += bot.settings.actionInterval / 1000;
                this.stats.totalRequests++;
                
                await this.saveBotToDatabase(bot);
                
                this.emit('botUpdate', this.sanitizeBot(bot));
                this.logBotActivity(bot.id, `Performed action: ${action.type}`);
                
            } catch (error) {
                bot.stats.errors++;
                this.stats.errors++;
                console.error(`Bot ${bot.username} error:`, error);
                this.emit('botError', {
                    botId: bot.id,
                    username: bot.username,
                    error: error.message,
                    timestamp: new Date()
                });
                
                await this.saveBotToDatabase(bot);

                if (bot.settings.autoReconnect && this.shouldReconnect(error)) {
                    await this.reconnectBot(bot.id);
                }
            }

            if (bot.status === 'online') {
                setTimeout(runBehavior, this.getActionInterval(bot));
            }
        };

        setTimeout(runBehavior, this.getActionInterval(bot));
    }

    getRandomDelay(baseInterval) {
        const variation = baseInterval * 0.3;
        return baseInterval + (Math.random() * variation * 2 - variation);
    }

    getActionInterval(bot) {
        if (bot.settings.humanLikeBehavior) {
            const hour = new Date().getHours();
            let baseInterval = bot.settings.actionInterval;
            if (hour < 6 || hour > 22) {
                baseInterval *= 1.5;
            }
            return this.getRandomDelay(baseInterval);
        }
        return bot.settings.actionInterval;
    }

    async performHumanLikeAction(bot) {
        const actions = [
            this.joinGameServer,
            this.moveCharacter,
            this.interactWithObject,
            this.sendChatMessage,
            this.checkGameUpdates,
            this.idle
        ];

        const actionWeights = this.calculateActionWeights(bot);
        const selectedAction = this.selectWeightedAction(actions, actionWeights);
        return await selectedAction.call(this, bot);
    }

    async joinGameServer(bot) {
        try {
            const servers = await noblox.getGameServers(bot.gameId, {
                limit: 100
            });
            
            if (servers && servers.length > 0) {
                const serverWithPlayers = servers.find(s => s.playing > 5);
                const targetServer = serverWithPlayers || servers[0];
                bot.behavior.currentServer = targetServer;
                await this.saveBotToDatabase(bot);
                this.logBotActivity(bot.id, `Joined server ${targetServer.id} with ${targetServer.playing} players`);
                return {
                    type: 'join_server',
                    server: targetServer.id,
                    players: targetServer.playing
                };
            }
        } catch (error) {
            console.error('Failed to join game server:', error);
            throw error;
        }
        return { type: 'join_server', server: null };
    }

    async moveCharacter(bot) {
        if (!bot.behavior.currentServer) {
            await this.joinGameServer(bot);
        }

        const newPosition = {
            x: bot.behavior.position.x + (Math.random() - 0.5) * 10,
            y: bot.behavior.position.y,
            z: bot.behavior.position.z + (Math.random() - 0.5) * 10
        };

        bot.behavior.pathHistory.push({
            position: bot.behavior.position,
            timestamp: new Date()
        });

        if (bot.behavior.pathHistory.length > 50) {
            bot.behavior.pathHistory.shift();
        }

        bot.behavior.position = newPosition;
        bot.behavior.lastAction = 'move';
        await this.saveBotToDatabase(bot);

        return {
            type: 'move',
            from: bot.behavior.pathHistory[bot.behavior.pathHistory.length - 1]?.position,
            to: newPosition
        };
    }

    async interactWithObject(bot) {
        const interactionTypes = ['click', 'collect', 'use', 'open'];
        const interaction = interactionTypes[Math.floor(Math.random() * interactionTypes.length)];
        this.logBotActivity(bot.id, `Interacted with object: ${interaction}`);
        return {
            type: 'interact',
            interaction: interaction,
            position: bot.behavior.position
        };
    }

    async sendChatMessage(bot) {
        const messages = [
            'Hello everyone!',
            'Nice game!',
            'Anyone want to team up?',
            'How do you play this?',
            'GG!',
            'This is fun!',
            'Anyone know where to go?'
        ];
        const message = messages[Math.floor(Math.random() * messages.length)];
        this.logBotActivity(bot.id, `Sent chat: ${message}`);
        return {
            type: 'chat',
            message: message
        };
    }

    async checkGameUpdates(bot) {
        try {
            const gameInfo = await noblox.getGame(bot.gameId);
            return {
                type: 'check_updates',
                gameInfo: {
                    name: gameInfo.Name,
                    playing: gameInfo.Playing,
                    visits: gameInfo.Visits
                }
            };
        } catch (error) {
            console.error('Failed to check game updates:', error);
            throw error;
        }
    }

    async idle(bot) {
        await this.sleep(5000);
        return {
            type: 'idle',
            duration: 5000
        };
    }

    calculateActionWeights(bot) {
        const weights = {
            joinGameServer: 0.1,
            moveCharacter: 0.3,
            interactWithObject: 0.25,
            sendChatMessage: 0.15,
            checkGameUpdates: 0.1,
            idle: 0.1
        };

        const timeSinceLastAction = bot.lastActive ? 
            (new Date() - new Date(bot.lastActive)) / 1000 : 0;

        if (timeSinceLastAction > 300) {
            weights.idle = 0.5;
            weights.moveCharacter = 0.2;
        }

        if (bot.behavior.currentServer?.playing > 20) {
            weights.sendChatMessage = 0.3;
        }

        return weights;
    }

    selectWeightedAction(actions, weights) {
        const weightArray = Object.values(weights);
        const totalWeight = weightArray.reduce((a, b) => a + b, 0);
        let random = Math.random() * totalWeight;
        
        for (let i = 0; i < actions.length; i++) {
            if (random < weightArray[i]) {
                return actions[i];
            }
            random -= weightArray[i];
        }
        return actions[0];
    }

    async reconnectBot(botId) {
        const bot = this.bots.get(botId);
        if (!bot) return false;

        try {
            this.logBotActivity(bot.id, 'Attempting to reconnect...');
            bot.status = 'reconnecting';
            await this.saveBotToDatabase(bot);
            this.emit('botUpdate', this.sanitizeBot(bot));

            const loginOptions = {
                username: bot.username,
                password: bot.password
            };

            if (bot.proxy && bot.proxy !== 'temp_ip_24.145.49.159') {
                loginOptions.agent = new HttpsProxyAgent(bot.proxy);
            }

            const user = await noblox.login(loginOptions);
            bot.security.cookie = user;
            bot.security.lastLogin = new Date();
            bot.status = 'online';
            bot.security.loginAttempts = 0;
            
            await this.saveBotToDatabase(bot);

            this.logBotActivity(bot.id, 'Reconnected successfully');
            this.emit('botUpdate', this.sanitizeBot(bot));
            return true;
        } catch (error) {
            bot.security.loginAttempts++;
            await this.saveBotToDatabase(bot);
            
            if (bot.security.loginAttempts >= 3) {
                bot.status = 'offline';
                await this.saveBotToDatabase(bot);
                this.logBotActivity(bot.id, 'Failed to reconnect after 3 attempts');
            }
            return false;
        }
    }

    shouldReconnect(error) {
        const recoverableErrors = [
            'ECONNRESET',
            'ETIMEDOUT',
            'socket hang up',
            'network timeout',
            'connection reset'
        ];
        return recoverableErrors.some(e => error.message?.toLowerCase().includes(e.toLowerCase()));
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    logBotActivity(botId, message) {
        const bot = this.bots.get(botId);
        if (!bot) return;

        const activity = {
            botId,
            username: bot.username,
            message,
            timestamp: new Date()
        };
        
        bot.activityLog.push(activity);
        if (bot.activityLog.length > 100) {
            bot.activityLog.shift();
        }
        this.emit('botActivity', activity);
    }

    async stopBot(botId) {
        const bot = this.bots.get(botId);
        if (bot) {
            bot.status = 'offline';
            this.stats.activeBots--;
            if (bot.proxy && bot.proxy !== 'temp_ip_24.145.49.159') {
                this.releaseProxy(bot.proxy);
            }
            await this.saveBotToDatabase(bot);
            this.logBotActivity(botId, 'Bot stopped');
            this.emit('botStopped', this.sanitizeBot(bot));
            return true;
        }
        return false;
    }

    async startBot(botId) {
        const bot = this.bots.get(botId);
        if (bot) {
            bot.status = 'online';
            this.stats.activeBots++;
            await this.saveBotToDatabase(bot);
            this.startBotBehavior(botId);
            this.logBotActivity(botId, 'Bot started');
            this.emit('botStarted', this.sanitizeBot(bot));
            return true;
        }
        return false;
    }

    async removeBot(botId) {
        const bot = this.bots.get(botId);
        if (bot) {
            await this.stopBot(botId);
            this.bots.delete(botId);
            this.stats.totalBots--;
            await this.deleteBotFromDatabase(botId);
            this.logBotActivity(botId, 'Bot removed');
            this.emit('botRemoved', this.sanitizeBot(bot));
            return true;
        }
        return false;
    }

    getBotActivity(botId) {
        const bot = this.bots.get(botId);
        return bot?.activityLog || [];
    }

    getBots() {
        return Array.from(this.bots.values()).map(bot => this.sanitizeBot(bot));
    }

    getStats() {
        return {
            totalBots: this.stats.totalBots,
            activeBots: this.stats.activeBots,
            totalRequests: this.stats.totalRequests,
            errors: this.stats.errors,
            bannedAccounts: this.stats.bannedAccounts,
            totalPlayTime: this.stats.totalPlayTime,
            proxyCount: this.proxies.length,
            availableProxies: this.proxies.filter(p => !p.inUse).length,
            databaseConnected: !!this.pool
        };
    }
}

module.exports = BotManager;
