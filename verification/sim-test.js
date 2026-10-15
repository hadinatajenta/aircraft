const fs = require('fs');
const path = require('path');
const vm = require('vm');

const targetFile = process.env.SKYSTRIKE_FILE || path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(targetFile, 'utf8');

function readInlineScript(markup) {
  const openIndex = markup.indexOf('<script>');
  const closeIndex = markup.lastIndexOf('</script>');
  if (openIndex === -1 || closeIndex === -1 || closeIndex < openIndex) return null;
  const body = markup.slice(openIndex + '<script>'.length, closeIndex);
  return body.trim() === '' ? null : body;
}

function readExternalScripts(markup, baseDirectory) {
  const pattern = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi;
  return [...markup.matchAll(pattern)].map((match) =>
    fs.readFileSync(path.resolve(baseDirectory, match[1]), 'utf8').replace(/^"use strict";\r?\n/, '')
  );
}

const inlineScript = readInlineScript(html);
const scriptParts = inlineScript === null
  ? readExternalScripts(html, path.dirname(targetFile))
  : [inlineScript];

if (scriptParts.length === 0) {
  process.stderr.write(`no game script found in ${targetFile}: expected an inline <script> block or <script src> tags\n`);
  process.exit(2);
}

let code = scriptParts.join('\n');
code += '\n;globalThis.__SIM = SkystrikeSimulation;\n';

function makeClassList() {
  const store = new Set();
  return {
    add: (name) => store.add(name),
    remove: (name) => store.delete(name),
    contains: (name) => store.has(name),
    toggle: (name, force) => {
      if (force === undefined) {
        if (store.has(name)) store.delete(name); else store.add(name);
      } else if (force) {
        store.add(name);
      } else {
        store.delete(name);
      }
      return store.has(name);
    }
  };
}

function makeElement(id) {
  const attributes = {};
  return {
    id,
    textContent: '',
    style: {},
    classList: makeClassList(),
    setAttribute: (key, value) => { attributes[key] = String(value); },
    getAttribute: (key) => attributes[key],
    addEventListener: () => {},
    focus: () => { attributes.focused = 'true'; }
  };
}

const elements = new Map();
const documentStub = {
  getElementById: (id) => {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  }
};

function makeRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const seededMath = Object.create(Math);
seededMath.random = makeRandom(20261015);

const sandbox = {
  Math: seededMath,
  document: documentStub,
  window: {
    addEventListener: () => {},
    matchMedia: () => ({ matches: false }),
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1
  },
  console,
  setTimeout,
  clearTimeout,
  requestAnimationFrame: () => {},
  performance: { now: () => 0 }
};

vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const SkystrikeSimulation = sandbox.__SIM;
const DT = 1 / 60;
const results = [];

function check(label, condition, detail) {
  results.push({ label, passed: Boolean(condition), detail });
}

function newSim() {
  return new SkystrikeSimulation();
}

function stepFor(sim, seconds) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) sim.step(DT);
}

function spawnHeavy(sim) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const existing = sim.drones.find((d) => d.active && d.enemyType === 1);
    if (existing) return existing;
    sim.spawnDroneFromMothership(0);
  }
  return sim.drones.find((d) => d.active && d.enemyType === 1) || null;
}

function spawnRecon(sim) {
  const existing = sim.drones.find((d) => d.active && d.enemyType === 0);
  if (existing) return existing;
  for (let attempt = 0; attempt < 200; attempt++) {
    sim.spawnDroneFromMothership(0);
    const found = sim.drones.find((d) => d.active && d.enemyType === 0);
    if (found) return found;
  }
  return null;
}

function takeFreeProjectile(sim) {
  return sim.projectiles.find((p) => !p.active);
}

{
  const sim = newSim();
  check('A1 initial health is MAX_JET_HEALTH', sim.jet.health === 100 && sim.jet.maxHealth === 100, `health=${sim.jet.health}`);
  check('A2 initial hp bar is full and announced', elements.get('hp-fill').style.transform === 'scaleX(1.0000)' && elements.get('hp-tracker').getAttribute('aria-valuenow') === '100');
  check('A3 initial score and target tally are zero', sim.score === 0 && sim.targetsDestroyed === 0);
  check('A4 initial state is not game over', sim.gameOver === false && !elements.get('gameover-overlay').classList.contains('visible'));
  check('A5 no projectile starts flagged as enemy', sim.projectiles.every((p) => p.isEnemy === false));

  sim.applyJetDamage(35, 0, 1.5, 0, 0.5);
  check('A6 damage reduces health', sim.jet.health === 65, `health=${sim.jet.health}`);
  sim.reset();
  check('A7 reset restores health and hides game over', sim.jet.health === 100 && sim.gameOver === false && !elements.get('gameover-overlay').classList.contains('visible'));
}

