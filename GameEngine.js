/**
 * GameEngine.js — Client-side offline game engine
 * Ports server logic (map gen, physics, zone ownership) + bot AI
 */

const BALL_RADIUS = 10;
const COLORS = ['#F43F5E', '#38BDF8', '#10B981', '#F59E0B'];
const BOT_NAMES = ['Robo', 'Volt', 'Pixel', 'Turbo', 'Neon', 'Blitz'];

// ─── ULTIMATE ABILITIES ────────────────────────────────

const ULTI_COOLDOWN = 200; // 5 seconds at 40Hz
const PROJECTILE_SPEED = 12;
const PROJECTILE_RADIUS = 45;
const PROJ_WALL_HITBOX = 8;

const ULTI_TYPES = {
    shockwave: {
        name: 'Şok Dalgası', icon: '🔴', color: '#EF4444',
        maxDistance: 180, projectile: true,
    },
    freeze: {
        name: 'Dondurma', icon: '🟡', color: '#3B82F6',
        maxDistance: 200, projectile: true,
    },
    cage: {
        name: 'Hapsetme', icon: '🔵', color: '#8B5CF6',
        maxDistance: 160, projectile: true,
    },
    // speedburst: {
    //     name: 'Hız Patlaması', icon: '🟣', color: '#EC4899',
    //     maxDistance: 180, projectile: false, // self-targeted
    // },
    vortex: {
        name: 'Kara Delik', icon: '🌀', color: '#6366F1',
        maxDistance: 250, projectile: true,
    },
};

function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}

// ─── MAP GENERATION ────────────────────────────────────

function generateLabyrinthMap() {
    const MAP_WIDTH = 800;
    const MAP_HEIGHT = 600;
    const GRID_SIZE = 40;

    const kingZone = { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2, radius: GRID_SIZE, name: 'Kale' };

    const frameWalls = [
        { id: '1', x: 0, y: 0, width: MAP_WIDTH, height: 40 },
        { id: '2', x: 0, y: MAP_HEIGHT - 40, width: MAP_WIDTH, height: 40 },
        { id: '3', x: 0, y: 0, width: 40, height: MAP_HEIGHT },
        { id: '4', x: MAP_WIDTH - 40, y: 0, width: 40, height: MAP_HEIGHT },
    ];

    const cols = Math.floor(MAP_WIDTH / GRID_SIZE) - 2;
    const rows = Math.floor(MAP_HEIGHT / GRID_SIZE) - 2;
    const ENTRY_SIZE = 3;

    const grid = new Array(cols);
    for (let i = 0; i < cols; i++) {
        grid[i] = new Array(rows);
        for (let j = 0; j < rows; j++) {
            grid[i][j] = {
                x: i, y: j,
                visited: false,
                walls: { top: true, right: true, bottom: true, left: true }
            };
        }
    }

    // Recursive backtracker maze from center
    const stack = [];
    const startX = Math.floor(cols / 2);
    const startY = Math.floor(rows / 2);
    grid[startX][startY].visited = true;
    stack.push(grid[startX][startY]);

    function getNeighbor(nx, ny) {
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return null;
        return grid[nx][ny];
    }

    while (stack.length > 0) {
        const cell = stack[stack.length - 1];
        const neighbors = [];
        const t = getNeighbor(cell.x, cell.y - 1); if (t && !t.visited) neighbors.push({ cell: t, dir: 'top' });
        const r = getNeighbor(cell.x + 1, cell.y); if (r && !r.visited) neighbors.push({ cell: r, dir: 'right' });
        const b = getNeighbor(cell.x, cell.y + 1); if (b && !b.visited) neighbors.push({ cell: b, dir: 'bottom' });
        const l = getNeighbor(cell.x - 1, cell.y); if (l && !l.visited) neighbors.push({ cell: l, dir: 'left' });

        if (neighbors.length > 0) {
            const n = neighbors[Math.floor(Math.random() * neighbors.length)];
            if (n.dir === 'top') { cell.walls.top = false; n.cell.walls.bottom = false; }
            if (n.dir === 'right') { cell.walls.right = false; n.cell.walls.left = false; }
            if (n.dir === 'bottom') { cell.walls.bottom = false; n.cell.walls.top = false; }
            if (n.dir === 'left') { cell.walls.left = false; n.cell.walls.right = false; }
            n.cell.visited = true;
            stack.push(n.cell);
        } else {
            stack.pop();
        }
    }

    function carveRegion(sx, sy, w, h) {
        for (let i = sx; i < sx + w; i++) {
            for (let j = sy; j < sy + h; j++) {
                const cell = getNeighbor(i, j);
                if (!cell) continue;
                const rightCell = getNeighbor(i + 1, j);
                if (i < sx + w - 1 && rightCell) { cell.walls.right = false; rightCell.walls.left = false; }
                const bottomCell = getNeighbor(i, j + 1);
                if (j < sy + h - 1 && bottomCell) { cell.walls.bottom = false; bottomCell.walls.top = false; }
            }
        }
    }

    carveRegion(0, 0, ENTRY_SIZE, ENTRY_SIZE);
    carveRegion(0, rows - ENTRY_SIZE, ENTRY_SIZE, ENTRY_SIZE);
    carveRegion(cols - ENTRY_SIZE, 0, ENTRY_SIZE, ENTRY_SIZE);
    carveRegion(cols - ENTRY_SIZE, rows - ENTRY_SIZE, ENTRY_SIZE, ENTRY_SIZE);

    const kzSize = 4;
    carveRegion(Math.floor(cols / 2) - kzSize / 2, Math.floor(rows / 2) - kzSize / 2, kzSize, kzSize);

    // Random wall removal for extra paths
    const removalChance = 0.05;
    for (let i = 1; i < cols - 1; i++) {
        for (let j = 1; j < rows - 1; j++) {
            if (Math.random() < removalChance) {
                const cell = grid[i][j];
                const dirs = [];
                if (cell.walls.top) dirs.push('top');
                if (cell.walls.right) dirs.push('right');
                if (cell.walls.bottom) dirs.push('bottom');
                if (cell.walls.left) dirs.push('left');
                if (dirs.length > 0) {
                    const d = dirs[Math.floor(Math.random() * dirs.length)];
                    if (d === 'top') { cell.walls.top = false; grid[i][j - 1].walls.bottom = false; }
                    if (d === 'right') { cell.walls.right = false; grid[i + 1][j].walls.left = false; }
                    if (d === 'bottom') { cell.walls.bottom = false; grid[i][j + 1].walls.top = false; }
                    if (d === 'left') { cell.walls.left = false; grid[i - 1][j].walls.right = false; }
                }
            }
        }
    }

    // Build wall rectangles
    const mazeWalls = [];
    let wallId = 5;
    for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
            const cell = grid[i][j];
            const px = (i + 1) * GRID_SIZE;
            const py = (j + 1) * GRID_SIZE;
            if (cell.walls.top) mazeWalls.push({ id: (wallId++).toString(), x: px, y: py, width: GRID_SIZE, height: 4 });
            if (cell.walls.left) mazeWalls.push({ id: (wallId++).toString(), x: px, y: py, width: 4, height: GRID_SIZE });
            if (j === rows - 1 && cell.walls.bottom) mazeWalls.push({ id: (wallId++).toString(), x: px, y: py + GRID_SIZE - 4, width: GRID_SIZE, height: 4 });
            if (i === cols - 1 && cell.walls.right) mazeWalls.push({ id: (wallId++).toString(), x: px + GRID_SIZE - 4, y: py, width: 4, height: GRID_SIZE });
        }
    }

    return {
        width: MAP_WIDTH, height: MAP_HEIGHT,
        walls: [...frameWalls, ...mazeWalls],
        kingZones: [kingZone],
        // Maze data for bot pathfinding
        grid, cols, rows, gridSize: GRID_SIZE,
    };
}

