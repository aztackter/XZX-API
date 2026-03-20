document.addEventListener('DOMContentLoaded', () => {
    renderStatsDemo();
    renderDemoBots();
    setupModal();
});

function renderStatsDemo() {
    const statsGrid = document.getElementById('statsGrid');
    const stats = [
        { label: 'Active Sessions', value: 128 },
        { label: 'Tasks Running', value: 342 },
        { label: 'Errors Detected', value: 15 },
        { label: 'System Uptime', value: '99.8%' }
    ];
    statsGrid.innerHTML = stats.map(s => `
        <div class="stat-card">
            <div class="stat-label">${s.label}</div>
            <div class="stat-value">${s.value}</div>
        </div>
    `).join('');
}

function renderDemoBots() {
    const grid = document.getElementById('agentsGrid');
    const bots = [
        { username:'Agent 01', status:'online' },
        { username:'Agent 02', status:'idle' },
        { username:'Agent 03', status:'error' }
    ];
    grid.innerHTML = bots.map(bot => `
        <div class="agent-card">
            <div class="agent-name">${bot.username}</div>
            <div class="status-badge ${bot.status}">${bot.status}</div>
        </div>
    `).join('');
}

function setupModal() {
    const btn = document.getElementById('createBotBtn');
    const modal = document.getElementById('createBotModal');
    const close = document.querySelector('.close-modal');
    btn.onclick = ()=> modal.style.display='flex';
    close.onclick = ()=> modal.style.display='none';
}
