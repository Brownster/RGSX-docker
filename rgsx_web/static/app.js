// RGSX Web Application
class RGSXApp {
    constructor() {
        this.API = '/api';
        this.state = {
            platforms: [],
            games: [],
            history: [],
            searchResults: [],
            currentPlatform: null,
            completed: new Set(),
            activeDownloads: new Map(),
            currentView: 'loading'
        };
        
        this.elements = {};
        this.websockets = new Map();
        this.searchTimeout = null;
        
        this.init();
    }

    async init() {
        this.cacheElements();
        this.bindEvents();
        await this.loadInitialData();
    }

    cacheElements() {
        const ids = [
            'loadingScreen', 'platformView', 'gameView', 'searchView', 'historyView',
            'platformGrid', 'gameGrid', 'searchResults', 'historyList',
            'platformCount', 'gameCount', 'completedCount', 'searchCount',
            'currentPlatform', 'gameSearch', 'globalSearch',
            'backBtn', 'searchBackBtn', 'historyBackBtn', 'floatingBackBtn', 'floatingDownloadBtn',
            'searchBtn', 'historyBtn', 'settingsBtn',
            'viewGrid', 'viewList', 'clearSearch',
            'clearHistoryBtn', 'downloadOverlay', 'activeDownloads',
            'modal', 'modalTitle', 'modalBody', 'modalFooter', 'modalClose'
        ];
        
        ids.forEach(id => {
            this.elements[id] = document.getElementById(id);
        });
    }