function generateArenaMap() {
    const MAP_WIDTH = 800;
    const MAP_HEIGHT = 600;

    const frameWalls = [
        { id: '1', x: 0, y: 0, width: MAP_WIDTH, height: 40 },
        { id: '2', x: 0, y: MAP_HEIGHT - 40, width: MAP_WIDTH, height: 40 },
        { id: '3', x: 0, y: 0, width: 40, height: MAP_HEIGHT },
        { id: '4', x: MAP_WIDTH - 40, y: 0, width: 40, height: MAP_HEIGHT },
    ];

    const kingZones = [
        { x: 200, y: 200, radius: 45, name: 'Kuzey' },
        { x: 600, y: 400, radius: 45, name: 'Güney' },
        { x: 400, y: 300, radius: 40, name: 'Merkez' },
    ];

    const spawnCorners = [
        { x: 40, y: 40, w: 120, h: 120 },
        { x: MAP_WIDTH - 160, y: 40, w: 120, h: 120 },
        { x: 40, y: MAP_HEIGHT - 160, w: 120, h: 120 },
        { x: MAP_WIDTH - 160, y: MAP_HEIGHT - 160, w: 120, h: 120 },
    ];

    function overlapsZone(wx, wy, ww, wh) {
        for (const kz of kingZones) {
            const cx = clamp(kz.x, wx, wx + ww);
            const cy = clamp(kz.y, wy, wy + wh);
            const dx = kz.x - cx, dy = kz.y - cy;
            if (Math.sqrt(dx * dx + dy * dy) < kz.radius + 20) return true;
        }
        for (const sc of spawnCorners) {
            if (wx < sc.x + sc.w && wx + ww > sc.x && wy < sc.y + sc.h && wy + wh > sc.y) return true;
        }
        return false;
    }

    const coverWalls = [];
    let wId = 5;
    const numWalls = 15 + Math.floor(Math.random() * 11);
    let attempts = 0;
    while (coverWalls.length < numWalls && attempts < 200) {
        attempts++;
        const isH = Math.random() > 0.5;
        const w = isH ? (60 + Math.floor(Math.random() * 80)) : 8;
        const h = isH ? 8 : (60 + Math.floor(Math.random() * 80));
        const x = 50 + Math.floor(Math.random() * (MAP_WIDTH - 100 - w));
        const y = 50 + Math.floor(Math.random() * (MAP_HEIGHT - 100 - h));
        if (!overlapsZone(x, y, w, h)) {
            coverWalls.push({ id: (wId++).toString(), x, y, width: w, height: h });
        }
    }

    return {
        width: MAP_WIDTH, height: MAP_HEIGHT,
        walls: [...frameWalls, ...coverWalls],
        kingZones,
        grid: null, cols: 0, rows: 0, gridSize: 0, // no maze grid
    };
}

