const socket = io({
    auth: {
        token: localStorage.getItem('authToken')
    },
    autoConnect: false
});

let currentUser = null;
let activityInterval = null;

document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    
    try {
        const response = await fetch('/api/admin/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            localStorage.setItem('authToken', 'rbx-bot-token-2024-secure');
            showNotification('Login successful!', 'success');
            document.getElementById('loginModal').style.display = 'none';
            initializeApp();
        } else {
            showNotification('Login failed: ' + data.error, 'error');
        }
    } catch (error) {
        showNotification('Login error: ' + error.message, 'error');
    }
});

window.logout = async function() {
    await fetch('/api/admin/logout', { method: 'POST' });
    localStorage.removeItem('authToken');
    document.getElementById('loginModal').style.display = 'block';
    document.querySelector('.container').style.display = 'none';
    socket.disconnect();
};

function initializeApp() {
    document.querySelector('.container').style.display = 'block';
    socket.auth = { token: localStorage.getItem('authToken') };
    socket.connect();
    startActivityUpdates();
    fetchBots();
    fetchStats();
}

async function fetchBots() {
    try {
        const response = await fetch('/api/bots', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });
        const bots = await response.json();
        updateBotsGrid(bots);
    } catch (error) {
        showNotification('Failed to fetch bots: ' + error.message, 'error');
    }
}

async function fetchStats() {
    try {
        const response = await fetch('/api/stats', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });
        const stats = await response.json();
        updateStats(stats);
    } catch (error) {
        showNotification('Failed to fetch stats: ' + error.message, 'error');
    }
}

function updateStats(stats) {
    document.getElementById('totalBots').textContent = stats.totalBots;
    document.getElementById('activeBots').textContent = stats.activeBots;
    document.getElementById('totalRequests').textContent = stats.totalRequests;
    document.getElementById('errors').textContent = stats.errors;
    document.getElementById('bannedAccounts').textContent = stats.bannedAccounts;
    document.getElementById('totalPlayTime').textContent = formatTime(stats.totalPlayTime);
    document.getElementById('proxyCount').textContent = `${stats.availableProxies}/${stats.proxyCount}`;
}

function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
}

function startActivityUpdates() {
    if (activityInterval) clearInterval(activityInterval);
    activityInterval = setInterval(async () => {
        const activeBotId = document.querySelector('.bot-card.active')?.id;
        if (activeBotId) {
            await fetchBotActivity(activeBotId.replace('bot-', ''));
        }
    }, 5000);
}

async function fetchBotActivity(botId) {
    try {
        const response = await fetch(`/api/bots/${botId}/activity`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });
        const data = await response.json();
        updateBotActivity(botId, data.activity);
    } catch (error) {
        console.error('Failed to fetch activity:', error);
    }
}

function updateBotActivity(botId, activities) {
    const activityLog = document.getElementById(`activity-${botId}`);
    if (activityLog && activities.length > 0) {
        activityLog.innerHTML = activities.slice(-5).map(activity => `
            <div class="activity-item">
                <span class="activity-time">${new Date(activity.timestamp).toLocaleTimeString()}</span>
                <span class="activity-message">${activity.message}</span>
            </div>
        `).join('');
    }
}

document.getElementById('createBotForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const gameId = document.getElementById('gameId').value;
    const useProxy = document.getElementById('useProxy').checked;
    const humanLike = document.getElementById('humanLike').checked;
    
    try {
        const response = await fetch('/api/bots/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify({ 
                username, 
                password, 
                gameId,
                options: {
                    useProxy,
                    humanLikeBehavior: humanLike,
                    randomDelay: true,
                    autoReconnect: true
                }
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('createBotForm').reset();
            showNotification('Bot created successfully!', 'success');
        } else {
            showNotification('Failed to create bot: ' + data.error, 'error');
        }
    } catch (error) {
        showNotification('Error creating bot: ' + error.message, 'error');
    }
});

function updateBotsGrid(bots) {
    const grid = document.getElementById('botsGrid');
    
    if (bots.length === 0) {
        grid.innerHTML = '<p class="no-bots">No bots created yet</p>';
        return;
    }
    
    grid.innerHTML = bots.map(bot => createBotCard(bot)).join('');
    
    bots.forEach(bot => {
        const startBtn = document.getElementById(`start-${bot.id}`);
        const stopBtn = document.getElementById(`stop-${bot.id}`);
        const removeBtn = document.getElementById(`remove-${bot.id}`);
        
        if (startBtn) {
            startBtn.onclick = (e) => {
                e.stopPropagation();
                startBot(bot.id);
            };
        }
        
        if (stopBtn) {
            stopBtn.onclick = (e) => {
                e.stopPropagation();
                stopBot(bot.id);
            };
        }
        
        if (removeBtn) {
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                removeBot(bot.id);
            };
        }
    });
}

