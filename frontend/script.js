// Global state
let bots = [];
let activityEntries = [];
let startTime = Date.now();
let demoMode = true;

// API Base URL (auto-detect)
const API_BASE = window.location.origin;

// Socket.IO connection
let socket = null;
try {
    socket = io({
        auth: { token: localStorage.getItem('authToken') || 'demo-token' },
        autoConnect: true
    });
    
    socket.on('connect_error', () => {
        console.log('WebSocket failed, using demo mode');
        demoMode = true;
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
    console.log('Socket.IO not available, using demo mode');
    demoMode = true;
}

document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    fetchStats();
    fetchBots();
    startActivitySimulation();
});

function setupEventListeners() {
    // Create bot button
    const createBtn = document.getElementById('createBotBtn');
    if (createBtn) {
        createBtn.addEventListener('click', () => {
            document.getElementById('createBotModal').style.display = 'flex';
        });
    }
    
    // Modal close
    const closeBtn = document.querySelector('.close-modal');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            document.getElementById('createBotModal').style.display = 'none';
        });
    }
    
    // Modal background click
    const modal = document.getElementById('createBotModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    }
    
    // Create bot form
    const form = document.getElementById('createBotForm');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await createBot();
        });
    }
    
    // Search input
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterAgents(e.target.value);
        });
    }
    
    // Tabs
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
    
    // Sidebar navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            const page = item.dataset.page;
            switchPage(page);
        });
    });
    
    // Click outside modal to close
    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });
}

async function fetchStats() {
    try {
        const response = await fetch(`${API_BASE}/api/stats`, {
            headers: getHeaders()
        });
        if (response.ok) {
            const stats = await response.json();
            updateStats(stats);
            demoMode = false;
        } else {
            useDemoStats();
        }
    } catch (error) {
        console.log('API unavailable, using demo stats');
        useDemoStats();
    }
}

function useDemoStats() {
    updateStats({
        activeBots: 128,
        totalRequests: 342,
        errors: 15
    });
}

function updateStats(stats) {
    const activeSessions = document.getElementById('activeSessions');
    const tasksRunning = document.getElementById('tasksRunning');
    const errorsDetected = document.getElementById('errorsDetected');
    
    if (activeSessions) activeSessions.textContent = stats.activeBots || stats.activeSessions || 0;
    if (tasksRunning) tasksRunning.textContent = stats.totalRequests || stats.tasksRunning || 0;
    if (errorsDetected) errorsDetected.textContent = stats.errors || 0;
    
    const uptime = ((Date.now() - startTime) / 1000 / 3600).toFixed(1);
    const uptimeElement = document.getElementById('systemUptime');
    if (uptimeElement) uptimeElement.textContent = `${Math.min(99.9, parseFloat(uptime))}%`;
}

async function fetchBots() {
    try {
        const response = await fetch(`${API_BASE}/api/bots`, {
            headers: getHeaders()
        });
        if (response.ok) {
            const data = await response.json();
            bots = data.bots || [];
            renderBotsGrid(bots);
            demoMode = false;
        } else {
            useDemoBots();
        }
    } catch (error) {
        console.log('API unavailable, using demo bots');
        useDemoBots();
    }
}

