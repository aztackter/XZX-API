let bots = [];
let activityEntries = [];
let startTime = Date.now();

let socket = null;
try {
    socket = io({
        auth: { token: localStorage.getItem('authToken') || 'demo-token' },
        autoConnect: true
    });
    
    socket.on('connect_error', () => {
        console.log('WebSocket connection failed');
    });
    
    socket.on('botCreated', (bot) => {
        addActivityLog(bot.username, 'New bot agent created', 'green');
        fetchBots();
    });
    
    socket.on('botUpdate', () => fetchBots());
    socket.on('botError', (error) => {
        addActivityLog(error.botId || 'System', `Error: ${error.error}`, 'red');
    });
} catch (e) {
    console.log('Socket.IO not available');
}

document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    fetchStats();
    fetchBots();
    startUptimeCounter();
    startActivitySimulation();
});

function setupEventListeners() {
    const createBtn = document.getElementById('createBotBtn');
    if (createBtn) {
        createBtn.addEventListener('click', () => {
            document.getElementById('createBotModal').style.display = 'flex';
        });
    }
    
    const closeBtn = document.querySelector('.close-modal');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            document.getElementById('createBotModal').style.display = 'none';
        });
    }
    
    const modal = document.getElementById('createBotModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    }
    
    const form = document.getElementById('createBotForm');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await createBot();
        });
    }
    
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterAgents(e.target.value);
        });
    }
    
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            if (e.target.dataset.tab === 'alerts') {
                showAlerts();
            } else {
                showRecentLogs();
            }
        });
    });
    
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            const page = item.dataset.page;
            switchPage(page);
        });
    });
}

async function fetchStats() {
    try {
        const response = await fetch('/api/stats', {
            headers: getHeaders()
        });
        if (response.ok) {
            const stats = await response.json();
            document.getElementById('activeSessions').textContent = stats.activeBots || 0;
            document.getElementById('tasksRunning').textContent = stats.totalRequests || 0;
            document.getElementById('errorsDetected').textContent = stats.errors || 0;
        }
    } catch (error) {
        console.log('Stats API unavailable');
    }
}

async function fetchBots() {
    try {
        const response = await fetch('/api/bots', {
            headers: getHeaders()
        });
        if (response.ok) {
            const data = await response.json();
            bots = data.bots || [];
            renderBotsGrid(bots);
        } else {
            renderEmptyGrid();
        }
    } catch (error) {
        console.log('Bots API unavailable');
        renderEmptyGrid();
    }
}

function renderEmptyGrid() {
    const grid = document.getElementById('agentsGrid');
    if (grid) {
        grid.innerHTML = '<div class="empty-state">No agents created yet. Click "Create New Bot" to get started.</div>';
    }
}

function renderBotsGrid(botsList) {
    const grid = document.getElementById('agentsGrid');
    if (!grid) return;
    
    if (!botsList || botsList.length === 0) {
        grid.innerHTML = '<div class="empty-state">No agents created yet. Click "Create New Bot" to get started.</div>';
        return;
    }
    
    grid.innerHTML = botsList.map(bot => createAgentCard(bot)).join('');
    
    botsList.forEach(bot => {
        const startBtn = document.getElementById(`start-${bot.id}`);
        const stopBtn = document.getElementById(`stop-${bot.id}`);
        const removeBtn = document.getElementById(`remove-${bot.id}`);
        
        if (startBtn) startBtn.onclick = (e) => { e.stopPropagation(); startBot(bot.id); };
        if (stopBtn) stopBtn.onclick = (e) => { e.stopPropagation(); stopBot(bot.id); };
        if (removeBtn) removeBtn.onclick = (e) => { e.stopPropagation(); removeBot(bot.id); };
    });
}

