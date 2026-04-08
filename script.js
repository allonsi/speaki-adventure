const ROWS = 10;
const COLS = 5; // 0,1 = Left seats | 2 = Aisle | 3,4 = Right seats
const AISLE_COL = 2;
const TOTAL_PASSENGERS = ROWS * 4; // 40

const sounds = {
    seated:     new Audio('assets/sound-seated2.mp3'),
    baggage:    new Audio('assets/sound-baggage.mp3'),
    isleBlocked:new Audio('assets/sound-isle-blocked.mp3'),
    seatBlocked:new Audio('assets/sound-seat-blocked.mp3')
};

function playSound(type) {
    const s = sounds[type].cloneNode();
    s.play().catch(() => {});
}

// Spooky mode is always on
const isSpookyMode = true;

function playSoundIfSpooky(type) {
    playSound(type);
}

let currentStage = 'boarding'; // 'boarding' | 'story' | 'crash' | 'battle'

// --- Boarding state ---
let passengers = [], queue = [], cells = [];
let grid = Array(ROWS).fill(null).map(() => Array(COLS).fill(null));
let boardedCount = 0;
let currentManual = null;

// --- Battle state ---
let playerX = 50;
let playerHP = 3;
let playerInvincible = false;
let enemyHP = 100;
let enemyX = 50;
let enemyDir = 1;
let enemyShootTimer = 80;
let pumpkins = [];
let enemyPumpkins = [];
let activeItem = null;
let playerShotCount = 1;
let bigPumpkinActive = false;
let battleInterval = null;
let battleKeysDown = {};

const ENEMY_INIT_SIZE = 180;
const ENEMY_MIN_SIZE  = 80;
const ENEMY_CENTER_Y  = 80 + ENEMY_INIT_SIZE / 2; // 170px — vertical center stays fixed

// --- DOM refs ---
const planeGrid       = document.getElementById('plane-grid');
const statBoarded     = document.getElementById('stat-boarded');
const progressFill    = document.getElementById('progress-fill');
const boardingSection = document.getElementById('boarding-section');
const storyOverlay    = document.getElementById('story-overlay');
const crashOverlay    = document.getElementById('crash-overlay');
const battleStageEl   = document.getElementById('battle-stage');

// Mobile toggle
const mobileToggle = document.getElementById('mobile-toggle');
const simControls  = document.getElementById('sim-controls');
if (mobileToggle && simControls) {
    mobileToggle.addEventListener('click', () => simControls.classList.toggle('active'));
}

document.getElementById('btn-reset').addEventListener('click', resetGame);
document.getElementById('btn-play-again').addEventListener('click', resetGame);
document.getElementById('btn-retry').addEventListener('click', resetGame);

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
        // crossOffset: pixel center of each col within the plane-body
        // desktop cols: 24+4+24+4+32+4+24+4+24 = total width
        //   col0=12, col1=40, col2(aisle)=72, col3=104, col4=132
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
        if (this.state === 'SEATED')     this.element.classList.add('pax-seated');
        else if (this.state === 'MANUAL') this.element.classList.add('pax-moving');
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

    // Shuffle
    for (let i = seats.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [seats[i], seats[j]] = [seats[j], seats[i]];
    }
    seats.forEach(s => passengers.push(new Passenger(id++, s.row, s.col)));
    queue = [...passengers];
    passengers.forEach(p => planeGrid.appendChild(p.element));
}

function spawnNextManual() {
    if (!queue.length) { currentManual = null; return; }
    currentManual = queue.shift();
    currentManual.state = 'MANUAL';
    currentManual.row   = 0;
    currentManual.col   = AISLE_COL;
    currentManual.updateVisuals();
}

// ================================================================
// Boarding controls
// ================================================================

// Returns true when both seats on a side are occupied in that row
function isSideFull(row, goingLeft) {
    if (goingLeft) {
        return cells[row]?.[0]?.classList.contains('occupied') &&
               cells[row]?.[1]?.classList.contains('occupied');
    }
    return cells[row]?.[3]?.classList.contains('occupied') &&
           cells[row]?.[4]?.classList.contains('occupied');
}

