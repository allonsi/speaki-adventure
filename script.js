const ROWS = 10;
const COLS = 5; // 0,1 = Left seats | 2 = Aisle | 3,4 = Right seats
const AISLE_COL = 2;
const TOTAL_PASSENGERS = ROWS * 4; // 40

const sounds = {
    seated:      new Audio('assets/sound-seated2.mp3'),
    baggage:     new Audio('assets/sound-baggage.mp3'),
    isleBlocked: new Audio('assets/sound-isle-blocked.mp3'),
    seatBlocked: new Audio('assets/sound-seat-blocked.mp3')
};

function playSound(type) {
    const s = sounds[type].cloneNode();
    s.play().catch(() => {});
}

// ================================================================
// Game State
// ================================================================
let currentStage = 'title'; // 'title' | 'boarding' | 'story' | 'crash' | 'battle'

// --- Boarding state ---
let passengers = [], queue = [], cells = [];
let grid = Array(ROWS).fill(null).map(() => Array(COLS).fill(null));
let boardedCount = 0;

// --- Battle state ---
let playerX = 50;
let playerY = 75;
let playerHP = 5;
let playerInvincible = false;
let enemyHP = 100;
let enemyCX = 50;   // enemy center X %
let enemyCY = 20;   // enemy center Y %
let enemyDirX = 1;
let enemyDirY = 1;
let enemyShootTimer = 80;
let pumpkins = [];
let enemyPumpkins = [];
let activeItems = [];  // multiple items allowed
let playerShotCount = 1;
let bigPumpkinActive = false;
let battleInterval = null;
let battleKeysDown = {};
let lastShotTime = 0;

const SHOT_COOLDOWN   = 380;  // ms between shots
const ITEM_EXPIRE_MS  = 180000; // 3 minutes
const ENEMY_INIT_SIZE = 180;
const ENEMY_MIN_SIZE  = 80;

// --- DOM refs ---
const planeGrid       = document.getElementById('plane-grid');
const statBoarded     = document.getElementById('stat-boarded');
const progressFill    = document.getElementById('progress-fill');
const boardingSection = document.getElementById('boarding-section');
const storyOverlay    = document.getElementById('story-overlay');
const crashOverlay    = document.getElementById('crash-overlay');
const battleStageEl   = document.getElementById('battle-stage');
const titleScreen     = document.getElementById('title-screen');

// --- Button handlers ---
document.getElementById('btn-start').addEventListener('click', startFromTitle);
document.getElementById('btn-reset').addEventListener('click', resetGame);
document.getElementById('btn-play-again').addEventListener('click', resetGame);
document.getElementById('btn-retry').addEventListener('click', resetGame);

// Mobile toggle
const mobileToggle = document.getElementById('mobile-toggle');
const simControls  = document.getElementById('sim-controls');
if (mobileToggle && simControls) {
    mobileToggle.addEventListener('click', () => simControls.classList.toggle('active'));
}

// ================================================================
// Title Screen
// ================================================================
function setupTitleScreen() {
    const bg = document.getElementById('title-bg');
    const configs = [
        { img: 'normal',  top: 12, dir: 'right', speed: 8,   delay: 0 },
        { img: 'blocked', top: 28, dir: 'left',  speed: 6,   delay: -2 },
        { img: 'normal',  top: 50, dir: 'right', speed: 11,  delay: -5 },
        { img: 'blocked', top: 68, dir: 'left',  speed: 7,   delay: -1 },
        { img: 'normal',  top: 80, dir: 'right', speed: 9,   delay: -4 },
        { img: 'blocked', top: 38, dir: 'right', speed: 5.5, delay: -3 },
        { img: 'normal',  top: 60, dir: 'left',  speed: 12,  delay: -6 },
        { img: 'blocked', top: 20, dir: 'left',  speed: 7.5, delay: -1.5 },
    ];
    configs.forEach(cfg => {
        const el = document.createElement('div');
        el.className = `title-spik title-spik-${cfg.img}`;
        el.style.top             = `${cfg.top}%`;
        el.style.animationName   = cfg.dir === 'right' ? 'walkRight' : 'walkLeft';
        el.style.animationDuration    = `${cfg.speed}s`;
        el.style.animationDelay       = `${cfg.delay}s`;
        el.style.animationIterationCount = 'infinite';
        el.style.animationTimingFunction = 'linear';
        bg.appendChild(el);
    });
}

