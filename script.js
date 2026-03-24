const ROWS = 30;
const COLS = 7; // 0,1,2 = Left, 3 = Aisle, 4,5,6 = Right
const TOTAL_PASSENGERS = ROWS * 6;

// Audio setup
const sounds = {
    seated: new Audio('assets/sound-seated2.mp3'),
    baggage: new Audio('assets/sound-baggage.mp3'),
    isleBlocked: new Audio('assets/sound-isle-blocked.mp3'),
    seatBlocked: new Audio('assets/sound-seat-blocked.mp3')
};

function playSound(type) {
    if (!isSpookyMode) return;
    const sound = sounds[type].cloneNode();
    sound.play().catch(e => {
        // block play until user interacts
    });
}

let isSpookyMode = false;

// Simulator State
let passengers = [];
let queue = [];
let grid = Array(ROWS).fill(null).map(() => Array(COLS).fill(null));
let cells = [];

let tickCount = 0;
let boardedCount = 0;
let bottlenecks = 0;

let isRunning = false;
let simInterval = null;

// Settings
let tickDelay = 1000 / 10; // 10 TPS default
let baggageProb = 0.8;
let expectedBaggageTime = 3;
let currentStrategy = 'random'; 

// Set initial CSS var for animation
document.documentElement.style.setProperty('--tick-speed', `${tickDelay}ms`);

// DOM Elements
const planeGrid = document.getElementById('plane-grid');
const statTicks = document.getElementById('stat-ticks');
const statBoarded = document.getElementById('stat-boarded');
const statBottlenecks = document.getElementById('stat-bottlenecks');
const progressFill = document.getElementById('progress-fill');

const selectStrategy = document.getElementById('strategy-select');
const inputBaggageProb = document.getElementById('baggage-prob');
const inputBaggageTime = document.getElementById('baggage-time');
const inputSpeed = document.getElementById('sim-speed');

const labelBaggageProb = document.getElementById('baggage-prob-val');
const labelBaggageTime = document.getElementById('baggage-time-val');
const labelSpeed = document.getElementById('sim-speed-val');

const btnPlay = document.getElementById('btn-play');
const btnPause = document.getElementById('btn-pause');
const btnReset = document.getElementById('btn-reset');

// Events
inputBaggageProb.addEventListener('input', (e) => {
    baggageProb = parseInt(e.target.value) / 100;
    labelBaggageProb.innerText = `${e.target.value}%`;
});

inputBaggageTime.addEventListener('input', (e) => {
    expectedBaggageTime = parseInt(e.target.value);
    labelBaggageTime.innerText = expectedBaggageTime;
});

inputSpeed.addEventListener('input', (e) => {
    const tps = parseInt(e.target.value);
    labelSpeed.innerText = `${tps} TPS`;
    tickDelay = 1000 / tps;
    document.documentElement.style.setProperty('--tick-speed', `${tickDelay}ms`);

    if (isRunning) {
        clearInterval(simInterval);
        simInterval = setInterval(gameLoop, tickDelay);
    }
});

selectStrategy.addEventListener('change', (e) => {
    currentStrategy = e.target.value;
    resetSimulation();
});

btnPlay.addEventListener('click', () => {
    if (boardedCount >= TOTAL_PASSENGERS) return;
    isRunning = true;
    btnPlay.disabled = true;
    btnPause.disabled = false;
    simInterval = setInterval(gameLoop, tickDelay);
});

btnPause.addEventListener('click', () => {
    isRunning = false;
    btnPlay.disabled = false;
    btnPause.disabled = true;
    clearInterval(simInterval);
});

btnReset.addEventListener('click', resetSimulation);

const cbSpookyMode = document.getElementById('spooky-mode');
if (cbSpookyMode) {
    cbSpookyMode.addEventListener('change', (e) => {
        isSpookyMode = e.target.checked;
        if (isSpookyMode) {
            document.body.classList.add('spooky-mode');
        } else {
            document.body.classList.remove('spooky-mode');
        }
    });
}

class Passenger {
    constructor(id, targetRow, targetCol) {
        this.id = id;
        this.targetRow = targetRow;
        this.targetCol = targetCol;
        
        this.row = -1;
        this.col = 3; // start in aisle
        
        this.state = 'QUEUE'; // QUEUE, AISLE, STOWING, WAITING, MOVING_TO_SEAT, SEATED
        this.baggageTime = 0;
        this.interferenceDelay = 0;
        this.wasBlocked = false; // Tracks if they've newly stopped in the aisle

        this.element = document.createElement('div');
        this.element.className = 'passenger pax-waiting';
        
        // Initial position outside plane
        this.updatePos();
    }