function handleBoardingKey(e) {
    if (!currentManual) return;
    const key = e.key;
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].includes(key)) return;
    e.preventDefault();

    const isMobile = window.innerWidth <= 800;
    const inAisle  = currentManual.col === AISLE_COL;

    if (isMobile) {
        // Mobile: Up/Down = row (along plane), Left/Right = col (across aisle)
        if (key === 'ArrowUp' && inAisle) {
            if (currentManual.row > 0) currentManual.row--;
        } else if (key === 'ArrowDown' && inAisle) {
            if (currentManual.row < ROWS - 1) currentManual.row++;
        } else if (key === 'ArrowLeft' && currentManual.col > 0) {
            if (inAisle && isSideFull(currentManual.row, true)) {
                playSoundIfSpooky('seatBlocked');
            } else {
                currentManual.col--;
            }
        } else if (key === 'ArrowRight' && currentManual.col < COLS - 1) {
            if (inAisle && isSideFull(currentManual.row, false)) {
                playSoundIfSpooky('seatBlocked');
            } else {
                currentManual.col++;
            }
        }
    } else {
        // Desktop: Left/Right = row (along plane), Up/Down = col (across aisle)
        if (key === 'ArrowLeft' && inAisle) {
            if (currentManual.row > 0) currentManual.row--;
        } else if (key === 'ArrowRight' && inAisle) {
            if (currentManual.row < ROWS - 1) currentManual.row++;
        } else if (key === 'ArrowUp' && currentManual.col > 0) {
            // Entering left seat side from aisle
            if (inAisle && isSideFull(currentManual.row, true)) {
                playSoundIfSpooky('seatBlocked');
            } else {
                currentManual.col--;
            }
        } else if (key === 'ArrowDown' && currentManual.col < COLS - 1) {
            // Entering right seat side from aisle
            if (inAisle && isSideFull(currentManual.row, false)) {
                playSoundIfSpooky('seatBlocked');
            } else {
                currentManual.col++;
            }
        }
    }

    if (key === ' ') attemptSeat();
    else currentManual.updateVisuals();
}

function attemptSeat() {
    if (!currentManual) return;
    const r = currentManual.row;
    const c = currentManual.col;
    if (c === AISLE_COL) { playSoundIfSpooky('seatBlocked'); return; }
    const seatEl = cells[r]?.[c];
    if (!seatEl || seatEl.classList.contains('occupied')) {
        playSoundIfSpooky('seatBlocked');
        return;
    }

    seatEl.classList.add('occupied');
    currentManual.state = 'SEATED';
    currentManual.updateVisuals();
    boardedCount++;
    playSoundIfSpooky('seated');
    currentManual = null;
    updateDashboard();

    if (boardedCount >= TOTAL_PASSENGERS) {
        setTimeout(triggerStory, 600);
        return;
    }
    setTimeout(spawnNextManual, 200);
}

function updateDashboard() {
    if (statBoarded)   statBoarded.innerText = `${boardedCount} / ${TOTAL_PASSENGERS}`;
    if (progressFill)  progressFill.style.width = `${(boardedCount / TOTAL_PASSENGERS) * 100}%`;
}