function startFromTitle() {
    currentStage = 'boarding';
    titleScreen.style.opacity = '0';
    setTimeout(() => {
        titleScreen.style.display = 'none';
        boardingSection.style.display = '';
        initGrid();
        generatePassengers();
        startAutoBoarding();
    }, 500);
}

// ================================================================
// Passenger class
// ================================================================
class Passenger {
    constructor(id, targetRow, targetCol) {
        this.id = id;
        this.targetRow = targetRow;
        this.targetCol = targetCol;
        this.row = -1;
        this.col = AISLE_COL;
        this.state = 'QUEUE';

        this.element = document.createElement('div');
        this.element.className = 'passenger pax-waiting';
        this.updatePos();
    }

    updatePos() {
        const crossOffset = [12, 40, 72, 104, 132];
        const longOffset = this.row < 0 ? -24 : (this.row * 28 + 12);
        if (window.innerWidth <= 800) {
            this.element.style.top  = `${longOffset}px`;
            this.element.style.left = `${crossOffset[this.col]}px`;
        } else {
            this.element.style.left = `${longOffset}px`;
            this.element.style.top  = `${crossOffset[this.col]}px`;
        }
    }

    updateVisuals() {
        this.element.className = 'passenger';
        if (this.state === 'SEATED')      this.element.classList.add('pax-seated');
        else if (this.state === 'MOVING') this.element.classList.add('pax-moving');
        else                              this.element.classList.add('pax-waiting');
        this.updatePos();
    }
}

// ================================================================
// Boarding — grid init & passengers
// ================================================================
function initGrid() {
    planeGrid.innerHTML = '';
    cells = [];
    grid = Array(ROWS).fill(null).map(() => Array(COLS).fill(null));

    for (let r = 0; r < ROWS; r++) {
        const rowCells = [];
        for (let c = 0; c < COLS; c++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            if (c === AISLE_COL) {
                cell.classList.add('aisle');
            } else {
                cell.classList.add('seat');
                cell.id = `seat-${r}-${c}`;
            }
            if (c === 0) {
                const label = document.createElement('div');
                label.className = 'row-label';
                label.innerText = r + 1;
                cell.appendChild(label);
            }
            planeGrid.appendChild(cell);
            rowCells.push(cell);
        }
        cells.push(rowCells);
    }
}

function generatePassengers() {
    passengers = [];
    let id = 0;
    const seats = [];
    for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
            if (c !== AISLE_COL) seats.push({ row: r, col: c });

    // Shuffle randomly
    for (let i = seats.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [seats[i], seats[j]] = [seats[j], seats[i]];
    }
    seats.forEach(s => passengers.push(new Passenger(id++, s.row, s.col)));
    queue = [...passengers];
    passengers.forEach(p => planeGrid.appendChild(p.element));
}

// ================================================================
// Auto-boarding (Stage 1 story mode)
// ================================================================
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function autoBoardPassenger(pax) {
    if (currentStage !== 'boarding') return;

    pax.state = 'MOVING';
    pax.row   = 0;
    pax.col   = AISLE_COL;
    pax.updateVisuals();
    await delay(60);

    // Walk down aisle row by row
    for (let r = 1; r <= pax.targetRow; r++) {
        if (currentStage !== 'boarding') return;
        pax.row = r;
        pax.updateVisuals();
        await delay(65);
    }

    // Slide to seat column
    const dir = pax.targetCol < AISLE_COL ? -1 : 1;
    let c = AISLE_COL;
    while (c !== pax.targetCol) {
        if (currentStage !== 'boarding') return;
        c += dir;
        pax.col = c;
        pax.updateVisuals();
        await delay(65);
    }

    if (currentStage !== 'boarding') return;

    // Seat passenger
    const seatEl = cells[pax.targetRow]?.[pax.targetCol];
    if (seatEl) seatEl.classList.add('occupied');
    pax.state = 'SEATED';
    pax.updateVisuals();
    boardedCount++;
    playSound('seated');
    updateDashboard();

    if (boardedCount === TOTAL_PASSENGERS) {
        setTimeout(triggerStory, 800);
        return;
    }

    // Kick off next passenger in this "lane"
    if (queue.length > 0) {
        const next = queue.shift();
        setTimeout(() => autoBoardPassenger(next), 80);
    }
}