// ─── PHYSICS ───────────────────────────────────────────

function updatePhysics(players, walls, gameMode, vortexes = []) {
    const friction = gameMode === 'labyrinth' ? 1.0 : 0.98;

    for (const p of players) {
        const sensitivity = 0.6;
        p.vx += p.tilt.x * sensitivity;
        p.vy -= p.tilt.y * sensitivity;
        p.vx *= friction;
        p.vy *= friction;
    }

    // Player-vs-Player collisions
    for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
            const p1 = players[i], p2 = players[j];
            const dx = p1.x - p2.x, dy = p1.y - p2.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < (BALL_RADIUS * 2) ** 2) {
                const dist = Math.sqrt(distSq);
                if (dist === 0) continue;
                const overlap = BALL_RADIUS * 2 - dist;
                const nx = dx / dist, ny = dy / dist;
                p1.x += nx * overlap / 2; p1.y += ny * overlap / 2;
                p2.x -= nx * overlap / 2; p2.y -= ny * overlap / 2;
                const dot1 = p1.vx * nx + p1.vy * ny;
                const dot2 = p2.vx * nx + p2.vy * ny;
                p1.vx += (dot2 - dot1) * nx * 1.5; p1.vy += (dot2 - dot1) * ny * 1.5;
                p2.vx += (dot1 - dot2) * nx * 1.5; p2.vy += (dot1 - dot2) * ny * 1.5;
            }
        }
    }

    // Wall collisions
    const SUBSTEPS = 4;
    for (let s = 0; s < SUBSTEPS; s++) {
        // Update vortexes once per tick
        if (s === 0) {
            for (const v of vortexes) {
                if (v.currentRadius < v.maxRadius) v.currentRadius += 2;
                v.ticksLeft--;
            }
        }

        for (const p of players) {
            p.x += p.vx / SUBSTEPS;
            p.y += p.vy / SUBSTEPS;

            // Apply Vortex attraction
            for (const v of vortexes) {
                if (p.id === v.shooterId) continue;
                const dx = v.x - p.x;
                const dy = v.y - p.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < v.currentRadius + 20) {
                    const force = 0.8 * (1 - dist / (v.currentRadius + 40));
                    p.vx += (dx / (dist || 1)) * force;
                    p.vy += (dy / (dist || 1)) * force;
                }
            }

            for (const wall of walls) {
                const cx = clamp(p.x, wall.x, wall.x + wall.width);
                const cy = clamp(p.y, wall.y, wall.y + wall.height);
                const dx = p.x - cx, dy = p.y - cy;
                const distSq = dx * dx + dy * dy;
                if (distSq < BALL_RADIUS * BALL_RADIUS) {
                    const dist = Math.sqrt(distSq);
                    if (dist === 0) continue;
                    const overlap = BALL_RADIUS - dist;
                    const nx = dx / dist, ny = dy / dist;
                    p.x += nx * overlap;
                    p.y += ny * overlap;
                    const dot = p.vx * nx + p.vy * ny;
                    p.vx = (p.vx - 1.5 * dot * nx) * 0.9;
                    p.vy = (p.vy - (1.5 * dot * ny)) * 0.9;
                }
            }
        }
    }
}

// ─── ZONE OWNERSHIP ────────────────────────────────────