function createAgentCard(bot) {
    const status = getBotStatus(bot);
    const progress = Math.min(100, (bot.stats?.actions || 0) % 100);
    const playTime = formatTime(bot.stats?.playTime || 0);
    
    return `
        <div class="agent-card" data-agent-id="${bot.id}" data-agent-name="${bot.displayName || bot.username}">
            <div class="agent-header">
                <span class="agent-name">${escapeHtml(bot.displayName || bot.username)}</span>
                <span class="status-badge ${status.class}">${status.text}</span>
            </div>
            <div class="agent-details">
                <p>Game ID: ${escapeHtml(bot.gameId)}</p>
                <p>Tasks: ${bot.stats?.actions || 0}</p>
                <p>Play Time: ${playTime}</p>
            </div>
            <div class="agent-progress">
                <div class="agent-progress-bar" style="width: ${progress}%"></div>
            </div>
            <div class="agent-actions">
                <button class="start-btn" id="start-${bot.id}" ${bot.status === 'online' ? 'disabled' : ''}>Start</button>
                <button class="stop-btn" id="stop-${bot.id}" ${bot.status === 'offline' ? 'disabled' : ''}>Stop</button>
                <button class="remove-btn" id="remove-${bot.id}">Remove</button>
            </div>
        </div>
    `;
}

function getBotStatus(bot) {
    if (bot.status === 'online') return { class: 'online', text: 'Online' };
    if (bot.status === 'offline') return { class: 'offline', text: 'Offline' };
    if (bot.status === 'reconnecting') return { class: 'idle', text: 'Reconnecting' };
    if (bot.stats?.errors > 5) return { class: 'error', text: 'Error' };
    return { class: 'idle', text: 'Idle' };
}

function filterAgents(searchTerm) {
    const cards = document.querySelectorAll('.agent-card');
    const term = searchTerm.toLowerCase();
    
    cards.forEach(card => {
        const name = card.dataset.agentName?.toLowerCase() || '';
        if (name.includes(term)) {
            card.style.display = '';
        } else {
            card.style.display = 'none';
        }
    });
}