function startAutoBoarding() {
    // Start 3 concurrent boarding lanes with staggered starts
    const CONCURRENT = 3;
    for (let i = 0; i < Math.min(CONCURRENT, queue.length); i++) {
        const pax = queue.shift();
        setTimeout(() => autoBoardPassenger(pax), i * 550);
    }
}

function updateDashboard() {
    if (statBoarded)  statBoarded.innerText = `${boardedCount} / ${TOTAL_PASSENGERS}`;
    if (progressFill) progressFill.style.width = `${(boardedCount / TOTAL_PASSENGERS) * 100}%`;
}

// ================================================================
// Stage 2a — Animated Story sequence
// ================================================================
function triggerStory() {
    currentStage = 'story';
    storyOverlay.style.display = 'flex';
    storyOverlay.style.opacity = '1';

    const container = document.getElementById('story-scene-container');
    const scenes = [buildTakeoffScene, buildFlyingScene, buildLightningScene];
    let i = 0;

    function showNext() {
        if (i >= scenes.length) {
            storyOverlay.style.transition = 'opacity 0.6s ease';
            storyOverlay.style.opacity = '0';
            setTimeout(() => {
                storyOverlay.style.display = 'none';
                storyOverlay.style.opacity = '1';
                storyOverlay.style.transition = '';
                triggerCrash();
            }, 600);
            return;
        }
        container.innerHTML = '';
        const scene = scenes[i++]();
        scene.style.opacity = '0';
        container.appendChild(scene);
        requestAnimationFrame(() => requestAnimationFrame(() => {
            scene.style.opacity = '1';
        }));
        setTimeout(showNext, 2800);
    }

    showNext();
}

function buildTakeoffScene() {
    const div = document.createElement('div');
    div.className = 'scene-container takeoff-scene';
    div.innerHTML = `
        <div class="takeoff-ground"></div>
        <div class="takeoff-runway"></div>
        <div class="takeoff-plane">✈️</div>
        <div class="scene-label">이륙 중...</div>
    `;
    return div;
}

function buildFlyingScene() {
    const div = document.createElement('div');
    div.className = 'scene-container flying-scene';
    div.innerHTML = `
        <div class="scene-cloud cloud-1">☁️</div>
        <div class="scene-cloud cloud-2">☁️</div>
        <div class="scene-cloud cloud-3">☁️</div>
        <div class="flying-plane">✈️</div>
        <div class="scene-label">비행 중...</div>
    `;
    return div;
}

function buildLightningScene() {
    const div = document.createElement('div');
    div.className = 'scene-container lightning-scene';
    div.innerHTML = `
        <div class="lightning-bg-flash"></div>
        <div class="storm-cloud storm-cloud-1">⛈️</div>
        <div class="storm-cloud storm-cloud-2">⛈️</div>
        <div class="storm-cloud storm-cloud-3">⛈️</div>
        <div class="lightning-bolt">⚡</div>
        <div class="storm-plane">✈️</div>
        <div class="scene-label">⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡</div>
    `;
    return div;
}

// ================================================================
// Stage 2b — Crash overlay
// ================================================================
function triggerCrash() {
    currentStage = 'crash';
    crashOverlay.style.display = 'flex';
    requestAnimationFrame(() => requestAnimationFrame(() => {
        crashOverlay.style.opacity = '1';
    }));
    setTimeout(startBattleStage, 3000);
}