function updateZoneOwnership(players, zoneStates) {
    const CAPTURE_SPEED = 2.5;
    const CAPTURE_DECAY = 1.0;
    const OWNER_SCORE_RATE = 50 / 40;
    const CONTEST_SCORE_RATE = 100 / 40;

    for (const zone of zoneStates) {
        const inZone = [];
        for (const p of players) {
            const dx = p.x - zone.x, dy = p.y - zone.y;
            if (Math.sqrt(dx * dx + dy * dy) < zone.radius) inZone.push(p);
        }

        for (const p of players) {
            if (!zone.captureProgress[p.id]) zone.captureProgress[p.id] = 0;

            if (inZone.includes(p)) {
                if (zone.ownerId && zone.ownerId !== p.id) {
                    zone.captureProgress[zone.ownerId] = Math.max(0,
                        (zone.captureProgress[zone.ownerId] || 0) - CAPTURE_SPEED);
                    if (zone.captureProgress[zone.ownerId] <= 0) {
                        zone.ownerId = null; zone.ownerColor = null; zone.ownerNick = null;
                    }
                } else {
                    zone.captureProgress[p.id] = Math.min(100, zone.captureProgress[p.id] + CAPTURE_SPEED);
                }
                if (!zone.ownerId && zone.captureProgress[p.id] >= 100) {
                    zone.ownerId = p.id; zone.ownerColor = p.color; zone.ownerNick = p.nick;
                }
            } else {
                if (p.id !== zone.ownerId) {
                    zone.captureProgress[p.id] = Math.max(0, zone.captureProgress[p.id] - CAPTURE_DECAY);
                }
            }
        }

        if (zone.ownerId) {
            const owner = players.find(p => p.id === zone.ownerId);
            if (owner) {
                owner.score += OWNER_SCORE_RATE;
                if (inZone.find(p => p.id === zone.ownerId)) {
                    owner.score += CONTEST_SCORE_RATE;
                }
            }
        }
    }
}

// ─── BOT AI ────────────────────────────────────────────

// BFS pathfinding on maze grid (for labyrinth bots)
function bfsMazePath(grid, cols, rows, fromCol, fromRow, toCol, toRow) {
    if (fromCol < 0 || fromRow < 0 || fromCol >= cols || fromRow >= rows) return [];
    if (toCol < 0 || toRow < 0 || toCol >= cols || toRow >= rows) return [];

    const visited = new Array(cols);
    for (let i = 0; i < cols; i++) visited[i] = new Array(rows).fill(false);
    const parent = new Array(cols);
    for (let i = 0; i < cols; i++) parent[i] = new Array(rows).fill(null);

    const queue = [{ x: fromCol, y: fromRow }];
    visited[fromCol][fromRow] = true;

    while (queue.length > 0) {
        const cur = queue.shift();
        if (cur.x === toCol && cur.y === toRow) break;

        const cell = grid[cur.x][cur.y];
        const moves = [];
        if (!cell.walls.top && cur.y > 0) moves.push({ x: cur.x, y: cur.y - 1 });
        if (!cell.walls.right && cur.x < cols - 1) moves.push({ x: cur.x + 1, y: cur.y });
        if (!cell.walls.bottom && cur.y < rows - 1) moves.push({ x: cur.x, y: cur.y + 1 });
        if (!cell.walls.left && cur.x > 0) moves.push({ x: cur.x - 1, y: cur.y });

        for (const next of moves) {
            if (!visited[next.x][next.y]) {
                visited[next.x][next.y] = true;
                parent[next.x][next.y] = cur;
                queue.push(next);
            }
        }
    }

    // Reconstruct path
    const path = [];
    let cur = { x: toCol, y: toRow };
    if (!visited[toCol][toRow]) return []; // no path
    while (cur) {
        path.unshift(cur);
        cur = parent[cur.x][cur.y];
    }
    return path;
}

function initBotState(bot, mapData, gameMode) {
    bot.ai = {
        path: [],
        pathIndex: 0,
        retargetTick: 0,
        stuckTicks: 0,
        mistakeTimer: 0,
        mistakeDir: null,
        strength: 0.45 + Math.random() * 0.25, // 0.45-0.70 personality (less aggressive)
        targetZoneIdx: -1,
        state: 'SEEK', // SEEK, DEFEND, CONTEST
    };
}

function updateBotAI(bots, allPlayers, mapData, zoneStates, gameMode, tickCount) {
    const gs = mapData.gridSize;

    for (const bot of bots) {
        if (!bot.ai) initBotState(bot, mapData, gameMode);

        if (gameMode === 'labyrinth') {
            updateLabyrinthBotAI(bot, allPlayers, mapData, zoneStates, tickCount);
        } else {
            updateArenaBotAI(bot, allPlayers, mapData, zoneStates, tickCount);
        }
    }
}

