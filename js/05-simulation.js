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
    const MAX_BLASTS         = 14;
    const BLAST_LIFE         = 0.55;
    const TERRAIN_SLICES     = 8;
    const TERRAIN_DEPTH      = 60.0;

    const MAX_JET_HEALTH      = 100;
    const MAX_HEAVY_GUNSHIPS  = 3;
    const ENEMY_BULLET_SPEED  = 128.0;
    const ENEMY_BULLET_DAMAGE = 4;
    const RECON_CRASH_DAMAGE  = 10;
    const HEAVY_CRASH_DAMAGE  = 20;

    const MOTHERSHIP_INSTANCE_SCALE = 1.15;
    const MOTHERSHIP_MAX_HP         = 6500;
    const MOTHERSHIP_BULLET_DAMAGE  = 8;
    const MOTHERSHIP_MISSILE_DAMAGE = 80;
    const MOTHERSHIP_RESPAWN_GROWTH = 1.25;
    const MOTHERSHIP_HANGAR_BAY_X   = 13.12 * MOTHERSHIP_INSTANCE_SCALE;
    const MOTHERSHIP_HANGAR_BAY_Y   = -1.84 * MOTHERSHIP_INSTANCE_SCALE;
    const MOTHERSHIP_HANGAR_BAY_Z   = 9.9 * MOTHERSHIP_INSTANCE_SCALE;
    const MOTHERSHIP_BOLT_HIT_X     = 20.0;
    const MOTHERSHIP_BOLT_HIT_Y     = 7.5;
    const MOTHERSHIP_BOLT_HIT_Z     = 19.0;
    const MOTHERSHIP_MISSILE_HIT_X  = 22.0;
    const MOTHERSHIP_MISSILE_HIT_Y  = 8.6;
    const MOTHERSHIP_MISSILE_HIT_Z  = 21.0;

    const SHIELD_DRONE_COUNT     = 8;
    const SHIELD_DRONE_HP        = 1;
    const SHIELD_DRONE_PATIENCE  = 15.0;
    const SHIELD_REDEPLOY_DELAY  = 30.0;
    const KAMIKAZE_SPEED         = 55.0;
    const KAMIKAZE_DAMAGE        = 12;
    const KAMIKAZE_TRIGGER_RANGE = 2.2;

    const SHIELD_FORMATION_SIZE     = 8;
    const SHIELD_FORMATION_Z        = 24.0;
    const SHIELD_FORMATION_CENTER_Y = 5.6;
    const SHIELD_FORMATION_INNER_X  = 9.0;
    const SHIELD_FORMATION_OUTER_X  = 26.0;
    const SHIELD_FORMATION_ROW_Y    = 4.6;
    const SHIELD_FORMATION_HOVER    = 0.35;
    const SHIELD_PANEL_WIDTH        = 64.0;
    const SHIELD_PANEL_HEIGHT       = 16.0;
    const SHIELD_PANEL_OFFSET_Z     = 1.6;
    const SHIELD_PANEL_BASE_GLOW    = 0.26;

    const PLAYER_SHIELD_CAPACITY    = 45;
    const PLAYER_SHIELD_RING_RADIUS = 7.4;
    const SWARM_ROLE_ATTACKER       = 'attacker';
    const SWARM_ROLE_SHIELDER       = 'shielder';

    const AIRCRAFT_SKYSTRIKE    = 'skystrike';
    const AIRCRAFT_VOLTARC      = 'voltarc';
    const ARC_BOLT_SPEED        = 265.0;
    const ARC_BOLT_DAMAGE       = 2;
    const ARC_FIRE_COOLDOWN     = 0.115;
    const EMP_COOLDOWN          = 14.0;
    const EMP_STUN_DURATION     = 4.5;
    const EMP_FALL_ACCEL        = 26.0;
    const EMP_KILL_Y            = -16.0;
    const EMP_SCORE             = 60;
    const SHIELD_SKILL_DURATION = 8.0;
    const SHIELD_SKILL_COOLDOWN = 12.0;

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
        this.shieldTrackerEl = document.getElementById('shield-tracker');
        this.shieldFillEl    = document.getElementById('shield-fill');
        this.shieldValueEl   = document.getElementById('shield-value');
        this.shieldEl        = document.getElementById('shield-val');
        this.swarmModeEl     = document.getElementById('swarm-mode-btn');
        this.gameOverEl    = document.getElementById('gameover-overlay');
        this.gameOverScoreEl   = document.getElementById('gameover-score');
        this.gameOverTargetsEl = document.getElementById('gameover-targets');
        this.gameOverRestartEl = document.getElementById('gameover-restart-btn');
        this.hangarEl       = document.getElementById('hangar-overlay');
        this.hangarCards    = Array.from(document.querySelectorAll('[data-aircraft]'));
        this.skillLabelEl   = document.getElementById('skill-label');
        this.controlHintEl  = document.getElementById('control-hint');
        this.controlSubhintEl = document.getElementById('control-subhint');
        this.swarmRoleBtnEl = document.getElementById('swarm-mode-btn');
        this.touchSwarmModeEl = document.getElementById('touch-swarm-mode');

        // Input state
        this.keys = { left: false, right: false, up: false, down: false, fire: false, missile: false, swarm: false };
        this.touchInput = { x: 0, y: 0, active: false, fire: false, missile: false, swarm: false };

        // Pre-allocate object pools
        this.projectiles = Array.from({ length: MAX_PROJECTILES }, () => ({
          active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
          pitch: 0, yaw: 0, life: 0, r: 1.0, g: 0.85, b: 0.45, isSwarm: false, isEnemy: false,
          isArc: false, damage: 1
        }));

        this.missiles = Array.from({ length: MAX_MISSILES }, () => ({
          active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
          yaw: 0, pitch: 0, roll: 0, speed: 0, life: 0, targetIdx: -1, trailTimer: 0
        }));

        this.drones = Array.from({ length: MAX_DRONES }, () => ({
          active: false, enemyType: 0, x: 0, y: 0, z: 0, baseX: 0, baseY: 0,
          spawnX: 0, spawnY: 0, launchBlend: 0, stationZ: 0,
          vx: 0, vy: 0, vz: 0, phase: 0, spin: 0, bankAngle: 0,
          fireTimer: 0, muzzleFlash: 0, hp: 2, maxHp: 2, hitFlash: 0,
          stunned: false, stunTimer: 0
        }));

        this.swarmDrones = Array.from({ length: ALLIED_SWARM_COUNT }, (_, idx) => ({
          active: false, slotIdx: idx, x: 0, y: 0, z: 0,
          yaw: 0, pitch: 0, roll: 0, fireTimer: 0, muzzleFlash: 0
        }));

        this.shieldDrones = Array.from({ length: SHIELD_DRONE_COUNT }, (_, idx) => ({
          active: false, slotIdx: idx, mode: 'shield',
          x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0,
          offsetX: 0, offsetY: 0, phase: 0, age: 0, hp: SHIELD_DRONE_HP, maxHp: SHIELD_DRONE_HP,
          hitFlash: 0, vx: 0, vy: 0, vz: 0, trailTimer: 0,
          stunned: false, stunTimer: 0
        }));

        this.particles = Array.from({ length: MAX_PARTICLES }, () => ({
          active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
          r: 1, g: 0.5, b: 0.1, scale: 1, life: 0, maxLife: 1, rot: 0
        }));

        this.speedLines = Array.from({ length: MAX_SPEEDLINES }, () => ({
          x: 0, y: 0, z: 0, len: 1
        }));

        this.blasts = Array.from({ length: MAX_BLASTS }, () => ({
          active: false, x: 0, y: 0, z: 0, age: 0, life: BLAST_LIFE, kind: 'fire',
          radius: 8, r: 1.0, g: 0.70, b: 0.28, spin: 0
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
        this.started = true;
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
          hullFlash: 0,
          swarmRole: SWARM_ROLE_ATTACKER,
          shieldHp: 0,
          maxShieldHp: PLAYER_SHIELD_CAPACITY,
          shieldFlash: 0,
          shieldTimer: 0,
          shieldCooldown: 0,
          shieldTriggerCooldown: 0,
          empCooldown: 0,
          empFlash: 0,
          empPulseTimer: 0,
          aircraftId: this.jet ? this.jet.aircraftId : AIRCRAFT_SKYSTRIKE
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
        for (const blast of this.blasts) blast.active = false;
        for (const d of this.drones) d.active = false;
        for (const sd of this.swarmDrones) {
          sd.active = false;
          sd.muzzleFlash = 0;
        }

        for (const d of this.drones) {
          d.muzzleFlash = 0;
          d.fireTimer = 0;
          d.stunned = false;
          d.stunTimer = 0;
          d.vy = 0;
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
          hp: MOTHERSHIP_MAX_HP,
          maxHp: MOTHERSHIP_MAX_HP,
          hitFlash: 0.0,
          bayFlashLeft: 0.0,
          bayFlashRight: 0.0,
          nextBaySide: -1,
          respawnTimer: 0.0,
          shieldBroken: false,
          redeployTimer: 0.0,
          shieldFlash: 0.0
        };

        for (const sd of this.shieldDrones) {
          sd.active = false;
          sd.mode = 'shield';
          sd.hitFlash = 0;
          sd.trailTimer = 0;
        }

        this.deployShieldRing();

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
        this.syncSwarmModeUI();
        this.syncAircraftUI();
      }

      deployShieldRing() {
        const ms = this.mothership;
        if (!ms || !ms.active) return;

        for (let i = 0; i < SHIELD_DRONE_COUNT; i++) {
          const sd = this.shieldDrones[i];
          sd.active = true;
          sd.mode = 'shield';
          sd.hp = SHIELD_DRONE_HP;
          sd.maxHp = SHIELD_DRONE_HP;
          sd.age = 0;
          sd.hitFlash = 0;
          sd.trailTimer = 0;
          sd.phase = (i / SHIELD_DRONE_COUNT) * Math.PI * 2;
          sd.stunned = false;
          sd.stunTimer = 0;
          sd.vx = 0;
          sd.vy = 0;
          sd.vz = 0;

          const isTopRow = i < SHIELD_FORMATION_SIZE / 2;
          const column = i % (SHIELD_FORMATION_SIZE / 2);
          const isOuterColumn = column === 0 || column === (SHIELD_FORMATION_SIZE / 2) - 1;
          const columnSign = column < SHIELD_FORMATION_SIZE / 4 ? -1 : 1;
          sd.offsetX = (isOuterColumn ? SHIELD_FORMATION_OUTER_X : SHIELD_FORMATION_INNER_X) * columnSign;
          sd.offsetY = isTopRow ? SHIELD_FORMATION_ROW_Y : -SHIELD_FORMATION_ROW_Y;

          this.updateShieldDroneTransform(sd, ms.x, ms.z);
        }

        ms.shieldBroken = false;
        ms.redeployTimer = 0;
        ms.shieldFlash = 1.0;
      }

      updateShieldDroneTransform(sd, centreX, centreZ) {
        const hover = Math.sin(sd.phase) * SHIELD_FORMATION_HOVER;
        sd.x = centreX + sd.offsetX;
        sd.y = SHIELD_FORMATION_CENTER_Y + sd.offsetY + hover;
        sd.z = centreZ + SHIELD_FORMATION_Z;
        sd.yaw = Math.PI;
        sd.pitch = 0;
        sd.roll = 0;
      }

      countShieldingDrones() {
        let count = 0;
        for (const sd of this.shieldDrones) {
          if (sd.active && sd.mode === 'shield') count++;
        }
        return count;
      }

      isMothershipShielded() {
        return Boolean(this.mothership && this.mothership.active && this.countShieldingDrones() > 0);
      }

      toggleSwarmRole() {
        if (this.gameOver) return;
        const j = this.jet;
        j.swarmRole = j.swarmRole === SWARM_ROLE_ATTACKER ? SWARM_ROLE_SHIELDER : SWARM_ROLE_ATTACKER;

        if (j.swarmRole === SWARM_ROLE_SHIELDER) {
          if (j.swarmTimer > 0) j.shieldHp = j.maxShieldHp;
        } else {
          j.shieldHp = 0;
        }

        this.updateHealthBar();
        this.updateHUD();
        this.syncSwarmModeUI();
      }

      syncSwarmModeUI() {
        if (!this.swarmModeEl) return;
        const isShielder = this.jet.swarmRole === SWARM_ROLE_SHIELDER;
        this.swarmModeEl.textContent = isShielder ? 'SWARM · SHIELD' : 'SWARM · ATTACK';
        this.swarmModeEl.setAttribute('aria-pressed', isShielder ? 'true' : 'false');
        this.swarmModeEl.setAttribute(
          'aria-label',
          isShielder ? 'Swarm role: shielder. Activate to switch to attacker.' : 'Swarm role: attacker. Activate to switch to shielder.'
        );
      }

      isArcAircraft() {
        return this.jet.aircraftId === AIRCRAFT_VOLTARC;
      }

      selectAircraft(aircraftId) {
        if (aircraftId !== AIRCRAFT_SKYSTRIKE && aircraftId !== AIRCRAFT_VOLTARC) return;
        this.jet.aircraftId = aircraftId;
        this.syncAircraftUI();
      }

      openHangar() {
        this.started = false;
        this.paused = false;
        if (this.hangarEl) this.hangarEl.classList.add('visible');
        this.syncAircraftUI();
      }

      startMission() {
        this.started = true;
        if (this.hangarEl) this.hangarEl.classList.remove('visible');
        this.syncAircraftUI();
        this.updateHUD();
      }

      syncAircraftUI() {
        const isArc = this.isArcAircraft();
        for (const card of this.hangarCards) {
          const selected = card.getAttribute('data-aircraft') === this.jet.aircraftId;
          card.classList.toggle('selected', selected);
          card.setAttribute('aria-pressed', selected ? 'true' : 'false');
        }
        if (this.swarmRoleBtnEl) this.swarmRoleBtnEl.classList.toggle('hidden', isArc);
        if (this.touchSwarmModeEl) this.touchSwarmModeEl.classList.toggle('hidden', isArc);
        if (this.skillLabelEl) this.skillLabelEl.textContent = isArc ? 'EMP [Q] · SHLD [E]' : 'SWARM [E]';
        if (this.controlHintEl) {
          this.controlHintEl.textContent = isArc
            ? 'STEER · SPACE ARC FIRE · Q EMP PULSE · E ENERGY SHIELD'
            : 'STEER · SPACE FIRE · Q MISSILE · E SWARM · F SWARM MODE';
        }
        if (this.controlSubhintEl) {
          this.controlSubhintEl.textContent = isArc
            ? 'WASD / ARROWS STEER · SPACE ARC CANNON · Q EMP (DROPS EVERY ENEMY AHEAD) · E ENERGY SHIELD · P PAUSE · R RESTART'
            : 'WASD / ARROWS STEER · SPACE FIRE · Q HOMING MISSILE · E DRONE SWARM · F SWARM SHIELDER / ATTACKER · P PAUSE · R RESTART';
        }
      }

      stunEnemyDrone(drone, duration) {
        drone.stunned = true;
        drone.stunTimer = Math.max(drone.stunTimer, duration);
        drone.fireTimer = 0;
        drone.muzzleFlash = 0;
        if (drone.vy === undefined) drone.vy = 0;
        if (drone.vx === undefined) drone.vx = 0;
        if (drone.vz === undefined) drone.vz = 0;
        this.spawnTrailParticle(drone.x, drone.y, drone.z, 0, 0, 0, 0.55, 0.95, 1.0, 0.55, 0.4);
      }

      triggerEmp() {
        const j = this.jet;
        j.empFlash = 1.0;
        if (!this.reducedMotion) this.cam.shake = Math.min(0.75, this.cam.shake + 0.38);

        let disabled = 0;
        for (const d of this.drones) {
          if (!d.active || d.stunned) continue;
          if (d.z > j.z - 2.0) continue;
          this.stunEnemyDrone(d, EMP_STUN_DURATION);
          disabled++;
        }
        for (const sd of this.shieldDrones) {
          if (!sd.active || sd.stunned) continue;
          if (sd.z > j.z - 2.0) continue;
          this.stunEnemyDrone(sd, EMP_STUN_DURATION);
          disabled++;
        }

        this.spawnBlast(j.x, j.y + 0.6, j.z - 26.0, 14.0, 0.55, 0.95, 1.0, 'emp');
        this.score += EMP_SCORE + disabled * 25;
        this.updateHUD();
      }

      raiseEnergyShield() {
        const j = this.jet;
        if (j.shieldTimer > 0 || j.shieldCooldown > 0) return;
        j.shieldTimer = SHIELD_SKILL_DURATION;
        j.shieldCooldown = SHIELD_SKILL_COOLDOWN;
        j.shieldHp = j.maxShieldHp;
        j.shieldFlash = 1.0;

        for (let i = 0; i < 12; i++) {
          this.spawnTrailParticle(
            j.x + (Math.random() - 0.5) * 3.0,
            j.y + (Math.random() - 0.5) * 3.0,
            j.z + (Math.random() - 0.5) * 3.0,
            (Math.random() - 0.5) * 14.0, (Math.random() - 0.5) * 14.0, 8.0,
            0.35, 0.92, 1.0, 0.55, 0.32
          );
        }

        this.updateHealthBar();
        this.updateHUD();
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
        const bayWorldX = ms.x + baySide * MOTHERSHIP_HANGAR_BAY_X * Math.cos(ms.roll);
        const bayWorldY = ms.y + MOTHERSHIP_HANGAR_BAY_Y + baySide * MOTHERSHIP_HANGAR_BAY_X * Math.sin(ms.roll);
        const bayWorldZ = ms.z + MOTHERSHIP_HANGAR_BAY_Z + forwardAdvanceFactor * 45.0;

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
        d.stunned = false;
        d.stunTimer = 0;
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
        j.swarmTimer = 10.0;
        j.swarmTriggerCooldown = 0.45;

        const isShielder = j.swarmRole === SWARM_ROLE_SHIELDER;
        if (isShielder) j.shieldHp = j.maxShieldHp;

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
          sd.fireTimer = isShielder ? Infinity : (i / ALLIED_SWARM_COUNT) * 0.11;
          sd.muzzleFlash = isShielder ? 0 : 0.08;

          this.spawnTrailParticle(
            sd.x, sd.y, sd.z,
            (Math.random() - 0.5) * 8.0, (Math.random() - 0.5) * 8.0, 10.0,
            0.2, 0.92, 1.0, 0.55, 0.28
          );
        }
        this.updateHealthBar();
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
            p.isArc = false;
            p.damage = 1;
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
              p.isArc = false;
              p.damage = 1;
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

      spawnBlast(x, y, z, radius, r, g, b, kind) {
        for (let i = 0; i < MAX_BLASTS; i++) {
          const blast = this.blasts[i];
          if (blast.active) continue;
          blast.active = true;
          blast.x = x;
          blast.y = y;
          blast.z = z;
          blast.age = 0;
          blast.life = kind === 'emp' ? 0.85 : BLAST_LIFE;
          blast.kind = kind === 'emp' ? 'emp' : 'fire';
          blast.radius = radius;
          blast.r = r;
          blast.g = g;
          blast.b = b;
          blast.spin = Math.random() * Math.PI * 2;
          return;
        }
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
        if (this.isArcAircraft()) {
          this.fireArcBolts();
          return;
        }
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
              p.isArc = false;
              p.damage = 1;
              break;
            }
          }
        }

        j.muzzleFlashTimer = 0.055;
      }

      fireArcBolts() {
        const j = this.jet;
        const cp = Math.cos(j.pitch), sp = Math.sin(j.pitch);
        const cy = Math.cos(j.yaw),   sy = Math.sin(j.yaw);
        const dirX = -sy * cp;
        const dirY = sp;
        const dirZ = -cy * cp;

        for (const side of [-1, 1]) {
          transformAircraftPoint(
            5.34 * side, 0.30, 0.30,
            j.x, j.y, j.z,
            j.yaw, j.pitch, j.roll,
            this.tempVec3A
          );

          for (let i = 0; i < MAX_PROJECTILES; i++) {
            const p = this.projectiles[i];
            if (p.active) continue;
            p.active = true;
            p.x = this.tempVec3A[0];
            p.y = this.tempVec3A[1];
            p.z = this.tempVec3A[2];
            p.vx = dirX * ARC_BOLT_SPEED + j.vx * 0.12;
            p.vy = dirY * ARC_BOLT_SPEED + j.vy * 0.12;
            p.vz = dirZ * ARC_BOLT_SPEED;
            p.yaw = j.yaw;
            p.pitch = j.pitch;
            p.life = 1.15;
            p.r = 0.42;
            p.g = 0.86;
            p.b = 1.0;
            p.isSwarm = false;
            p.isEnemy = false;
            p.isArc = true;
            p.damage = ARC_BOLT_DAMAGE;
            break;
          }
        }

        j.muzzleFlashTimer = 0.05;
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
        if (this.swarmEl && this.jet) {
          const j = this.jet;
          if (this.isArcAircraft()) {
            if (j.empCooldown > 0) {
              this.swarmEl.textContent = `EMP ${j.empCooldown.toFixed(1)}S`;
            } else if (j.shieldTimer > 0) {
              this.swarmEl.textContent = `SHLD ${j.shieldTimer.toFixed(1)}S`;
            } else if (j.shieldCooldown > 0) {
              this.swarmEl.textContent = `CD ${j.shieldCooldown.toFixed(1)}S`;
            } else {
              this.swarmEl.textContent = 'EMP READY';
            }
          } else if (j.swarmTimer > 0) {
            this.swarmEl.textContent = `ACT ${j.swarmTimer.toFixed(1)}S`;
          } else if (j.swarmCooldown > 0) {
            this.swarmEl.textContent = `CD ${j.swarmCooldown.toFixed(1)}S`;
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
        if (this.shieldEl && this.mothership) {
          const shielding = this.countShieldingDrones();
          if (this.mothership.active && shielding > 0) {
            const pct = Math.round((shielding / SHIELD_DRONE_COUNT) * 100);
            this.shieldEl.textContent = `${pct}%`;
            this.shieldEl.classList.add('shield-up');
            this.shieldEl.classList.remove('shield-down');
          } else if (this.mothership.active) {
            this.shieldEl.textContent = this.mothership.redeployTimer > 0
              ? `DOWN · ${Math.ceil(this.mothership.redeployTimer)}S`
              : 'DOWN';
            this.shieldEl.classList.remove('shield-up');
            this.shieldEl.classList.add('shield-down');
          } else {
            this.shieldEl.textContent = 'OFFLINE';
            this.shieldEl.classList.remove('shield-up', 'shield-down');
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

        const shieldRatio = j.maxShieldHp > 0 ? Math.max(0, Math.min(1, j.shieldHp / j.maxShieldHp)) : 0;
        if (this.shieldTrackerEl) {
          const shieldUp = j.swarmRole === SWARM_ROLE_SHIELDER && j.shieldHp > 0;
          this.shieldTrackerEl.classList.toggle('hidden', !shieldUp);
          if (this.shieldFillEl) this.shieldFillEl.style.transform = `scaleX(${shieldRatio.toFixed(4)})`;
          if (this.shieldValueEl) this.shieldValueEl.textContent = `${Math.round(shieldRatio * 100)}%`;
          this.shieldTrackerEl.setAttribute('aria-valuenow', String(Math.round(shieldRatio * 100)));
        }
      }

      applyJetDamage(amount, hitX, hitY, hitZ, impactScale) {
        if (this.gameOver) return;

        const j = this.jet;
        if (j.shieldHp > 0) {
          const absorbed = Math.min(j.shieldHp, amount);
          j.shieldHp -= absorbed;
          amount -= absorbed;
          j.shieldFlash = 1.0;
          this.spawnExplosion(hitX, hitY, hitZ, 8, 0.5);
          if (j.shieldHp <= 0) {
            j.shieldHp = 0;
            for (const sd of this.swarmDrones) sd.active = false;
            j.swarmTimer = 0;
            j.swarmCooldown = 4.5;
          }
          this.updateHealthBar();
          this.updateHUD();
          if (amount <= 0) return;
        }

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
      stepWorldBackdrop(dt) {
        this.time += dt;
        const worldSpeed = 62.0;
        this.terrainScrollZ = (this.terrainScrollZ + worldSpeed * dt) % TERRAIN_DEPTH;

        for (let i = 0; i < MAX_SPEEDLINES; i++) {
          const s = this.speedLines[i];
          s.z += worldSpeed * 2.1 * dt;
          if (s.z > 16.0) this.initSpeedLine(s, -135.0 - Math.random() * 30.0);
        }

        const hangarLerp = 1.0 - Math.exp(-4.5 * dt);
        this.cam.x += (Math.sin(this.time * 0.24) * 10.0 - this.cam.x) * hangarLerp;
        this.cam.y += (3.3 + Math.sin(this.time * 0.18) * 1.2 - this.cam.y) * hangarLerp;
        this.cam.z += (13.4 - this.cam.z) * hangarLerp;
        this.cam.lookX += (Math.sin(this.time * 0.24) * 11.0 - this.cam.lookX) * hangarLerp;
        this.cam.lookY += (1.7 - this.cam.lookY) * hangarLerp;
        this.cam.lookZ += (-34.0 - this.cam.lookZ) * hangarLerp;
        this.cam.roll += (Math.sin(this.time * 0.16) * 0.06 - this.cam.roll) * hangarLerp;
      }

      step(dt) {
        if (this.paused) return;

        if (!this.started) {
          this.stepWorldBackdrop(dt);
          return;
        }

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
        if (j.shieldFlash > 0) j.shieldFlash = Math.max(0, j.shieldFlash - dt * 4.0);
        if (j.empFlash > 0) j.empFlash = Math.max(0, j.empFlash - dt * 2.2);

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

          const isArc = this.isArcAircraft();
          const wantsFire = this.keys.fire || this.touchInput.fire;
          if (j.fireCooldown > 0) j.fireCooldown -= dt;
          if (j.missileCooldown > 0) j.missileCooldown -= dt;
          if (j.swarmTriggerCooldown > 0) j.swarmTriggerCooldown -= dt;
          if (j.shieldCooldown > 0) j.shieldCooldown = Math.max(0, j.shieldCooldown - dt);
          if (j.empCooldown > 0) {
            j.empCooldown = Math.max(0, j.empCooldown - dt);
            this.updateHUD();
          }
          if (j.swarmCooldown > 0) {
            j.swarmCooldown = Math.max(0, j.swarmCooldown - dt);
            this.updateHUD();
          }
          if (j.shieldTimer > 0) {
            j.shieldTimer = Math.max(0, j.shieldTimer - dt);
            if (j.shieldTimer <= 0) {
              j.shieldHp = 0;
              this.updateHealthBar();
              this.updateHUD();
            }
          }
          if (j.muzzleFlashTimer > 0) j.muzzleFlashTimer = Math.max(0, j.muzzleFlashTimer - dt);

          if (wantsFire && j.fireCooldown <= 0) {
            this.fireProjectiles();
            j.fireCooldown = isArc ? ARC_FIRE_COOLDOWN : 0.095;
          }
          this.pipperEl?.classList.toggle('firing', wantsFire);

          const wantsMissile = this.keys.missile || this.touchInput.missile;
          if (isArc) {
            if (wantsMissile && j.empCooldown <= 0) {
              this.triggerEmp();
              j.empCooldown = EMP_COOLDOWN;
            }
          } else if (wantsMissile && j.missileCooldown <= 0) {
            this.launchHomingMissile();
            j.missileCooldown = 0.45; // Tactical salvo launch cooldown
          }

          const wantsSwarm = this.keys.swarm || this.touchInput.swarm;
          if (isArc) {
            if (wantsSwarm && j.shieldTriggerCooldown <= 0) {
              this.raiseEnergyShield();
              j.shieldTriggerCooldown = 0.4;
            }
          } else if (wantsSwarm && j.swarmTriggerCooldown <= 0 && j.swarmTimer <= 0 && j.swarmCooldown <= 0) {
            this.deployAlliedSwarm();
          }
          if (j.shieldTriggerCooldown > 0) j.shieldTriggerCooldown = Math.max(0, j.shieldTriggerCooldown - dt);
        }

        // 4B. Update Allied Swarm Drones (Attacker Barrage or Shielder Bubble Formation)
        if (j.swarmTimer > 0) {
          j.swarmTimer = Math.max(0, j.swarmTimer - dt);
          this.updateHUD();

          const isShielder = j.swarmRole === SWARM_ROLE_SHIELDER;
          const validTargets = [];
          if (!isShielder) {
            for (let k = 0; k < MAX_DRONES; k++) {
              const d = this.drones[k];
              if (d.active && d.z < j.z - 4.0 && d.z > -285.0) {
                validTargets.push(d);
              }
            }
            validTargets.sort((a, b) => b.z - a.z);
            if (validTargets.length === 0 && this.mothership && this.mothership.active) {
              validTargets.push({
                active: true,
                x: this.mothership.x,
                y: this.mothership.y,
                z: this.mothership.z,
                vz: 0
              });
            }
          }

          const swarmFollowLerp = 1.0 - Math.exp(-9.0 * dt);
          for (let i = 0; i < ALLIED_SWARM_COUNT; i++) {
            const sd = this.swarmDrones[i];
            sd.active = true;

            const orbitAngle = this.time * (isShielder ? 1.4 : 2.6) + i * (Math.PI / 3);
            let formX, formY, formZ;

            if (isShielder) {
              formX = Math.cos(orbitAngle) * (PLAYER_SHIELD_RING_RADIUS - 0.8);
              formY = Math.sin(orbitAngle) * (PLAYER_SHIELD_RING_RADIUS - 0.8) * 0.72;
              formZ = Math.sin(orbitAngle * 1.7) * 0.9 - 0.4;
            } else {
              const side = (i % 2 === 0) ? -1 : 1;
              const rank = Math.floor(i / 2);
              formX = side * (4.8 + rank * 2.8) + Math.cos(orbitAngle) * 1.1;
              formY = 0.65 + (1 - rank) * 1.15 + Math.sin(orbitAngle * 1.3) * 0.85;
              formZ = -3.8 - rank * 1.8;
            }

            transformAircraftPoint(formX, formY, formZ, j.x, j.y, j.z, j.yaw, j.pitch, j.roll, this.tempVec3A);
            sd.x += (this.tempVec3A[0] - sd.x) * swarmFollowLerp;
            sd.y += (this.tempVec3A[1] - sd.y) * swarmFollowLerp;
            sd.z += (this.tempVec3A[2] - sd.z) * swarmFollowLerp;
            sd.roll = j.roll * 0.85 + Math.sin(orbitAngle) * 0.25;

            if (sd.muzzleFlash > 0) sd.muzzleFlash = Math.max(0, sd.muzzleFlash - dt);
            if (isShielder) continue;

            sd.fireTimer -= dt;
            if (sd.fireTimer <= 0) {
              sd.fireTimer = 0.11;
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
            j.shieldHp = 0;
            j.swarmCooldown = 4.5;
            this.updateHealthBar();
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
              d.hp -= p.damage;
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
                this.spawnBlast(d.x, d.y, d.z, d.enemyType === 1 ? 10.0 : 7.0, 1.0, 0.68, 0.26);
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

          for (let s = 0; s < SHIELD_DRONE_COUNT; s++) {
            const sd = this.shieldDrones[s];
            if (!sd.active) continue;
            const sdx = p.x - sd.x;
            const sdy = p.y - sd.y;
            const sdz = p.z - sd.z;
            if (sdx * sdx + sdy * sdy + sdz * sdz < 30.0) {
              p.active = false;
              this.damageShieldDrone(sd, p.damage, p.x, p.y, p.z);
              break;
            }
          }

          // Check projectile collision against the Enemy Mothership Flagship
          if (p.active && this.mothership && this.mothership.active) {
            const ms = this.mothership;
            const mdx = Math.abs(p.x - ms.x);
            const mdy = Math.abs(p.y - ms.y);
            const mdz = Math.abs(p.z - ms.z);
            if (mdx < MOTHERSHIP_BOLT_HIT_X && mdy < MOTHERSHIP_BOLT_HIT_Y && mdz < MOTHERSHIP_BOLT_HIT_Z) {
              p.active = false;
              if (this.isMothershipShielded()) {
                this.blockMothershipHit(p.x, p.y, p.z);
              } else {
                this.damageMothership(MOTHERSHIP_BULLET_DAMAGE * p.damage, p.x, p.y, p.z);
              }
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

              this.spawnBlast(d.x, d.y, d.z, d.enemyType === 1 ? 16.0 : 12.0, 1.0, 0.66, 0.22);
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

          for (let s = 0; s < SHIELD_DRONE_COUNT; s++) {
            const sd = this.shieldDrones[s];
            if (!sd.active) continue;
            const dsx = m.x - sd.x;
            const dsy = m.y - sd.y;
            const dsz = m.z - sd.z;
            if (dsx * dsx + dsy * dsy + dsz * dsz < 36.0) {
              m.active = false;
              this.damageShieldDrone(sd, sd.maxHp, m.x, m.y, m.z);
              break;
            }
          }

          // Check homing missile impact against the Enemy Mothership Flagship
          if (m.active && this.mothership && this.mothership.active) {
            const ms = this.mothership;
            const mdx = Math.abs(m.x - ms.x);
            const mdy = Math.abs(m.y - ms.y);
            const mdz = Math.abs(m.z - ms.z);
            if (mdx < MOTHERSHIP_MISSILE_HIT_X && mdy < MOTHERSHIP_MISSILE_HIT_Y && mdz < MOTHERSHIP_MISSILE_HIT_Z) {
              m.active = false;
              this.spawnExplosion(m.x, m.y, m.z, 32, 1.35);
              if (this.isMothershipShielded()) {
                this.spawnBlast(m.x, m.y, m.z, 10.0, 0.35, 0.85, 1.0);
                this.blockMothershipHit(m.x, m.y, m.z);
              } else {
                this.spawnBlast(m.x, m.y, m.z, 15.0, 1.0, 0.66, 0.22);
                this.damageMothership(MOTHERSHIP_MISSILE_DAMAGE, m.x, m.y, m.z);
              }
            }
          }
        }

        // 5C. Update Enemy Mothership Flagship Movement, Shield Redeployment & Respawn
        const ms = this.mothership;
        if (ms.active) {
          ms.phase += dt * 0.55;
          // Smoothly glide from deep warp arrival (-320) to tactical carrier orbit (-185)
          ms.z += (ms.targetZ - ms.z) * (1.0 - Math.exp(-2.2 * dt));
          ms.x = Math.sin(ms.phase) * 11.5;
          ms.y = 6.2 + Math.cos(ms.phase * 0.7) * 2.2;
          ms.roll = -Math.cos(ms.phase) * 0.16;

          if (ms.hitFlash > 0) ms.hitFlash = Math.max(0, ms.hitFlash - dt * 5.0);
          if (ms.shieldFlash > 0) ms.shieldFlash = Math.max(0, ms.shieldFlash - dt * 2.6);
          if (ms.bayFlashLeft > 0) ms.bayFlashLeft = Math.max(0, ms.bayFlashLeft - dt * 3.2);
          if (ms.bayFlashRight > 0) ms.bayFlashRight = Math.max(0, ms.bayFlashRight - dt * 3.2);

          if (ms.redeployTimer > 0) {
            ms.redeployTimer = Math.max(0, ms.redeployTimer - dt);
            this.updateHUD();
            if (ms.redeployTimer <= 0) this.deployShieldRing();
          }
        } else {
          ms.respawnTimer = Math.max(0, ms.respawnTimer - dt);
          this.updateHUD();
          if (ms.respawnTimer <= 0) {
            ms.active = true;
            ms.z = -335.0;
            ms.maxHp = Math.round(ms.maxHp * MOTHERSHIP_RESPAWN_GROWTH);
            ms.hp = ms.maxHp;
            ms.hitFlash = 0.5;
            this.deployShieldRing();
            this.updateHUD();
          }
        }

        // 5D. Update the Mothership Shield Ring and its Kamikaze Escalation
        for (let i = 0; i < SHIELD_DRONE_COUNT; i++) {
          const sd = this.shieldDrones[i];
          if (!sd.active) continue;

          if (sd.hitFlash > 0) sd.hitFlash = Math.max(0, sd.hitFlash - dt * 5.5);

          if (sd.stunned) {
            sd.stunTimer -= dt;
            sd.vy -= EMP_FALL_ACCEL * dt;
            sd.y += sd.vy * dt;
            sd.x += sd.vx * dt;
            sd.z += sd.vz * 0.25 * dt;
            sd.roll += dt * 9.0;
            if (sd.stunTimer <= 0 || sd.y < EMP_KILL_Y) {
              sd.active = false;
              this.spawnBlast(sd.x, sd.y, sd.z, 9.0, 0.40, 0.86, 1.0);
              this.spawnExplosion(sd.x, sd.y, sd.z, 22, 1.1);
              this.score += EMP_SCORE;
              this.targetsDestroyed += 1;
              this.updateHUD();
            }
            continue;
          }

          if (sd.mode === 'shield') {
            sd.age += dt;
            sd.phase += dt * 0.9;
            this.updateShieldDroneTransform(sd, ms.x, ms.z);
            if (sd.age >= SHIELD_DRONE_PATIENCE) {
              sd.mode = 'kamikaze';
              sd.vx = 0;
              sd.vy = 0;
              sd.vz = 0;
              sd.trailTimer = 0;
              sd.roll = 0;
              this.spawnExplosion(sd.x, sd.y, sd.z, 10, 0.7);
            }
            continue;
          }

          const kdx = j.x - sd.x;
          const kdy = j.y - sd.y;
          const kdz = j.z - sd.z;
          const kamikazeDistance = Math.hypot(kdx, kdy, kdz) || 1.0;
          const kamikazeLerp = 1.0 - Math.exp(-3.2 * dt);

          sd.vx += ((kdx / kamikazeDistance) * KAMIKAZE_SPEED - sd.vx) * kamikazeLerp;
          sd.vy += ((kdy / kamikazeDistance) * KAMIKAZE_SPEED - sd.vy) * kamikazeLerp;
          sd.vz += ((kdz / kamikazeDistance) * KAMIKAZE_SPEED - sd.vz) * kamikazeLerp;

          sd.x += sd.vx * dt;
          sd.y += sd.vy * dt;
          sd.z += sd.vz * dt;

          const kamikazeSpeed = Math.hypot(sd.vx, sd.vy, sd.vz) || 1.0;
          sd.pitch = Math.asin(Math.max(-0.995, Math.min(0.995, sd.vy / kamikazeSpeed)));
          sd.yaw = Math.atan2(-sd.vx / kamikazeSpeed, -sd.vz / kamikazeSpeed);
          sd.roll += dt * 6.0;

          sd.trailTimer -= dt;
          if (sd.trailTimer <= 0) {
            sd.trailTimer = 0.022;
            this.spawnTrailParticle(sd.x, sd.y, sd.z, 0, 0, 0, 1.0, 0.34, 0.22, 0.34, 0.2);
          }

          if (kamikazeDistance < KAMIKAZE_TRIGGER_RANGE) {
            sd.active = false;
            this.spawnBlast(sd.x, sd.y, sd.z, 11.0, 1.0, 0.55, 0.18);
            this.spawnExplosion(sd.x, sd.y, sd.z, 34, 1.45);
            if (!this.reducedMotion) this.cam.shake = Math.min(0.7, this.cam.shake + 0.3);
            this.applyJetDamage(KAMIKAZE_DAMAGE, sd.x, sd.y, sd.z, 1.0);
            continue;
          }

          if (sd.z > 26.0) {
            sd.active = false;
          }
        }

        this.refreshMothershipShieldState();

        // 6. Update Enemy Drones & Controlled Launch from Mothership Hangar Bays
        let activeDroneCount = 0;
        for (let i = 0; i < MAX_DRONES; i++) {
          const d = this.drones[i];
          if (!d.active) continue;

          if (d.stunned) {
            d.stunTimer -= dt;
            d.vy -= EMP_FALL_ACCEL * dt;
            d.y += d.vy * dt;
            d.x += d.vx * dt;
            d.z += d.vz * 0.25 * dt;
            d.spin += dt * 8.0;
            d.bankAngle += dt * 11.0;
            if (d.hitFlash > 0) d.hitFlash = Math.max(0, d.hitFlash - dt * 5.5);
            if (d.stunTimer <= 0 || d.y < EMP_KILL_Y) {
              d.active = false;
              this.spawnBlast(d.x, d.y, d.z, 9.0, 0.40, 0.86, 1.0);
              this.spawnExplosion(d.x, d.y, d.z, 22, 1.1);
              this.score += EMP_SCORE;
              this.targetsDestroyed += 1;
              this.updateHUD();
            }
            activeDroneCount++;
            continue;
          }

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

        for (let i = 0; i < MAX_BLASTS; i++) {
          const blast = this.blasts[i];
          if (!blast.active) continue;
          blast.age += dt;
          blast.spin += dt * 2.4;
          if (blast.age >= blast.life) blast.active = false;
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
          ms.shieldBroken = true;
          ms.redeployTimer = 0;
          this.score += 1500;
          this.targetsDestroyed += 1;
          for (const sd of this.shieldDrones) sd.active = false;
          this.spawnExplosion(ms.x, ms.y, ms.z, 55, 2.4);
          this.spawnExplosion(ms.x - 14.4, ms.y - 1.6, ms.z + 4.8, 35, 1.8);
          this.spawnExplosion(ms.x + 14.4, ms.y - 1.6, ms.z + 4.8, 35, 1.8);
          if (!this.reducedMotion) this.cam.shake = 0.85;
        }
        this.updateHUD();
      }

      damageShieldDrone(shieldDrone, amount, hitX, hitY, hitZ) {
        shieldDrone.hp -= amount;
        shieldDrone.hitFlash = 1.0;
        this.spawnExplosion(hitX, hitY, hitZ, 7, 0.55);

        if (shieldDrone.hp > 0) {
          this.score += 25;
          this.updateHUD();
          return;
        }

        shieldDrone.active = false;
        this.score += 150;
        this.targetsDestroyed += 1;
        this.spawnBlast(shieldDrone.x, shieldDrone.y, shieldDrone.z, 7.0, 0.40, 0.85, 1.0);
        this.spawnExplosion(shieldDrone.x, shieldDrone.y, shieldDrone.z, 26, 1.15);
        if (!this.reducedMotion) this.cam.shake = Math.min(0.5, this.cam.shake + 0.18);
        this.updateHUD();
      }

      blockMothershipHit(hitX, hitY, hitZ) {
        const ms = this.mothership;
        if (ms) ms.shieldFlash = 1.0;

        for (let k = 0; k < 4; k++) {
          this.spawnTrailParticle(
            hitX, hitY, hitZ,
            (Math.random() - 0.5) * 16.0,
            (Math.random() - 0.5) * 16.0,
            8.0,
            0.35, 0.92, 1.0, 0.42, 0.24
          );
        }

        this.pipperEl?.classList.add('hit-confirm');
        clearTimeout(this._hitConfirmTimer);
        this._hitConfirmTimer = setTimeout(() => this.pipperEl?.classList.remove('hit-confirm'), 60);
      }

      refreshMothershipShieldState() {
        const ms = this.mothership;
        if (!ms || !ms.active) return;
        if (this.countShieldingDrones() > 0) return;
        if (ms.shieldBroken && ms.redeployTimer > 0) return;

        ms.shieldBroken = true;
        ms.redeployTimer = SHIELD_REDEPLOY_DELAY;
        ms.shieldFlash = 1.0;
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
        const playerIsArc = this.isArcAircraft();
        const fighterStart = instCount;
        if (!this.gameOver && !playerIsArc) {
          pushInstance(
            j.x, j.y + microBuffetY, j.z,
            j.yaw, j.pitch, j.roll,
            1, 1, 1,
            1, 1, 1, 1,
            0, 0, 1.0, j.hullFlash
          );
        }
        batches.fighter = { first: fighterStart, count: instCount - fighterStart };

        const voltFighterStart = instCount;
        if (!this.gameOver && playerIsArc) {
          pushInstance(
            j.x, j.y + microBuffetY, j.z,
            j.yaw, j.pitch, j.roll,
            1, 1, 1,
            1, 1, 1, 1,
            0, 0.35, 1.0, j.hullFlash
          );
        }
        batches.voltFighter = { first: voltFighterStart, count: instCount - voltFighterStart };

        // 2B. ENEMY AERIAL MOTHERSHIP CARRIER (Flagship in the distance)
        const mothershipStart = instCount;
        const mothershipScale = MOTHERSHIP_INSTANCE_SCALE;
        if (this.mothership && this.mothership.active) {
          const ms = this.mothership;
          pushInstance(
            ms.x, ms.y, ms.z,
            0, ms.pitch, ms.roll,
            mothershipScale, mothershipScale, mothershipScale,
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
            d.stunned ? 0.45 : 1, d.stunned ? 0.75 : 1, 1, 1,
            0, d.stunned ? 1.4 : 0.6, 0.5, d.hitFlash
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
            d.stunned ? 0.45 : 1, d.stunned ? 0.75 : 1, 1, 1,
            0, d.stunned ? 1.4 : 0.75, 0.5, d.hitFlash
          );
        }
        batches.heavyDrone = { first: heavyDroneStart, count: instCount - heavyDroneStart };

        // 3A2. MOTHERSHIP SHIELD PROJECTOR DRONES (Shield ring and kamikaze escalation)
        const shieldDroneStart = instCount;
        for (let i = 0; i < SHIELD_DRONE_COUNT; i++) {
          const sd = this.shieldDrones[i];
          if (!sd.active) continue;
          const isKamikaze = sd.mode === 'kamikaze';
          pushInstance(
            sd.x, sd.y, sd.z,
            sd.yaw, sd.pitch, sd.roll,
            1.6, 1.6, 1.6,
            sd.stunned ? 0.45 : (isKamikaze ? 1.0 : 0.85),
            sd.stunned ? 0.75 : (isKamikaze ? 0.35 : 0.95),
            sd.stunned ? 1.0 : (isKamikaze ? 0.28 : 1.0), 1,
            0, sd.stunned ? 1.4 : (isKamikaze ? 1.0 : 0.7), 0.5, sd.hitFlash
          );
        }
        batches.shieldDrone = { first: shieldDroneStart, count: instCount - shieldDroneStart };

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
          if (!p.active || p.isArc) continue;
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

        const boltStart = instCount;
        for (let i = 0; i < MAX_PROJECTILES; i++) {
          const p = this.projectiles[i];
          if (!p.active || !p.isArc) continue;
          pushInstance(
            p.x, p.y, p.z,
            p.yaw, p.pitch, this.time * 46.0 + i,
            0.85, 0.85, 0.85,
            p.r, p.g, p.b, 1.0,
            4.0, 2.2, 0, 0
          );
        }
        batches.lightningBolt = { first: boltStart, count: instCount - boltStart };

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
              playerIsArc ? 0.45 : 1.0, playerIsArc ? 0.85 : 0.55, playerIsArc ? 1.0 : 0.18, 0.92,
              4.0, playerIsArc ? 1.1 : 1.6, 0, 0
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

        // Rocket motor flames on each active homing missile: a hot inner core plus a wide outer flame
        for (let i = 0; i < MAX_MISSILES; i++) {
          const ms = this.missiles[i];
          if (!ms.active) continue;

          transformAircraftPoint(
            0, 0, 1.62,
            ms.x, ms.y, ms.z,
            ms.yaw, ms.pitch, ms.roll,
            this.tempVec3A
          );
          pushInstance(
            this.tempVec3A[0], this.tempVec3A[1], this.tempVec3A[2],
            ms.yaw, ms.pitch, ms.roll,
            1.00, 1.00, 1.85 * pulse,
            0.86, 0.28, 0.05, 0.92,
            4.0, 0.0, 0, 0
          );

          transformAircraftPoint(
            0, 0, 1.46,
            ms.x, ms.y, ms.z,
            ms.yaw, ms.pitch, ms.roll,
            this.tempVec3A
          );
          pushInstance(
            this.tempVec3A[0], this.tempVec3A[1], this.tempVec3A[2],
            ms.yaw, ms.pitch, ms.roll,
            0.52, 0.52, 1.25 * pulse,
            0.80, 0.62, 0.24, 0.85,
            4.0, 0.0, 0, 0
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
              MOTHERSHIP_HANGAR_BAY_X * side, MOTHERSHIP_HANGAR_BAY_Y, MOTHERSHIP_HANGAR_BAY_Z,
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

        // Enemy shield barrier projected by the projector formation, drone-held and drone-count scaled
        const shieldPanelStart = instCount;
        if (this.mothership && this.mothership.active) {
          const ms = this.mothership;
          const shielding = this.countShieldingDrones();
          const shieldRatio = shielding / SHIELD_DRONE_COUNT;
          if (shielding > 0 || ms.shieldFlash > 0) {
            const panelPulse = 1.0 + Math.sin(this.time * 2.1) * 0.05;
            const panelAlpha = Math.min(0.22, 0.03 + shieldRatio * 0.13 + ms.shieldFlash * 0.10);
            pushInstance(
              ms.x, SHIELD_FORMATION_CENTER_Y, ms.z + SHIELD_FORMATION_Z + SHIELD_PANEL_OFFSET_Z,
              0, 0, 0,
              SHIELD_PANEL_WIDTH * panelPulse,
              SHIELD_PANEL_HEIGHT * panelPulse,
              1,
              0.30, 0.62, 1.0, panelAlpha,
              4.0, SHIELD_PANEL_BASE_GLOW + ms.shieldFlash * 1.4, 0, 0
            );
          }
        }
        batches.shieldPanel = { first: shieldPanelStart, count: instCount - shieldPanelStart };

        // Player shield halo: an open ring so the aircraft and the forward view stay unobstructed
        const shieldRingStart = instCount;
        if (!this.gameOver && j.shieldHp > 0) {
          const playerShieldRatio = Math.max(0, Math.min(1, j.shieldHp / j.maxShieldHp));
          pushInstance(
            j.x, j.y + microBuffetY, j.z,
            j.yaw, j.pitch, 0,
            PLAYER_SHIELD_RING_RADIUS, PLAYER_SHIELD_RING_RADIUS, PLAYER_SHIELD_RING_RADIUS,
            0.34, 0.80, 1.0, 0.10 + playerShieldRatio * 0.10 + j.shieldFlash * 0.16,
            4.0, 0.22 + j.shieldFlash * 1.3, 0, 0
          );
        }
        batches.shieldRing = { first: shieldRingStart, count: instCount - shieldRingStart };

        // Detonation fireballs and expanding shockwave rings
        const blastFireStart = instCount;
        for (let i = 0; i < MAX_BLASTS; i++) {
          const blast = this.blasts[i];
          if (!blast.active || blast.kind === 'emp') continue;
          const progress = Math.min(1, blast.age / blast.life);
          const eased = 1 - (1 - progress) * (1 - progress);
          const core = blast.radius * (0.14 + eased * 0.28);
          const holdFade = progress < 0.65 ? 1.0 : Math.max(0, 1 - (progress - 0.65) / 0.35);
          pushInstance(
            blast.x, blast.y, blast.z,
            blast.spin, blast.spin * 0.7, blast.spin * 0.45,
            core, core, core,
            0.95, 0.85 - progress * 0.62, 0.55 - progress * 0.50, holdFade,
            4.0, 0.0, 0, 0
          );
        }
        batches.blastSphere = { first: blastFireStart, count: instCount - blastFireStart };

        const blastWaveStart = instCount;
        for (let i = 0; i < MAX_BLASTS; i++) {
          const blast = this.blasts[i];
          if (!blast.active) continue;
          const progress = Math.min(1, blast.age / blast.life);
          const eased = 1 - (1 - progress) * (1 - progress);
          const wave = blast.kind === 'emp'
            ? blast.radius * (0.30 + eased * 1.60)
            : blast.radius * (0.22 + eased * 0.80);
          const waveFade = (1 - progress) * 0.90;
          pushInstance(
            blast.x, blast.y, blast.z,
            0, 0, 0,
            wave, wave, wave,
            blast.r, blast.g * 0.72 + 0.10, blast.b * 0.45 + 0.08, waveFade,
            4.0, 0.0, 0, 0
          );
        }
        batches.blastRing = { first: blastWaveStart, count: instCount - blastWaveStart };

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