// ================================================================
// Stage 3 — Battle
// ================================================================
function startBattleStage() {
    currentStage = 'battle';
    boardingSection.style.display = 'none';
    crashOverlay.style.display    = 'none';
    crashOverlay.style.opacity    = '0';
    battleStageEl.style.display   = 'block';

    // Reset state
    playerX          = 50;
    playerY          = 75;
    playerHP         = 5;
    playerInvincible = false;
    enemyHP          = 100;
    enemyCX          = 50;
    enemyCY          = 20;
    enemyDirX        = 1;
    enemyDirY        = 1;
    enemyShootTimer  = 80;
    playerShotCount  = 1;
    bigPumpkinActive = false;
    lastShotTime     = 0;
    pumpkins         = [];
    enemyPumpkins    = [];
    activeItems      = [];

    // UI
    document.getElementById('enemy-hp').textContent  = '❤️ 100';
    document.getElementById('player-hp').textContent = '💙 5';
    document.getElementById('power-ups').textContent  = '';
    document.getElementById('victory-screen').style.display   = 'none';
    document.getElementById('game-over-screen').style.display = 'none';

    // Reset enemy
    const enemyEl = document.getElementById('battle-enemy');
    enemyEl.className  = 'battle-char enemy-char';
    enemyEl.style.cssText = `
        width:${ENEMY_INIT_SIZE}px;
        height:${ENEMY_INIT_SIZE}px;
        left:${enemyCX}%;
        top:${enemyCY}%;
        opacity:1;
    `;

    // Reset player
    const playerEl = document.getElementById('battle-player');
    playerEl.className       = 'battle-char player-char';
    playerEl.style.left      = `${playerX}%`;
    playerEl.style.top       = `${playerY}%`;
    playerEl.style.opacity   = '1';
    playerEl.style.animation = '';

    if (battleInterval) clearInterval(battleInterval);
    battleInterval = setInterval(updateBattle, 50);
}

function updateBattle() {
    if (currentStage !== 'battle') return;

    const playerEl = document.getElementById('battle-player');
    const enemyEl  = document.getElementById('battle-enemy');

    // --- Move player (4 directions) ---
    const spd = 1.5;
    if (battleKeysDown['ArrowLeft'])  playerX = Math.max(2,  playerX - spd);
    if (battleKeysDown['ArrowRight']) playerX = Math.min(98, playerX + spd);
    if (battleKeysDown['ArrowUp'])    playerY = Math.max(45, playerY - spd);
    if (battleKeysDown['ArrowDown'])  playerY = Math.min(92, playerY + spd);
    playerEl.style.left = `${playerX}%`;
    playerEl.style.top  = `${playerY}%`;

    // --- Move enemy (free in upper half) ---
    enemyCX += enemyDirX * 0.45;
    enemyCY += enemyDirY * 0.3;
    if (enemyCX > 80) { enemyCX = 80; enemyDirX = -1; }
    if (enemyCX < 20) { enemyCX = 20; enemyDirX =  1; }
    if (enemyCY > 40) { enemyCY = 40; enemyDirY = -1; }
    if (enemyCY < 8)  { enemyCY = 8;  enemyDirY =  1; }
    enemyEl.style.left = `${enemyCX}%`;
    enemyEl.style.top  = `${enemyCY}%`;

    // --- Enemy shoot timer ---
    enemyShootTimer--;
    const shootInterval = enemyHP < 50 ? 40 : 90;
    if (enemyShootTimer <= 0) {
        shootEnemyPumpkin();
        enemyShootTimer = shootInterval;
    }

    const eRect = enemyEl.getBoundingClientRect();
    const pRect = playerEl.getBoundingClientRect();

    // --- Player pumpkins: move up, check enemy hit ---
    pumpkins = pumpkins.filter(p => {
        p.y -= 1.8;
        p.el.style.top = `${p.y}%`;
        const bRect = p.el.getBoundingClientRect();
        if (bRect.bottom > eRect.top && bRect.top < eRect.bottom &&
            bRect.right > eRect.left && bRect.left < eRect.right) {
            hitEnemy(p);
            return false;
        }
        if (p.y < -10) { p.el.remove(); return false; }
        return true;
    });

    // --- Enemy pumpkins: move toward player, check player hit ---
    enemyPumpkins = enemyPumpkins.filter(ep => {
        ep.x += ep.vx;
        ep.y += ep.vy;
        ep.el.style.left = `${ep.x}%`;
        ep.el.style.top  = `${ep.y}%`;
        if (!playerInvincible) {
            const epRect = ep.el.getBoundingClientRect();
            if (epRect.bottom > pRect.top && epRect.top < pRect.bottom &&
                epRect.right > pRect.left && epRect.left < pRect.right) {
                ep.el.remove();
                playerTakeDamage();
                return false;
            }
        }
        if (ep.y > 115 || ep.y < -15 || ep.x < -15 || ep.x > 115) {
            ep.el.remove();
            return false;
        }
        return true;
    });

    // --- Items: expiry check + pickup ---
    const now = Date.now();
    activeItems = activeItems.filter(item => {
        // Expire after 3 minutes
        if (now - item.spawnTime > ITEM_EXPIRE_MS) {
            item.el.style.transition = 'opacity 0.5s';
            item.el.style.opacity    = '0';
            setTimeout(() => item.el.remove(), 500);
            return false;
        }
        // Pickup collision
        const iRect = item.el.getBoundingClientRect();
        if (pRect.bottom > iRect.top && pRect.top < iRect.bottom &&
            pRect.right > iRect.left && pRect.left < iRect.right) {
            collectItem(item);
            return false;
        }
        return true;
    });
}