function updateLabyrinthBotAI(bot, allPlayers, mapData, zoneStates, tickCount) {
    const { grid, cols, rows, gridSize } = mapData;
    if (!grid) return; // safety

    // Bot's current grid cell
    const bCol = clamp(Math.floor((bot.x - gridSize) / gridSize), 0, cols - 1);
    const bRow = clamp(Math.floor((bot.y - gridSize) / gridSize), 0, rows - 1);

    // Target: king zone center cell
    const kz = mapData.kingZones[0];
    const tCol = clamp(Math.floor((kz.x - gridSize) / gridSize), 0, cols - 1);
    const tRow = clamp(Math.floor((kz.y - gridSize) / gridSize), 0, rows - 1);

    // Detect stuck
    const speed = Math.sqrt(bot.vx * bot.vx + bot.vy * bot.vy);
    if (speed < 0.3) bot.ai.stuckTicks++; else bot.ai.stuckTicks = 0;

    // Re-path every 80 ticks (~2s) or when stuck or no path
    const needRepath = bot.ai.path.length === 0
        || bot.ai.retargetTick <= 0
        || bot.ai.stuckTicks > 20
        || bot.ai.pathIndex >= bot.ai.path.length;

    if (needRepath) {
        bot.ai.path = bfsMazePath(grid, cols, rows, bCol, bRow, tCol, tRow);
        bot.ai.pathIndex = 1; // skip starting cell
        bot.ai.retargetTick = 80;
        bot.ai.stuckTicks = 0;
    }

    bot.ai.retargetTick--;

    // Imperfection: 15% chance per second (~0.375% per tick at 40Hz) to wander
    bot.ai.mistakeTimer--;
    if (bot.ai.mistakeTimer <= 0) {
        if (Math.random() < 0.25) {
            // Pick a random passable direction from current cell
            const cell = grid[bCol]?.[bRow];
            if (cell) {
                const dirs = [];
                if (!cell.walls.top) dirs.push({ x: 0, y: -1 });
                if (!cell.walls.right) dirs.push({ x: 1, y: 0 });
                if (!cell.walls.bottom) dirs.push({ x: 0, y: 1 });
                if (!cell.walls.left) dirs.push({ x: -1, y: 0 });
                if (dirs.length > 0) {
                    bot.ai.mistakeDir = dirs[Math.floor(Math.random() * dirs.length)];
                }
            }
            bot.ai.mistakeTimer = 15 + Math.floor(Math.random() * 20); // wander for 15-35 ticks
        } else {
            bot.ai.mistakeDir = null;
            bot.ai.mistakeTimer = 40; // check again in ~1 sec
        }
    }

    // Determine steering target
    let targetX, targetY;

    if (bot.ai.mistakeDir) {
        // Wander in the mistake direction
        targetX = bot.x + bot.ai.mistakeDir.x * gridSize;
        targetY = bot.y + bot.ai.mistakeDir.y * gridSize;
    } else if (bot.ai.path.length > 0 && bot.ai.pathIndex < bot.ai.path.length) {
        const wp = bot.ai.path[bot.ai.pathIndex];
        targetX = (wp.x + 1) * gridSize + gridSize / 2;
        targetY = (wp.y + 1) * gridSize + gridSize / 2;

        // Advance waypoint when close
        const dx = targetX - bot.x, dy = targetY - bot.y;
        if (Math.sqrt(dx * dx + dy * dy) < gridSize * 0.6) {
            bot.ai.pathIndex++;
        }
    } else {
        // Fallback: aim at king zone
        targetX = kz.x;
        targetY = kz.y;
    }

    // Steer toward target
    const dx = targetX - bot.x;
    const dy = targetY - bot.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 1) {
        bot.tilt.x = (dx / dist) * bot.ai.strength;
        bot.tilt.y = -(dy / dist) * bot.ai.strength; // inverted y
    } else {
        bot.tilt.x = 0;
        bot.tilt.y = 0;
    }
}

