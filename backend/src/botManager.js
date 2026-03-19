const noblox = require('noblox.js');
const EventEmitter = require('events');
const crypto = require('crypto');
const HttpsProxyAgent = require('https-proxy-agent');
const { RateLimiter } = require('limiter');

class BotManager extends EventEmitter {
    constructor() {
        super();
        this.bots = new Map();
        this.proxies = [];
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

    async createBot(username, password, gameId, options = {}) {
        try {
            await this.rateLimiter.removeTokens(1);
            const botId = `bot_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
            const proxy = options.useProxy ? this.getAvailableProxy() : null;
            
            const bot = {
                id: botId,
                username,
                gameId,
                status: 'initializing',
                createdAt: new Date(),
                lastActive: new Date(),
                proxy: proxy?.proxyAgent?.proxy?.href,
                stats: {
                    requests: 0,
                    errors: 0,
                    playTime: 0,
                    actions: 0
                },
                settings: {
                    actionInterval: options.actionInterval || 8000,
                    randomDelay: options.randomDelay || true,
                    humanLikeBehavior: options.humanLikeBehavior || true,
                    autoReconnect: options.autoReconnect || true
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

            const loginOptions = {
                username: username,
                password: password
            };
            
            if (proxy) {
                loginOptions.agent = proxy;
            }

            const user = await noblox.login(loginOptions);
            const csrf = await noblox.getCSRFToken();
            
            bot.security.cookie = user;
            bot.security.csrf = csrf;
            bot.security.lastLogin = new Date();
            bot.status = 'online';
            
            const userInfo = await noblox.getCurrentUser();
            bot.userId = userInfo.UserID;
            bot.displayName = userInfo.UserName;
            
            this.bots.set(bot.id, bot);
            this.stats.totalBots++;
            this.stats.activeBots++;
            
            this.emit('botCreated', this.sanitizeBot(bot));
            this.logBotActivity(bot.id, 'Bot created and logged in successfully');
            this.startBotBehavior(bot.id);
            
            return this.sanitizeBot(bot);
        } catch (error) {
            console.error(`Failed to create bot ${username}:`, error);
            if (error.message.includes('banned')) {
                this.stats.bannedAccounts++;
            }
            this.emit('botError', {
                username,
                error: error.message,
                timestamp: new Date()
            });
            throw error;
        }
    }

    sanitizeBot(bot) {
        const sanitized = { ...bot };
        delete sanitized.security;
        delete sanitized.settings?.password;
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
                
                this.emit('botUpdate', this.sanitizeBot(bot));
                this.logBotActivity(bot.id, `Performed action: ${action.type}`);
                
            } catch (error) {
                bot.stats.errors++;
                this.stats.errors++;
                console.error(`Bot ${bot.username} error:`, error);
                this.emit('botError', {
                    botId: bot.id,
                    error: error.message,
                    timestamp: new Date()
                });

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
            const gameFavorites = await noblox.getGameFavorites(bot.gameId);
            return {
                type: 'check_updates',
                gameInfo: {
                    name: gameInfo.Name,
                    playing: gameInfo.Playing,
                    visits: gameInfo.Visits,
                    favorites: gameFavorites.count
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
            this.emit('botUpdate', this.sanitizeBot(bot));

            const loginOptions = {
                username: bot.username,
                password: bot.password
            };

            if (bot.proxy) {
                loginOptions.agent = new HttpsProxyAgent(bot.proxy);
            }

            const user = await noblox.login(loginOptions);
            bot.security.cookie = user;
            bot.security.lastLogin = new Date();
            bot.status = 'online';
            bot.security.loginAttempts = 0;

            this.logBotActivity(bot.id, 'Reconnected successfully');
            this.emit('botUpdate', this.sanitizeBot(bot));
            return true;
        } catch (error) {
            bot.security.loginAttempts++;
            if (bot.security.loginAttempts >= 3) {
                bot.status = 'offline';
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
            'network timeout'
        ];
        return recoverableErrors.some(e => error.message.includes(e));
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

    stopBot(botId) {
        const bot = this.bots.get(botId);
        if (bot) {
            bot.status = 'offline';
            this.stats.activeBots--;
            if (bot.proxy) {
                this.releaseProxy(bot.proxy);
            }
            this.logBotActivity(botId, 'Bot stopped');
            this.emit('botStopped', this.sanitizeBot(bot));
            return true;
        }
        return false;
    }

    startBot(botId) {
        const bot = this.bots.get(botId);
        if (bot) {
            bot.status = 'online';
            this.stats.activeBots++;
            this.startBotBehavior(botId);
            this.logBotActivity(botId, 'Bot started');
            this.emit('botStarted', this.sanitizeBot(bot));
            return true;
        }
        return false;
    }

    removeBot(botId) {
        const bot = this.bots.get(botId);
        if (bot) {
            this.stopBot(botId);
            this.bots.delete(botId);
            this.stats.totalBots--;
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
            ...this.stats,
            bots: this.getBots(),
            proxyCount: this.proxies.length,
            availableProxies: this.proxies.filter(p => !p.inUse).length
        };
    }
}

module.exports = BotManager;