// ================================================================
// Stage 2a — Story sequence
// ================================================================
function triggerStory() {
    currentStage = 'story';

    const storyContent = document.getElementById('story-content');
    const emojiEl      = document.getElementById('story-emoji');
    const textEl       = document.getElementById('story-text');

    const messages = [
        { emoji: '✈️',  text: '이륙 중...' },
        { emoji: '🌤️', text: '비행 중...' },
        { emoji: '⛈️', text: '⚡ 벼락이 쳤습니다!', lightning: true },
    ];

    storyOverlay.style.display = 'flex';
    storyContent.style.opacity = '0';
    let i = 0;

    function showNext() {
        if (i >= messages.length) {
            storyContent.style.opacity = '0';
            setTimeout(() => {
                storyOverlay.style.display = 'none';
                triggerCrash();
            }, 500);
            return;
        }
        const msg = messages[i++];
        storyContent.style.opacity = '0';
        setTimeout(() => {
            emojiEl.textContent = msg.emoji;
            textEl.textContent  = msg.text;
            storyContent.style.opacity = '1';
            if (msg.lightning) {
                storyOverlay.classList.add('lightning-flash');
                setTimeout(() => storyOverlay.classList.remove('lightning-flash'), 700);
            }
            setTimeout(showNext, 1800);
        }, 400);
    }

    showNext();
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
    playerX           = 50;
    playerHP          = 3;
    playerInvincible  = false;
    enemyHP           = 100;
    enemyX            = 50;
    enemyDir          = 1;
    enemyShootTimer   = 80;
    playerShotCount   = 1;
    bigPumpkinActive  = false;
    pumpkins          = [];
    enemyPumpkins     = [];

    // UI
    document.getElementById('enemy-hp').textContent  = '❤️ 100';
    document.getElementById('player-hp').textContent = '💙 3';
    document.getElementById('power-ups').textContent  = '';
    document.getElementById('victory-screen').style.display   = 'none';
    document.getElementById('game-over-screen').style.display = 'none';

    // Reset enemy element
    const enemyEl = document.getElementById('battle-enemy');
    enemyEl.className        = 'battle-char enemy-char';
    enemyEl.style.cssText    = `width:${ENEMY_INIT_SIZE}px; height:${ENEMY_INIT_SIZE}px; top:80px; left:50%; opacity:1; animation:'';`;

    // Reset player element
    const playerEl = document.getElementById('battle-player');
    playerEl.className       = 'battle-char player-char';
    playerEl.style.left      = `${playerX}%`;
    playerEl.style.opacity   = '1';
    playerEl.style.animation = '';

    if (battleInterval) clearInterval(battleInterval);
    battleInterval = setInterval(updateBattle, 50);
}

function updateBattle() {
    if (currentStage !== 'battle') return;

    const playerEl = document.getElementById('battle-player');
    const enemyEl  = document.getElementById('battle-enemy');

    // --- Move player ---
    if (battleKeysDown['ArrowLeft'])  playerX = Math.max(2,  playerX - 1);
    if (battleKeysDown['ArrowRight']) playerX = Math.min(98, playerX + 1);
    playerEl.style.left = `${playerX}%`;

    // --- Move enemy (oscillates left/right) ---
    enemyX += enemyDir * 0.4;
    if (enemyX > 80) { enemyX = 80; enemyDir = -1; }
    if (enemyX < 20) { enemyX = 20; enemyDir =  1; }
    enemyEl.style.left = `${enemyX}%`;

    // --- Enemy shoot ---
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
        p.y -= 1.5;
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

    // --- Enemy pumpkins: move down, check player hit ---
    enemyPumpkins = enemyPumpkins.filter(ep => {
        ep.y += 1.0;
        ep.el.style.top = `${ep.y}%`;
        if (!playerInvincible) {
            const epRect = ep.el.getBoundingClientRect();
            if (epRect.bottom > pRect.top && epRect.top < pRect.bottom &&
                epRect.right > pRect.left && epRect.left < pRect.right) {
                ep.el.remove();
                playerTakeDamage();
                return false;
            }
        }
        if (ep.y > 110) { ep.el.remove(); return false; }
        return true;
    });

    // --- Item pickup ---
    if (activeItem) {
        const iRect = activeItem.el.getBoundingClientRect();
        if (pRect.bottom > iRect.top && pRect.top < iRect.bottom &&
            pRect.right > iRect.left && pRect.left < iRect.right) {
            collectItem();
        }
    }
}

function shootEnemyPumpkin() {
    const el = document.createElement('div');
    el.className   = 'pumpkin enemy-pumpkin';
    el.textContent = '🎃';
    const startY   = 28;
    el.style.left  = `${enemyX}%`;
    el.style.top   = `${startY}%`;
    battleStageEl.appendChild(el);
    enemyPumpkins.push({ el, y: startY });
}

