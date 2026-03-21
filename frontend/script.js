let bots = [];
let activityEntries = [];
let startTime = Date.now();
let notifications = [];

let socket = null;
try {
    socket = io({
        autoConnect: true
    });
    
    socket.on('connect_error', () => {
        console.log('WebSocket connection failed, using REST API only');
    });
    
    socket.on('botCreated', (bot) => {
        addNotification(`${bot.username} created successfully`, 'green');
        addActivityLog(bot.username, 'New bot agent created', 'green');
        fetchBots();
    });
    
    socket.on('botUpdate', () => fetchBots());
    socket.on('botError', (error) => {
        addNotification(`Error: ${error.error}`, 'red');
        addActivityLog(error.username || error.botId || 'System', `Error: ${error.error}`, 'red');
    });
} catch (e) {
    console.log('Socket.IO not available');
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing...');
    setupEventListeners();
    setupDropdowns();
    fetchStats();
    fetchBots();
    startUptimeCounter();
    startActivitySimulation();
});

function setupDropdowns() {
    const notificationsBtn = document.getElementById('notificationsBtn');
    const settingsBtn = document.getElementById('settingsBtn');
    const notificationsDropdown = document.getElementById('notificationsDropdown');
    const settingsDropdown = document.getElementById('settingsDropdown');
    
    if (notificationsBtn) {
        notificationsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            notificationsDropdown.classList.toggle('show');
            settingsDropdown.classList.remove('show');
        });
    }
    
    if (settingsBtn) {
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            settingsDropdown.classList.toggle('show');
            notificationsDropdown.classList.remove('show');
        });
    }
    
    document.addEventListener('click', () => {
        notificationsDropdown?.classList.remove('show');
        settingsDropdown?.classList.remove('show');
    });
    
    const markAllRead = document.querySelector('.mark-all-read');
    if (markAllRead) {
        markAllRead.addEventListener('click', () => {
            notifications = [];
            updateNotificationsList();
        });
    }
    
    const darkModeToggle = document.getElementById('darkModeToggle');
    const pushNotificationsToggle = document.getElementById('pushNotificationsToggle');
    const soundAlertsToggle = document.getElementById('soundAlertsToggle');
    const autoRefreshToggle = document.getElementById('autoRefreshToggle');
    
    if (darkModeToggle) {
        darkModeToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                document.body.classList.remove('light-mode');
            } else {
                document.body.classList.add('light-mode');
            }
        });
    }
    
    if (pushNotificationsToggle) {
        pushNotificationsToggle.addEventListener('change', async (e) => {
            if (e.target.checked && 'Notification' in window) {
                const permission = await Notification.requestPermission();
                if (permission !== 'granted') {
                    e.target.checked = false;
                    alert('Please allow notifications in your browser settings');
                }
            }
        });
    }
    
    if (soundAlertsToggle) {
        soundAlertsToggle.addEventListener('change', (e) => {
            localStorage.setItem('soundAlerts', e.target.checked);
        });
        const saved = localStorage.getItem('soundAlerts');
        if (saved !== null) soundAlertsToggle.checked = saved === 'true';
    }
    
    if (autoRefreshToggle) {
        autoRefreshToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                startAutoRefresh();
            } else {
                stopAutoRefresh();
            }
        });
    }
}

let autoRefreshInterval = null;

function startAutoRefresh() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    autoRefreshInterval = setInterval(() => {
        fetchStats();
        fetchBots();
    }, 30000);
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
}

function addNotification(message, color) {
    const notification = {
        id: Date.now(),
        message,
        color,
        timestamp: new Date()
    };
    notifications.unshift(notification);
    if (notifications.length > 20) notifications.pop();
    updateNotificationsList();
    updateNotificationBadge();
    
    const pushEnabled = document.getElementById('pushNotificationsToggle')?.checked;
    if (pushEnabled && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('Bot Control Panel', { body: message });
    }
}