function updateArenaBotAI(bot, allPlayers, mapData, zoneStates, tickCount) {
    // Find nearest enemy within 60px
    let nearestEnemy = null;
    let nearestEnemyDist = Infinity;
    for (const p of allPlayers) {
        if (p.id === bot.id) continue;
        const dx = p.x - bot.x, dy = p.y - bot.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 40 && d < nearestEnemyDist) {
            nearestEnemy = p;
            nearestEnemyDist = d;
        }
    }

    // Check if bot is in any king zone
    let botInZone = null;
    for (const zs of zoneStates) {
        const dx = bot.x - zs.x, dy = bot.y - zs.y;
        if (Math.sqrt(dx * dx + dy * dy) < zs.radius) {
            botInZone = zs;
            break;
        }
    }

    let targetX, targetY;

    // RAM: if enemy nearby and we're in/near a king zone, ram them
    if (nearestEnemy && botInZone && botInZone.ownerId === bot.id) {
        // Defend: ram enemy out of our zone
        targetX = nearestEnemy.x;
        targetY = nearestEnemy.y;
    } else {
        // SEEK: target best zone
        // Prefer: unowned > enemy-owned > own (to defend)
        let bestZone = null;
        let bestScore = -Infinity;
        for (let i = 0; i < zoneStates.length; i++) {
            const zs = zoneStates[i];
            let score = 0;
            if (!zs.ownerId) score = 100;           // unowned = highest priority
            else if (zs.ownerId !== bot.id) score = 50; // enemy-owned
            else score = 10;                         // own zone (low priority)

            // Distance penalty
            const dx = bot.x - zs.x, dy = bot.y - zs.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            score -= dist * 0.1;

            if (score > bestScore) {
                bestScore = score;
                bestZone = zs;
            }
        }

        if (bestZone) {
            targetX = bestZone.x;
            targetY = bestZone.y;
        } else {
            targetX = mapData.width / 2;
            targetY = mapData.height / 2;
        }

        // If enemy is near and we're close to our target zone, ram them
        if (nearestEnemy && nearestEnemyDist < 25) {
            targetX = nearestEnemy.x;
            targetY = nearestEnemy.y;
        }
    }

    const dx = targetX - bot.x;
    const dy = targetY - bot.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 1) {
        bot.tilt.x = (dx / dist) * bot.ai.strength;
        bot.tilt.y = -(dy / dist) * bot.ai.strength;
    } else {
        // Add slight random jitter when at target
        bot.tilt.x = (Math.random() - 0.5) * 0.3;
        bot.tilt.y = (Math.random() - 0.5) * 0.3;
    }
}

// ─── ULTI FUNCTIONS ────────────────────────────────────

function fireUlti(game, shooterId, ultiType, dx, dy) {
    const shooter = game.allPlayers.find(p => p.id === shooterId);
    if (!shooter || shooter.ultiCooldown > 0 || shooter.frozenTicks > 0) return false;

    const ultiDef = ULTI_TYPES[ultiType];
    if (!ultiDef) return false;

    // Normalize direction
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.01) return false;
    const nx = dx / len, ny = dy / len;

    shooter.ultiCooldown = ULTI_COOLDOWN;



    // Create projectile
    game.projectiles.push({
        id: game.nextProjectileId++,
        type: ultiType,
        ownerId: shooterId,
        ownerColor: shooter.color,
        x: shooter.x,
        y: shooter.y,
        vx: nx * PROJECTILE_SPEED,
        vy: ny * PROJECTILE_SPEED,
        facingAngle: Math.atan2(ny, nx),
        distanceTraveled: 0,
        maxDistance: ultiDef.maxDistance,
    });

    return true;
}

function updateProjectiles(game) {
    const toRemove = [];
    const players = game.allPlayers;

    for (const proj of game.projectiles) {
        // Move
        proj.x += proj.vx;
        proj.y += proj.vy;
        proj.distanceTraveled += PROJECTILE_SPEED;

        // Max distance check
        if (proj.distanceTraveled >= proj.maxDistance) {
            toRemove.push(proj.id);
            continue;
        }

        // Wall collision (including cage walls)
        const allWalls = [...game.mapData.walls, ...game.cageWalls.map(c => ({ x: c.x, y: c.y, width: c.w, height: c.h }))];
        let hitWall = false;
        for (const wall of allWalls) {
            const cx = clamp(proj.x, wall.x, wall.x + wall.width);
            const cy = clamp(proj.y, wall.y, wall.y + wall.height);
            const dx = proj.x - cx, dy = proj.y - cy;
            if (dx * dx + dy * dy < PROJ_WALL_HITBOX * PROJ_WALL_HITBOX) {
                hitWall = true;
                break;
            }
        }

        if (hitWall || proj.distanceTraveled >= proj.maxDistance) {
            if (proj.type === 'vortex') {
                game.vortexes.push({
                    id: `vortex_${game.nextProjectileId++}`,
                    shooterId: proj.ownerId,
                    x: proj.x,
                    y: proj.y,
                    currentRadius: 0,
                    maxRadius: 80,
                    ticksLeft: 140, // 3.5 seconds
                    color: '#6366F1'
                });
            }
            toRemove.push(proj.id);
            continue;
        }

        // Player hit detection
        for (const p of players) {
            if (p.id === proj.ownerId) continue; // Don't hit self
            if (p.frozenTicks && p.frozenTicks > 0 && proj.type === 'freeze') continue; // Don't re-freeze already frozen (optional optimization)

            const dx = p.x - proj.x;
            const dy = p.y - proj.y;
            const distSq = dx * dx + dy * dy;

            // Cone collision check (dist + 45 deg angle)
            if (distSq < (BALL_RADIUS + PROJECTILE_RADIUS) ** 2) {
                const angleToTarget = Math.atan2(dy, dx);
                const angleDiff = Math.abs(angleToTarget - proj.facingAngle);

                let normDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
                normDiff = Math.abs(normDiff);

                if (normDiff <= Math.PI / 4) { // Hit!
                    applyUltiEffect(game, proj.type, p, proj.vx, proj.vy, proj.ownerId, proj.x, proj.y);
                    toRemove.push(proj.id);
                    break; // Hit one target (can remove break if we want AoE to pierce, but let's keep it 1 hit for now)
                }
            }
        }
    }

    game.projectiles = game.projectiles.filter(p => !toRemove.includes(p.id));
}