    updatePos() {
        const crossOffset = [12, 40, 68, 100, 132, 160, 188];
        const longOffset = this.row < 0 ? -24 : (this.row * 28 + 12);
        this.element.style.left = `${longOffset}px`;
        this.element.style.top = `${crossOffset[this.col]}px`;
    }

    updateVisuals() {
        this.element.className = 'passenger';
        if (this.state === 'STOWING') this.element.classList.add('pax-stowing');
        else if (this.state === 'WAITING' || this.wasBlocked) this.element.classList.add('pax-waiting');
        else if (this.state === 'AISLE' || this.state === 'QUEUE') this.element.classList.add('pax-moving');
        else if (this.state === 'MOVING_TO_SEAT') this.element.classList.add('pax-moving');
        else if (this.state === 'SEATED') this.element.classList.add('pax-seated');
        
        this.updatePos();
    }
}

function initGrid() {
    planeGrid.innerHTML = '';
    cells = [];
    grid = Array(ROWS).fill(null).map(() => Array(COLS).fill(null));

    for (let r = 0; r < ROWS; r++) {
        let rowCells = [];
        for (let c = 0; c < COLS; c++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            
            if (c === 3) {
                cell.classList.add('aisle');
            } else {
                cell.classList.add('seat');
                cell.id = `seat-${r}-${c}`;
            }

            // Draw row labels
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

    let availableSeats = [];
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (c === 3) continue; // skip aisle
            availableSeats.push({row: r, col: c});
        }
    }

    if (currentStrategy === 'random') {
        availableSeats.forEach(seat => {
            passengers.push(new Passenger(id++, seat.row, seat.col));
        });
        for (let i = passengers.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [passengers[i], passengers[j]] = [passengers[j], passengers[i]];
        }
    } else if (currentStrategy === 'b2f') {
        availableSeats.forEach(seat => {
            passengers.push(new Passenger(id++, seat.row, seat.col));
        });
        passengers.sort((a, b) => {
            if (a.targetRow !== b.targetRow) {
                return b.targetRow - a.targetRow; // back rows first
            }
            return Math.random() - 0.5; // shuffle within the same row
        });
    } else if (currentStrategy === 'block') {
        availableSeats.forEach(seat => {
            passengers.push(new Passenger(id++, seat.row, seat.col));
        });
        
        const getGroup = (row) => {
            if (row >= 20) return 0; // Rows 21-30 are 0-indexed as 20-29
            if (row >= 10) return 1; // Rows 11-20 are 0-indexed as 10-19
            return 2;                // Rows 1-10 are 0-indexed as 0-9
        };

        passengers.sort((a, b) => {
            const groupA = getGroup(a.targetRow);
            const groupB = getGroup(b.targetRow);
            if (groupA !== groupB) {
                return groupA - groupB;
            }
            return Math.random() - 0.5; // Random shuffle within the same block
        });
    } else if (currentStrategy === 'wilma') {
        availableSeats.forEach(seat => {
            passengers.push(new Passenger(id++, seat.row, seat.col));
        });
        const getGroup = (col) => {
            if (col === 0 || col === 6) return 0; // Window
            if (col === 1 || col === 5) return 1; // Middle
            return 2; // Aisle
        };
        passengers.sort((a, b) => {
            const groupA = getGroup(a.targetCol);
            const groupB = getGroup(b.targetCol);
            if (groupA !== groupB) {
                return groupA - groupB;
            }
            return Math.random() - 0.5; // shuffle within same group
        });
    } else if (currentStrategy === 'steffen') {
        let steffenOrder = [];
        // Window -> Middle -> Aisle
        // Right side then Left side
        // Even rows then Odd rows (from back to front)
        const colsOrder = [[6], [0], [5], [1], [4], [2]]; 
        for (let cols of colsOrder) {
            for (let parity of [0, 1]) { // 0 for even rows, 1 for odd rows
                for (let r = ROWS - 1; r >= 0; r--) {
                    if (r % 2 === parity) {
                        for (let c of cols) {
                            steffenOrder.push({row: r, col: c});
                        }
                    }
                }
            }
        }
        steffenOrder.forEach(seat => {
            passengers.push(new Passenger(id++, seat.row, seat.col));
        });
    } else if (currentStrategy === 'no-assigned') {
        // 모든 승객은 그냥 좌석과 상관없이 랜덤하게 아무 곳이나 앉음
        // In terms of simulation outcome, randomly picking an empty seat is essentially 
        // assigning a random permutation of passengers to random seats.
        availableSeats.forEach(seat => {
            passengers.push(new Passenger(id++, seat.row, seat.col));
        });
        for (let i = passengers.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [passengers[i], passengers[j]] = [passengers[j], passengers[i]];
        }
    }

    queue = [...passengers];
    passengers.forEach(pax => {
        planeGrid.appendChild(pax.element);
    });
}