function updateNotificationsList() {
    const container = document.getElementById('notificationsList');
    if (!container) return;
    
    if (notifications.length === 0) {
        container.innerHTML = '<div class="notification-item"><div class="notification-text">No new notifications</div></div>';
        return;
    }
    
    container.innerHTML = notifications.map(notif => `
        <div class="notification-item">
            <div class="notification-dot ${notif.color}"></div>
            <div class="notification-text">${escapeHtml(notif.message)}</div>
            <div class="notification-time">${getTimeAgo(notif.timestamp)}</div>
        </div>
    `).join('');
}

function setupEventListeners() {
    const createBtn = document.getElementById('createBotBtn');
    const modal = document.getElementById('createBotModal');
    const closeBtn = document.querySelector('.close-modal');
    const form = document.getElementById('createBotForm');
    
    if (createBtn) {
        createBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (modal) modal.style.display = 'flex';
        });
    }
    
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            if (modal) modal.style.display = 'none';
        });
    }
    
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });
    }
    
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
        const response = await fetch('/api/stats');
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
        const response = await fetch('/api/bots');
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
        <div class="agent-card" data-agent-id="${bot.id}" data-agent-name="${escapeHtml(bot.displayName || bot.username)}">
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
    
    const modal = document.getElementById('createBotModal');
    const submitBtn = document.querySelector('#createBotForm .submit-btn');
    
    if (submitBtn) {
        submitBtn.textContent = 'Creating...';
        submitBtn.disabled = true;
    }
    
    addActivityLog('System', `Creating bot "${username}"...`, 'yellow');
    
    try {
        const response = await fetch('/api/bots/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username: username.trim(),
                password,
                gameId: gameId.trim(),
                options: { 
                    humanLikeBehavior: humanLike, 
                    autoReconnect
                }
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            if (modal) modal.style.display = 'none';
            document.getElementById('createBotForm')?.reset();
            addNotification(`Bot "${username}" created successfully`, 'green');
            addActivityLog('System', `✅ Bot agent "${username}" created successfully!`, 'green');
            fetchBots();
            updateNotificationBadge();
            alert(`✅ Bot "${username}" created successfully!`);
        } else {
            let errorMsg = data.error;
            let detailedMsg = '';
            
            if (errorMsg.includes('credentials')) {
                detailedMsg = '\n\n🔐 ROBLOX LOGIN ISSUES:\n' +
                    '1. Check username and password are correct\n' +
                    '2. Account must NOT have 2FA (Two-Factor Authentication) enabled\n' +
                    '3. Account email must be verified\n' +
                    '4. Try logging into Roblox website first to verify the account';
            } else if (errorMsg.includes('captcha')) {
                detailedMsg = '\n\n🤖 CAPTCHA REQUIRED:\nPlease log into Roblox website first to complete verification.';
            } else if (errorMsg.includes('2FA')) {
                detailedMsg = '\n\n⚠️ 2FA ENABLED:\nBot accounts cannot have 2FA. Please create a new account without 2FA.';
            }
            
            addActivityLog('System', `❌ Failed to create bot: ${errorMsg}`, 'red');
            alert(`❌ Failed to create bot: ${errorMsg}${detailedMsg}`);
        }
    } catch (error) {
        console.error('Create bot error:', error);
        addActivityLog('System', `Error creating bot: ${error.message}`, 'red');
        alert(`❌ Network error: ${error.message}`);
    } finally {
        if (submitBtn) {
            submitBtn.textContent = 'Create Agent';
            submitBtn.disabled = false;
        }
    }
}

async function startBot(botId) {
    try {
        const response = await fetch(`/api/bots/${botId}/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        if (data.success) {
            addActivityLog(`Bot`, 'Bot started successfully', 'green');
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
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        if (data.success) {
            addActivityLog(`Bot`, 'Bot stopped', 'yellow');
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
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        if (data.success) {
            addActivityLog(`Bot`, 'Bot agent removed from system', 'gray');
            fetchBots();
        }
    } catch (error) {
        addActivityLog(`Bot`, `Failed to remove bot`, 'red');
    }
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
        const unreadCount = notifications.length;
        badge.textContent = unreadCount > 0 ? unreadCount : '0';
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
            document.getElementById('settingsBtn')?.click();
            break;
    }
}