function shootPumpkin() {
    if (currentStage !== 'battle') return;
    const damage   = bigPumpkinActive ? 2 : 1;
    const fontSize = bigPumpkinActive ? '46px' : '26px';

    for (let i = 0; i < playerShotCount; i++) {
        const spread  = playerShotCount > 1 ? (i - (playerShotCount - 1) / 2) * 7 : 0;
        const el      = document.createElement('div');
        el.className  = 'pumpkin';
        el.textContent= '🎃';
        el.style.fontSize = fontSize;
        const sx = playerX + spread;
        const sy = 73;
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

    // Shrink enemy: size = MIN_SIZE + HP (80→180)
    const newSize = ENEMY_MIN_SIZE + enemyHP;
    const enemyEl = document.getElementById('battle-enemy');
    enemyEl.style.width  = `${newSize}px`;
    enemyEl.style.height = `${newSize}px`;
    enemyEl.style.top    = `${ENEMY_CENTER_Y - newSize / 2}px`; // keep center fixed

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
    if (activeItem) { activeItem.el.remove(); activeItem = null; }

    const types = ['multishot', 'bigpumpkin'];
    const type  = types[Math.floor(Math.random() * 2)];
    const x     = 10 + Math.random() * 80;
    const y     = 45 + Math.random() * 15;

    const el       = document.createElement('div');
    el.className   = 'battle-item';
    el.textContent = type === 'multishot' ? '✨' : '💥';
    el.style.left  = `${x}%`;
    el.style.top   = `${y}%`;
    battleStageEl.appendChild(el);

    activeItem = { el, type };
}

function collectItem() {
    if (!activeItem) return;
    const { type } = activeItem;
    activeItem.el.remove();
    activeItem = null;

    if (type === 'multishot') {
        playerShotCount = Math.min(playerShotCount + 1, 5);
    } else {
        bigPumpkinActive = true;
    }
    updatePowerUpDisplay();
    showItemToast(type);
}

function updatePowerUpDisplay() {
    let text = '';
    if (playerShotCount > 1)  text += `✨×${playerShotCount} `;
    if (bigPumpkinActive)     text += '💥';
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
    if (activeItem) { activeItem.el.remove(); activeItem = null; }

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
    if (activeItem) { activeItem.el.remove(); activeItem = null; }

    const playerEl = document.getElementById('battle-player');
    playerEl.style.animation = 'playerDie 0.8s forwards';
    setTimeout(() => {
        document.getElementById('game-over-screen').style.display = 'flex';
    }, 800);
}

// ================================================================
// Reset
// ================================================================
function resetGame() {
    if (battleInterval) { clearInterval(battleInterval); battleInterval = null; }
    pumpkins.forEach(p => p.el.remove());      pumpkins = [];
    enemyPumpkins.forEach(p => p.el.remove()); enemyPumpkins = [];
    if (activeItem) { activeItem.el.remove(); activeItem = null; }
    document.querySelectorAll('.item-toast').forEach(t => t.remove());
    battleKeysDown = {};

    currentStage      = 'boarding';
    boardedCount      = 0;
    currentManual     = null;
    playerX           = 50;
    playerHP          = 3;
    playerInvincible  = false;
    enemyHP           = 100;
    enemyX            = 50;
    enemyDir          = 1;
    enemyShootTimer   = 80;
    playerShotCount   = 1;
    bigPumpkinActive  = false;

    boardingSection.style.display   = '';
    storyOverlay.style.display      = 'none';
    document.getElementById('story-content').style.opacity = '0';
    crashOverlay.style.display      = 'none';
    crashOverlay.style.opacity      = '0';
    battleStageEl.style.display     = 'none';

    const playerEl = document.getElementById('battle-player');
    playerEl.style.animation = '';
    playerEl.style.opacity   = '1';

    updateDashboard();
    initGrid();
    generatePassengers();
    spawnNextManual();
}

// ================================================================
// Key handling
// ================================================================
window.addEventListener('keydown', (e) => {
    battleKeysDown[e.key] = true;
    if (currentStage === 'boarding') {
        handleBoardingKey(e);
    } else if (currentStage === 'battle') {
        if (e.key === ' ') { e.preventDefault(); shootPumpkin(); }
        if (['ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    battleKeysDown[e.key] = false;
});

// ================================================================
// Init
// ================================================================
initGrid();
generatePassengers();
spawnNextManual();

window.addEventListener('resize', () => {
    passengers.forEach(p => p.updatePos());
});