    bindEvents() {
        // Navigation (guard for missing nodes)
        if (this.elements.backBtn) this.elements.backBtn.onclick = () => this.showPlatforms();
        if (this.elements.searchBackBtn) this.elements.searchBackBtn.onclick = () => this.showPlatforms();
        if (this.elements.historyBackBtn) this.elements.historyBackBtn.onclick = () => this.showPlatforms();
        if (this.elements.floatingBackBtn) {
            this.elements.floatingBackBtn.onclick = () => this.showPlatforms();
        }
        if (this.elements.floatingDownloadBtn) {
            this.elements.floatingDownloadBtn.onclick = () => this.handleDownloadSelectedClick();
        }
        
        // Header actions
        if (this.elements.searchBtn) this.elements.searchBtn.onclick = () => this.showSearch();
        if (this.elements.historyBtn) this.elements.historyBtn.onclick = () => this.showHistory();
        if (this.elements.settingsBtn) this.elements.settingsBtn.onclick = () => this.openSettingsModal();
        
        // Search inputs
        if (this.elements.gameSearch) this.elements.gameSearch.oninput = (e) => this.filterGames(e.target.value);
        if (this.elements.globalSearch) this.elements.globalSearch.oninput = (e) => this.performGlobalSearch(e.target.value);
        if (this.elements.clearSearch) this.elements.clearSearch.onclick = () => this.clearGameSearch();
        
        // View toggles
        if (this.elements.viewGrid) this.elements.viewGrid.onclick = () => this.setGameView('grid');
        if (this.elements.viewList) this.elements.viewList.onclick = () => this.setGameView('list');
        
        // History actions
        if (this.elements.clearHistoryBtn) this.elements.clearHistoryBtn.onclick = () => this.confirmClearHistory();
        
        // Download selected - use querySelector since it's not cached
        const bulkBtn = document.getElementById('download-selected-btn');
        if (bulkBtn) bulkBtn.onclick = () => this.handleDownloadSelectedClick();
        
        // History filters
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.onclick = () => this.filterHistory(btn.dataset.status);
        });
        
        // Modal
        if (this.elements.modalClose) this.elements.modalClose.onclick = () => this.hideModal();
        if (this.elements.modal) this.elements.modal.onclick = (e) => {
            if (e.target === this.elements.modal) this.hideModal();
        };

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.state.currentView !== 'platform') {
                    this.showPlatforms();
                }
            } else if (e.key === '/' && e.ctrlKey) {
                e.preventDefault();
                this.showSearch();
            }
        });

        // Scroll-based floating button visibility
        window.addEventListener('scroll', () => this.updateFloatingButtonVisibility());
        
        // Selection change handler for floating download button
        document.addEventListener('change', (e) => {
            if (e.target.classList.contains('game-checkbox')) {
                this.updateFloatingButtonVisibility();
            }
        });
    }

    async loadInitialData() {
        try {
            await this.loadCompleted();
            await this.loadPlatforms();
            this.showPlatforms();
        } catch (error) {
            console.error('Failed to load initial data:', error);
            this.showError('Failed to load data. Please refresh the page.');
        }
    }

    async loadCompleted() {
        const response = await fetch(`${this.API}/history?status=completed&limit=10000`);
        const history = await response.json();
        this.state.completed = new Set(history.map(h => h.url).filter(Boolean));
    }

    async loadPlatforms() {
        try {
            const response = await fetch(`${this.API}/platforms`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            this.state.platforms = await response.json();
        } catch (err) {
            console.error('[RGSX] failed to load platforms:', err);
            this.state.platforms = [];
        }
    }

    async loadGames(platformId) {
        try {
            const response = await fetch(`${this.API}/platforms/${encodeURIComponent(platformId)}/games`);
            if (!response.ok) throw new Error('Failed to load games');
            
            this.state.games = await response.json();
            this.state.currentPlatform = this.state.platforms.find(p => p.id === platformId);
        } catch (error) {
            console.error('Failed to load games:', error);
            this.showError('Failed to load games for this platform.');
        }
    }

    async loadHistory() {
        const response = await fetch(`${this.API}/history?limit=100`);
        this.state.history = await response.json();
    }

    async performGlobalSearch(query) {
        if (this.searchTimeout) clearTimeout(this.searchTimeout);
        
        if (!query.trim()) {
            this.state.searchResults = [];
            this.renderSearchResults();
            return;
        }

        this.searchTimeout = setTimeout(async () => {
            try {
                const response = await fetch(`${this.API}/search?q=${encodeURIComponent(query)}&limit=50`);
                this.state.searchResults = await response.json();
                this.renderSearchResults();
            } catch (error) {
                console.error('Search failed:', error);
            }
        }, 300);
    }

    filterGames(query) {
        const cards = document.querySelectorAll('.game-card');
        const filteredCount = Array.from(cards).filter(card => {
            const name = card.querySelector('.game-name').textContent.toLowerCase();
            const matches = name.includes(query.toLowerCase());
            card.style.display = matches ? 'block' : 'none';
            return matches;
        }).length;

        this.updateGameStats();
    }

    clearGameSearch() {
        this.elements.gameSearch.value = '';
        this.filterGames('');
    }

    filterHistory(status) {
        // Update active filter button
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.status === status);
        });

        const items = document.querySelectorAll('.history-item');
        items.forEach(item => {
            const itemStatus = item.dataset.status;
            const visible = status === 'all' || itemStatus === status;
            item.style.display = visible ? 'flex' : 'none';
        });
    }

    setGameView(view) {
        this.elements.viewGrid.classList.toggle('active', view === 'grid');
        this.elements.viewList.classList.toggle('active', view === 'list');
        this.elements.gameGrid.classList.toggle('list-view', view === 'list');
    }

    // View management
    showView(viewName) {
        const views = ['loadingScreen', 'platformView', 'gameView', 'searchView', 'historyView'];
        views.forEach(view => {
            const element = this.elements[view];
            const shouldShow = view === `${viewName}View` || view === viewName;
            if (element) {
                element.style.display = shouldShow ? 'block' : 'none';
            }
        });
        this.state.currentView = viewName;
        this.updateFloatingButtonVisibility();
    }

    showPlatforms() {
        this.showView('platform');
        this.renderPlatforms();
    }

    async showGames(platform) {
        this.showView('loading');
        await this.loadGames(platform.id);
        this.showView('game');
        this.renderGames();
        this.updateFloatingButtonVisibility();
    }

    updateFloatingButtonVisibility() {
        // Floating back button
        const backBtn = this.elements.floatingBackBtn;
        if (backBtn) {
            const shouldShowBack = this.state.currentView === 'game' && window.scrollY > 200;
            backBtn.style.display = shouldShowBack ? 'inline-flex' : 'none';
        }

        // Floating download selected button
        const downloadBtn = this.elements.floatingDownloadBtn;
        if (downloadBtn) {
            const selectedCount = document.querySelectorAll('.game-checkbox:checked').length;
            const shouldShowDownload = this.state.currentView === 'game' && window.scrollY > 200 && selectedCount > 0;
            downloadBtn.style.display = shouldShowDownload ? 'inline-flex' : 'none';
            
            // Update text with count
            const span = downloadBtn.querySelector('span');
            if (span && selectedCount > 0) {
                span.textContent = `⬇ (${selectedCount})`;
            }
        }
    }

    showSearch() {
        this.showView('search');
        this.elements.globalSearch.focus();
    }

    async showHistory() {
        this.showView('loading');
        await this.loadHistory();
        this.showView('history');
        this.renderHistory();
    }

    // Rendering methods
    renderPlatforms() {
        const count = Array.isArray(this.state.platforms) ? this.state.platforms.length : 0;
        
        if (this.elements.platformCount) this.elements.platformCount.textContent = `${count} platforms`;
        if (!this.elements.platformGrid) return;
        this.elements.platformGrid.innerHTML = '';

        if (!count) {
            const msg = document.createElement('div');
            msg.className = 'text-muted';
            msg.style.padding = '1rem';
            msg.textContent = 'No platforms found. Try reloading.';
            const btn = document.createElement('button');
            btn.className = 'btn btn-primary';
            btn.style.marginTop = '0.5rem';
            btn.textContent = 'Reload';
            btn.onclick = async () => { await this.loadPlatforms(); this.renderPlatforms(); };
            this.elements.platformGrid.appendChild(msg);
            this.elements.platformGrid.appendChild(btn);
            return;
        }

        for (const platform of this.state.platforms) {
            try {
                const card = this.createPlatformCard(platform);
                this.elements.platformGrid.appendChild(card);
            } catch (e) {
                console.error('[RGSX] failed to render platform card:', platform, e);
            }
        }
    }

    renderGames() {
        this.elements.currentPlatform.textContent = this.state.currentPlatform?.name || 'Platform';
        this.updateGameStats();
        this.elements.gameGrid.innerHTML = '';

        this.state.games.forEach(game => {
            const card = this.createGameCard(game);
            this.elements.gameGrid.appendChild(card);
        });
    }

    renderSearchResults() {
        this.elements.searchCount.textContent = `${this.state.searchResults.length} results`;
        this.elements.searchResults.innerHTML = '';

        this.state.searchResults.forEach(game => {
            const card = this.createGameCard(game, true);
            this.elements.searchResults.appendChild(card);
        });
    }

    renderHistory() {
        this.elements.historyList.innerHTML = '';

        this.state.history.forEach(item => {
            const historyItem = this.createHistoryItem(item);
            this.elements.historyList.appendChild(historyItem);
        });
    }

    updateGameStats() {
        const totalGames = this.state.games.length;
        const completedGames = this.state.games.filter(g => 
            this.state.completed.has(g.url) || g.completed
        ).length;

        this.elements.gameCount.textContent = `${totalGames} games`;
        this.elements.completedCount.textContent = `${completedGames} completed`;
    }

    // Card creation methods
    createPlatformCard(platform) {
        const card = document.createElement('div');
        card.className = 'platform-card';
        card.onclick = () => this.showGames(platform);

        // Text content
        const nameEl = document.createElement('div');
        nameEl.className = 'platform-name';
        nameEl.textContent = platform.name || platform.id;
        const folderEl = document.createElement('div');
        folderEl.className = 'platform-folder';
        folderEl.textContent = platform.folder || platform.id;
        card.appendChild(nameEl);
        card.appendChild(folderEl);

        // Optional logo on the right (served from /assets/system-images)
        const logoName = platform.system_image || platform.image_source;
        const logoUrl = platform.image_url || (logoName ? `/assets/system-images/${encodeURIComponent(logoName)}` : null);
        if (logoUrl) {
            const img = document.createElement('img');
            img.className = 'platform-logo';
            img.loading = 'lazy';
            img.src = logoUrl;
            img.alt = platform.name || 'logo';
            card.appendChild(img);
        }

        return card;
    }

    createGameCard(game, showPlatform = false) {
        const card = document.createElement('div');
        card.className = 'game-card';

        const isCompleted = this.state.completed.has(game.url) || game.completed;
        const isDownloading = this.state.activeDownloads.has(game.url);

        // Title
        const nameEl = document.createElement('div');
        nameEl.className = 'game-name';
        nameEl.textContent = game.name || 'Unknown';
        card.appendChild(nameEl);

        // Info row
        const infoEl = document.createElement('div');
        infoEl.className = 'game-info';
        if (showPlatform) {
            const plat = document.createElement('span');
            plat.textContent = game.platform || '';
            infoEl.appendChild(plat);
        }
        const size = document.createElement('span');
        size.textContent = game.size || 'Unknown size';
        infoEl.appendChild(size);
        card.appendChild(infoEl);

        // Actions
        const actions = document.createElement('div');
        actions.className = 'game-actions';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'game-checkbox';
        checkbox.dataset.url = game.url;
        checkbox.dataset.name = game.name;
        checkbox.dataset.platform = showPlatform ? (game.platform || '') : (this.state.currentPlatform?.id || '');
        actions.appendChild(checkbox);

        const dlBtn = document.createElement('button');
        dlBtn.className = `btn ${isCompleted ? 'btn-success' : 'btn-primary'}`;
        dlBtn.disabled = !!isCompleted;
        dlBtn.textContent = isCompleted ? '✓ Downloaded' : '⬇ Download';
        dlBtn.addEventListener('click', () => {
            const platformId = showPlatform ? (game.platform || '') : (this.state.currentPlatform?.id || '');
            this.startDownload(game.url, game.name, platformId);
        });
        actions.appendChild(dlBtn);

        if (isDownloading) {
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'btn btn-danger';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.addEventListener('click', () => this.cancelDownload(game.url));
            actions.appendChild(cancelBtn);
        }

        card.appendChild(actions);

        // Progress container
        const prog = document.createElement('div');
        prog.className = 'progress-container';
        prog.id = `progress-${this.generateId(game.url)}`;
        const barOuter = document.createElement('div');
        barOuter.className = 'progress-bar';
        const barFill = document.createElement('div');
        barFill.className = 'progress-fill';
        barOuter.appendChild(barFill);
        const barText = document.createElement('div');
        barText.className = 'progress-text';
        barText.textContent = '0%';
        prog.appendChild(barOuter);
        prog.appendChild(barText);
        card.appendChild(prog);

        return card;
    }

    createHistoryItem(item) {
        const historyItem = document.createElement('div');
        historyItem.className = 'history-item';
        historyItem.dataset.status = this.normalizeStatus(item.status);

        historyItem.innerHTML = `
            <div class="history-info">
                <div class="history-game">${this.escapeHtml(item.game_name || item.name)}</div>
                <div class="history-platform">${this.escapeHtml(item.platform || 'Unknown')}</div>
            </div>
            <div class="history-status ${this.normalizeStatus(item.status)}">
                ${this.normalizeStatus(item.status)}
            </div>
            <div class="history-actions">
                <button class="btn btn-sm btn-primary redownload-btn" data-url="${item.url}">Download Again</button>
            </div>
        `;

        const redownloadBtn = historyItem.querySelector('.redownload-btn');
        if (redownloadBtn) {
            redownloadBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.redownload(item.url);
            });
        }

        return historyItem;
    }

    // Download management
    async startDownload(url, gameName, platformId) {
        try {
            const body = {
                platform: platformId || this.state.currentPlatform?.id,
                game_name: gameName,
                url: url,
                is_archive: /\.(zip|rar)$/i.test(url)
            };

            const response = await fetch(`${this.API}/download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(error);
            }

            this.startProgressMonitoring(url, gameName);
            this.showDownloadOverlay();

        } catch (error) {
            console.error('Download failed:', error);
            this.showError(`Download failed: ${error.message}`);
        }
    }

    startProgressMonitoring(url, gameName) {
        if (this.websockets.has(url)) return;

        const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${wsProtocol}//${location.host}/ws/progress?url=${encodeURIComponent(url)}`);
        
        this.websockets.set(url, ws);
        this.state.activeDownloads.set(url, { name: gameName, progress: 0, status: 'downloading' });
        const badge = document.getElementById('activeCountBadge');
        if (badge) { badge.style.display = 'inline-flex'; badge.textContent = String(this.state.activeDownloads.size); }

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.updateDownloadProgress(url, data);
        };

        ws.onclose = () => {
            this.websockets.delete(url);
            this.state.activeDownloads.delete(url);
            this.updateDownloadOverlay();
            const badge = document.getElementById('activeCountBadge');
            if (badge) {
                const n = this.state.activeDownloads.size;
                badge.style.display = n > 0 ? 'inline-flex' : 'none';
                if (n > 0) badge.textContent = String(n);
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.websockets.delete(url);
        };
    }

    updateDownloadProgress(url, data) {
        // Keep per-card progress hidden (we use the overlay list only)

        // Update active downloads
        if (this.state.activeDownloads.has(url)) {
            this.state.activeDownloads.set(url, {
                ...this.state.activeDownloads.get(url),
                progress: data.percent || 0,
                status: data.status,
                speed: data.speed
            });
            this.updateDownloadOverlay();
        }

        // Handle completion
        if (['completed', 'error', 'canceled'].includes(data.status)) {
            if (data.status === 'completed') {
                this.state.completed.add(url);
                this.updateGameStats();
            }
            // Remove from active list immediately; overlay will re-render
            this.state.activeDownloads.delete(url);
            const ws = this.websockets.get(url);
            if (ws) try { ws.close(); } catch (_) {}
            this.updateDownloadOverlay();
            const badge = document.getElementById('activeCountBadge');
            if (badge) {
                const n = this.state.activeDownloads.size;
                badge.style.display = n > 0 ? 'inline-flex' : 'none';
                if (n > 0) badge.textContent = String(n);
            }
        }
    }

    async cancelDownload(url) {
        try {
            await fetch(`${this.API}/cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });

            const ws = this.websockets.get(url);
            if (ws) ws.close();

        } catch (error) {
            console.error('Cancel failed:', error);
            this.showError('Failed to cancel download');
        }
    }

    async redownload(url) {
        try {
            const response = await fetch(`${this.API}/history/redownload`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(error);
            }

            const data = await response.json();
            this.startProgressMonitoring(data.history.url, data.history.game_name);
            this.showDownloadOverlay();

        } catch (error) {
            console.error('Redownload failed:', error);
            this.showError(`Redownload failed: ${error.message}`);
        }
    }

    async handleDownloadSelectedClick() {
        const checkboxes = document.querySelectorAll('.game-checkbox:checked');
        const downloads = [];
        checkboxes.forEach(checkbox => {
            downloads.push({
                platform: checkbox.dataset.platform,
                game_name: checkbox.dataset.name,
                url: checkbox.dataset.url,
                is_archive: /\.(zip|rar)$/i.test(checkbox.dataset.url)
            });
        });

        if (downloads.length > 0) {
            try {
                const response = await fetch(`${this.API}/download/batch`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ items: downloads })
                });

                if (!response.ok) {
                    const error = await response.text();
                    throw new Error(error);
                }

                const data = await response.json();
                (data.tasks || []).forEach(task => {
                    const h = task.history || {};
                    if (h.url && h.game_name) this.startProgressMonitoring(h.url, h.game_name);
                });
                this.showDownloadOverlay();

            } catch (error) {
                console.error('Batch download failed:', error);
                this.showError(`Batch download failed: ${error.message}`);
            }
        }
    }

    showDownloadOverlay() {
        this.elements.downloadOverlay.style.display = 'block';
        this.updateDownloadOverlay();
    }

    updateDownloadOverlay() {
        const activeCount = this.state.activeDownloads.size;
        
        if (activeCount === 0) {
            this.elements.downloadOverlay.style.display = 'none';
            return;
        }

        this.elements.activeDownloads.innerHTML = '';
        
        this.state.activeDownloads.forEach((download, url) => {
            const item = document.createElement('div');
            item.className = 'active-download';
            item.innerHTML = `
                <div class="active-download-name">${this.escapeHtml(download.name)}</div>
                <div class="progress-text">in progress…</div>
            `;
            this.elements.activeDownloads.appendChild(item);
        });
    }

    // Modal management
    showModal(title, body, footer = '') {
        this.elements.modalTitle.textContent = title;
        this.elements.modalBody.innerHTML = body;
        this.elements.modalFooter.innerHTML = footer;
        this.elements.modal.style.display = 'flex';
    }

    hideModal() {
        this.elements.modal.style.display = 'none';
    }

    confirmClearHistory() {
        const footer = `
            <button class="btn btn-secondary" onclick="app.hideModal()">Cancel</button>
            <button class="btn btn-danger" onclick="app.clearHistory()">Clear All</button>
        `;
        this.showModal(
            'Clear History',
            '<p>Are you sure you want to clear all download history? This action cannot be undone.</p>',
            footer
        );
    }

    // Settings modal with 1fichier API key and data updates
    async openSettingsModal() {
        try {
            // Load both API key status and update status
            const [apiResponse, updateResponse] = await Promise.all([
                fetch(`${this.API}/settings/onefichier`),
                fetch(`${this.API}/update/status`)
            ]);
            
            const apiStatus = await apiResponse.json();
            const updateStatus = await updateResponse.json();
            
            const presentText = apiStatus.present ? `Present (${apiStatus.length} chars)` : 'Not set';
            const lastUpdated = updateStatus.last_updated 
                ? new Date(updateStatus.last_updated).toLocaleString()
                : 'Never';
                
            const body = `
                <div>
                    <div class="mb-md">
                        <h4>1fichier API Key</h4>
                        <input id="onefichierInput" type="password" class="search-input" placeholder="Paste your 1fichier API key" />
                        <div class="text-muted mb-md">Current: ${presentText}</div>
                    </div>
                    
                    <div class="mb-md">
                        <h4>Game Data Updates</h4>
                        <div class="text-muted mb-sm">
                            Platforms: ${updateStatus.platforms} | Games: ${updateStatus.games}<br>
                            Last updated: ${lastUpdated}
                        </div>
                        <button id="updateDataBtn" class="btn btn-primary mb-sm">Update Platform & Game Lists</button>
                        <div class="text-muted">Downloads latest platform definitions and game catalogs from RetroGameSets.</div>
                    </div>
                </div>
            `;
            const footer = `
                <button id="cancelSettingsBtn" class="btn btn-secondary">Cancel</button>
                <button id="saveOnefichierBtn" class="btn btn-primary">Save API Key</button>
            `;
            
            this.showModal('Settings', body, footer);
            
            document.getElementById('cancelSettingsBtn').onclick = () => this.hideModal();
            document.getElementById('saveOnefichierBtn').onclick = () => this.saveOnefichierKey();
            document.getElementById('updateDataBtn').onclick = () => this.updateGameData();
            
        } catch (e) {
            console.error('Failed to open settings:', e);
            this.showError('Failed to load settings');
        }
    }

    async saveOnefichierKey() {
        try {
            const input = document.getElementById('onefichierInput');
            const api_key = (input?.value || '').trim();
            const r = await fetch(`${this.API}/settings/onefichier`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key })
            });
            if (!r.ok) {
                const txt = await r.text();
                throw new Error(txt);
            }
            this.hideModal();
            this.showModal('Settings', '<p>API key saved.</p>', '<button class="btn btn-primary" onclick="app.hideModal()">Close</button>');
        } catch (e) {
            console.error('Failed to save key:', e);
            this.showError('Failed to save API key');
        }
    }

    async updateGameData() {
        try {
            // Disable button and show loading
            const updateBtn = document.getElementById('updateDataBtn');
            const originalText = updateBtn.textContent;
            updateBtn.disabled = true;
            updateBtn.textContent = 'Updating...';

            const response = await fetch(`${this.API}/update/data`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(error);
            }

            const result = await response.json();
            
            // Success - reload platforms and close modal
            await this.loadPlatforms();
            this.hideModal();
            
            this.showModal(
                'Update Complete', 
                `<p>${result.message}</p><p class="text-muted">Updated at: ${new Date(result.timestamp).toLocaleString()}</p>`,
                '<button class="btn btn-primary" onclick="app.hideModal()">Close</button>'
            );

            // Refresh current view if showing platforms
            if (this.state.currentView === 'platform') {
                this.renderPlatforms();
            }

        } catch (error) {
            console.error('Update failed:', error);
            this.showError(`Update failed: ${error.message}`);
        } finally {
            // Re-enable button
            const updateBtn = document.getElementById('updateDataBtn');
            if (updateBtn) {
                updateBtn.disabled = false;
                updateBtn.textContent = 'Update Platform & Game Lists';
            }
        }
    }

    async clearHistory() {
        try {
            // Note: The API doesn't have a clear history endpoint, so this is a placeholder
            this.state.history = [];
            this.renderHistory();
            this.hideModal();
        } catch (error) {
            console.error('Failed to clear history:', error);
            this.showError('Failed to clear history');
        }
    }

    showError(message) {
        this.showModal('Error', `<p class="text-error">${this.escapeHtml(message)}</p>`);
    }

    // Utility methods
    normalizeStatus(status) {
        const statusMap = {
            'download_ok': 'completed',
            'completed': 'completed',
            'done': 'completed',
            'erreur': 'error',
            'error': 'error',
            'failed': 'error',
            'telechargement': 'downloading',
            'downloading': 'downloading',
            'extracting': 'extracting',
            'canceled': 'canceled',
            'cancelled': 'canceled'
        };
        return statusMap[status?.toLowerCase()] || 'unknown';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    generateId(text) {
        return btoa(text).replace(/[^a-zA-Z0-9]/g, '').substring(0, 10);
    }
}

// Initialize the application
const app = new RGSXApp();