{
  const sim = newSim();
  const fill = elements.get('hp-fill');

  sim.jet.health = 60;
  sim.updateHealthBar();
  check('B1 60% shows the warning colour', fill.classList.contains('is-warning') && !fill.classList.contains('is-critical'), fill.style.transform);

  sim.jet.health = 30;
  sim.updateHealthBar();
  check('B2 30% is still warning', fill.classList.contains('is-warning') && !fill.classList.contains('is-critical'));

  sim.jet.health = 28;
  sim.updateHealthBar();
  check('B3 28% switches to critical', fill.classList.contains('is-critical') && !fill.classList.contains('is-warning'));

  sim.jet.health = 0;
  sim.updateHealthBar();
  check('B4 0% is critical and announces zero', fill.classList.contains('is-critical') && elements.get('hp-tracker').getAttribute('aria-valuenow') === '0');

  sim.jet.health = 100;
  sim.updateHealthBar();
  check('B5 full health clears both colour states', !fill.classList.contains('is-warning') && !fill.classList.contains('is-critical'));
}

{
  const sim = newSim();
  sim.applyJetDamage = () => {};

  const heavy = spawnHeavy(sim);
  check('C1 a heavy gunship can launch from the mothership', heavy !== null && heavy.enemyType === 1);
  check('C2 heavy gunship is assigned a forward station', heavy.stationZ < 0 && heavy.stationZ > -160, `stationZ=${heavy.stationZ.toFixed(1)}`);

  stepFor(sim, 12);
  check('C3 heavy gunship advances to and holds its station', Math.abs(heavy.z - heavy.stationZ) < 0.001, `z=${heavy.z.toFixed(2)} stationZ=${heavy.stationZ.toFixed(2)}`);

  const zAtStation = heavy.z;
  stepFor(sim, 20);
  check('C4 heavy gunship never drifts past its station', heavy.z === zAtStation, `z=${heavy.z.toFixed(2)}`);
  check('C5 heavy gunship stays alive on station', heavy.active === true);

  let fireCount = 0;
  const originalFire = sim.fireHeavyGunship.bind(sim);
  sim.fireHeavyGunship = (gunship) => {
    fireCount++;
    originalFire(gunship);
  };
  stepFor(sim, 25);
  check('C6 heavy gunship keeps firing at the player', fireCount >= 5, `fires=${fireCount} in 25s`);

  sim.projectiles.forEach((p) => { p.active = false; });
  originalFire(heavy);
  const salvo = sim.projectiles.filter((p) => p.active && p.isEnemy);
  check('C7 a salvo is a twin-barrel pair', salvo.length === 2, `bolts=${salvo.length}`);
  check('C8 enemy bolts travel toward the player (+Z)', salvo.every((p) => p.vz > 0));
  check('C9 enemy bolts use the crimson tint and are not swarm bolts', salvo.every((p) => p.r === 1.0 && p.g === 0.22 && p.b === 0.34 && p.isSwarm === false));
  check('C10 firing raises a muzzle flash on the gunship', heavy.muzzleFlash > 0);

  const probe = salvo[0];
  const distBefore = Math.hypot(probe.x - sim.jet.x, probe.y - sim.jet.y, probe.z - sim.jet.z);
  stepFor(sim, 0.3);
  const distAfter = Math.hypot(probe.x - sim.jet.x, probe.y - sim.jet.y, probe.z - sim.jet.z);
  check('C11 enemy bolts close on the aircraft', distAfter < distBefore, `${distBefore.toFixed(1)} -> ${distAfter.toFixed(1)}`);

  stepFor(sim, 60);
  const heavyCount = sim.drones.filter((d) => d.active && d.enemyType === 1).length;
  check('C12 heavy gunship spawn is capped', heavyCount <= 3, `heavy=${heavyCount}`);
  check('C13 recon drones still share the airspace', sim.drones.some((d) => d.active && d.enemyType === 0) || sim.enemySpawnTimer > 0);
}