function applyUltiEffect(game, type, targetPlayer, vx, vy, shooterId, px, py) {
    const dir = Math.sqrt(vx ** 2 + vy ** 2);
    const nx = dir > 0 ? vx / dir : 0;
    const ny = dir > 0 ? vy / dir : 0;

    if (type === 'shockwave') {
        targetPlayer.vx += nx * 22; // Strong push
        targetPlayer.vy += ny * 22;
    } else if (type === 'freeze') {
        // Freeze for 2 seconds (80 ticks)
        targetPlayer.frozenTicks = 80;
        targetPlayer.vx = 0;
        targetPlayer.vy = 0;
    } else if (type === 'cage') {
        // Create 4 walls around target (cage box)
        const cageSize = 50;
        const cx = targetPlayer.x - cageSize / 2;
        const cy = targetPlayer.y - cageSize / 2;
        const cageId = `cage_${game.nextProjectileId++}`;
        const wallThickness = 6;
        const cageTicks = 200; // 5 seconds

        game.cageWalls.push(
            { id: cageId + '_t', x: cx, y: cy, w: cageSize, h: wallThickness, ticksLeft: cageTicks },
            { id: cageId + '_b', x: cx, y: cy + cageSize - wallThickness, w: cageSize, h: wallThickness, ticksLeft: cageTicks },
            { id: cageId + '_l', x: cx, y: cy, w: wallThickness, h: cageSize, ticksLeft: cageTicks },
            { id: cageId + '_r', x: cx + cageSize - wallThickness, y: cy, w: wallThickness, h: cageSize, ticksLeft: cageTicks },
        );
        targetPlayer.vx = 0;
        targetPlayer.vy = 0;
    } else if (type === 'vortex') {
        game.vortexes.push({
            id: `vortex_${game.nextProjectileId++}`,
            shooterId: shooterId,
            x: px,
            y: py,
            currentRadius: 0,
            maxRadius: 80,
            ticksLeft: 140, // 3.5 seconds
            color: '#6366F1'
        });
    }
}

function updateBotUltiAI(game) {
    for (const bot of game.bots) {
        if (bot.ultiCooldown > 0 || bot.frozenTicks > 0) {
            bot.activeAim = null;
            bot.ai.aimingUlti = null;
            continue;
        }

        // If currently aiming, track target and countdown
        if (bot.ai.aimingUlti) {
            const tgt = game.allPlayers.find(p => p.id === bot.ai.aimingUlti.targetId);
            if (!tgt) {
                // Target lost
                bot.activeAim = null;
                bot.ai.aimingUlti = null;
                continue;
            }

            const dx = tgt.x - bot.x;
            const dy = tgt.y - bot.y;
            bot.activeAim = { type: bot.ai.aimingUlti.type, dx, dy };

            bot.ai.aimingUlti.ticks--;
            if (bot.ai.aimingUlti.ticks <= 0) {
                // Fire
                fireUlti(game, bot.id, bot.ai.aimingUlti.type, dx, dy);
                bot.activeAim = null;
                bot.ai.aimingUlti = null;
            }
            continue; // Skip deciding to fire another while aiming
        }

        // Find nearest enemy
        let nearestEnemy = null;
        let nearestDist = Infinity;
        for (const p of game.allPlayers) {
            if (p.id === bot.id) continue;
            const dx = p.x - bot.x, dy = p.y - bot.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < nearestDist) { nearestDist = d; nearestEnemy = p; }
        }

        if (!nearestEnemy) continue;

        // Only use ulti when enemy is within reasonable range
        if (nearestDist > 180) continue;

        // Random chance to aim (don't spam, ~3% per tick)
        if (Math.random() > 0.03) continue;

        // Pick a random ulti type
        const types = ['shockwave', 'freeze', 'cage', 'vortex'];
        const chosen = types[Math.floor(Math.random() * types.length)];

        // Start aiming for 10-20 ticks (0.25 - 0.5s reaction time / warning)
        bot.ai.aimingUlti = {
            targetId: nearestEnemy.id,
            type: chosen,
            ticks: 10 + Math.floor(Math.random() * 10)
        };
        bot.activeAim = { type: chosen, dx: nearestEnemy.x - bot.x, dy: nearestEnemy.y - bot.y };
    }
}

// ─── OFFLINE GAME SESSION ──────────────────────────────