function resetSimulation() {
    isRunning = false;
    clearInterval(simInterval);
    btnPlay.disabled = false;
    btnPause.disabled = true;
    
    tickCount = 0;
    boardedCount = 0;
    bottlenecks = 0;
    
    updateDashboard();
    initGrid();
    generatePassengers();
}

function updateDashboard() {
    statTicks.innerText = tickCount;
    statBoarded.innerText = `${boardedCount} / ${TOTAL_PASSENGERS}`;
    statBottlenecks.innerText = bottlenecks;
    
    const pct = (boardedCount / TOTAL_PASSENGERS) * 100;
    progressFill.style.width = `${pct}%`;
}


function startMovingToSeat(pax, r) {
    grid[r][3] = null;
    grid[r][pax.targetCol] = pax;
    pax.state = 'MOVING_TO_SEAT';
    
    const step = pax.targetCol < pax.col ? -1 : 1;
    pax.col += step;
    
    if (pax.col === pax.targetCol) {
        pax.state = 'SEATED';
        boardedCount++;
        cells[pax.row][pax.targetCol].classList.add('occupied');
        playSound('seated');
    }
}

function checkInterferenceAndMove(pax, r) {
    let interCount = 0;
    if (pax.targetCol < 3) {
        for (let c = pax.targetCol + 1; c < 3; c++) {
            if (grid[r][c] !== null) interCount++;
        }
    } else if (pax.targetCol > 3) {
        for (let c = 4; c < pax.targetCol; c++) {
            if (grid[r][c] !== null) interCount++;
        }
    }
    
    if (interCount > 0) {
        pax.interferenceDelay = interCount * 3;
        pax.state = 'WAITING';
        playSound('seatBlocked');
    } else {
        startMovingToSeat(pax, r);
    }
}

function gameLoop() {
    tickCount++;
    let bottleneckOccurred = false;

    // Process step-by-step movement into seats
    passengers.forEach(pax => {
        if (pax.state === 'MOVING_TO_SEAT') {
            const step = pax.targetCol < pax.col ? -1 : 1;
            pax.col += step;
            if (pax.col === pax.targetCol) {
                pax.state = 'SEATED';
                boardedCount++;
                const seatElement = cells[pax.row][pax.targetCol];
                seatElement.classList.add('occupied');
                playSound('seated');
            }
            pax.updateVisuals();
        }
    });

    // Process from back to front of aisle
    for (let r = ROWS - 1; r >= 0; r--) {
        const pax = grid[r][3];
        if (!pax) continue;

        if (pax.state === 'WAITING') {
            if (pax.interferenceDelay > 0) {
                pax.interferenceDelay--;
            }
            if (pax.interferenceDelay <= 0) {
                startMovingToSeat(pax, r);
            }
            bottleneckOccurred = true; // people behind might be blocked
        } 
        else if (pax.state === 'STOWING') {
            if (pax.baggageTime > 0) {
                pax.baggageTime--;
            }
            if (pax.baggageTime <= 0) {
                checkInterferenceAndMove(pax, r);
            }
            bottleneckOccurred = true;
        }
        else if (pax.state === 'AISLE') {
            if (pax.targetRow === r) {
                if (Math.random() < baggageProb && expectedBaggageTime > 0) {
                    pax.state = 'STOWING';
                    pax.baggageTime = expectedBaggageTime;
                    playSound('baggage');
                } else {
                    checkInterferenceAndMove(pax, r);
                }
                pax.wasBlocked = false;
            } else if (r < ROWS - 1 && grid[r+1][3] === null) {
                // Move forward
                grid[r+1][3] = pax;
                grid[r][3] = null;
                pax.row = r + 1;
                pax.wasBlocked = false;
            } else {
                // Blocked by passenger ahead
                pax.wasBlocked = true;
            }
        }
        pax.updateVisuals();
    }

    // Attempt to spawn new passenger into aisle row 0
    if (queue.length > 0) {
        if (grid[0][3] === null) {
            const newPax = queue.shift();
            newPax.state = 'AISLE';
            newPax.row = 0;
            newPax.wasBlocked = false;
            grid[0][3] = newPax;
            newPax.updateVisuals();
        } else {
            // Queue passenger is blocked from entering
            bottlenecks++;
            playSound('isleBlocked');
            queue[0].wasBlocked = true;
            queue[0].updateVisuals();
        }
    }

    updateDashboard();

    if (boardedCount >= TOTAL_PASSENGERS) {
        isRunning = false;
        clearInterval(simInterval);
        btnPlay.disabled = false;
        btnPause.disabled = true;
    }
}

// Initial setup
initGrid();
resetSimulation();