{
  const sim = newSim();
  const damageLog = [];
  const realApplyDamage = sim.applyJetDamage.bind(sim);
  sim.applyJetDamage = (amount, hitX, hitY, hitZ, impactScale) => {
    damageLog.push(amount);
    realApplyDamage(amount, hitX, hitY, hitZ, impactScale);
  };

  const enemyBolt = takeFreeProjectile(sim);
  enemyBolt.active = true;
  enemyBolt.isEnemy = true;
  enemyBolt.isSwarm = false;
  enemyBolt.x = sim.jet.x;
  enemyBolt.y = sim.jet.y;
  enemyBolt.z = sim.jet.z;
  enemyBolt.vx = 0;
  enemyBolt.vy = 0;
  enemyBolt.vz = 0;
  enemyBolt.life = 1.0;
  const healthBeforeBolt = sim.jet.health;
  sim.step(DT);
  check('D1 an enemy bolt on the aircraft deals 4 damage', sim.jet.health === healthBeforeBolt - 4 && damageLog.at(-1) === 4, `health=${sim.jet.health} log=${damageLog.join(',')}`);
  check('D2 the enemy bolt is consumed on impact', enemyBolt.active === false);
  check('D3 the aircraft flashes on impact', sim.jet.hullFlash > 0);

  const friendlyBolt = takeFreeProjectile(sim);
  friendlyBolt.active = true;
  friendlyBolt.isEnemy = false;
  friendlyBolt.isSwarm = false;
  friendlyBolt.x = sim.jet.x;
  friendlyBolt.y = sim.jet.y;
  friendlyBolt.z = sim.jet.z;
  friendlyBolt.vx = 0;
  friendlyBolt.vy = 0;
  friendlyBolt.vz = 0;
  friendlyBolt.life = 1.0;
  const healthBeforeFriendly = sim.jet.health;
  sim.step(DT);
  check('D4 friendly bolts never damage the aircraft', sim.jet.health === healthBeforeFriendly, `health=${sim.jet.health}`);

  const mothershipBolt = takeFreeProjectile(sim);
  mothershipBolt.active = true;
  mothershipBolt.isEnemy = true;
  mothershipBolt.x = sim.mothership.x;
  mothershipBolt.y = sim.mothership.y;
  mothershipBolt.z = sim.mothership.z;
  mothershipBolt.vx = 0;
  mothershipBolt.vy = 0;
  mothershipBolt.vz = 0;
  mothershipBolt.life = 1.0;
  const mothershipHp = sim.mothership.hp;
  sim.step(DT);
  check('D5 enemy bolts never damage the mothership', sim.mothership.hp === mothershipHp && mothershipBolt.active === true, `hp=${sim.mothership.hp}`);

  const recon = spawnRecon(sim);
  if (recon) {
    recon.active = true;
    recon.enemyType = 0;
    recon.launchBlend = 0;
    recon.z = sim.jet.z;
    recon.baseX = sim.jet.x - Math.sin(recon.phase) * 3.4;
    recon.baseY = sim.jet.y - Math.cos(recon.phase * 0.8) * 1.6;
    const healthBeforeCrash = sim.jet.health;
    sim.step(DT);
    check('D6 a recon collision deals 10 damage', sim.jet.health === healthBeforeCrash - 10 && damageLog.at(-1) === 10, `health=${sim.jet.health} log=${damageLog.join(',')}`);
    check('D7 the colliding recon drone is destroyed', recon.active === false);
  } else {
    check('D6 a recon collision deals 10 damage', false, 'no recon drone available');
    check('D7 the colliding recon drone is destroyed', false, 'no recon drone available');
  }

  const hostile = spawnHeavy(sim);
  if (hostile) {
    hostile.active = true;
    hostile.enemyType = 1;
    hostile.launchBlend = 0;
    hostile.stationZ = sim.jet.z;
    hostile.z = sim.jet.z;
    hostile.baseX = sim.jet.x - Math.sin(hostile.phase) * 5.2;
    hostile.baseY = sim.jet.y - Math.sin(hostile.phase * 0.65) * 2.1;
    const healthBeforeHeavy = sim.jet.health;
    sim.step(DT);
    check('D8 a heavy gunship collision deals 20 damage', sim.jet.health === healthBeforeHeavy - 20 && damageLog.at(-1) === 20, `health=${sim.jet.health} log=${damageLog.join(',')}`);
  } else {
    check('D8 a heavy gunship collision deals 20 damage', false, 'no heavy gunship available');
  }
}

{
  const sim = newSim();
  const recon = spawnRecon(sim);
  check('E1 recon drone is available for the regression check', recon !== null);

  recon.active = true;
  recon.enemyType = 0;
  recon.hp = 1;
  recon.maxHp = 1;
  recon.z = -40;
  recon.x = 0;
  recon.y = 0;

  const bolt = takeFreeProjectile(sim);
  bolt.active = true;
  bolt.isEnemy = false;
  bolt.isSwarm = false;
  bolt.x = recon.x;
  bolt.y = recon.y;
  bolt.z = recon.z;
  bolt.vx = 0;
  bolt.vy = 0;
  bolt.vz = 0;
  bolt.life = 1.0;

  sim.step(DT);
  check('E2 player bolts still destroy recon drones', recon.active === false);
  check('E3 a destroyed recon drone scores 100', sim.score === 100, `score=${sim.score}`);
  check('E4 the target tally advances', sim.targetsDestroyed === 1);
}