function shootEnemyPumpkin() {
    const el = document.createElement('div');
    el.className   = 'pumpkin enemy-pumpkin';
    el.textContent = '🎃';

    const startX = enemyCX;
    const startY = enemyCY + 10;
    el.style.left = `${startX}%`;
    el.style.top  = `${startY}%`;
    battleStageEl.appendChild(el);

    // Aim at player with slight speed
    const dx = playerX - startX;
    const dy = playerY - startY;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const speed = 1.4;
    enemyPumpkins.push({
        el,
        x: startX,
        y: startY,
        vx: (dx / dist) * speed,
        vy: (dy / dist) * speed
    });
}

function shootPumpkin() {
    if (currentStage !== 'battle') return;

    const now = Date.now();
    if (now - lastShotTime < SHOT_COOLDOWN) return;
    lastShotTime = now;

    const damage   = bigPumpkinActive ? 2 : 1;
    const fontSize = bigPumpkinActive ? '46px' : '26px';

    for (let i = 0; i < playerShotCount; i++) {
        const spread = playerShotCount > 1 ? (i - (playerShotCount - 1) / 2) * 7 : 0;
        const el     = document.createElement('div');
        el.className  = 'pumpkin';
        el.textContent = '🎃';
        el.style.fontSize = fontSize;
        const sx = playerX + spread;
        const sy = playerY - 6;
        el.style.left = `${sx}%`;
        el.style.top  = `${sy}%`;
        battleStageEl.appendChild(el);
        pumpkins.push({ el, y: sy, damage });
    }
    playSound('baggage');
}

function hitEnemy(pumpkinData) {
    pumpkinData.el.remove();
    enemyHP = Math.max(0, enemyHP - pumpkinData.damage);
    playSound('isleBlocked');

    // Shrink enemy via width/height, keep centered via CSS transform
    const newSize = ENEMY_MIN_SIZE + enemyHP;
    const enemyEl = document.getElementById('battle-enemy');
    enemyEl.style.width  = `${newSize}px`;
    enemyEl.style.height = `${newSize}px`;

    enemyEl.classList.add('enemy-hit');
    setTimeout(() => enemyEl.classList.remove('enemy-hit'), 200);

    document.getElementById('enemy-hp').textContent = `❤️ ${enemyHP}`;

    if (enemyHP <= 0) endBattleWin();
}

function playerTakeDamage() {
    if (playerInvincible) return;
    playerHP--;
    document.getElementById('player-hp').textContent = `💙 ${Math.max(0, playerHP)}`;

    const playerEl = document.getElementById('battle-player');
    playerEl.classList.add('player-hit');
    setTimeout(() => playerEl.classList.remove('player-hit'), 1500);

    playerInvincible = true;
    setTimeout(() => { playerInvincible = false; }, 1500);

    spawnItem();

    if (playerHP <= 0) endBattleLose();
}

function spawnItem() {
    // New item does NOT remove existing ones
    const types = ['multishot', 'bigpumpkin'];
    const type  = types[Math.floor(Math.random() * 2)];
    const x     = 10 + Math.random() * 80;
    const y     = 48 + Math.random() * 12;

    const el       = document.createElement('div');
    el.className   = 'battle-item';
    el.textContent = type === 'multishot' ? '✨' : '💥';
    el.style.left  = `${x}%`;
    el.style.top   = `${y}%`;
    battleStageEl.appendChild(el);

    activeItems.push({ el, type, spawnTime: Date.now() });
}