function useDemoBots() {
    bots = [
        { id: '1', username: 'Agent 01', displayName: 'Agent 01', status: 'online', gameId: '123456', stats: { actions: 12, playTime: 3600 }, behavior: { position: { x: 10, y: 0, z: 5 } } },
        { id: '2', username: 'Agent 02', displayName: 'Agent 02', status: 'idle', gameId: '123456', stats: { actions: 3, playTime: 1800 }, behavior: { position: { x: 20, y: 0, z: 15 } } },
        { id: '3', username: 'Agent 03', displayName: 'Agent 03', status: 'error', gameId: '123456', stats: { actions: 0, playTime: 300 }, behavior: { position: { x: 5, y: 0, z: 8 } } },
        { id: '4', username: 'Agent 05', displayName: 'Agent 05', status: 'online', gameId: '789012', stats: { actions: 6, playTime: 5400 }, behavior: { position: { x: 30, y: 0, z: 25 } } },
        { id: '5', username: 'Agent 06', displayName: 'Agent 06', status: 'updating', gameId: '789012', stats: { actions: 5, playTime: 2700 }, behavior: { position: { x: 15, y: 0, z: 12 } } },
        { id: '6', username: 'Agent 07', displayName: 'Agent 07', status: 'online', gameId: '345678', stats: { actions: 9, playTime: 7200 }, behavior: { position: { x: 40, y: 0, z: 35 } } },
        { id: '7', username: 'Agent 08', displayName: 'Agent 08', status: 'online', gameId: '345678', stats: { actions: 4, playTime: 3600 }, behavior: { position: { x: 25, y: 0, z: 20 } } },
        { id: '8', username: 'Agent 09', displayName: 'Agent 09', status: 'offline', gameId: '901234', stats: { actions: 0, playTime: 0 }, behavior: { position: { x: 0, y: 0, z: 0 } } }
    ];
    renderBotsGrid(bots);
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
    const position = bot.behavior?.position || { x: 0, y: 0, z: 0 };
    
    return `
        <div class="agent-card" data-agent-id="${bot.id}" data-agent-name="${bot.displayName || bot.username}">
            <div class="agent-header">
                <span class="agent-name">${bot.displayName || bot.username}</span>
                <span class="status-badge ${status.class}">${status.text}</span>
            </div>
            <div class="agent-details">
                <p>Game ID: ${bot.gameId}</p>
                <p>Tasks: ${bot.stats?.actions || 0}</p>
                <p>Play Time: ${playTime}</p>
                <p>Position: (${position.x.toFixed(1)}, ${position.z.toFixed(1)})</p>
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
    if (bot.status === 'reconnecting') return { class: 'updating', text: 'Updating' };
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
        const response = await fetch(`${API_BASE}/api/bots/create`, {
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
        // Demo mode - simulate bot creation
        addActivityLog('System', `Bot agent "${username}" created (DEMO MODE)`, 'green');
        
        const newBot = {
            id: Date.now().toString(),
            username,
            displayName: username,
            status: 'online',
            gameId,
            stats: { actions: 0, playTime: 0 },
            behavior: { position: { x: 0, y: 0, z: 0 } }
        };
        bots.unshift(newBot);
        renderBotsGrid(bots);
        
        const modal = document.getElementById('createBotModal');
        if (modal) modal.style.display = 'none';
        document.getElementById('createBotForm')?.reset();
    }
}

async function startBot(botId) {
    try {
        const response = await fetch(`${API_BASE}/api/bots/${botId}/start`, {
            method: 'POST',
            headers: getHeaders()
        });
        const data = await response.json();
        if (data.success) {
            addActivityLog(`Bot ${botId}`, 'Bot started successfully', 'green');
            fetchBots();
        }
    } catch (error) {
        // Demo mode
        const bot = bots.find(b => b.id === botId);
        if (bot) {
            bot.status = 'online';
            renderBotsGrid(bots);
            addActivityLog(bot.username, 'Bot started (DEMO MODE)', 'green');
        }
    }
}

async function stopBot(botId) {
    try {
        const response = await fetch(`${API_BASE}/api/bots/${botId}/stop`, {
            method: 'POST',
            headers: getHeaders()
        });
        const data = await response.json();
        if (data.success) {
            addActivityLog(`Bot ${botId}`, 'Bot stopped', 'yellow');
            fetchBots();
        }
    } catch (error) {
        // Demo mode
        const bot = bots.find(b => b.id === botId);
        if (bot) {
            bot.status = 'offline';
            renderBotsGrid(bots);
            addActivityLog(bot.username, 'Bot stopped (DEMO MODE)', 'yellow');
        }
    }
}

async function removeBot(botId) {
    if (!confirm('Are you sure you want to remove this bot agent?')) return;
    
    try {
        const response = await fetch(`${API_BASE}/api/bots/${botId}`, {
            method: 'DELETE',
            headers: getHeaders()
        });
        const data = await response.json();
        if (data.success) {
            addActivityLog(`Bot ${botId}`, 'Bot agent removed from system', 'gray');
            fetchBots();
        }
    } catch (error) {
        // Demo mode
        const bot = bots.find(b => b.id === botId);
        if (bot) {
            const index = bots.findIndex(b => b.id === botId);
            if (index > -1) bots.splice(index, 1);
            renderBotsGrid(bots);
            addActivityLog(bot.username, 'Bot agent removed (DEMO MODE)', 'gray');
        }
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
        timestamp: new Date(),
        timeAgo: 'just now'
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

function startActivitySimulation() {
    setInterval(() => {
        if (bots.length > 0 && Math.random() > 0.7) {
            const randomBot = bots[Math.floor(Math.random() * bots.length)];
            const actions = [
                'Task completed successfully',
                'Joined game server',
                'Moved to new location',
                'Sent chat message',
                'Interacted with object',
                'Collected reward'
            ];
            const randomAction = actions[Math.floor(Math.random() * actions.length)];
            addActivityLog(randomBot.displayName || randomBot.username, randomAction, 'green');
            updateNotificationBadge();
        }
    }, 30000);
}

function updateNotificationBadge() {
    const badge = document.getElementById('notificationBadge');
    if (badge) {
        const newActivities = activityEntries.filter(e => {
            const timeAgo = getTimeAgo(e.timestamp);
            return timeAgo.includes('secs') || timeAgo.includes('just now');
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
            if (statsGrid) statsGrid.style.display = 'grid';
            if (agentsGrid) agentsGrid.style.display = 'grid';
            break;
        case 'agents':
            if (statsGrid) statsGrid.style.display = 'grid';
            if (agentsGrid) agentsGrid.style.display = 'grid';
            break;
        case 'activity':
            showRecentLogs();
            break;
        case 'settings':
            alert('Settings panel coming soon!');
            break;
    }
}