function createBotCard(bot) {
    return `
        <div class="bot-card ${bot.status}" id="bot-${bot.id}" onclick="selectBot('${bot.id}')">
            <div class="bot-header">
                <span class="bot-name">${bot.displayName || bot.username}</span>
                <span class="bot-status ${bot.status}">${bot.status}</span>
            </div>
            <div class="bot-details">
                <p>Game ID: ${bot.gameId}</p>
                <p>Last Active: ${new Date(bot.lastActive).toLocaleString()}</p>
                <p>Actions: ${bot.stats.actions}</p>
                <p>Play Time: ${formatTime(bot.stats.playTime)}</p>
                <p>Proxy: ${bot.proxy ? 'Yes' : 'No'}</p>
            </div>
            <div class="bot-behavior">
                <p>Current Server: ${bot.behavior.currentServer?.id || 'None'}</p>
                <p>Position: (${bot.behavior.position.x.toFixed(1)}, ${bot.behavior.position.y.toFixed(1)}, ${bot.behavior.position.z.toFixed(1)})</p>
            </div>
            <div class="bot-activity" id="activity-${bot.id}"></div>
            <div class="bot-actions">
                <button class="start" id="start-${bot.id}" ${bot.status === 'online' ? 'disabled' : ''}>Start</button>
                <button class="stop" id="stop-${bot.id}" ${bot.status === 'offline' ? 'disabled' : ''}>Stop</button>
                <button class="remove" id="remove-${bot.id}">Remove</button>
            </div>
        </div>
    `;
}

window.selectBot = function(botId) {
    document.querySelectorAll('.bot-card').forEach(card => {
        card.classList.remove('active');
    });
    document.getElementById(`bot-${botId}`).classList.add('active');
    fetchBotActivity(botId);
};

window.startBot = async function(botId) {
    try {
        const response = await fetch(`/api/bots/${botId}/start`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });
        const data = await response.json();
        if (data.success) {
            showNotification('Bot started', 'success');
        }
    } catch (error) {
        showNotification('Failed to start bot', 'error');
    }
};

window.stopBot = async function(botId) {
    try {
        const response = await fetch(`/api/bots/${botId}/stop`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });
        const data = await response.json();
        if (data.success) {
            showNotification('Bot stopped', 'warning');
        }
    } catch (error) {
        showNotification('Failed to stop bot', 'error');
    }
};

window.removeBot = async function(botId) {
    if (confirm('Are you sure you want to remove this bot?')) {
        try {
            const response = await fetch(`/api/bots/${botId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                }
            });
            const data = await response.json();
            if (data.success) {
                showNotification('Bot removed', 'info');
            }
        } catch (error) {
            showNotification('Failed to remove bot', 'error');
        }
    }
};

function showNotification(message, type) {
    const container = document.getElementById('notificationContainer') || createNotificationContainer();
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-message">${message}</span>
            <button class="notification-close" onclick="this.parentElement.parentElement.remove()">×</button>
        </div>
    `;
    container.appendChild(notification);
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}

function createNotificationContainer() {
    const container = document.createElement('div');
    container.id = 'notificationContainer';
    container.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 9999;
    `;
    document.body.appendChild(container);
    return container;
}

socket.on('stats', updateStats);
socket.on('botCreated', (bot) => {
    showNotification(`Bot ${bot.username} created!`, 'success');
    fetchBots();
});
socket.on('botUpdate', (bot) => {
    const card = document.getElementById(`bot-${bot.id}`);
    if (card) {
        card.outerHTML = createBotCard(bot);
    }
});
socket.on('botActivity', (activity) => {
    updateBotActivity(activity.botId, [activity]);
});
socket.on('botError', (error) => {
    showNotification(`Bot error: ${error.error}`, 'error');
});
socket.on('connect_error', (error) => {
    if (error.message === 'Authentication error') {
        showNotification('Authentication failed. Please login again.', 'error');
        document.getElementById('loginModal').style.display = 'block';
        document.querySelector('.container').style.display = 'none';
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('authToken');
    if (token) {
        initializeApp();
    } else {
        document.getElementById('loginModal').style.display = 'block';
        document.querySelector('.container').style.display = 'none';
    }
});