function collectItem(item) {
    item.el.remove();
    if (item.type === 'multishot') {
        playerShotCount = Math.min(playerShotCount + 1, 5);
    } else {
        bigPumpkinActive = true;
    }
    updatePowerUpDisplay();
    showItemToast(item.type);
}

function updatePowerUpDisplay() {
    let text = '';
    if (playerShotCount > 1) text += `✨×${playerShotCount} `;
    if (bigPumpkinActive)    text += '💥';
    document.getElementById('power-ups').textContent = text.trim();
}

function showItemToast(type) {
    const toast       = document.createElement('div');
    toast.className   = 'item-toast';
    toast.textContent = type === 'multishot' ? '✨ 다중 발사!' : '💥 거대 호박!';
    battleStageEl.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
}

function endBattleWin() {
    clearInterval(battleInterval); battleInterval = null;
    pumpkins.forEach(p => p.el.remove());      pumpkins = [];
    enemyPumpkins.forEach(p => p.el.remove()); enemyPumpkins = [];
    activeItems.forEach(i => i.el.remove());   activeItems = [];

    const enemyEl = document.getElementById('battle-enemy');
    enemyEl.style.animation = 'enemyDie 1s forwards';
    setTimeout(() => {
        document.getElementById('victory-screen').style.display = 'flex';
    }, 1000);
}

function endBattleLose() {
    clearInterval(battleInterval); battleInterval = null;
    pumpkins.forEach(p => p.el.remove());      pumpkins = [];
    enemyPumpkins.forEach(p => p.el.remove()); enemyPumpkins = [];
    activeItems.forEach(i => i.el.remove());   activeItems = [];

    const playerEl = document.getElementById('battle-player');
    playerEl.style.animation = 'playerDie 0.8s forwards';
    setTimeout(() => {
        document.getElementById('game-over-screen').style.display = 'flex';
    }, 800);
}

// ================================================================
// Reset — back to title screen
// ================================================================
function resetGame() {
    if (battleInterval) { clearInterval(battleInterval); battleInterval = null; }
    pumpkins.forEach(p => p.el.remove());      pumpkins = [];
    enemyPumpkins.forEach(p => p.el.remove()); enemyPumpkins = [];
    activeItems.forEach(i => i.el.remove());   activeItems = [];
    document.querySelectorAll('.item-toast').forEach(t => t.remove());
    battleKeysDown = {};

    currentStage     = 'title';
    boardedCount     = 0;
    playerX          = 50;
    playerY          = 75;
    playerHP         = 5;
    playerInvincible = false;
    enemyHP          = 100;
    enemyCX          = 50;
    enemyCY          = 20;
    enemyDirX        = 1;
    enemyDirY        = 1;
    enemyShootTimer  = 80;
    playerShotCount  = 1;
    bigPumpkinActive = false;
    lastShotTime     = 0;

    boardingSection.style.display = 'none';
    storyOverlay.style.display    = 'none';
    crashOverlay.style.display    = 'none';
    crashOverlay.style.opacity    = '0';
    battleStageEl.style.display   = 'none';
    document.getElementById('story-scene-container').innerHTML = '';

    const playerEl = document.getElementById('battle-player');
    playerEl.style.animation = '';
    playerEl.style.opacity   = '1';

    // Back to title
    titleScreen.style.display  = 'flex';
    titleScreen.style.opacity  = '0';
    requestAnimationFrame(() => requestAnimationFrame(() => {
        titleScreen.style.transition = 'opacity 0.5s ease';
        titleScreen.style.opacity    = '1';
    }));
    setTimeout(() => { titleScreen.style.transition = ''; }, 600);
}

// ================================================================
// Key handling
// ================================================================
window.addEventListener('keydown', (e) => {
    battleKeysDown[e.key] = true;
    if (currentStage === 'battle') {
        if (e.key === ' ')                                              { e.preventDefault(); shootPumpkin(); }
        if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    battleKeysDown[e.key] = false;
});

// ================================================================
// Init
// ================================================================
setupTitleScreen();

window.addEventListener('resize', () => {
    passengers.forEach(p => p.updatePos());
});