function createOfflineGame(gameMode, playerNick) {
    const mapGen = gameMode === 'labyrinth' ? generateLabyrinthMap : generateArenaMap;
    const mapData = mapGen();

    const spawns = [
        { x: 80, y: 80 },
        { x: mapData.width - 80, y: 80 },
        { x: 80, y: mapData.height - 80 },
        { x: mapData.width - 80, y: mapData.height - 80 },
    ];

    // Human player (id = 1)
    const humanPlayer = {
        id: 1, nick: playerNick || 'Sen', color: COLORS[0],
        isBot: false, isHost: true, ready: true,
        score: 0, x: spawns[0].x, y: spawns[0].y,
        vx: 0, vy: 0, tilt: { x: 0, y: 0 },
        ultiCooldown: 0, frozenTicks: 0,
    };

    // 3 bots
    const bots = [];
    for (let i = 0; i < 3; i++) {
        const bot = {
            id: 1000 + i, nick: BOT_NAMES[i], color: COLORS[i + 1],
            isBot: true, isHost: false, ready: true,
            score: 0, x: spawns[i + 1].x, y: spawns[i + 1].y,
            vx: 0, vy: 0, tilt: { x: 0, y: 0 }, ai: null,
            ultiCooldown: 0, frozenTicks: 0,
        };
        initBotState(bot, mapData, gameMode);
        bots.push(bot);
    }

    const allPlayers = [humanPlayer, ...bots];

    const zoneStates = mapData.kingZones.map((kz, idx) => ({
        id: idx, name: kz.name || `Bölge ${idx + 1}`,
        x: kz.x, y: kz.y, radius: kz.radius,
        ownerId: null, ownerColor: null, ownerNick: null,
        captureProgress: {},
    }));

    return {
        gameMode,
        mapData,
        allPlayers,
        humanPlayer,
        bots,
        zoneStates,
        ticksLeft: 180 * 40, // 180 seconds
        tickCount: 0,
        projectiles: [],   // active ulti projectiles
        vortexes: [],      // active vortexes
        cageWalls: [],     // temporary cage walls [{x,y,w,h,ticksLeft,id}]
        nextProjectileId: 1,
    };
}

function tickOfflineGame(game) {
    game.tickCount++;
    game.ticksLeft--;

    // Update bot AI (sets each bot's tilt)
    updateBotAI(game.bots, game.allPlayers, game.mapData, game.zoneStates, game.gameMode, game.tickCount);

    // Bot ulti AI (arena only)
    if (game.gameMode === 'arena') {
        updateBotUltiAI(game);
    }

    // Apply freeze effect: frozen players can't move
    for (const p of game.allPlayers) {
        if (p.frozenTicks > 0) {
            p.tilt = { x: 0, y: 0 };
            p.frozenTicks--;
        }
        if (p.ultiCooldown > 0) p.ultiCooldown--;
    }

    // Physics (includes cage walls as temporary obstacles)
    const allWalls = [...game.mapData.walls, ...game.cageWalls.map(c => ({ x: c.x, y: c.y, width: c.w, height: c.h, id: c.id }))];
    updatePhysics(game.allPlayers, allWalls, game.gameMode, game.vortexes);

    // Update projectiles
    updateProjectiles(game);

    // Filter expired effects
    game.cageWalls = game.cageWalls.filter(c => c.ticksLeft > 0);
    game.vortexes = game.vortexes.filter(v => v.ticksLeft > 0);

    // Update cage wall timers
    for (const cage of game.cageWalls) cage.ticksLeft--;
    game.cageWalls = game.cageWalls.filter(c => c.ticksLeft > 0);

    // Zone ownership
    updateZoneOwnership(game.allPlayers, game.zoneStates);

    // Build sync-like state
    const playersState = {};
    const activeAimsPacked = {};
    for (const p of game.allPlayers) {
        playersState[p.id] = { x: p.x, y: p.y, score: p.score, frozenTicks: p.frozenTicks };
        if (p.activeAim) activeAimsPacked[p.id] = p.activeAim;
    }

    const timeLeft = Math.ceil(game.ticksLeft / 40);

    let winner = null;
    if (game.ticksLeft <= 0) {
        let maxScore = -1;
        for (const p of game.allPlayers) {
            if (p.score > maxScore) { maxScore = p.score; winner = p.nick; }
        }
    }

    return {
        playersState, timeLeft, isOver: game.ticksLeft <= 0, winner,
        projectiles: game.projectiles,
        vortexes: game.vortexes,
        cageWalls: game.cageWalls,
        activeAims: activeAimsPacked,
    };
}

export {
    createOfflineGame,
    tickOfflineGame,
    fireUlti,
    BALL_RADIUS,
    COLORS,
    ULTI_TYPES,
    ULTI_COOLDOWN,
};
