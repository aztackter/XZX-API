const socket = io({
    auth: {
        token: localStorage.getItem('authToken')
    },
    autoConnect: true
});

let bots = [];
let startTime = Date.now();

document.addEventListener('DOMContentLoaded', () => {
    fetchStats();
    fetchBots();
    setupEventListeners();
    startActivitySimulation();
});

function setupEventListeners() {
    document.getElementById('createBotBtn').addEventListener('click', () => {
        document.getElementById('createBotModal').style.display = 'flex';
    });

    document.querySelector('.close-modal').addEventListener('click', () => {
        document.getElementById('createBotModal').style.display = 'none';
    });

    document.getElementById('createBotForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await createBot();
    });

    document.getElementById('searchAgents').addEventListener('input', (e) => {
        filterAgents(e.target.value);
    });

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
            document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
            e.currentTarget.classList.add('active');
            const page = e.currentTarget.dataset.page;
            switchPage(page);
        });
    });
}

async function fetchStats() {
    try {
        const response = await fetch('/api/stats', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken') || 'rbx-bot-token-2024-secure'}`
            }
        });
        const stats = await response.json();
        updateStats(stats);
    } catch (error) {
        console.error('Failed to fetch stats:', error);
        updateStatsDemo();
    }
}

function updateStats(stats) {
    document.getElementById('activeSessions').textContent = stats.activeBots || 0;
    document.getElementById('tasksRunning').textContent = stats.totalRequests || 0;
    document.getElementById('errorsDetected').textContent = stats.errors || 0;
    
    const uptime = ((Date.now() - startTime) / 1000 / 3600).toFixed(1);
    document.getElementById('systemUptime').textContent = `${uptime}%`;
}

function updateStatsDemo() {
    document.getElementById('activeSessions').textContent = '128';
    document.getElementById('tasksRunning').textContent = '342';
    document.getElementById('errorsDetected').textContent = '15';
    document.getElementById('systemUptime').textContent = '99.8%';
}

async function fetchBots() {
    try {
        const response = await fetch('/api/bots', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken') || 'rbx-bot-token-2024-secure'}`
            }
        });
        const data = await response.json();
        bots = data.bots || [];
        renderBotsGrid(bots);
    } catch (error) {
        console.error('Failed to fetch bots:', error);
        renderDemoBots();
    }
}

function renderBotsGrid(botsList) {
    const grid = document.getElementById('agentsGrid');
    
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
    
    return `
        <div class="agent-card" data-agent-id="${bot.id}">
            <div class="agent-header">
                <span class="agent-name">${bot.displayName || bot.username}</span>
                <span class="status-badge ${status.class}">${status.text}</span>
            </div>
            <div class="agent-details">
                <p>Game ID: ${bot.gameId}</p>
                <p>Tasks: ${bot.stats?.actions || 0}</p>
                <p>Play Time: ${formatTime(bot.stats?.playTime || 0)}</p>
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

function renderDemoBots() {
    const demoBots = [
        { id: '1', username: 'Agent 01', status: 'online', gameId: '123456', stats: { actions: 12, playTime: 3600 } },
        { id: '2', username: 'Agent 02', status: 'idle', gameId: '123456', stats: { actions: 3, playTime: 1800 } },
        { id: '3', username: 'Agent 03', status: 'error', gameId: '123456', stats: { actions: 0, playTime: 300 } },
        { id: '4', username: 'Agent 05', status: 'online', gameId: '789012', stats: { actions: 6, playTime: 5400 } },
        { id: '5', username: 'Agent 06', status: 'updating', gameId: '789012', stats: { actions: 5, playTime: 2700 } },
        { id: '6', username: 'Agent 07', status: 'online', gameId: '345678', stats: { actions: 9, playTime: 7200 } },
        { id: '7', username: 'Agent 08', status: 'online', gameId: '345678', stats: { actions: 4, playTime: 3600 } },
        { id: '8', username: 'Agent 09', status: 'offline', gameId: '901234', stats: { actions: 0, playTime: 0 } }
    ];
    
    renderBotsGrid(demoBots);
}

async function createBot() {
    const username = document.getElementById('botUsername').value;
    const password = document.getElementById('botPassword').value;
    const gameId = document.getElementById('botGameId').value;
    const humanLike = document.getElementById('humanLike').checked;
    const autoReconnect = document.getElementById('autoReconnect').checked;
    
    try {
        const response = await fetch('/api/bots/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken') || 'rbx-bot-token-2024-secure'}`
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
            document.getElementById('createBotModal').style.display = 'none';
            document.getElementById('createBotForm').reset();
            addActivityLog('System', `Bot agent "${username}" created successfully`, 'green');
            fetchBots();
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
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken') || 'rbx-bot-token-2024-secure'}`
            }
        });
        const data = await response.json();
        if (data.success) {
            addActivityLog(`Bot ${botId}`, 'Bot started successfully', 'green');
            fetchBots();
        }
    } catch (error) {
        addActivityLog(`Bot ${botId}`, `Failed to start: ${error.message}`, 'red');
    }
}