async function createBot() {
    const username = document.getElementById('botUsername')?.value;
    const password = document.getElementById('botPassword')?.value;
    const gameId = document.getElementById('botGameId')?.value;
    const humanLike = document.getElementById('humanLike')?.checked || true;
    const autoReconnect = document.getElementById('autoReconnect')?.checked || true;
    
    if (!username || !password || !gameId) {
        alert('Please fill in all fields');
        return;
    }
    
    try {
        const response = await fetch('/api/bots/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getHeaders()
            },
            body: JSON.stringify({
                username,
                password,
                gameId,
                options: { humanLikeBehavior: humanLike, autoReconnect }
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            const modal = document.getElementById('createBotModal');
            if (modal) modal.style.display = 'none';
            document.getElementById('createBotForm')?.reset();
            addActivityLog('System', `Bot agent "${username}" created successfully`, 'green');
            fetchBots();
            updateNotificationBadge();
        } else {
            addActivityLog('System', `Failed to create bot: ${data.error}`, 'red');
        }
    } catch (error) {
        addActivityLog('System', `Error creating bot: ${error.message}`, 'red');
    }
}

async function startBot(botId) {
    try {
        const response = await fetch(`/api/bots/${botId}/start`, {
            method: 'POST',
            headers: getHeaders()
        });
        const data = await response.json();
        if (data.success) {
            addActivityLog(`Bot ${botId}`, 'Bot started successfully', 'green');
            fetchBots();
        }
    } catch (error) {
        addActivityLog(`Bot`, `Failed to start bot`, 'red');
    }
}

async function stopBot(botId) {
    try {
        const response = await fetch(`/api/bots/${botId}/stop`, {
            method: 'POST',
            headers: getHeaders()
        });
        const data = await response.json();
        if (data.success) {
            addActivityLog(`Bot ${botId}`, 'Bot stopped', 'yellow');
            fetchBots();
        }
    } catch (error) {
        addActivityLog(`Bot`, `Failed to stop bot`, 'red');
    }
}

async function removeBot(botId) {
    if (!confirm('Are you sure you want to remove this bot agent?')) return;
    
    try {
        const response = await fetch(`/api/bots/${botId}`, {
            method: 'DELETE',
            headers: getHeaders()
        });
        const data = await response.json();
        if (data.success) {
            addActivityLog(`Bot ${botId}`, 'Bot agent removed from system', 'gray');
            fetchBots();
        }
    } catch (error) {
        addActivityLog(`Bot`, `Failed to remove bot`, 'red');
    }
}

function getHeaders() {
    const token = localStorage.getItem('authToken') || 'demo-token';
    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
}

function addActivityLog(agent, action, color) {
    const entry = {
        agent,
        action,
        color,
        timestamp: new Date()
    };
    
    activityEntries.unshift(entry);
    if (activityEntries.length > 50) activityEntries.pop();
    
    const activeTab = document.querySelector('.tab.active');
    if (activeTab && activeTab.dataset.tab === 'logs') {
        showRecentLogs();
    }
}

function showRecentLogs() {
    const logContainer = document.getElementById('activityLog');
    if (!logContainer) return;
    
    if (activityEntries.length === 0) {
        logContainer.innerHTML = '<div class="empty-state">No activity logs yet</div>';
        return;
    }
    
    logContainer.innerHTML = activityEntries.map(entry => `
        <div class="activity-entry">
            <div class="activity-dot ${entry.color}"></div>
            <div class="activity-content">
                <div class="activity-agent">${escapeHtml(entry.agent)}</div>
                <div class="activity-action">${escapeHtml(entry.action)}</div>
                <div class="activity-time">${getTimeAgo(entry.timestamp)}</div>
            </div>
        </div>
    `).join('');
}

function showAlerts() {
    const alerts = activityEntries.filter(e => e.color === 'red' || e.color === 'yellow');
    const logContainer = document.getElementById('activityLog');
    if (!logContainer) return;
    
    if (alerts.length === 0) {
        logContainer.innerHTML = '<div class="empty-state">No alerts to display</div>';
        return;
    }
    
    logContainer.innerHTML = alerts.map(entry => `
        <div class="activity-entry">
            <div class="activity-dot ${entry.color}"></div>
            <div class="activity-content">
                <div class="activity-agent">${escapeHtml(entry.agent)}</div>
                <div class="activity-action">${escapeHtml(entry.action)}</div>
                <div class="activity-time">${getTimeAgo(entry.timestamp)}</div>
            </div>
        </div>
    `).join('');
}

function startUptimeCounter() {
    setInterval(() => {
        const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
        const hours = Math.floor(uptimeSeconds / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);
        const uptimeElement = document.getElementById('systemUptime');
        if (uptimeElement) {
            uptimeElement.textContent = `${hours}h ${minutes}m`;
        }
    }, 60000);
}

function startActivitySimulation() {
    setInterval(() => {
        if (bots.length > 0 && Math.random() > 0.8) {
            const randomBot = bots[Math.floor(Math.random() * bots.length)];
            const actions = [
                'Task completed',
                'Joined game server',
                'Moved to location',
                'Sent message',
                'Collected reward'
            ];
            const randomAction = actions[Math.floor(Math.random() * actions.length)];
            addActivityLog(randomBot.displayName || randomBot.username, randomAction, 'green');
            updateNotificationBadge();
        }
    }, 45000);
}

function updateNotificationBadge() {
    const badge = document.getElementById('notificationBadge');
    if (badge) {
        const newActivities = activityEntries.filter(e => {
            const seconds = Math.floor((new Date() - e.timestamp) / 1000);
            return seconds < 60;
        }).length;
        badge.textContent = newActivities > 0 ? newActivities : '0';
    }
}

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return `${seconds} secs ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} mins ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hours ago`;
    return `${Math.floor(hours / 24)} days ago`;
}

function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function switchPage(page) {
    const agentsGrid = document.getElementById('agentsGrid');
    const statsGrid = document.querySelector('.stats-grid');
    
    switch(page) {
        case 'dashboard':
        case 'agents':
            if (statsGrid) statsGrid.style.display = 'grid';
            if (agentsGrid) agentsGrid.style.display = 'grid';
            break;
        case 'activity':
            showRecentLogs();
            break;
        case 'settings':
            alert('Settings panel coming soon');
            break;
    }
}