{
  const sim = newSim();
  const info = sim.prepareRenderData(16 / 9);
  check('F1 render batches are produced', info.totalInstances > 0, `instances=${info.totalInstances}`);
  check('F2 the aircraft is rendered while alive', info.batches.fighter.count === 1);
  check('F3 the mothership batch is present', info.batches.mothership.count === 1);
  check('F4 the hull tracker is visible and projected', !elements.get('hp-tracker').classList.contains('hidden') && /%\s*$/.test(elements.get('hp-tracker').style.left), `left=${elements.get('hp-tracker').style.left} top=${elements.get('hp-tracker').style.top}`);
  check('F5 the hull tracker is scaled into screen space', /translate\(-50%, -100%\) scale\(/.test(elements.get('hp-tracker').style.transform), elements.get('hp-tracker').style.transform);

  sim.applyJetDamage(500, 0, 1.5, 0, 1.0);
  check('F6 zero health triggers game over', sim.gameOver === true && sim.jet.health === 0);
  check('F7 game over overlay is revealed with stats', elements.get('gameover-overlay').classList.contains('visible') && elements.get('gameover-score').textContent === String(sim.score).padStart(5, '0'));
  check('F8 game over moves focus to the restart control', elements.get('gameover-restart-btn').getAttribute('focused') === 'true');

  const deadInfo = sim.prepareRenderData(16 / 9);
  check('F9 the destroyed aircraft is not rendered', deadInfo.batches.fighter.count === 0);
  check('F10 the hull tracker is hidden after destruction', elements.get('hp-tracker').classList.contains('hidden'));
  check('F11 the battle keeps rendering behind the overlay', deadInfo.totalInstances > 0, `instances=${deadInfo.totalInstances}`);
}

{
  const sim = newSim();

  sim.keys.fire = true;
  sim.touchInput.fire = true;
  sim.applyJetDamage(500, 0, 1.5, 0, 1.0);
  check('G1 input is cleared the moment the aircraft is destroyed', sim.keys.fire === false && sim.touchInput.fire === false);
  check('G2 zero health triggers game over', sim.gameOver === true && sim.jet.health === 0);

  const scoreAtDeath = sim.score;
  const targetsAtDeath = sim.targetsDestroyed;
  const xAtDeath = sim.jet.x;
  const phaseAtDeath = sim.mothership.phase;

  sim.keys.fire = true;
  sim.keys.left = true;
  sim.touchInput.fire = true;
  let error = null;
  try {
    stepFor(sim, 10);
  } catch (caught) {
    error = caught;
  }

  check('G3 the failed mission keeps stepping without error', error === null, error && error.message);
  check('G4 the aircraft no longer responds to input', sim.jet.x === xAtDeath, `x=${sim.jet.x}`);
  check('G5 the player cannot fire after destruction', sim.projectiles.every((p) => !p.active || p.isEnemy));
  check('G6 the score and tally are frozen after destruction', sim.score === scoreAtDeath && sim.targetsDestroyed === targetsAtDeath);
  check('G7 the world keeps advancing while the mission is failed', sim.mothership.phase > phaseAtDeath, `phase ${phaseAtDeath.toFixed(2)} -> ${sim.mothership.phase.toFixed(2)}`);

  sim.reset();
  check('G8 reset clears the failure state', sim.gameOver === false && sim.jet.health === 100);
  check('G9 reset clears any held input', sim.keys.fire === false && sim.keys.left === false && sim.touchInput.fire === false);
  check('G10 reset hides the overlay and refills the bar', !elements.get('gameover-overlay').classList.contains('visible') && elements.get('hp-fill').style.transform === 'scaleX(1.0000)');

  sim.keys.fire = true;
  stepFor(sim, 1);
  check('G11 a restarted mission can fire again', sim.projectiles.some((p) => p.active && !p.isEnemy));
}

{
  const sim = newSim();
  stepFor(sim, 15);
  check('H1 the aircraft survives the opening 15 seconds of fire', sim.gameOver === false && sim.jet.health > 0, `health=${sim.jet.health}`);
  check('H2 the opening pressure is real, not cosmetic', sim.jet.health < 100, `health=${sim.jet.health}`);

  let elapsed = 15;
  while (!sim.gameOver && elapsed < 180) {
    sim.step(DT);
    elapsed += DT;
  }
  check('H3 sustained enemy fire eventually destroys an idle aircraft', sim.gameOver === true, `survived=${elapsed.toFixed(1)}s`);
  check('H4 the idle player survives until the projectors escalate', elapsed > 16, `survived=${elapsed.toFixed(1)}s`);
}

{
  const sim = newSim();
  const ms = sim.mothership;

  check('I1 the flagship carries 100x its original hull', ms.maxHp === 6500 && ms.hp === 6500, `hp=${ms.hp} maxHp=${ms.maxHp}`);
  check('I2 a full shield ring deploys with the flagship', sim.countShieldingDrones() === 8, `shielding=${sim.countShieldingDrones()}`);
  check('I3 the flagship starts shielded', sim.isMothershipShielded() === true);

  const shieldedHp = ms.hp;
  const blockedBolt = sim.projectiles.find((p) => !p.active);
  blockedBolt.active = true;
  blockedBolt.isEnemy = false;
  blockedBolt.isSwarm = false;
  blockedBolt.x = ms.x;
  blockedBolt.y = ms.y;
  blockedBolt.z = ms.z;
  blockedBolt.vx = 0;
  blockedBolt.vy = 0;
  blockedBolt.vz = 0;
  blockedBolt.life = 1.0;
  sim.step(DT);
  check('I4 a bolt on the shielded flagship is blocked, not absorbed', ms.hp === shieldedHp && blockedBolt.active === false, `hp=${ms.hp}`);

  const target = sim.shieldDrones[0];
  target.active = true;
  target.mode = 'shield';
  target.hp = 1;
  const ringBefore = sim.countShieldingDrones();
  const droneBolt = sim.projectiles.find((p) => !p.active);
  droneBolt.active = true;
  droneBolt.isEnemy = false;
  droneBolt.isSwarm = false;
  droneBolt.x = target.x;
  droneBolt.y = target.y;
  droneBolt.z = target.z;
  droneBolt.vx = 0;
  droneBolt.vy = 0;
  droneBolt.vz = 0;
  droneBolt.life = 1.0;
  sim.step(DT);
  check('I5 a shield drone can be destroyed', target.active === false && sim.countShieldingDrones() === ringBefore - 1, `shielding ${ringBefore} -> ${sim.countShieldingDrones()}`);

  for (const sd of sim.shieldDrones) sd.active = false;
  sim.step(DT);
  check('I6 the shield drops when the last projector dies', sim.isMothershipShielded() === false);
  check('I7 the shield loss arms a redeploy timer', ms.shieldBroken === true && ms.redeployTimer > 25, `timer=${ms.redeployTimer.toFixed(1)}`);

  const openHp = ms.hp;
  const openBolt = sim.projectiles.find((p) => !p.active);
  openBolt.active = true;
  openBolt.isEnemy = false;
  openBolt.isSwarm = false;
  openBolt.x = ms.x;
  openBolt.y = ms.y;
  openBolt.z = ms.z;
  openBolt.vx = 0;
  openBolt.vy = 0;
  openBolt.vz = 0;
  openBolt.life = 1.0;
  sim.step(DT);
  check('I8 an unshielded flagship takes scaled bolt damage', ms.hp === openHp - 8, `hp ${openHp} -> ${ms.hp}`);
}

{
  const sim = newSim();
  const ms = sim.mothership;
  const missile = sim.missiles.find((m) => !m.active);
  missile.active = true;
  missile.x = ms.x;
  missile.y = ms.y;
  missile.z = ms.z;
  missile.vx = 0;
  missile.vy = 0;
  missile.vz = 0;
  missile.speed = 100;
  missile.life = 1;
  missile.targetIdx = -1;
  const shieldedHp = ms.hp;
  sim.step(DT);
  check('J1 a missile on the shielded flagship is blocked', ms.hp === shieldedHp, `hp=${ms.hp}`);

  for (const sd of sim.shieldDrones) sd.active = false;
  sim.step(DT);

  const openMissile = sim.missiles.find((m) => !m.active);
  openMissile.active = true;
  openMissile.x = ms.x;
  openMissile.y = ms.y;
  openMissile.z = ms.z;
  openMissile.vx = 0;
  openMissile.vy = 0;
  openMissile.vz = 0;
  openMissile.speed = 100;
  openMissile.life = 1;
  openMissile.targetIdx = -1;
  const openHp = ms.hp;
  sim.step(DT);
  check('J2 an unshielded flagship takes scaled missile damage', ms.hp === openHp - 80, `hp ${openHp} -> ${ms.hp}`);

  const redeploySim = newSim();
  redeploySim.mothership.shieldBroken = false;
  for (const sd of redeploySim.shieldDrones) sd.active = false;
  redeploySim.step(DT);
  check('J3 a broken shield schedules a fresh ring', redeploySim.mothership.redeployTimer > 0, `timer=${redeploySim.mothership.redeployTimer.toFixed(1)}`);
  stepFor(redeploySim, 31);
  check('J4 the ring redeploys after the delay', redeploySim.countShieldingDrones() === 8, `shielding=${redeploySim.countShieldingDrones()}`);
  check('J5 the redeployed flagship is shielded again', redeploySim.isMothershipShielded() === true);
}

{
  const sim = newSim();
  const kamikaze = sim.shieldDrones[0];
  kamikaze.mode = 'shield';
  kamikaze.age = 14.99;
  sim.step(DT);
  check('K1 a projector converts to kamikaze at 15 seconds', kamikaze.mode === 'kamikaze', `mode=${kamikaze.mode} age=${kamikaze.age.toFixed(2)}`);

  let hits = 0;
  const realDamage = sim.applyJetDamage.bind(sim);
  sim.applyJetDamage = (amount, x, y, z, scale) => {
    hits++;
    realDamage(amount, x, y, z, scale);
  };
  for (let i = 0; i < 60 * 30 && hits === 0; i++) sim.step(DT);
  check('K2 a kamikaze reaches and damages the aircraft', hits > 0, `hits=${hits}`);

  const untouched = sim.shieldDrones.find((sd) => sd.mode === 'shield' && sd.active);
  check('K3 untouched projectors keep guarding while others dive', untouched !== undefined || sim.countShieldingDrones() > 0, `shielding=${sim.countShieldingDrones()}`);
}

{
  const sim = newSim();
  check('L1 the swarm defaults to attacker', sim.jet.swarmRole === 'attacker', sim.jet.swarmRole);

  sim.toggleSwarmRole();
  check('L2 toggling switches to shielder', sim.jet.swarmRole === 'shielder', sim.jet.swarmRole);
  check('L3 the mode control reflects shielder state', elements.get('swarm-mode-btn').textContent === 'SWARM · SHIELD' && elements.get('swarm-mode-btn').getAttribute('aria-pressed') === 'true', elements.get('swarm-mode-btn').textContent);

  sim.toggleSwarmRole();
  check('L4 toggling returns to attacker', sim.jet.swarmRole === 'attacker' && sim.jet.shieldHp === 0);
  check('L5 the mode control reflects attacker state', elements.get('swarm-mode-btn').textContent === 'SWARM · ATTACK' && elements.get('swarm-mode-btn').getAttribute('aria-pressed') === 'false');

  sim.toggleSwarmRole();
  sim.deployAlliedSwarm();
  check('L6 a shielder deployment charges the shield pool', sim.jet.shieldHp === 45, `shieldHp=${sim.jet.shieldHp}`);

  const hullBefore = sim.jet.health;
  sim.applyJetDamage(25, 0, 1.5, 0, 0.5);
  check('L7 the shield absorbs damage before the hull', sim.jet.health === hullBefore && sim.jet.shieldHp === 20, `hp=${sim.jet.health} shield=${sim.jet.shieldHp}`);
  check('L8 the hull tracker exposes the shield', elements.get('shield-tracker').classList.contains('hidden') === false);
  check('L9 shield integrity is announced', elements.get('shield-tracker').getAttribute('aria-valuenow') === '44', elements.get('shield-tracker').getAttribute('aria-valuenow'));

  sim.applyJetDamage(40, 0, 1.5, 0, 0.5);
  check('L10 overflow damage reaches the hull when the shield breaks', sim.jet.health === hullBefore - 20 && sim.jet.shieldHp === 0, `hp=${sim.jet.health} shield=${sim.jet.shieldHp}`);
  check('L11 breaking the shield scatters the swarm', sim.swarmDrones.every((sd) => sd.active === false));

  const attacker = newSim();
  attacker.deployAlliedSwarm();
  stepFor(attacker, 0.5);
  check('L12 an attacker swarm still fires', attacker.projectiles.some((p) => p.active && p.isSwarm), `swarmBolts=${attacker.projectiles.filter((p) => p.active && p.isSwarm).length}`);

  const shielder = newSim();
  shielder.toggleSwarmRole();
  shielder.deployAlliedSwarm();
  stepFor(shielder, 0.5);
  check('L13 a shielder swarm does not fire', shielder.projectiles.every((p) => !p.active || !p.isSwarm));
  check('L14 a shielder swarm holds its shield pool', shielder.jet.shieldHp === 45, `shieldHp=${shielder.jet.shieldHp}`);
}

{
  const sim = newSim();
  const info = sim.prepareRenderData(16 / 9);
  check('M1 the render exposes a shieldDrone batch', info.batches.shieldDrone !== undefined, JSON.stringify(info.batches.shieldDrone));
  check('M2 the formation renders eight projectors', info.batches.shieldDrone.count === 8, `count=${info.batches.shieldDrone.count}`);
  check('M3 the render exposes a shieldPanel batch', info.batches.shieldPanel !== undefined, JSON.stringify(info.batches.shieldPanel));
  check('M4 the barrier renders while the shield holds', info.batches.shieldPanel.count === 1, `count=${info.batches.shieldPanel.count}`);
  check('M5 no player halo renders in attacker role', info.batches.shieldRing.count === 0, `count=${info.batches.shieldRing.count}`);
  check('M6 the instance budget is respected', info.totalInstances <= 1024, `instances=${info.totalInstances}`);

  const panelBefore = info.batches.shieldPanel.count;
  for (const sd of sim.shieldDrones) sd.active = false;
  sim.mothership.shieldFlash = 0;
  const panelAfter = sim.prepareRenderData(16 / 9).batches.shieldPanel.count;
  check('M7 the barrier is dropped once the shield is gone', panelAfter < panelBefore, `${panelBefore} -> ${panelAfter}`);

  const haloSim = newSim();
  haloSim.toggleSwarmRole();
  haloSim.deployAlliedSwarm();
  const haloInfo = haloSim.prepareRenderData(16 / 9);
  check('M8 the player halo renders in shielder role', haloInfo.batches.shieldRing.count === 1, `count=${haloInfo.batches.shieldRing.count}`);

  const lateSwitchSim = newSim();
  lateSwitchSim.deployAlliedSwarm();
  lateSwitchSim.toggleSwarmRole();
  const lateSwitchInfo = lateSwitchSim.prepareRenderData(16 / 9);
  check('M9 switching role after deploying still raises the halo', lateSwitchSim.jet.swarmRole === 'shielder' && lateSwitchSim.jet.shieldHp === 45, `shieldHp=${lateSwitchSim.jet.shieldHp}`);
  check('M10 the late-switch halo renders', lateSwitchInfo.batches.shieldRing.count === 1, `count=${lateSwitchInfo.batches.shieldRing.count}`);
}

{
  const sim = newSim();
  const ms = sim.mothership;
  const formation = sim.shieldDrones.filter((sd) => sd.active);

  check('N1 the projectors hold a formation of eight', formation.length === 8, `count=${formation.length}`);
  check('N2 the formation is two rows of four', formation.filter((sd) => sd.y > 5.6).length === 4 && formation.filter((sd) => sd.y < 5.6).length === 4, `above=${formation.filter((sd) => sd.y > 5.6).length} below=${formation.filter((sd) => sd.y < 5.6).length}`);
  check('N3 the formation is four columns', new Set(formation.map((sd) => Math.round(sd.x - ms.x))).size === 4, JSON.stringify([...new Set(formation.map((sd) => Math.round(sd.x - ms.x)))]));
  check('N4 the formation sits between the player and the flagship', formation.every((sd) => sd.z > ms.z && sd.z < 0), `droneZ=${Math.round(formation[0].z)} flagshipZ=${Math.round(ms.z)}`);
  check('N5 the formation stays inside the reachable firing band', formation.every((sd) => sd.y > -5.0 && sd.y < 11.0), `y=${formation.map((sd) => sd.y.toFixed(1)).join(',')}`);

  const beforeX = formation.map((sd) => sd.x - ms.x);
  const beforeY = formation.map((sd) => sd.y);
  stepFor(sim, 8);
  const maxOffsetDrift = Math.max(...formation.map((sd, index) => Math.abs((sd.x - ms.x) - beforeX[index])));
  const maxYDrift = Math.max(...formation.map((sd, index) => Math.abs(sd.y - beforeY[index])));
  check('N6 the formation never circles the flagship', maxOffsetDrift < 0.001, `maxOffsetDrift=${maxOffsetDrift}`);
  check('N7 the formation only hovers inside a small band', maxYDrift < 1.2, `maxYDrift=${maxYDrift.toFixed(2)}`);
  check('N8 the projectors keep facing the player', formation.every((sd) => Math.abs(sd.yaw - Math.PI) < 1e-6), `yaw=${formation[0].yaw.toFixed(3)}`);
  check('N9 the formation never leaves the reachable band over time', formation.every((sd) => sd.y > -5.0 && sd.y < 11.0), `y=${formation.map((sd) => sd.y.toFixed(1)).join(',')}`);
}

{
  const sim = newSim();
  sim.toggleSwarmRole();
  sim.deployAlliedSwarm();
  stepFor(sim, 0.4);

  const info = sim.prepareRenderData(16 / 9);
  const ranges = Object.entries(info.batches)
    .filter(([, batch]) => batch.count > 0)
    .map(([name, batch]) => ({ name, first: batch.first, last: batch.first + batch.count - 1 }));

  const overlaps = [];
  for (let i = 0; i < ranges.length; i++) {
    for (let k = i + 1; k < ranges.length; k++) {
      if (ranges[i].first <= ranges[k].last && ranges[k].first <= ranges[i].last) {
        overlaps.push(`${ranges[i].name}[${ranges[i].first}-${ranges[i].last}] vs ${ranges[k].name}[${ranges[k].first}-${ranges[k].last}]`);
      }
    }
  }
  check('P1 no two instance batches overlap', overlaps.length === 0, overlaps.join('; ') || `${ranges.length} batches are disjoint`);

  const plumeBatch = info.batches.plume;
  check('P2 the plume batch closes before the shield batches open', plumeBatch.count > 0 && plumeBatch.first + plumeBatch.count <= info.batches.shieldPanel.first, `plume ends at ${plumeBatch.first + plumeBatch.count - 1}, shieldPanel starts at ${info.batches.shieldPanel.first}`);

  const claimed = new Set();
  let duplicated = 0;
  for (const batch of Object.values(info.batches)) {
    for (let index = batch.first; index < batch.first + batch.count; index++) {
      if (claimed.has(index)) duplicated += 1;
      claimed.add(index);
    }
  }
  check('P3 every instance is claimed by exactly one batch', duplicated === 0 && claimed.size === info.totalInstances, `claimed=${claimed.size} total=${info.totalInstances} duplicated=${duplicated}`);

  check('P4 the shield batches hold one instance each', info.batches.shieldPanel.count === 1 && info.batches.shieldRing.count === 1, `panel=${info.batches.shieldPanel.count} ring=${info.batches.shieldRing.count}`);

  const geometry = sandbox.buildAllStaticMeshes();
  const meshNames = Object.keys(geometry.meshes);
  const batchesWithoutMesh = Object.keys(info.batches).filter((name) => !meshNames.includes(name));
  check('P5 every batch name resolves to a mesh', batchesWithoutMesh.length === 0, batchesWithoutMesh.join(', ') || `${Object.keys(info.batches).length} batches resolve to meshes`);

  check('P6 the detonation meshes exist', meshNames.includes('blastSphere') && meshNames.includes('blastRing'), `${meshNames.length} meshes: ${meshNames.join(',')}`);
}

{
  const sim = newSim();
  const drone = sim.drones[0];
  drone.active = true;
  drone.enemyType = 0;
  drone.hp = 1;
  drone.maxHp = 1;
  drone.z = -40;
  drone.x = 0;
  drone.y = 0;

  const bolt = sim.projectiles.find((p) => !p.active);
  bolt.active = true;
  bolt.isEnemy = false;
  bolt.isSwarm = false;
  bolt.x = drone.x;
  bolt.y = drone.y;
  bolt.z = drone.z;
  bolt.vx = 0;
  bolt.vy = 0;
  bolt.vz = 0;
  bolt.life = 1.0;

  check('Q1 no blast is active before a kill', sim.blasts.every((blast) => !blast.active));
  sim.step(DT);
  const firedBlast = sim.blasts.find((blast) => blast.active);
  check('Q2 destroying a drone starts a detonation', firedBlast !== undefined, `active=${sim.blasts.filter((blast) => blast.active).length}`);
  check('Q3 the detonation is anchored at the kill', firedBlast !== undefined && Math.abs(firedBlast.x - drone.x) < 2 && Math.abs(firedBlast.z - drone.z) < 2, firedBlast ? `blast=(${firedBlast.x.toFixed(1)},${firedBlast.z.toFixed(1)}) drone=(${drone.x},${drone.z})` : 'none');

  const blastInfo = sim.prepareRenderData(16 / 9);
  check('Q4 the detonation renders a fireball core', blastInfo.batches.blastSphere.count === 1, `count=${blastInfo.batches.blastSphere.count}`);
  check('Q5 the detonation renders a shockwave ring', blastInfo.batches.blastRing.count === 1, `count=${blastInfo.batches.blastRing.count}`);

  const startRadius = firedBlast ? firedBlast.radius : 0;
  stepFor(sim, 0.2);
  check('Q6 the detonation ages and expands', firedBlast.age > 0.1 && firedBlast.age < firedBlast.life, `age=${firedBlast.age.toFixed(2)} life=${firedBlast.life}`);
  check('Q7 the detonation expires on its own', (() => { stepFor(sim, 0.6); return firedBlast.active === false; })(), `active=${firedBlast.active}`);
  check('Q8 blast radius is carried from the spawn call', startRadius > 0, `radius=${startRadius}`);
  check('Q9 the expired detonation stops rendering', sim.prepareRenderData(16 / 9).batches.blastSphere.count === 0);

  const detonation = newSim();
  detonation.spawnBlast(0, 0, -40, 10.0, 1.0, 0.66, 0.22);
  stepFor(detonation, 0.4);
  const detonationRender = detonation.prepareRenderData(16 / 9);
  const geometry = sandbox.buildAllStaticMeshes();
  const INSTANCE_STRIDE = 24;

  const meshRadius = (mesh) => {
    let maxRadius = 0;
    for (let i = mesh.firstIndex; i < mesh.firstIndex + mesh.indexCount; i++) {
      const vertex = geometry.indexData[i] * 12;
      maxRadius = Math.max(maxRadius, Math.hypot(geometry.vertexData[vertex], geometry.vertexData[vertex + 1], geometry.vertexData[vertex + 2]));
    }
    return maxRadius;
  };

  const instanceScale = (batchFirst) => {
    const offset = batchFirst * INSTANCE_STRIDE;
    return Math.hypot(detonation.instanceBufferData[offset], detonation.instanceBufferData[offset + 1], detonation.instanceBufferData[offset + 2]);
  };

  const sphereRadius = meshRadius(geometry.meshes.blastSphere);
  const ringRadius = meshRadius(geometry.meshes.blastRing);
  const coreWorld = instanceScale(detonationRender.batches.blastSphere.first) * sphereRadius;
  const ringWorld = instanceScale(detonationRender.batches.blastRing.first) * ringRadius;

  check('R1 the blast meshes are authored at unit radius', Math.abs(sphereRadius - 1.0) < 0.01 && Math.abs(ringRadius - 1.0) < 0.01, `sphere=${sphereRadius.toFixed(3)} ring=${ringRadius.toFixed(3)}`);
  check('R2 the fireball never dwarfs its own detonation radius', coreWorld <= 10.0 * 0.6, `coreWorld=${coreWorld.toFixed(2)} limit=${(10.0 * 0.6).toFixed(2)}`);
  check('R3 the shockwave never dwarfs its own detonation radius', ringWorld <= 10.0 * 1.4, `ringWorld=${ringWorld.toFixed(2)} limit=${(10.0 * 1.4).toFixed(2)}`);
  check('R4 the shockwave always expands beyond the fireball', ringWorld > coreWorld, `ring=${ringWorld.toFixed(2)} core=${coreWorld.toFixed(2)}`);
}

const failures = results.filter((r) => !r.passed);
results.forEach((r) => console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.label}${r.detail ? `  [${r.detail}]` : ''}`));
console.log(`\n${results.length - failures.length}/${results.length} checks passed`);
process.exit(failures.length === 0 ? 0 : 1);