async function stopBot(botId) {
    try {
        const response = await fetch(`/api/bots/${botId}/stop`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken') || 'rbx-bot-token-2024-secure'}`
            }
        });
        const data = await response.json();
        if (data.success) {
            addActivityLog(`Bot ${botId}`, 'Bot stopped', 'yellow');
            fetchBots();
        }
    } catch (error) {
        addActivityLog(`Bot ${botId}`, `Failed to stop: ${error.message}`, 'red');
    }
}

async function removeBot(botId) {
    if (!confirm('Are you sure you want to remove this bot agent?')) return;
    
    try {
        const response = await fetch(`/api/bots/${botId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken') || 'rbx-bot-token-2024-secure'}`
            }
        });
        const data = await response.json();
        if (data.success) {
            addActivityLog(`Bot ${botId}`, 'Bot agent removed from system', 'gray');
            fetchBots();
        }
    } catch (error) {
        addActivityLog(`Bot ${botId}`, `Failed to remove: ${error.message}`, 'red');
    }
}

function filterAgents(searchTerm) {
    const cards = document.querySelectorAll('.agent-card');
    const term = searchTerm.toLowerCase();
    
    cards.forEach(card => {
        const name = card.querySelector('.agent-name')?.textContent.toLowerCase() || '';
        if (name.includes(term)) {
            card.style.display = '';
        } else {
            card.style.display = 'none';
        }
    });
}

let activityEntries = [];

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
    
    showRecentLogs();
}

function showRecentLogs() {
    const logContainer = document.getElementById('activityLog');
    
    if (activityEntries.length === 0) {
        logContainer.innerHTML = '<div class="empty-state">No activity logs yet</div>';
        return;
    }
    
    logContainer.innerHTML = activityEntries.map(entry => `
        <div class="activity-entry">
            <div class="activity-dot ${entry.color}"></div>
            <div class="activity-content">
                <div class="activity-agent">${entry.agent}</div>
                <div class="activity-action">${entry.action}</div>
                <div class="activity-time">${getTimeAgo(entry.timestamp)}</div>
            </div>
        </div>
    `).join('');
}

function showAlerts() {
    const alerts = activityEntries.filter(e => e.color === 'red' || e.color === 'yellow');
    const logContainer = document.getElementById('activityLog');
    
    if (alerts.length === 0) {
        logContainer.innerHTML = '<div class="empty-state">No alerts to display</div>';
        return;
    }
    
    logContainer.innerHTML = alerts.map(entry => `
        <div class="activity-entry">
            <div class="activity-dot ${entry.color}"></div>
            <div class="activity-content">
                <div class="activity-agent">${entry.agent}</div>
                <div class="activity-action">${entry.action}</div>
                <div class="activity-time">${getTimeAgo(entry.timestamp)}</div>
            </div>
        </div>
    `).join('');
}

function startActivitySimulation() {
    setInterval(() => {
        if (Math.random() > 0.7 && bots.length > 0) {
            const randomBot = bots[Math.floor(Math.random() * bots.length)];
            const actions = [
                'Task completed successfully',
                'Joined game server',
                'Moved to new location',
                'Sent chat message',
                'Interacted with object'
            ];
            const randomAction = actions[Math.floor(Math.random() * actions.length)];
            addActivityLog(randomBot.username || 'Agent', randomAction, 'green');
        }
    }, 30000);
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

function switchPage(page) {
    switch(page) {
        case 'dashboard':
            document.querySelector('.agents-grid').style.display = 'grid';
            break;
        case 'agents':
            document.querySelector('.agents-grid').style.display = 'grid';
            break;
        case 'activity':
            showRecentLogs();
            break;
        case 'settings':
            alert('Settings panel coming soon!');
            break;
    }
}

socket.on('botCreated', (bot) => {
    addActivityLog(bot.username, 'New bot agent created', 'green');
    fetchBots();
});

socket.on('botUpdate', (bot) => {
    fetchBots();
});

socket.on('botError', (error) => {
    addActivityLog(error.botId || 'System', `Error: ${error.error}`, 'red');
});

socket.on('connect_error', () => {
    console.log('WebSocket connection failed, using demo mode');
});
