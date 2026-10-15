"use strict";
    // ============================================================================
    // 4. GAME SIMULATION & OBJECT POOLS (FIXED TIMESTEP, ZERO GC ALLOCATIONS)
    // ============================================================================
    const MAX_INSTANCES      = 1024;
    const FLOATS_PER_INST    = 24; // 16 (mat4) + 4 (colorTint) + 4 (extraParams) = 96 bytes
    const MAX_PROJECTILES    = 240;
    const MAX_MISSILES       = 16;
    const MAX_DRONES         = 10;
    const ACTIVE_ENEMY_CAP   = 5;  // Spacious, tactical enemy cap on screen
    const ALLIED_SWARM_COUNT = 6;  // 6 wingman swarm drones deployed on 'E'
    const MAX_PARTICLES      = 280;
    const MAX_SPEEDLINES     = 45;
    const TERRAIN_SLICES     = 8;
    const TERRAIN_DEPTH      = 60.0;

    const MAX_JET_HEALTH      = 100;
    const MAX_HEAVY_GUNSHIPS  = 3;
    const ENEMY_BULLET_SPEED  = 128.0;
    const ENEMY_BULLET_DAMAGE = 4;
    const RECON_CRASH_DAMAGE  = 10;
    const HEAVY_CRASH_DAMAGE  = 20;

    class SkystrikeSimulation {
      constructor() {
        this.reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        // UI DOM references
        this.scoreEl       = document.getElementById('score-val');
        this.targetsEl     = document.getElementById('targets-val');
        this.swarmEl       = document.getElementById('swarm-val');
        this.mothershipEl  = document.getElementById('mothership-val');
        this.pipperEl      = document.getElementById('aim-pipper');
        this.lockDiamondEl = document.getElementById('lock-diamond');
        this.pauseBtn      = document.getElementById('pause-btn');
        this.pauseBanner   = document.getElementById('pause-banner');
        this.hpTrackerEl   = document.getElementById('hp-tracker');
        this.hpFillEl      = document.getElementById('hp-fill');
        this.hpValueEl     = document.getElementById('hp-value');
        this.gameOverEl    = document.getElementById('gameover-overlay');
        this.gameOverScoreEl   = document.getElementById('gameover-score');
        this.gameOverTargetsEl = document.getElementById('gameover-targets');
        this.gameOverRestartEl = document.getElementById('gameover-restart-btn');

        // Input state
        this.keys = { left: false, right: false, up: false, down: false, fire: false, missile: false, swarm: false };
        this.touchInput = { x: 0, y: 0, active: false, fire: false, missile: false, swarm: false };

        // Pre-allocate object pools
        this.projectiles = Array.from({ length: MAX_PROJECTILES }, () => ({
          active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
          pitch: 0, yaw: 0, life: 0, r: 1.0, g: 0.85, b: 0.45, isSwarm: false, isEnemy: false
        }));

        this.missiles = Array.from({ length: MAX_MISSILES }, () => ({
          active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
          yaw: 0, pitch: 0, roll: 0, speed: 0, life: 0, targetIdx: -1, trailTimer: 0
        }));

        this.drones = Array.from({ length: MAX_DRONES }, () => ({
          active: false, enemyType: 0, x: 0, y: 0, z: 0, baseX: 0, baseY: 0,
          spawnX: 0, spawnY: 0, launchBlend: 0, stationZ: 0,
          vx: 0, vy: 0, vz: 0, phase: 0, spin: 0, bankAngle: 0,
          fireTimer: 0, muzzleFlash: 0, hp: 2, maxHp: 2, hitFlash: 0
        }));

        this.swarmDrones = Array.from({ length: ALLIED_SWARM_COUNT }, (_, idx) => ({
          active: false, slotIdx: idx, x: 0, y: 0, z: 0,
          yaw: 0, pitch: 0, roll: 0, fireTimer: 0, muzzleFlash: 0
        }));

        this.particles = Array.from({ length: MAX_PARTICLES }, () => ({
          active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
          r: 1, g: 0.5, b: 0.1, scale: 1, life: 0, maxLife: 1, rot: 0
        }));

        this.speedLines = Array.from({ length: MAX_SPEEDLINES }, () => ({
          x: 0, y: 0, z: 0, len: 1
        }));

        // Pre-allocate CPU staging arrays for GPU upload
        this.instanceBufferData = new Float32Array(MAX_INSTANCES * FLOATS_PER_INST);
        this.sceneUniformData   = new Float32Array(64); // 256 bytes
        this.matView     = createMat4();
        this.matProj     = createMat4();
        this.matViewProj = createMat4();
        this.matInvVP    = createMat4();
        this.tempVec3A   = new Float32Array(3);
        this.tempVec3B   = new Float32Array(3);

        this.reset();
      }

      clearInputState() {
        this.keys.left = false;
        this.keys.right = false;
        this.keys.up = false;
        this.keys.down = false;
        this.keys.fire = false;
        this.keys.missile = false;
        this.keys.swarm = false;
        this.touchInput.x = 0;
        this.touchInput.y = 0;
        this.touchInput.active = false;
        this.touchInput.fire = false;
        this.touchInput.missile = false;
        this.touchInput.swarm = false;
      }

      reset() {
        this.paused = false;
        this.gameOver = false;
        this.clearInputState();
        this.time = 0;
        this.score = 0;
        this.targetsDestroyed = 0;
        this.terrainScrollZ = 0;
        this.enemySpawnTimer = 0.8;
        this.swarmSpawnCounter = 0;

        // Aircraft state (centered near X=0, Y=1.5, Z=0 in local render space while world streams past)
        this.jet = {
          x: 0,
          y: 1.5,
          z: 0,
          vx: 0,
          vy: 0,
          yaw: 0,
          pitch: 0,
          roll: 0,
          health: MAX_JET_HEALTH,
          maxHealth: MAX_JET_HEALTH,
          fireCooldown: 0,
          missileCooldown: 0,
          swarmTimer: 0,
          swarmCooldown: 0,
          swarmTriggerCooldown: 0,
          pylonToggle: 1,
          lockedDroneIdx: -1,
          muzzleFlashTimer: 0,
          gunBarrelToggle: 0,
          hullFlash: 0
        };

        // Smooth camera state
        this.cam = {
          x: 0,
          y: 3.9,
          z: 12.8,
          lookX: 0,
          lookY: 1.2,
          lookZ: -30.0,
          roll: 0,
          shake: 0
        };

        // Clear pools
        for (const p of this.projectiles) {
          p.active = false;
          p.isEnemy = false;
        }
        for (const m of this.missiles) m.active = false;
        for (const pt of this.particles) pt.active = false;
        for (const d of this.drones) d.active = false;
        for (const sd of this.swarmDrones) {
          sd.active = false;
          sd.muzzleFlash = 0;
        }

        for (const d of this.drones) {
          d.muzzleFlash = 0;
          d.fireTimer = 0;
        }

        if (this.lockDiamondEl) this.lockDiamondEl.classList.remove('active');

        // Initialize Enemy Mothership Flagship ahead in the flight corridor
        this.mothership = {
          active: true,
          x: 0.0,
          y: 6.2,
          z: -215.0,
          targetZ: -185.0,
          roll: 0.0,
          pitch: 0.04,
          phase: 0.0,
          hp: 65,
          maxHp: 65,
          hitFlash: 0.0,
          bayFlashLeft: 0.0,
          bayFlashRight: 0.0,
          nextBaySide: -1,
          respawnTimer: 0.0
        };

        // Seed 3 initial enemies launching directly from the Mothership hangar bays
        for (let i = 0; i < 3; i++) {
          this.spawnDroneFromMothership(i * 0.35);
        }

        // Seed speed lines
        for (let i = 0; i < MAX_SPEEDLINES; i++) {
          this.initSpeedLine(this.speedLines[i], -Math.random() * 140);
        }

        this.updateHUD();
        this.hideGameOver();
        this.updateHealthBar();
        this.syncPauseUI();
      }

      initSpeedLine(s, zPos) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 6.5 + Math.random() * 24.0;
        s.x = this.jet.x + Math.cos(angle) * radius;
        s.y = this.jet.y + Math.sin(angle) * radius * 0.7;
        s.z = zPos;
        s.len = 2.5 + Math.random() * 4.5;
      }

      // Spawn an enemy Recon Drone or Heavy Gunship directly out of the Mothership's Hangar Bays
      spawnDroneFromMothership(forwardAdvanceFactor = 0.0) {
        const ms = this.mothership;
        if (!ms || !ms.active) return;

        let freeIdx = -1;
        let heavyGunshipCount = 0;
        for (let i = 0; i < MAX_DRONES; i++) {
          const drone = this.drones[i];
          if (!drone.active) {
            if (freeIdx === -1) freeIdx = i;
            continue;
          }
          if (drone.enemyType === 1) heavyGunshipCount++;
        }
        if (freeIdx === -1) return;

        const d = this.drones[freeIdx];
        d.active = true;
        this.swarmSpawnCounter++;
        const isHeavy = heavyGunshipCount < MAX_HEAVY_GUNSHIPS
          && ((this.swarmSpawnCounter % 4 === 0) || (Math.random() < 0.25));
        d.enemyType = isHeavy ? 1 : 0;

        // Alternate between left (-1) and right (+1) Mothership Hangar Launch Bays
        const baySide = ms.nextBaySide;
        ms.nextBaySide = -baySide;
        if (baySide < 0) {
          ms.bayFlashLeft = 1.0;
        } else {
          ms.bayFlashRight = 1.0;
        }

        // World coordinates of the Mothership's Hangar Bay portal
        const bayWorldX = ms.x + baySide * 8.2 * Math.cos(ms.roll);
        const bayWorldY = ms.y - 1.15 + baySide * 8.2 * Math.sin(ms.roll);
        const bayWorldZ = ms.z + 6.5 + forwardAdvanceFactor * 45.0;

        d.spawnX = bayWorldX;
        d.spawnY = bayWorldY;
        d.baseX = (Math.random() * 2 - 1) * 15.5;
        d.baseY = -3.2 + Math.random() * 11.5;

        // Start right inside the hangar launch bay and blend smoothly toward patrol lane
        d.launchBlend = Math.max(0.0, 1.0 - forwardAdvanceFactor);
        d.x = d.spawnX;
        d.y = d.spawnY;
        d.z = bayWorldZ;
        d.vz = isHeavy ? (31.0 + Math.random() * 9.0) : (38.0 + Math.random() * 12.0);
        d.phase = Math.random() * Math.PI * 2;
        d.spin = 0;
        d.bankAngle = 0;
        d.stationZ = isHeavy ? (-88.0 - Math.random() * 46.0) : 0.0;
        d.fireTimer = isHeavy ? 1.2 + Math.random() * 1.0 : 0.0;
        d.muzzleFlash = 0;
        d.maxHp = isHeavy ? 6 : 1;
        d.hp = d.maxHp;
        d.hitFlash = 0.35; // Brief ignition glow on launch

        // Emit orange/crimson launch catapult sparks at the hangar mouth
        for (let k = 0; k < 6; k++) {
          this.spawnTrailParticle(
            bayWorldX + (Math.random() - 0.5) * 1.2,
            bayWorldY + (Math.random() - 0.5) * 1.2,
            bayWorldZ + 1.0,
            baySide * (2.0 + Math.random() * 4.0),
            -1.5 + (Math.random() - 0.5) * 3.0,
            22.0,
            1.0, 0.45, 0.15, 0.52, 0.30
          );
        }
      }

      // Deploy or refresh the 6 Allied Swarm Mini-Drones (Press E)
      deployAlliedSwarm() {
        const j = this.jet;
        if (j.swarmTimer > 0 || j.swarmCooldown > 0) return;
        j.swarmTimer = 10.0; // 10 seconds of continuous autonomous barrage
        j.swarmTriggerCooldown = 0.45;

        for (let i = 0; i < ALLIED_SWARM_COUNT; i++) {
          const sd = this.swarmDrones[i];
          if (!sd.active) {
            sd.active = true;
            sd.x = j.x + (i % 2 === 0 ? -1.8 : 1.8);
            sd.y = j.y - 0.3;
            sd.z = j.z + 1.2;
            sd.yaw = j.yaw;
            sd.pitch = j.pitch;
            sd.roll = j.roll;
          }
          // Stagger initial firing timers so the 6 drones unleash a continuous stream of bullets
          sd.fireTimer = (i / ALLIED_SWARM_COUNT) * 0.11;
          sd.muzzleFlash = 0.08;

          // Cyan energy deployment burst around each wingman drone
          this.spawnTrailParticle(
            sd.x, sd.y, sd.z,
            (Math.random() - 0.5) * 8.0, (Math.random() - 0.5) * 8.0, 10.0,
            0.2, 0.92, 1.0, 0.55, 0.28
          );
        }
        this.updateHUD();
      }

      // Fire a high-velocity tracer bolt from an Allied Swarm Drone toward a locked enemy target
      fireSwarmDroneBullet(sd, targetDrone) {
        let dirX = 0, dirY = 0, dirZ = -1;
        const bulletSpeed = 215.0;

        if (targetDrone && targetDrone.active) {
          const dist = Math.hypot(targetDrone.x - sd.x, targetDrone.y - sd.y, targetDrone.z - sd.z) || 1.0;
          const leadTime = dist / bulletSpeed;
          // Lead target position slightly and add subtle tactical spread for a rain-of-bullets effect
          const aimX = targetDrone.x + (Math.random() - 0.5) * 1.1;
          const aimY = targetDrone.y + (Math.random() - 0.5) * 1.1;
          const aimZ = targetDrone.z + targetDrone.vz * leadTime * 0.65;

          const dx = aimX - sd.x;
          const dy = aimY - sd.y;
          const dz = aimZ - sd.z;
          const len = Math.hypot(dx, dy, dz) || 1.0;
          dirX = dx / len;
          dirY = dy / len;
          dirZ = dz / len;
        } else {
          // Converged forward barrage ahead of the aircraft when no enemy is in range
          const cp = Math.cos(this.jet.pitch), sp = Math.sin(this.jet.pitch);
          const cy = Math.cos(this.jet.yaw),   sy = Math.sin(this.jet.yaw);
          dirX = -sy * cp + (Math.random() - 0.5) * 0.04;
          dirY = sp + (Math.random() - 0.5) * 0.04;
          dirZ = -cy * cp;
          const len = Math.hypot(dirX, dirY, dirZ) || 1.0;
          dirX /= len; dirY /= len; dirZ /= len;
        }

        const yaw = Math.atan2(-dirX, -dirZ);
        const pitch = Math.asin(Math.max(-0.99, Math.min(0.99, dirY)));
        sd.yaw = yaw;
        sd.pitch = pitch;
        sd.muzzleFlash = 0.045;

        for (let i = 0; i < MAX_PROJECTILES; i++) {
          const p = this.projectiles[i];
          if (!p.active) {
            p.active = true;
            p.x = sd.x + dirX * 1.35;
            p.y = sd.y + dirY * 1.35;
            p.z = sd.z + dirZ * 1.35;
            p.vx = dirX * bulletSpeed;
            p.vy = dirY * bulletSpeed;
            p.vz = dirZ * bulletSpeed;
            p.yaw = yaw;
            p.pitch = pitch;
            p.life = 1.45;
            // Alternate cyan-electric and hot gold tracer bolts for visual clarity
            if ((sd.slotIdx & 1) === 0) {
              p.r = 0.25; p.g = 0.95; p.b = 1.00;
            } else {
              p.r = 1.00; p.g = 0.88; p.b = 0.35;
            }
            p.isSwarm = true;
            p.isEnemy = false;
            break;
          }
        }
      }

      // Fire a twin-barrel crimson bolt salvo from a Heavy Gunship holding station
      fireHeavyGunship(gunship) {
        const j = this.jet;

        for (const side of [-1, 1]) {
          transformAircraftPoint(
            1.65 * side, -0.08, -2.35,
            gunship.x, gunship.y, gunship.z,
            0, 0.05, gunship.bankAngle,
            this.tempVec3B
          );

          const muzzleX = this.tempVec3B[0];
          const muzzleY = this.tempVec3B[1];
          const muzzleZ = this.tempVec3B[2];

          const distToJet = Math.hypot(j.x - muzzleX, j.y - muzzleY, j.z - muzzleZ) || 1.0;
          const leadTime = distToJet / ENEMY_BULLET_SPEED;

          let dirX = j.x + j.vx * leadTime + (Math.random() - 0.5) * 6.8 - muzzleX;
          let dirY = j.y + j.vy * leadTime + (Math.random() - 0.5) * 6.8 - muzzleY;
          let dirZ = j.z - muzzleZ;
          const dirLen = Math.hypot(dirX, dirY, dirZ) || 1.0;
          dirX /= dirLen;
          dirY /= dirLen;
          dirZ /= dirLen;

          for (let i = 0; i < MAX_PROJECTILES; i++) {
            const p = this.projectiles[i];
            if (!p.active) {
              p.active = true;
              p.isSwarm = false;
              p.isEnemy = true;
              p.x = muzzleX;
              p.y = muzzleY;
              p.z = muzzleZ;
              p.vx = dirX * ENEMY_BULLET_SPEED;
              p.vy = dirY * ENEMY_BULLET_SPEED;
              p.vz = dirZ * ENEMY_BULLET_SPEED;
              p.pitch = Math.asin(Math.max(-0.99, Math.min(0.99, dirY)));
              p.yaw = Math.atan2(-dirX, -dirZ);
              p.life = 1.9;
              p.r = 1.00;
              p.g = 0.22;
              p.b = 0.34;
              break;
            }
          }
        }

        gunship.muzzleFlash = 0.11;
      }

      spawnExplosion(x, y, z, count, scaleMul = 1.0) {
        let spawned = 0;
        for (let i = 0; i < MAX_PARTICLES && spawned < count; i++) {
          const pt = this.particles[i];
          if (!pt.active) {
            pt.active = true;
            pt.x = x + (Math.random() - 0.5) * 0.6;
            pt.y = y + (Math.random() - 0.5) * 0.6;
            pt.z = z + (Math.random() - 0.5) * 0.6;

            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const spd = (6.0 + Math.random() * 26.0) * scaleMul;
            pt.vx = Math.sin(phi) * Math.cos(theta) * spd;
            pt.vy = Math.sin(phi) * Math.sin(theta) * spd;
            pt.vz = Math.cos(phi) * spd + 18.0; // Carry slightly with world flow

            // Mix of hot white-yellow core sparks, bright orange fire, and dark debris
            const paletteRoll = Math.random();
            if (paletteRoll < 0.45) {
              pt.r = 1.0; pt.g = 0.85; pt.b = 0.35;
            } else if (paletteRoll < 0.85) {
              pt.r = 1.0; pt.g = 0.38; pt.b = 0.08;
            } else {
              pt.r = 0.55; pt.g = 0.62; pt.b = 0.72;
            }

            pt.scale = (0.28 + Math.random() * 0.55) * scaleMul;
            pt.maxLife = 0.28 + Math.random() * 0.38;
            pt.life = pt.maxLife;
            pt.rot = Math.random() * 6.28;
            spawned++;
          }
        }
      }

      fireProjectiles() {
        const j = this.jet;
        // Forward aim unit vector from aircraft yaw & pitch
        const cp = Math.cos(j.pitch), sp = Math.sin(j.pitch);
        const cy = Math.cos(j.yaw),   sy = Math.sin(j.yaw);
        const dirX = -sy * cp;
        const dirY = sp;
        const dirZ = -cy * cp;

        const bulletSpeed = 195.0;

        // Spawn twin cannon bolts from left & right wing-root gun ports
        for (const side of [-1, 1]) {
          transformAircraftPoint(
            1.28 * side, -0.08, -2.25,
            j.x, j.y, j.z,
            j.yaw, j.pitch, j.roll,
            this.tempVec3A
          );

          for (let i = 0; i < MAX_PROJECTILES; i++) {
            const p = this.projectiles[i];
            if (!p.active) {
              p.active = true;
              p.x = this.tempVec3A[0];
              p.y = this.tempVec3A[1];
              p.z = this.tempVec3A[2];
              p.vx = dirX * bulletSpeed + j.vx * 0.18;
              p.vy = dirY * bulletSpeed + j.vy * 0.18;
              p.vz = dirZ * bulletSpeed;
              p.yaw = j.yaw;
              p.pitch = j.pitch;
              p.life = 1.45; // Removes cleanly after ~280 units
              p.r = 1.0;
              p.g = 0.85;
              p.b = 0.45;
              p.isSwarm = false;
              p.isEnemy = false;
              break;
            }
          }
        }

        j.muzzleFlashTimer = 0.055;
      }

      // Scan active drones ahead of a given origin & forward vector to find best lock-on target
      findBestTarget(ox, oy, oz, dirX, dirY, dirZ) {
        let bestIdx = -1;
        let bestScore = Infinity;

        for (let i = 0; i < MAX_DRONES; i++) {
          const d = this.drones[i];
          if (!d.active) continue;
          // Target must be ahead of origin
          if (d.z > oz - 6.0 || d.z < -295.0) continue;

          const dx = d.x - ox;
          const dy = d.y - oy;
          const dz = d.z - oz;
          const dist = Math.hypot(dx, dy, dz);
          if (dist < 1.0) continue;

          const dot = (dx * dirX + dy * dirY + dz * dirZ) / dist;
          // Require target within forward 65-degree acquisition cone
          if (dot < 0.42) continue;

          // Score favors targets close to the boresight centerline and at medium-close range
          const anglePenalty = (1.0 - dot) * 180.0;
          const score = dist * 0.55 + anglePenalty;
          if (score < bestScore) {
            bestScore = score;
            bestIdx = i;
          }
        }

        // If no small drone is inside the immediate cone, allow locking onto the Mothership Flagship
        if (bestIdx === -1 && this.mothership && this.mothership.active) {
          const ms = this.mothership;
          const dx = ms.x - ox;
          const dy = ms.y - oy;
          const dz = ms.z - oz;
          const dist = Math.hypot(dx, dy, dz) || 1.0;
          const dot = (dx * dirX + dy * dirY + dz * dirZ) / dist;
          if (dot > 0.35) {
            return 999; // Special lock index 999 = Enemy Mothership
          }
        }
        return bestIdx;
      }

      // Spawn a single trail puff/spark particle at a specific 3D coordinate
      spawnTrailParticle(x, y, z, vx, vy, vz, r, g, b, scale, life) {
        for (let i = 0; i < MAX_PARTICLES; i++) {
          const pt = this.particles[i];
          if (!pt.active) {
            pt.active = true;
            pt.x = x + (Math.random() - 0.5) * 0.18;
            pt.y = y + (Math.random() - 0.5) * 0.18;
            pt.z = z + (Math.random() - 0.5) * 0.18;
            pt.vx = vx + (Math.random() - 0.5) * 2.2;
            pt.vy = vy + (Math.random() - 0.5) * 2.2;
            pt.vz = vz + 26.0;
            pt.r = r;
            pt.g = g;
            pt.b = b;
            pt.scale = scale;
            pt.maxLife = life;
            pt.life = life;
            pt.rot = Math.random() * 6.28;
            return;
          }
        }
      }

      // Launch a 3D Homing Missile from alternating underwing weapon pylons (KeyQ / Mobile Button)
      launchHomingMissile() {
        const j = this.jet;
        const side = j.pylonToggle;
        j.pylonToggle = -side;

        transformAircraftPoint(
          2.55 * side, -0.32, -0.45,
          j.x, j.y, j.z,
          j.yaw, j.pitch, j.roll,
          this.tempVec3A
        );

        const cp = Math.cos(j.pitch), sp = Math.sin(j.pitch);
        const cy = Math.cos(j.yaw),   sy = Math.sin(j.yaw);
        const dirX = -sy * cp;
        const dirY = sp;
        const dirZ = -cy * cp;

        for (let i = 0; i < MAX_MISSILES; i++) {
          const m = this.missiles[i];
          if (!m.active) {
            m.active = true;
            m.x = this.tempVec3A[0];
            m.y = this.tempVec3A[1];
            m.z = this.tempVec3A[2];
            m.speed = 92.0;
            // Initial launch velocity with slight outward/downward pylon separation impulse
            m.vx = dirX * m.speed + j.vx * 0.35 + side * 2.5;
            m.vy = dirY * m.speed + j.vy * 0.35 - 2.0;
            m.vz = dirZ * m.speed;
            m.yaw = j.yaw;
            m.pitch = j.pitch;
            m.roll = j.roll;
            m.life = 3.2;
            m.trailTimer = 0;

            // Lock onto currently tracked target or scan ahead
            m.targetIdx = j.lockedDroneIdx >= 0
              ? j.lockedDroneIdx
              : this.findBestTarget(m.x, m.y, m.z, dirX, dirY, dirZ);

            // Ignition flash & launch puff at the pylon
            j.muzzleFlashTimer = 0.085;
            for (let k = 0; k < 6; k++) {
              this.spawnTrailParticle(
                m.x, m.y, m.z + 0.8,
                (Math.random() - 0.5) * 6.0, (Math.random() - 0.5) * 6.0, 12.0,
                1.0, 0.72, 0.32, 0.42, 0.22
              );
            }
            break;
          }
        }
      }

      togglePause() {
        if (this.gameOver) return;
        this.paused = !this.paused;
        this.syncPauseUI();
      }

      syncPauseUI() {
        if (this.paused) {
          this.pauseBtn.textContent = 'RESUME';
          this.pauseBtn.classList.add('paused-state');
          this.pauseBanner.classList.add('visible');
        } else {
          this.pauseBtn.textContent = 'PAUSE';
          this.pauseBtn.classList.remove('paused-state');
          this.pauseBanner.classList.remove('visible');
        }
      }

      updateHUD() {
        if (this.scoreEl)   this.scoreEl.textContent   = String(this.score).padStart(5, '0');
        if (this.targetsEl) this.targetsEl.textContent = String(this.targetsDestroyed).padStart(3, '0');
        if (this.swarmEl) {
          if (this.jet && this.jet.swarmTimer > 0) {
            this.swarmEl.textContent = `ACT ${this.jet.swarmTimer.toFixed(1)}S`;
          } else if (this.jet && this.jet.swarmCooldown > 0) {
            this.swarmEl.textContent = `CD ${this.jet.swarmCooldown.toFixed(1)}S`;
          } else {
            this.swarmEl.textContent = 'READY';
          }
        }
        if (this.mothershipEl && this.mothership) {
          if (this.mothership.active) {
            const pct = Math.max(0, Math.ceil((this.mothership.hp / this.mothership.maxHp) * 100));
            this.mothershipEl.textContent = `${pct}%`;
          } else {
            this.mothershipEl.textContent = `WARP ${this.mothership.respawnTimer.toFixed(1)}S`;
          }
        }
      }

      updateHealthBar() {
        if (!this.hpTrackerEl) return;

        const j = this.jet;
        const ratio = j.maxHealth > 0 ? Math.max(0, Math.min(1, j.health / j.maxHealth)) : 0;
        const percent = Math.round(ratio * 100);

        if (this.hpFillEl) {
          this.hpFillEl.style.transform = `scaleX(${ratio.toFixed(4)})`;
          this.hpFillEl.classList.toggle('is-warning', ratio <= 0.6 && ratio > 0.28);
          this.hpFillEl.classList.toggle('is-critical', ratio <= 0.28);
        }
        if (this.hpValueEl) this.hpValueEl.textContent = `${percent}%`;
        this.hpTrackerEl.setAttribute('aria-valuenow', String(percent));
      }

      applyJetDamage(amount, hitX, hitY, hitZ, impactScale) {
        if (this.gameOver) return;

        const j = this.jet;
        j.health = Math.max(0, j.health - amount);
        j.hullFlash = 1.0;
        if (!this.reducedMotion) {
          this.cam.shake = Math.min(0.65, this.cam.shake + impactScale * 0.4);
        }

        this.spawnExplosion(hitX, hitY, hitZ, Math.round(30 * impactScale), impactScale);
        this.updateHealthBar();

        if (j.health <= 0) this.triggerGameOver();
      }

      triggerGameOver() {
        if (this.gameOver) return;
        this.gameOver = true;

        const j = this.jet;
        j.health = 0;
        j.swarmTimer = 0;
        j.muzzleFlashTimer = 0;
        j.lockedDroneIdx = -1;

        this.clearInputState();
        this.pipperEl?.classList.remove('firing');

        for (const p of this.projectiles) p.active = false;
        for (const m of this.missiles) m.active = false;
        for (const sd of this.swarmDrones) sd.active = false;

        this.spawnExplosion(j.x, j.y, j.z, 60, 2.3);
        this.spawnExplosion(j.x + 2.6, j.y - 0.5, j.z + 1.2, 30, 1.5);
        this.spawnExplosion(j.x - 2.6, j.y - 0.5, j.z + 1.2, 30, 1.5);
        if (!this.reducedMotion) this.cam.shake = 0.95;

        if (this.lockDiamondEl) this.lockDiamondEl.classList.remove('active');

        this.updateHUD();
        this.updateHealthBar();
        this.showGameOver();
      }

      showGameOver() {
        if (!this.gameOverEl) return;
        if (this.gameOverScoreEl) this.gameOverScoreEl.textContent = String(this.score).padStart(5, '0');
        if (this.gameOverTargetsEl) this.gameOverTargetsEl.textContent = String(this.targetsDestroyed).padStart(3, '0');
        this.gameOverEl.classList.add('visible');
        this.gameOverRestartEl?.focus();
      }

      hideGameOver() {
        if (this.gameOverEl) this.gameOverEl.classList.remove('visible');
      }

      // Fixed-timestep simulation update (dt = 1/60s)
      step(dt) {
        if (this.paused) return;

        this.time += dt;
        const j = this.jet;

        if (!this.gameOver) {
          // 1. Gather steering input (Keyboard + Mobile Touch Stick)
          let steerX = 0;
          let steerY = 0;
          if (this.keys.left)  steerX -= 1;
          if (this.keys.right) steerX += 1;
          if (this.keys.up)    steerY += 1;
          if (this.keys.down)  steerY -= 1;

          if (this.touchInput.active) {
            steerX += this.touchInput.x;
            steerY += this.touchInput.y;
          }
          steerX = Math.max(-1, Math.min(1, steerX));
          steerY = Math.max(-1, Math.min(1, steerY));

          // 2. Arcade aircraft movement, natural banking, and smooth return to level flight
          const maxSpeedX = 22.0;
          const maxSpeedY = 16.5;
          const targetVx = steerX * maxSpeedX;
          const targetVy = steerY * maxSpeedY;

          const velLerp = 1.0 - Math.exp(-10.5 * dt);
          j.vx += (targetVx - j.vx) * velLerp;
          j.vy += (targetVy - j.vy) * velLerp;

          j.x += j.vx * dt;
          j.y += j.vy * dt;

          // Soft flight corridor boundaries
          const boundX = 18.0;
          const minY = -5.2;
          const maxY = 11.5;
          if (j.x > boundX)  { j.x = boundX;  j.vx *= 0.5; }
          if (j.x < -boundX) { j.x = -boundX; j.vx *= 0.5; }
          if (j.y > maxY)    { j.y = maxY;    j.vy *= 0.5; }
          if (j.y < minY)    { j.y = minY;    j.vy *= 0.5; }

          // Bank (roll) naturally into turns, pitch with climb/dive, yaw slightly into turn
          const targetRoll  = -steerX * 0.88 - (j.vx / maxSpeedX) * 0.22;
          const targetPitch =  steerY * 0.40 + (j.vy / maxSpeedY) * 0.12;
          const targetYaw   = -steerX * 0.20;

          const rotLerp = 1.0 - Math.exp(-9.5 * dt);
          j.roll  += (targetRoll  - j.roll)  * rotLerp;
          j.pitch += (targetPitch - j.pitch) * rotLerp;
          j.yaw   += (targetYaw   - j.yaw)   * rotLerp;
        }

        if (j.hullFlash > 0) j.hullFlash = Math.max(0, j.hullFlash - dt * 3.5);

        // 3. Smooth third-person follow camera behind & slightly above aircraft
        const camFollowLerp = 1.0 - Math.exp(-7.5 * dt);
        const targetCamX = j.x * 0.76;
        const targetCamY = j.y * 0.72 + 2.55;
        const targetCamZ = 12.6;

        this.cam.x += (targetCamX - this.cam.x) * camFollowLerp;
        this.cam.y += (targetCamY - this.cam.y) * camFollowLerp;
        this.cam.z += (targetCamZ - this.cam.z) * camFollowLerp;

        const targetLookX = j.x * 0.92 - Math.sin(j.yaw) * 14.0;
        const targetLookY = j.y * 0.88 + Math.sin(j.pitch) * 12.0 + 0.6;
        const targetLookZ = -32.0;

        this.cam.lookX += (targetLookX - this.cam.lookX) * camFollowLerp;
        this.cam.lookY += (targetLookY - this.cam.lookY) * camFollowLerp;
        this.cam.lookZ += (targetLookZ - this.cam.lookZ) * camFollowLerp;
        this.cam.roll  += (j.roll * 0.32 - this.cam.roll) * camFollowLerp;

        if (this.cam.shake > 0) {
          this.cam.shake = Math.max(0, this.cam.shake - dt * 2.4);
        }

        // 4. Continuous Shooting System, Homing Missile & Allied Drone Swarm ('E')
        if (!this.gameOver) {
          const cp = Math.cos(j.pitch), sp = Math.sin(j.pitch);
          const cy = Math.cos(j.yaw),   sy = Math.sin(j.yaw);
          const fwdX = -sy * cp;
          const fwdY = sp;
          const fwdZ = -cy * cp;

          j.lockedDroneIdx = this.findBestTarget(j.x, j.y, j.z, fwdX, fwdY, fwdZ);

          const wantsFire = this.keys.fire || this.touchInput.fire;
          if (j.fireCooldown > 0) j.fireCooldown -= dt;
          if (j.missileCooldown > 0) j.missileCooldown -= dt;
          if (j.swarmTriggerCooldown > 0) j.swarmTriggerCooldown -= dt;
          if (j.swarmCooldown > 0) {
            j.swarmCooldown = Math.max(0, j.swarmCooldown - dt);
            this.updateHUD();
          }
          if (j.muzzleFlashTimer > 0) j.muzzleFlashTimer = Math.max(0, j.muzzleFlashTimer - dt);

          if (wantsFire && j.fireCooldown <= 0) {
            this.fireProjectiles();
            j.fireCooldown = 0.095; // ~10.5 salvos per second
          }
          this.pipperEl?.classList.toggle('firing', wantsFire);

          const wantsMissile = this.keys.missile || this.touchInput.missile;
          if (wantsMissile && j.missileCooldown <= 0) {
            this.launchHomingMissile();
            j.missileCooldown = 0.45; // Tactical salvo launch cooldown
          }

          const wantsSwarm = this.keys.swarm || this.touchInput.swarm;
          if (wantsSwarm && j.swarmTriggerCooldown <= 0 && j.swarmTimer <= 0 && j.swarmCooldown <= 0) {
            this.deployAlliedSwarm();
          }
        }

        // 4B. Update Allied Swarm Drones (Flanking Halo Formation & Rapid Bullet Barrage)
        if (j.swarmTimer > 0) {
          j.swarmTimer = Math.max(0, j.swarmTimer - dt);
          this.updateHUD();

          // Collect all currently active enemy targets in engagement range ahead
          const validTargets = [];
          for (let k = 0; k < MAX_DRONES; k++) {
            const d = this.drones[k];
            if (d.active && d.z < j.z - 4.0 && d.z > -285.0) {
              validTargets.push(d);
            }
          }
          // Sort closest first
          validTargets.sort((a, b) => b.z - a.z);
          // If no small drones are active, the Allied Swarm focuses fire on the Enemy Mothership!
          if (validTargets.length === 0 && this.mothership && this.mothership.active) {
            validTargets.push({
              active: true,
              x: this.mothership.x,
              y: this.mothership.y,
              z: this.mothership.z,
              vz: 0
            });
          }

          const swarmFollowLerp = 1.0 - Math.exp(-9.0 * dt);
          for (let i = 0; i < ALLIED_SWARM_COUNT; i++) {
            const sd = this.swarmDrones[i];
            sd.active = true;

            // Flanking arc + dynamic orbital weave around and slightly ahead of the fighter
            const side = (i % 2 === 0) ? -1 : 1;
            const rank = Math.floor(i / 2); // 0, 1, 2
            const orbitAngle = this.time * 2.6 + i * (Math.PI / 3);
            const formX = side * (4.8 + rank * 2.8) + Math.cos(orbitAngle) * 1.1;
            const formY = 0.65 + (1 - rank) * 1.15 + Math.sin(orbitAngle * 1.3) * 0.85;
            const formZ = -3.8 - rank * 1.8;

            transformAircraftPoint(formX, formY, formZ, j.x, j.y, j.z, j.yaw, j.pitch, j.roll, this.tempVec3A);
            sd.x += (this.tempVec3A[0] - sd.x) * swarmFollowLerp;
            sd.y += (this.tempVec3A[1] - sd.y) * swarmFollowLerp;
            sd.z += (this.tempVec3A[2] - sd.z) * swarmFollowLerp;
            sd.roll = j.roll * 0.85 + Math.sin(orbitAngle) * 0.25;

            if (sd.muzzleFlash > 0) sd.muzzleFlash = Math.max(0, sd.muzzleFlash - dt);

            sd.fireTimer -= dt;
            if (sd.fireTimer <= 0) {
              sd.fireTimer = 0.11; // ~9 shots/sec per drone = 54 shots/sec across all 6 swarm drones!
              const assignedTarget = validTargets.length > 0
                ? validTargets[i % validTargets.length]
                : null;
              this.fireSwarmDroneBullet(sd, assignedTarget);
            }
          }

          if (j.swarmTimer <= 0) {
            for (let i = 0; i < ALLIED_SWARM_COUNT; i++) {
              this.swarmDrones[i].active = false;
            }
            j.swarmCooldown = 4.5; // Brief tactical recharge after 10s deployment
            this.updateHUD();
          }
        }

        // 5. Update Projectiles & Check Target Collisions (Player bolts, Allied swarm bolts, Enemy gunship bolts)
        for (let i = 0; i < MAX_PROJECTILES; i++) {
          const p = this.projectiles[i];
          if (!p.active) continue;

          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          p.life -= dt;

          if (p.life <= 0 || p.z < -310.0 || p.z > 26.0) {
            p.active = false;
            continue;
          }

          // Enemy gunship bolts only threaten the player aircraft
          if (p.isEnemy) {
            if (!this.gameOver) {
              const boltX = p.x - j.x;
              const boltY = p.y - j.y;
              const boltZ = p.z - j.z;
              if (boltX * boltX + boltY * boltY + boltZ * boltZ < 9.0) {
                p.active = false;
                this.applyJetDamage(ENEMY_BULLET_DAMAGE, p.x, p.y, p.z, 0.5);
              }
            }
            continue;
          }

          // Check collision against active enemy drones
          for (let k = 0; k < MAX_DRONES; k++) {
            const d = this.drones[k];
            if (!d.active) continue;

            const dx = p.x - d.x;
            const dy = p.y - d.y;
            const dz = p.z - d.z;
            const hitRadiusSq = d.enemyType === 1 ? 16.5 : 9.6;
            if (dx * dx + dy * dy + dz * dz < hitRadiusSq) {
              p.active = false;
              d.hp -= 1;
              d.hitFlash = 1.0;

              if (d.hp <= 0) {
                d.active = false;
                const pts = d.enemyType === 1 ? 250 : 100;
                this.score += pts;
                this.targetsDestroyed += 1;
                this.updateHUD();
                this.spawnExplosion(
                  d.x, d.y, d.z,
                  d.enemyType === 1 ? 42 : 26,
                  d.enemyType === 1 ? 1.55 : 1.15
                );
                if (!this.reducedMotion) {
                  this.cam.shake = Math.min(0.55, this.cam.shake + (d.enemyType === 1 ? 0.34 : 0.22));
                }
              } else {
                this.score += 25;
                this.updateHUD();
                this.spawnExplosion(p.x, p.y, p.z, 7, 0.55);
              }

              // Brief reticle hit confirmation flash
              this.pipperEl.classList.add('hit-confirm');
              clearTimeout(this._hitConfirmTimer);
              this._hitConfirmTimer = setTimeout(() => this.pipperEl.classList.remove('hit-confirm'), 90);
              break;
            }
          }

          // Check projectile collision against the Enemy Mothership Flagship
          if (p.active && this.mothership && this.mothership.active) {
            const ms = this.mothership;
            const mdx = Math.abs(p.x - ms.x);
            const mdy = Math.abs(p.y - ms.y);
            const mdz = Math.abs(p.z - ms.z);
            if (mdx < 16.5 && mdy < 4.5 && mdz < 11.5) {
              p.active = false;
              this.damageMothership(1, p.x, p.y, p.z);
            }
          }
        }

        // 5B. Update 3D Homing Missiles (Proportional Pursuit Guidance, Trails & Impact)
        for (let i = 0; i < MAX_MISSILES; i++) {
          const m = this.missiles[i];
          if (!m.active) continue;

          m.life -= dt;
          if (m.life <= 0 || m.z < -330.0 || m.z > 25.0) {
            m.active = false;
            continue;
          }

          // Accelerate rocket motor up to supersonic cruise speed
          m.speed = Math.min(165.0, m.speed + 95.0 * dt);

          // Validate current target lock or dynamically re-acquire a target ahead
          let target = null;
          if (m.targetIdx === 999 && this.mothership && this.mothership.active) {
            target = { active: true, x: this.mothership.x, y: this.mothership.y, z: this.mothership.z, vz: 0 };
          } else if (m.targetIdx >= 0 && m.targetIdx < MAX_DRONES) {
            target = this.drones[m.targetIdx];
          }
          if (!target || !target.active || target.z > m.z + 3.0) {
            const vLen = Math.hypot(m.vx, m.vy, m.vz) || 1.0;
            m.targetIdx = this.findBestTarget(m.x, m.y, m.z, m.vx / vLen, m.vy / vLen, m.vz / vLen);
            if (m.targetIdx === 999 && this.mothership && this.mothership.active) {
              target = { active: true, x: this.mothership.x, y: this.mothership.y, z: this.mothership.z, vz: 0 };
            } else {
              target = (m.targetIdx >= 0 && m.targetIdx < MAX_DRONES) ? this.drones[m.targetIdx] : null;
            }
          }

          // Smooth high-G proportional pursuit steering toward locked target
          if (target && target.active) {
            const distToTarget = Math.hypot(target.x - m.x, target.y - m.y, target.z - m.z) || 1.0;
            const timeToIntercept = Math.min(0.45, distToTarget / Math.max(m.speed, 60.0));

            // Lead target slightly based on its closing velocity
            const aimX = target.x;
            const aimY = target.y;
            const aimZ = target.z + target.vz * timeToIntercept * 0.35;

            let dx = aimX - m.x;
            let dy = aimY - m.y;
            let dz = aimZ - m.z;
            const dLen = Math.hypot(dx, dy, dz) || 1.0;
            dx /= dLen; dy /= dLen; dz /= dLen;

            let curLen = Math.hypot(m.vx, m.vy, m.vz) || 1.0;
            let curX = m.vx / curLen;
            let curY = m.vy / curLen;
            let curZ = m.vz / curLen;

            const turnRate = 7.2 * dt; // High-G agility
            curX += (dx - curX) * turnRate;
            curY += (dy - curY) * turnRate;
            curZ += (dz - curZ) * turnRate;
            const newLen = Math.hypot(curX, curY, curZ) || 1.0;

            m.vx = (curX / newLen) * m.speed;
            m.vy = (curY / newLen) * m.speed;
            m.vz = (curZ / newLen) * m.speed;
          } else {
            const curLen = Math.hypot(m.vx, m.vy, m.vz) || 1.0;
            m.vx = (m.vx / curLen) * m.speed;
            m.vy = (m.vy / curLen) * m.speed;
            m.vz = (m.vz / curLen) * m.speed;
          }

          // Advance missile in 3D space
          m.x += m.vx * dt;
          m.y += m.vy * dt;
          m.z += m.vz * dt;

          // Orient 3D missile mesh along its true 3D velocity vector
          const vMag = Math.hypot(m.vx, m.vy, m.vz) || 1.0;
          const ndx = m.vx / vMag;
          const ndy = m.vy / vMag;
          const ndz = m.vz / vMag;
          m.pitch = Math.asin(Math.max(-0.995, Math.min(0.995, ndy)));
          m.yaw   = Math.atan2(-ndx, -ndz);
          m.roll += 6.5 * dt; // Stabilizing fin roll spin

          // Emit continuous 3D smoke & flame exhaust trail behind missile
          m.trailTimer -= dt;
          if (m.trailTimer <= 0) {
            m.trailTimer = 0.016;
            const tailX = m.x - ndx * 1.45;
            const tailY = m.y - ndy * 1.45;
            const tailZ = m.z - ndz * 1.45;
            // Hot orange-gold rocket exhaust spark
            this.spawnTrailParticle(tailX, tailY, tailZ, 0, 0, 0, 1.0, 0.68, 0.22, 0.36, 0.18);
            // Bright atmospheric contrail smoke puff
            this.spawnTrailParticle(
              tailX - ndx * 0.5, tailY - ndy * 0.5, tailZ - ndz * 0.5,
              0, 0.4, 0,
              0.78, 0.86, 0.96, 0.48, 0.36
            );
          }

          // Check collision against active enemy drones
          for (let k = 0; k < MAX_DRONES; k++) {
            const d = this.drones[k];
            if (!d.active) continue;

            const cdx = m.x - d.x;
            const cdy = m.y - d.y;
            const cdz = m.z - d.z;
            const mHitRadSq = d.enemyType === 1 ? 22.0 : 14.5;
            if (cdx * cdx + cdy * cdy + cdz * cdz < mHitRadSq) {
              m.active = false;
              d.active = false;
              this.score += d.enemyType === 1 ? 300 : 150;
              this.targetsDestroyed += 1;
              this.updateHUD();

              // High-energy multi-layered warhead detonation burst
              this.spawnExplosion(
                d.x, d.y, d.z,
                d.enemyType === 1 ? 48 : 38,
                d.enemyType === 1 ? 1.65 : 1.45
              );
              if (!this.reducedMotion) this.cam.shake = Math.min(0.6, this.cam.shake + 0.34);

              this.pipperEl.classList.add('hit-confirm');
              clearTimeout(this._hitConfirmTimer);
              this._hitConfirmTimer = setTimeout(() => this.pipperEl.classList.remove('hit-confirm'), 120);
              break;
            }
          }

          // Check homing missile impact against the Enemy Mothership Flagship
          if (m.active && this.mothership && this.mothership.active) {
            const ms = this.mothership;
            const mdx = Math.abs(m.x - ms.x);
            const mdy = Math.abs(m.y - ms.y);
            const mdz = Math.abs(m.z - ms.z);
            if (mdx < 18.0 && mdy < 5.2 && mdz < 12.5) {
              m.active = false;
              this.spawnExplosion(m.x, m.y, m.z, 32, 1.35);
              this.damageMothership(8, m.x, m.y, m.z);
            }
          }
        }

        // 5C. Update Enemy Mothership Flagship Movement & Respawn
        const ms = this.mothership;
        if (ms.active) {
          ms.phase += dt * 0.55;
          // Smoothly glide from deep warp arrival (-320) to tactical carrier orbit (-185)
          ms.z += (ms.targetZ - ms.z) * (1.0 - Math.exp(-2.2 * dt));
          ms.x = Math.sin(ms.phase) * 11.5;
          ms.y = 6.2 + Math.cos(ms.phase * 0.7) * 2.2;
          ms.roll = -Math.cos(ms.phase) * 0.16;

          if (ms.hitFlash > 0) ms.hitFlash = Math.max(0, ms.hitFlash - dt * 5.0);
          if (ms.bayFlashLeft > 0) ms.bayFlashLeft = Math.max(0, ms.bayFlashLeft - dt * 3.2);
          if (ms.bayFlashRight > 0) ms.bayFlashRight = Math.max(0, ms.bayFlashRight - dt * 3.2);
        } else {
          ms.respawnTimer = Math.max(0, ms.respawnTimer - dt);
          this.updateHUD();
          if (ms.respawnTimer <= 0) {
            ms.active = true;
            ms.z = -335.0; // Warp in from deep horizon
            ms.maxHp += 15;
            ms.hp = ms.maxHp;
            ms.hitFlash = 0.5;
            this.updateHUD();
          }
        }

        // 6. Update Enemy Drones & Controlled Launch from Mothership Hangar Bays
        let activeDroneCount = 0;
        for (let i = 0; i < MAX_DRONES; i++) {
          const d = this.drones[i];
          if (!d.active) continue;

          if (d.launchBlend > 0) {
            d.launchBlend = Math.max(0, d.launchBlend - dt * 1.35);
          }

          let patrolX, patrolY;
          if (d.enemyType === 1) {
            // Heavy Interceptor Gunship: advances to a firing station and then holds it like the Mothership
            d.phase += dt * 1.35;
            d.spin += dt * 1.4;
            d.bankAngle = -Math.cos(d.phase) * 0.42;
            patrolX = d.baseX + Math.sin(d.phase) * 5.2;
            patrolY = d.baseY + Math.sin(d.phase * 0.65) * 2.1;

            d.z = Math.min(d.stationZ, d.z + d.vz * dt);

            if (d.muzzleFlash > 0) d.muzzleFlash = Math.max(0, d.muzzleFlash - dt);
            if (!this.gameOver) {
              d.fireTimer -= dt;
              if (d.fireTimer <= 0) {
                d.fireTimer = 3.2 + Math.random() * 1.6;
                this.fireHeavyGunship(d);
              }
            }
          } else {
            // Tactical Recon Drone
            d.phase += dt * 1.85;
            d.spin += dt * 2.2;
            d.bankAngle = Math.cos(d.phase) * 0.35;
            patrolX = d.baseX + Math.sin(d.phase) * 3.4;
            patrolY = d.baseY + Math.cos(d.phase * 0.8) * 1.6;
            d.z += d.vz * dt;
          }

          // Smoothly transition from Mothership Hangar Launch Bay into active combat lane
          const blend = d.launchBlend * d.launchBlend;
          d.x = patrolX * (1.0 - blend) + d.spawnX * blend;
          d.y = patrolY * (1.0 - blend) + d.spawnY * blend;

          if (d.hitFlash > 0) d.hitFlash = Math.max(0, d.hitFlash - dt * 5.5);

          // Check direct collision with aircraft
          const jdx = d.x - j.x;
          const jdy = d.y - j.y;
          const jdz = d.z - j.z;
          const crashRadSq = d.enemyType === 1 ? 16.0 : 11.5;
          if (!this.gameOver && jdx * jdx + jdy * jdy + jdz * jdz < crashRadSq) {
            d.active = false;
            if (!this.reducedMotion) this.cam.shake = 0.45;
            this.applyJetDamage(
              d.enemyType === 1 ? HEAVY_CRASH_DAMAGE : RECON_CRASH_DAMAGE,
              d.x, d.y, d.z,
              d.enemyType === 1 ? 1.3 : 1.0
            );
            continue;
          }

          // Recycle drone once it flies past the camera
          if (d.z > 22.0) {
            d.active = false;
            continue;
          }
          activeDroneCount++;
        }

        // Launch new enemies directly from the Mothership Hangar Bays when active
        this.enemySpawnTimer -= dt;
        if (!this.gameOver && ms.active && ms.z > -245.0 && activeDroneCount < ACTIVE_ENEMY_CAP && this.enemySpawnTimer <= 0) {
          this.spawnDroneFromMothership(0.0);
          this.enemySpawnTimer = 1.55 + Math.random() * 0.45;
        }

        // 7. Update 3D Explosion Particles
        for (let i = 0; i < MAX_PARTICLES; i++) {
          const pt = this.particles[i];
          if (!pt.active) continue;
          pt.x += pt.vx * dt;
          pt.y += pt.vy * dt;
          pt.z += pt.vz * dt;
          pt.vy -= 9.5 * dt; // Subtle gravity arc
          pt.rot += 5.0 * dt;
          pt.life -= dt;
          if (pt.life <= 0) pt.active = false;
        }

        // 8. Scroll World Environment (Terrain & Speed Lines — No Clouds)
        const worldSpeed = 62.0;
        this.terrainScrollZ = (this.terrainScrollZ + worldSpeed * dt) % TERRAIN_DEPTH;

        for (let i = 0; i < MAX_SPEEDLINES; i++) {
          const s = this.speedLines[i];
          s.z += worldSpeed * 2.1 * dt;
          if (s.z > 16.0) {
            this.initSpeedLine(s, -135.0 - Math.random() * 30.0);
          }
        }
      }

      damageMothership(amount, hitX, hitY, hitZ) {
        const ms = this.mothership;
        if (!ms || !ms.active) return;

        ms.hp -= amount;
        ms.hitFlash = 1.0;
        this.score += amount * 20;
        this.spawnExplosion(hitX, hitY, hitZ, 8, 0.75);

        this.pipperEl?.classList.add('hit-confirm');
        clearTimeout(this._hitConfirmTimer);
        this._hitConfirmTimer = setTimeout(() => this.pipperEl?.classList.remove('hit-confirm'), 90);

        if (ms.hp <= 0) {
          ms.active = false;
          ms.respawnTimer = 6.0;
          this.score += 1500;
          this.targetsDestroyed += 1;
          // Massive multi-point flagship detonation across hull and both hangar bays
          this.spawnExplosion(ms.x, ms.y, ms.z, 55, 2.4);
          this.spawnExplosion(ms.x - 9.0, ms.y - 1.0, ms.z + 3.0, 35, 1.8);
          this.spawnExplosion(ms.x + 9.0, ms.y - 1.0, ms.z + 3.0, 35, 1.8);
          if (!this.reducedMotion) this.cam.shake = 0.85;
        }
        this.updateHUD();
      }

      // Build per-frame GPU uniform & instance buffers and return mesh batch draw ranges
      prepareRenderData(aspect) {
        const j = this.jet;
        const c = this.cam;

        // Subtle high-speed airframe vibration
        const vib = this.reducedMotion ? 0 : 1;
        const shakeX = (Math.sin(this.time * 47.0) * 0.25 * c.shake) * vib;
        const shakeY = (Math.cos(this.time * 53.0) * 0.25 * c.shake) * vib;

        const eyeX = c.x + shakeX;
        const eyeY = c.y + shakeY;
        const eyeZ = c.z;

        const upX = Math.sin(c.roll);
        const upY = Math.cos(c.roll);
        const upZ = 0;

        mat4LookAt(this.matView, eyeX, eyeY, eyeZ, c.lookX, c.lookY, c.lookZ, upX, upY, upZ);
        mat4PerspectiveZO(this.matProj, 54.0 * Math.PI / 180.0, aspect, 0.5, 420.0);
        mat4Multiply(this.matViewProj, this.matProj, this.matView);
        mat4Invert(this.matInvVP, this.matViewProj);

        // Update 3D projected aiming reticle position on screen
        transformAircraftPoint(0, 0, -68.0, j.x, j.y, j.z, j.yaw, j.pitch, j.roll, this.tempVec3A);
        const ax = this.tempVec3A[0], ay = this.tempVec3A[1], az = this.tempVec3A[2];
        const m = this.matViewProj;
        const clipW = m[3] * ax + m[7] * ay + m[11] * az + m[15];
        if (clipW > 0.1) {
          const ndcX = (m[0] * ax + m[4] * ay + m[8]  * az + m[12]) / clipW;
          const ndcY = (m[1] * ax + m[5] * ay + m[9]  * az + m[13]) / clipW;
          const screenX = (ndcX * 0.5 + 0.5) * 100;
          const screenY = (-ndcY * 0.5 + 0.5) * 100;
          this.pipperEl.style.left = `${screenX.toFixed(2)}%`;
          this.pipperEl.style.top  = `${screenY.toFixed(2)}%`;
        }

        // Project tactical target lock-on diamond over the best locked drone or Mothership ahead
        let lockTargetObj = null;
        if (j.lockedDroneIdx === 999 && this.mothership && this.mothership.active) {
          lockTargetObj = this.mothership;
        } else if (j.lockedDroneIdx >= 0 && this.drones[j.lockedDroneIdx] && this.drones[j.lockedDroneIdx].active) {
          lockTargetObj = this.drones[j.lockedDroneIdx];
        }

        if (lockTargetObj) {
          const td = lockTargetObj;
          const tClipW = m[3] * td.x + m[7] * td.y + m[11] * td.z + m[15];
          if (tClipW > 0.1) {
            const tNdcX = (m[0] * td.x + m[4] * td.y + m[8]  * td.z + m[12]) / tClipW;
            const tNdcY = (m[1] * td.x + m[5] * td.y + m[9]  * td.z + m[13]) / tClipW;
            const tScreenX = (tNdcX * 0.5 + 0.5) * 100;
            const tScreenY = (-tNdcY * 0.5 + 0.5) * 100;
            this.lockDiamondEl.style.left = `${tScreenX.toFixed(2)}%`;
            this.lockDiamondEl.style.top  = `${tScreenY.toFixed(2)}%`;
            this.lockDiamondEl.classList.add('active');
          } else {
            this.lockDiamondEl.classList.remove('active');
          }
        } else {
          this.lockDiamondEl.classList.remove('active');
        }

        // Project the aircraft hull integrity tracker above the jet in 3D space
        if (this.hpTrackerEl) {
          const hpWorldX = j.x;
          const hpWorldY = j.y + 3.2;
          const hpWorldZ = j.z;
          const hpClipW = m[3] * hpWorldX + m[7] * hpWorldY + m[11] * hpWorldZ + m[15];

          if (!this.gameOver && hpClipW > 0.1) {
            const hpNdcX = (m[0] * hpWorldX + m[4] * hpWorldY + m[8]  * hpWorldZ + m[12]) / hpClipW;
            const hpNdcY = (m[1] * hpWorldX + m[5] * hpWorldY + m[9]  * hpWorldZ + m[13]) / hpClipW;
            const hpDistance = Math.hypot(eyeX - hpWorldX, eyeY - hpWorldY, eyeZ - hpWorldZ);
            const hpScale = Math.min(1.4, Math.max(0.6, 13.5 / Math.max(hpDistance, 1.0)));

            this.hpTrackerEl.style.left = `${((hpNdcX * 0.5 + 0.5) * 100).toFixed(2)}%`;
            this.hpTrackerEl.style.top  = `${((-hpNdcY * 0.5 + 0.5) * 100).toFixed(2)}%`;
            this.hpTrackerEl.style.transform = `translate(-50%, -100%) scale(${hpScale.toFixed(3)})`;
            this.hpTrackerEl.classList.remove('hidden');
          } else {
            this.hpTrackerEl.classList.add('hidden');
          }
        }

        // Populate SceneUniforms (64 floats = 256 bytes)
        this.sceneUniformData.set(this.matViewProj, 0);
        this.sceneUniformData.set(this.matInvVP, 16);
        this.sceneUniformData[32] = eyeX;
        this.sceneUniformData[33] = eyeY;
        this.sceneUniformData[34] = eyeZ;
        this.sceneUniformData[35] = this.time;

        // Normalized sun direction (warm high-altitude afternoon sun ahead-right)
        const sx = 0.52, sy = 0.46, sz = -0.72;
        const sLen = Math.hypot(sx, sy, sz);
        this.sceneUniformData[36] = sx / sLen;
        this.sceneUniformData[37] = sy / sLen;
        this.sceneUniformData[38] = sz / sLen;
        this.sceneUniformData[39] = aspect;

        // Aircraft world pos for terrain contact shadow + muzzleFlash intensity
        this.sceneUniformData[40] = j.x;
        this.sceneUniformData[41] = j.y;
        this.sceneUniformData[42] = j.z;
        this.sceneUniformData[43] = j.muzzleFlashTimer > 0 ? 1.0 : 0.0;

        this.sceneUniformData[44] = c.roll;
        this.sceneUniformData[45] = j.pitch;
        this.sceneUniformData[46] = 1.0;
        this.sceneUniformData[47] = this.reducedMotion ? 1.0 : 0.0;

        // Pack instances grouped by mesh type for single-call instanced drawing
        let instCount = 0;
        const buf = this.instanceBufferData;

        const pushInstance = (tx, ty, tz, yaw, pitch, roll, scx, scy, scz, r, g, b, a, p0, p1, p2, p3) => {
          if (instCount >= MAX_INSTANCES) return;
          const off = instCount * FLOATS_PER_INST;
          composeModelMatrix(buf, off, tx, ty, tz, yaw, pitch, roll, scx, scy, scz);
          buf[off + 16] = r;  buf[off + 17] = g;  buf[off + 18] = b;  buf[off + 19] = a;
          buf[off + 20] = p0; buf[off + 21] = p1; buf[off + 22] = p2; buf[off + 23] = p3;
          instCount++;
        };

        const batches = {};

        // 1. TERRAIN SLICES
        const terrainStart = instCount;
        for (let i = 0; i < TERRAIN_SLICES; i++) {
          const sliceZ = 30.0 - i * TERRAIN_DEPTH + this.terrainScrollZ;
          pushInstance(
            0, -18.5, sliceZ,
            0, 0, 0,
            1, 1, 1,
            1, 1, 1, 1,
            0, 0, 0, 0
          );
        }
        batches.terrain = { first: terrainStart, count: instCount - terrainStart };

        // 2. PLAYER FIGHTER AIRCRAFT (Rigid hard-surface airframe with subtle high-speed flight buffet)
        const microBuffetY = this.reducedMotion ? 0 : Math.sin(this.time * 18.0) * 0.025;
        const fighterStart = instCount;
        if (!this.gameOver) {
          pushInstance(
            j.x, j.y + microBuffetY, j.z,
            j.yaw, j.pitch, j.roll,
            1, 1, 1,
            1, 1, 1, 1,
            0, 0, 1.0, j.hullFlash
          );
        }
        batches.fighter = { first: fighterStart, count: instCount - fighterStart };

        // 2B. ENEMY AERIAL MOTHERSHIP CARRIER (Flagship in the distance)
        const mothershipStart = instCount;
        if (this.mothership && this.mothership.active) {
          const ms = this.mothership;
          pushInstance(
            ms.x, ms.y, ms.z,
            0, ms.pitch, ms.roll,
            1.15, 1.15, 1.15,
            1, 1, 1, 1,
            0, 0.85, 0.5, ms.hitFlash
          );
        }
        batches.mothership = { first: mothershipStart, count: instCount - mothershipStart };

        // 3. ENEMY TYPE 0: TACTICAL RECON DRONES
        const droneStart = instCount;
        for (let i = 0; i < MAX_DRONES; i++) {
          const d = this.drones[i];
          if (!d.active || d.enemyType !== 0) continue;
          pushInstance(
            d.x, d.y, d.z,
            0, 0.08, d.bankAngle,
            1.15, 1.15, 1.15,
            1, 1, 1, 1,
            0, 0.6, 0.5, d.hitFlash
          );
        }
        batches.drone = { first: droneStart, count: instCount - droneStart };

        // 3A. ENEMY TYPE 1: HEAVY ARMORED INTERCEPTOR GUNSHIPS
        const heavyDroneStart = instCount;
        for (let i = 0; i < MAX_DRONES; i++) {
          const d = this.drones[i];
          if (!d.active || d.enemyType !== 1) continue;
          pushInstance(
            d.x, d.y, d.z,
            0, 0.05, d.bankAngle,
            1.35, 1.35, 1.35,
            1, 1, 1, 1,
            0, 0.75, 0.5, d.hitFlash
          );
        }
        batches.heavyDrone = { first: heavyDroneStart, count: instCount - heavyDroneStart };

        // 3B. HOMING MISSILES (3D Airframe oriented along velocity vector)
        const missileStart = instCount;
        for (let i = 0; i < MAX_MISSILES; i++) {
          const ms = this.missiles[i];
          if (!ms.active) continue;
          pushInstance(
            ms.x, ms.y, ms.z,
            ms.yaw, ms.pitch, ms.roll,
            1.15, 1.15, 1.15,
            1, 1, 1, 1,
            0, 0.4, 0.5, 0
          );
        }
        batches.missile = { first: missileStart, count: instCount - missileStart };

        // 4. ALLIED SWARM MINI-DRONES (6 Wingman UAVs deployed on KeyE)
        const swarmStart = instCount;
        for (let i = 0; i < ALLIED_SWARM_COUNT; i++) {
          const sd = this.swarmDrones[i];
          if (!sd.active) continue;
          pushInstance(
            sd.x, sd.y, sd.z,
            sd.yaw, sd.pitch, sd.roll,
            1.0, 1.0, 1.0,
            1, 1, 1, 1,
            0, 0.8, 0.5, sd.muzzleFlash > 0 ? 0.55 : 0.0
          );
        }
        batches.swarmDrone = { first: swarmStart, count: instCount - swarmStart };

        // 5. PROJECTILES (Main Cannon + Allied Swarm Bullet Barrage)
        const projStart = instCount;
        for (let i = 0; i < MAX_PROJECTILES; i++) {
          const p = this.projectiles[i];
          if (!p.active) continue;
          const sc = p.isSwarm ? 0.88 : 1.0;
          pushInstance(
            p.x, p.y, p.z,
            p.yaw, p.pitch, 0,
            sc, sc, 1.65 * sc,
            p.r, p.g, p.b, 1.0,
            4.0, 1.5, 0, 0
          );
        }
        batches.projectile = { first: projStart, count: instCount - projStart };

        // 6. AFTERBURNER PLUMES & MUZZLE FLASHES (Additive / Emissive Cones)
        const plumeStart = instCount;
        const pulse = 1.0 + Math.sin(this.time * 42.0) * 0.16;
        if (!this.gameOver) {
          for (const side of [-1, 1]) {
            // Twin engine afterburner plumes attached to rear nozzles
            transformAircraftPoint(
              0.56 * side, -0.02, 4.55,
              j.x, j.y + microBuffetY, j.z,
              j.yaw, j.pitch, j.roll,
              this.tempVec3A
            );
            pushInstance(
              this.tempVec3A[0], this.tempVec3A[1], this.tempVec3A[2],
              j.yaw, j.pitch, j.roll,
              0.95, 0.95, 1.35 * pulse,
              1.0, 0.55, 0.18, 0.92,
              4.0, 1.6, 0, 0
            );

            // Muzzle flashes when firing
            if (j.muzzleFlashTimer > 0) {
              transformAircraftPoint(
                1.28 * side, -0.08, -2.35,
                j.x, j.y + microBuffetY, j.z,
                j.yaw, j.pitch, j.roll,
                this.tempVec3B
              );
              pushInstance(
                this.tempVec3B[0], this.tempVec3B[1], this.tempVec3B[2],
                j.yaw + Math.PI, -j.pitch, this.time * 25.0,
                1.35, 1.35, 0.95,
                1.0, 0.82, 0.35, 0.95,
                4.0, 2.2, 0, 0
              );
            }
          }
        }

        // Homing missile rocket motor plumes attached to each active missile's tail
        for (let i = 0; i < MAX_MISSILES; i++) {
          const ms = this.missiles[i];
          if (!ms.active) continue;
          transformAircraftPoint(
            0, 0, 1.55,
            ms.x, ms.y, ms.z,
            ms.yaw, ms.pitch, ms.roll,
            this.tempVec3A
          );
          pushInstance(
            this.tempVec3A[0], this.tempVec3A[1], this.tempVec3A[2],
            ms.yaw, ms.pitch, ms.roll,
            0.72, 0.72, 1.55 * pulse,
            1.0, 0.72, 0.24, 0.96,
            4.0, 2.1, 0, 0
          );
        }

        // Allied Swarm Drone thruster plumes & rapid-fire muzzle flashes
        for (let i = 0; i < ALLIED_SWARM_COUNT; i++) {
          const sd = this.swarmDrones[i];
          if (!sd.active) continue;
          transformAircraftPoint(
            0, 0, 1.48,
            sd.x, sd.y, sd.z,
            sd.yaw, sd.pitch, sd.roll,
            this.tempVec3A
          );
          pushInstance(
            this.tempVec3A[0], this.tempVec3A[1], this.tempVec3A[2],
            sd.yaw, sd.pitch, sd.roll,
            0.48, 0.48, 0.85 * pulse,
            0.20, 0.90, 1.00, 0.92,
            4.0, 1.8, 0, 0
          );

          if (sd.muzzleFlash > 0) {
            transformAircraftPoint(
              0, 0, -1.55,
              sd.x, sd.y, sd.z,
              sd.yaw, sd.pitch, sd.roll,
              this.tempVec3B
            );
            pushInstance(
              this.tempVec3B[0], this.tempVec3B[1], this.tempVec3B[2],
              sd.yaw + Math.PI, -sd.pitch, this.time * 30.0,
              0.78, 0.78, 0.65,
              0.35, 0.95, 1.00, 0.95,
              4.0, 2.2, 0, 0
            );
          }
        }

        // Heavy Gunship twin-barrel muzzle flashes when firing
        for (let i = 0; i < MAX_DRONES; i++) {
          const d = this.drones[i];
          if (!d.active || d.enemyType !== 1 || d.muzzleFlash <= 0) continue;
          for (const side of [-1, 1]) {
            transformAircraftPoint(
              1.65 * side, -0.08, -2.45,
              d.x, d.y, d.z,
              0, 0.05, d.bankAngle,
              this.tempVec3A
            );
            pushInstance(
              this.tempVec3A[0], this.tempVec3A[1], this.tempVec3A[2],
              0, 0.05, this.time * 24.0,
              1.15, 1.15, 0.9,
              1.0, 0.30, 0.28, 0.95,
              4.0, 2.2, 0, 0
            );
          }
        }

        // Mothership Hangar Launch Bay energy flare when deploying enemy drones
        if (this.mothership && this.mothership.active) {
          const ms = this.mothership;
          for (const side of [-1, 1]) {
            const flashVal = side < 0 ? ms.bayFlashLeft : ms.bayFlashRight;
            const bayScale = 1.35 + flashVal * 1.45;
            transformAircraftPoint(
              8.2 * side * 1.15, -1.15 * 1.15, 6.2 * 1.15,
              ms.x, ms.y, ms.z,
              0, ms.pitch, ms.roll,
              this.tempVec3A
            );
            pushInstance(
              this.tempVec3A[0], this.tempVec3A[1], this.tempVec3A[2],
              0, ms.pitch, this.time * 4.0 * side,
              bayScale, bayScale, (1.2 + flashVal * 2.2) * pulse,
              1.0, 0.32 + flashVal * 0.4, 0.15, 0.92,
              4.0, 1.8 + flashVal * 1.5, 0, 0
            );
          }
        }
        batches.plume = { first: plumeStart, count: instCount - plumeStart };

        // 7. EXPLOSION PARTICLES & HIGH-SPEED AIR STREAM LINES
        const shardStart = instCount;
        for (let i = 0; i < MAX_PARTICLES; i++) {
          const pt = this.particles[i];
          if (!pt.active) continue;
          const lifeRatio = Math.max(0, pt.life / pt.maxLife);
          const s = pt.scale * (0.35 + lifeRatio * 0.85);
          pushInstance(
            pt.x, pt.y, pt.z,
            pt.rot, pt.rot * 0.7, 0,
            s, s, s,
            pt.r, pt.g, pt.b, lifeRatio,
            4.0, 1.5 * lifeRatio, 0, 0
          );
        }

        // Subtle atmospheric speed lines / dust particles
        if (!this.reducedMotion) {
          for (let i = 0; i < MAX_SPEEDLINES; i++) {
            const sl = this.speedLines[i];
            pushInstance(
              sl.x, sl.y, sl.z,
              0, 0, 0,
              0.035, 0.035, sl.len,
              0.72, 0.88, 1.0, 0.35,
              4.0, 0.4, 0, 0
            );
          }
        }
        batches.shard = { first: shardStart, count: instCount - shardStart };

        return { totalInstances: instCount, batches };
      }
    }

