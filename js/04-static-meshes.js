"use strict";
    function buildAllStaticMeshes() {
      const gb = new GeometryBuilder();

      // Material definitions: [matID, roughness, metallic]
      const MAT_GRAPHITE = [1.0, 0.36, 0.45]; // Hard-surface stealth tactical paint
      const MAT_METAL    = [1.0, 0.20, 0.88]; // Titanium / silver bare metal
      const MAT_ACCENT   = [1.0, 0.28, 0.30]; // Tactical orange markings
      const MAT_CANOPY   = [2.0, 0.06, 0.92]; // High-gloss tinted cockpit canopy glass
      const MAT_TERRAIN  = [3.0, 0.78, 0.08]; // Low-poly canyon rock/mountain
      const MAT_EMISSIVE = [4.0, 0.10, 0.00]; // Pure glowing plasma / afterburner / tracer

      // Color palette: Dark graphite, silver titanium, restrained orange accents
      const COL_GRAPHITE_DARK = [0.13, 0.15, 0.19];
      const COL_GRAPHITE_MID  = [0.20, 0.23, 0.28];
      const COL_BELLY_SLATE   = [0.26, 0.30, 0.36];
      const COL_SILVER_METAL  = [0.68, 0.73, 0.80];
      const COL_TITANIUM_DARK = [0.34, 0.38, 0.44];
      const COL_ORANGE_ACCENT = [0.96, 0.38, 0.12];
      const COL_CANOPY_GLASS  = [0.12, 0.24, 0.38];

      // ========================================================================
      // MESH 1: THE MODERN FIGHTER AIRCRAFT (Nose at -Z, Tail at +Z)
      // ========================================================================
      const jetMarker = gb.beginMesh();

      // 8-point octagonal chined fuselage cross-section generator:
      // Order around perimeter:
      // 0: Top Spine, 1: Upper Right Deck, 2: Right Chine Edge, 3: Lower Right Cheek,
      // 4: Belly Center, 5: Lower Left Cheek, 6: Left Chine Edge, 7: Upper Left Deck
      function makeFuselageRing(z, halfW, chineY, topY, botY, deckWFactor = 0.55) {
        const dw = halfW * deckWFactor;
        const bw = halfW * 0.65;
        return [
          [ 0.0,   topY,                  z],
          [ dw,    topY * 0.82,           z],
          [ halfW, chineY,                z],
          [ bw,    botY * 0.88,           z],
          [ 0.0,   botY,                  z],
          [-bw,    botY * 0.88,           z],
          [-halfW, chineY,                z],
          [-dw,    topY * 0.82,           z],
        ];
      }

      const fuselageRings = [
        makeFuselageRing(-6.35, 0.02, -0.10, -0.08, -0.12, 0.5), // 0: Sharp Pitot/Radome tip
        makeFuselageRing(-5.30, 0.32, -0.06,  0.08, -0.20, 0.5), // 1: Forward Radome
        makeFuselageRing(-3.80, 0.68, -0.02,  0.26, -0.34, 0.52),// 2: Forward Fuselage / Nose Cone base
        makeFuselageRing(-2.10, 1.18,  0.02,  0.42, -0.44, 0.55),// 3: LERX / Cockpit Midsection
        makeFuselageRing(-0.20, 1.48,  0.04,  0.44, -0.46, 0.62),// 4: Main Wing Root Junction
        makeFuselageRing( 1.90, 1.38,  0.04,  0.40, -0.42, 0.68),// 5: Mid-Aft Engine Bay
        makeFuselageRing( 3.65, 1.15,  0.03,  0.30, -0.32, 0.72),// 6: Rear Engine Shroud
      ];

      // Loft the fuselage sections with silver radome tip, dark graphite dorsal spine, and slate belly
      gb.addLoftSection(fuselageRings[0], fuselageRings[1], COL_SILVER_METAL, COL_SILVER_METAL, COL_SILVER_METAL, MAT_METAL);
      gb.addLoftSection(fuselageRings[1], fuselageRings[2], COL_GRAPHITE_DARK, COL_GRAPHITE_MID, COL_BELLY_SLATE, MAT_GRAPHITE);
      gb.addLoftSection(fuselageRings[2], fuselageRings[3], COL_GRAPHITE_DARK, COL_SILVER_METAL, COL_BELLY_SLATE, MAT_GRAPHITE);
      gb.addLoftSection(fuselageRings[3], fuselageRings[4], COL_GRAPHITE_DARK, COL_GRAPHITE_MID, COL_BELLY_SLATE, MAT_GRAPHITE);
      gb.addLoftSection(fuselageRings[4], fuselageRings[5], COL_GRAPHITE_DARK, COL_GRAPHITE_MID, COL_BELLY_SLATE, MAT_GRAPHITE);
      gb.addLoftSection(fuselageRings[5], fuselageRings[6], COL_TITANIUM_DARK, COL_SILVER_METAL, COL_BELLY_SLATE, MAT_METAL);

      // Close rear fuselage bulkhead between the twin nozzles
      const rRear = fuselageRings[6];
      for (let i = 1; i < rRear.length - 1; i++) {
        gb.addTri(rRear[0], rRear[i], rRear[i + 1], COL_TITANIUM_DARK, MAT_METAL);
      }

      // 2. Tinted Teardrop Bubble Cockpit Canopy (Faceted glass + metallic frame arch)
      const canopyRings = [
        makeFuselageRing(-3.95, 0.22, 0.20, 0.24, 0.18, 0.7),
        makeFuselageRing(-3.05, 0.48, 0.30, 0.68, 0.22, 0.72),
        makeFuselageRing(-1.95, 0.52, 0.34, 0.76, 0.26, 0.72),
        makeFuselageRing(-0.85, 0.38, 0.36, 0.56, 0.30, 0.68),
        makeFuselageRing( 0.10, 0.16, 0.38, 0.42, 0.34, 0.60),
      ];
      for (let i = 0; i < canopyRings.length - 1; i++) {
        gb.addLoftSection(canopyRings[i], canopyRings[i + 1], COL_CANOPY_GLASS, COL_CANOPY_GLASS, COL_GRAPHITE_DARK, MAT_CANOPY);
      }

      // Canopy bow frame strip (high-contrast silver/orange accent frame)
      const bowRingA = makeFuselageRing(-2.90, 0.50, 0.31, 0.70, 0.22, 0.73);
      const bowRingB = makeFuselageRing(-2.78, 0.51, 0.32, 0.72, 0.23, 0.73);
      gb.addLoftSection(bowRingA, bowRingB, COL_SILVER_METAL, COL_ORANGE_ACCENT, COL_GRAPHITE_DARK, MAT_METAL);

      // 3. Swept Supersonic Air Intakes (Under LERX cheeks)
      for (const sign of [-1, 1]) {
        const inFront = [
          [0.52 * sign, -0.05, -2.65],
          [1.12 * sign, -0.02, -2.15],
          [1.02 * sign, -0.48, -2.05],
          [0.48 * sign, -0.44, -2.55]
        ];
        const inBack = [
          [0.58 * sign, -0.05,  1.20],
          [1.22 * sign,  0.00,  1.20],
          [1.10 * sign, -0.45,  1.20],
          [0.52 * sign, -0.44,  1.20]
        ];
        if (sign === 1) {
          gb.addQuad(inFront[0], inFront[1], inBack[1], inBack[0], COL_GRAPHITE_MID, MAT_GRAPHITE);
          gb.addQuad(inFront[1], inFront[2], inBack[2], inBack[1], COL_SILVER_METAL, MAT_METAL);
          gb.addQuad(inFront[2], inFront[3], inBack[3], inBack[2], COL_BELLY_SLATE, MAT_GRAPHITE);
          // Dark intake mouth cavity
          gb.addQuad(inFront[0], inFront[3], inFront[2], inFront[1], [0.03, 0.04, 0.06], MAT_GRAPHITE);
        } else {
          gb.addQuad(inFront[1], inFront[0], inBack[0], inBack[1], COL_GRAPHITE_MID, MAT_GRAPHITE);
          gb.addQuad(inFront[2], inFront[1], inBack[1], inBack[2], COL_SILVER_METAL, MAT_METAL);
          gb.addQuad(inFront[3], inFront[2], inBack[2], inBack[3], COL_BELLY_SLATE, MAT_GRAPHITE);
          gb.addQuad(inFront[1], inFront[2], inFront[3], inFront[0], [0.03, 0.04, 0.06], MAT_GRAPHITE);
        }
      }

      // 4. Main Swept Delta-Trapezoidal Wings
      gb.addSymmetricAirfoil(
        [1.15,  0.03, -1.65], // Root leading edge
        [1.15,  0.02,  2.55], // Root trailing edge
        0.13,                 // Root thickness
        [5.45, -0.06,  1.35], // Tip leading edge
        [5.45, -0.06,  2.75], // Tip trailing edge
        0.035,                // Tip thickness
        COL_GRAPHITE_DARK,
        COL_SILVER_METAL,
        COL_ORANGE_ACCENT,
        MAT_METAL,
        MAT_GRAPHITE
      );

      // 5. All-Moving Horizontal Tail Stabilators
      gb.addSymmetricAirfoil(
        [0.95,  0.01,  2.75],
        [0.85,  0.01,  4.25],
        0.07,
        [2.85, -0.04,  3.65],
        [2.45, -0.04,  4.55],
        0.025,
        COL_GRAPHITE_DARK,
        COL_SILVER_METAL,
        COL_SILVER_METAL,
        MAT_METAL,
        MAT_GRAPHITE
      );

      // 6. Twin Canted Vertical Tail Fins (V-Tails with orange squadron tips)
      gb.addSymmetricAirfoil(
        [0.72,  0.22,  1.85], // Fin root leading edge
        [0.72,  0.18,  3.85], // Fin root trailing edge
        0.065,
        [1.52,  1.68,  3.15], // Fin tip leading edge (canted outward)
        [1.48,  1.65,  4.25], // Fin tip trailing edge
        0.025,
        COL_GRAPHITE_MID,
        COL_SILVER_METAL,
        COL_ORANGE_ACCENT,
        MAT_METAL,
        MAT_GRAPHITE
      );

      // 7. Wingside Weapon Mounts (Underwing Pylons + Tactical Missiles + Wingtip Rails)
      function addCylinderZ(cx, cy, zStart, zEnd, rFront, rBack, sides, col, mat) {
        const ringF = [], ringB = [];
        for (let i = 0; i < sides; i++) {
          const a = (i / sides) * Math.PI * 2;
          const ca = Math.cos(a), sa = Math.sin(a);
          ringF.push([cx + ca * rFront, cy + sa * rFront, zStart]);
          ringB.push([cx + ca * rBack,  cy + sa * rBack,  zEnd]);
        }
        gb.addLoftSection(ringF, ringB, col, col, col, mat);
        // Cap ends
        for (let i = 1; i < sides - 1; i++) {
          gb.addTri(ringF[0], ringF[i + 1], ringF[i], col, mat);
          gb.addTri(ringB[0], ringB[i], ringB[i + 1], col, mat);
        }
      }

      for (const sign of [-1, 1]) {
        // Inner weapon pylon + heavy air-to-air missile
        const px = 2.55 * sign;
        addCylinderZ(px, -0.16, -0.2, 1.8, 0.05, 0.05, 6, COL_TITANIUM_DARK, MAT_METAL);
        // Missile nose cone + body
        addCylinderZ(px, -0.28, -1.35, -0.85, 0.01, 0.085, 8, COL_ORANGE_ACCENT, MAT_ACCENT);
        addCylinderZ(px, -0.28, -0.85,  1.95, 0.085, 0.085, 8, COL_SILVER_METAL, MAT_METAL);

        // Outer wingtip launch rail
        const wx = 5.48 * sign;
        addCylinderZ(wx, -0.06, 0.65, 3.05, 0.045, 0.045, 6, COL_TITANIUM_DARK, MAT_METAL);
        addCylinderZ(wx, -0.06, 0.35, 0.65, 0.01,  0.045, 6, COL_ORANGE_ACCENT, MAT_ACCENT);
      }

      // 8. Detailed Twin Engine Nozzles & Glowing Orange Afterburner Cores
      for (const sign of [-1, 1]) {
        const nx = 0.56 * sign;
        const ny = -0.02;
        // Outer titanium nozzle shroud
        addCylinderZ(nx, ny, 3.45, 4.35, 0.42, 0.34, 10, COL_TITANIUM_DARK, MAT_METAL);
        // Serrated inner nozzle petals
        addCylinderZ(nx, ny, 4.30, 4.65, 0.34, 0.28, 10, COL_SILVER_METAL, MAT_METAL);
        // Glowing plasma afterburner core disc inside nozzle
        addCylinderZ(nx, ny, 4.45, 4.68, 0.23, 0.16, 10, [1.0, 0.48, 0.12], MAT_EMISSIVE);
      }

      const meshFighter = gb.endMesh(jetMarker);

      // ========================================================================
      // MESH 2: DYNAMIC AFTERBURNER PLUME / MUZZLE FLASH CONE
      // ========================================================================
      const plumeMarker = gb.beginMesh();
      {
        const sides = 8;
        const rBase = 0.22;
        const ring0 = [], ring1 = [];
        for (let i = 0; i < sides; i++) {
          const a = (i / sides) * Math.PI * 2;
          ring0.push([Math.cos(a) * rBase, Math.sin(a) * rBase, 0.0]);
          ring1.push([Math.cos(a) * 0.02,  Math.sin(a) * 0.02,  1.8]);
        }
        gb.addLoftSection(ring0, ring1, [1.0, 0.62, 0.18], [1.0, 0.45, 0.10], [1.0, 0.45, 0.10], MAT_EMISSIVE);
      }
      const meshPlume = gb.endMesh(plumeMarker);

      // ========================================================================
      // MESH 3: TACTICAL ENEMY DRONE / AERIAL TARGET
      // ========================================================================
      const droneMarker = gb.beginMesh();
      {
        // Central armored octahedron chassis
        const top = [0,  0.85,  0];
        const bot = [0, -0.85,  0];
        const frt = [0,  0,    -1.15];
        const bck = [0,  0,     1.15];
        const rgt = [1.15, 0,   0];
        const lft = [-1.15, 0,  0];

        // Core emissive sensor eye band
        gb.addTri(top, frt, rgt, [0.95, 0.25, 0.12], MAT_EMISSIVE);
        gb.addTri(top, lft, frt, [0.95, 0.25, 0.12], MAT_EMISSIVE);
        gb.addTri(bot, rgt, frt, [0.95, 0.25, 0.12], MAT_EMISSIVE);
        gb.addTri(bot, frt, lft, [0.95, 0.25, 0.12], MAT_EMISSIVE);

        // Rear armored shell
        gb.addTri(top, rgt, bck, COL_GRAPHITE_DARK, MAT_GRAPHITE);
        gb.addTri(top, bck, lft, COL_GRAPHITE_DARK, MAT_GRAPHITE);
        gb.addTri(bot, bck, rgt, COL_TITANIUM_DARK, MAT_METAL);
        gb.addTri(bot, lft, bck, COL_TITANIUM_DARK, MAT_METAL);

        // Swept interceptor drone wings with bright orange target tips
        gb.addSymmetricAirfoil(
          [0.65, 0.0, -0.55],
          [0.65, 0.0,  0.65],
          0.12,
          [2.75, 0.35, 0.15],
          [2.75, 0.35, 0.75],
          0.05,
          COL_GRAPHITE_DARK,
          COL_SILVER_METAL,
          COL_ORANGE_ACCENT,
          MAT_METAL,
          MAT_GRAPHITE
        );
        gb.addSymmetricAirfoil(
          [0.65,  0.0, -0.55],
          [0.65,  0.0,  0.65],
          0.12,
          [2.45, -0.45, 0.15],
          [2.45, -0.45, 0.75],
          0.05,
          COL_GRAPHITE_DARK,
          COL_SILVER_METAL,
          COL_ORANGE_ACCENT,
          MAT_METAL,
          MAT_GRAPHITE
        );
      }
      const meshDrone = gb.endMesh(droneMarker);

      // ========================================================================
      // MESH 4: PROJECTILE BOLT / TRACER
      // ========================================================================
      const projMarker = gb.beginMesh();
      {
        const sides = 6;
        const rMid = 0.12;
        const ringTip = [], ringMid = [], ringTail = [];
        for (let i = 0; i < sides; i++) {
          const a = (i / sides) * Math.PI * 2;
          const c = Math.cos(a), s = Math.sin(a);
          ringTip.push([c * 0.02, s * 0.02, -1.6]);
          ringMid.push([c * rMid, s * rMid, -0.4]);
          ringTail.push([c * 0.01, s * 0.01,  1.8]);
        }
        gb.addLoftSection(ringTip, ringMid, [1.0, 0.96, 0.88], [1.0, 0.90, 0.75], [1.0, 0.90, 0.75], MAT_EMISSIVE);
        gb.addLoftSection(ringMid, ringTail, [0.95, 0.80, 0.65], [0.90, 0.70, 0.55], [0.90, 0.70, 0.55], MAT_EMISSIVE);
      }
      const meshProjectile = gb.endMesh(projMarker);

      // ========================================================================
      // MESH 5: ENEMY TYPE 1 — HEAVY ARMORED INTERCEPTOR / GUNSHIP DRONE
      // ========================================================================
      const heavyDroneMarker = gb.beginMesh();
      {
        const COL_CRIMSON_ARMOR = [0.58, 0.11, 0.16];
        const COL_GUNMETAL_DARK = [0.16, 0.18, 0.23];
        const COL_VIOLET_CORE   = [0.95, 0.22, 0.85];

        // Central heavy armored command hull & glowing violet reactor core
        const r0 = makeFuselageRing(-2.45, 0.25,  0.00,  0.14, -0.14, 0.6);
        const r1 = makeFuselageRing(-1.10, 0.95,  0.04,  0.52, -0.46, 0.65);
        const r2 = makeFuselageRing( 0.85, 1.15,  0.05,  0.58, -0.50, 0.68);
        const r3 = makeFuselageRing( 2.15, 0.72,  0.02,  0.34, -0.32, 0.65);

        gb.addLoftSection(r0, r1, COL_CRIMSON_ARMOR, COL_SILVER_METAL, COL_GUNMETAL_DARK, MAT_GRAPHITE);
        gb.addLoftSection(r1, r2, COL_GUNMETAL_DARK, COL_CRIMSON_ARMOR, COL_GUNMETAL_DARK, MAT_GRAPHITE);
        gb.addLoftSection(r2, r3, COL_CRIMSON_ARMOR, COL_TITANIUM_DARK, COL_GUNMETAL_DARK, MAT_METAL);

        // Glowing central violet/magenta reactor eye
        addCylinderZ(0.0, 0.05, -2.55, -1.65, 0.12, 0.38, 8, COL_VIOLET_CORE, MAT_EMISSIVE);

        // Twin outrigger weapon pods & dual rear thruster cores
        for (const sign of [-1, 1]) {
          const px = 1.65 * sign;
          addCylinderZ(px, -0.08, -2.20, -1.25, 0.04, 0.28, 8, COL_CRIMSON_ARMOR, MAT_ACCENT);
          addCylinderZ(px, -0.08, -1.25,  1.85, 0.28, 0.26, 8, COL_GUNMETAL_DARK, MAT_METAL);
          addCylinderZ(px, -0.08,  1.80,  2.25, 0.22, 0.15, 8, COL_VIOLET_CORE, MAT_EMISSIVE);
        }

        // Aggressive forward-swept V-wings with crimson armor & silver leading edges
        gb.addSymmetricAirfoil(
          [0.85,  0.04, -0.85], // Root leading edge
          [0.85,  0.02,  1.55], // Root trailing edge
          0.16,
          [3.95,  0.22, -1.95], // Forward-swept wingtip leading edge
          [3.95,  0.22, -0.35], // Forward-swept wingtip trailing edge
          0.07,
          COL_GUNMETAL_DARK,
          COL_SILVER_METAL,
          COL_CRIMSON_ARMOR,
          MAT_METAL,
          MAT_GRAPHITE
        );

        // Twin canted dorsal armor fins
        gb.addSymmetricAirfoil(
          [0.95, 0.25, -0.10],
          [0.95, 0.22,  1.65],
          0.08,
          [1.65, 1.35,  0.65],
          [1.65, 1.35,  1.85],
          0.04,
          COL_CRIMSON_ARMOR,
          COL_SILVER_METAL,
          COL_VIOLET_CORE,
          MAT_METAL,
          MAT_GRAPHITE
        );
      }
      const meshHeavyDrone = gb.endMesh(heavyDroneMarker);

      // ========================================================================
      // MESH 6: ALLIED SWARM MINI-DRONE (SLEEK CYAN WINGMAN UAV)
      // ========================================================================
      const swarmDroneMarker = gb.beginMesh();
      {
        const COL_CYAN_ENERGY = [0.15, 0.88, 1.00];
        const COL_UAV_HULL    = [0.82, 0.88, 0.96];

        // Sleek pointed UAV fuselage (-Z forward)
        const u0 = makeFuselageRing(-1.55, 0.02, 0.0,  0.02, -0.02, 0.5);
        const u1 = makeFuselageRing(-0.55, 0.28, 0.02, 0.18, -0.14, 0.6);
        const u2 = makeFuselageRing( 0.85, 0.34, 0.02, 0.20, -0.16, 0.6);
        const u3 = makeFuselageRing( 1.35, 0.20, 0.00, 0.12, -0.10, 0.6);

        gb.addLoftSection(u0, u1, COL_CYAN_ENERGY, COL_UAV_HULL, COL_GRAPHITE_DARK, MAT_METAL);
        gb.addLoftSection(u1, u2, COL_UAV_HULL, COL_SILVER_METAL, COL_GRAPHITE_DARK, MAT_METAL);
        gb.addLoftSection(u2, u3, COL_GRAPHITE_DARK, COL_SILVER_METAL, COL_GRAPHITE_DARK, MAT_METAL);

        // Glowing cyan sensor visor & thruster core
        addCylinderZ(0.0, 0.12, -0.75, 0.15, 0.12, 0.14, 6, COL_CYAN_ENERGY, MAT_EMISSIVE);
        addCylinderZ(0.0, 0.00,  1.28, 1.52, 0.14, 0.09, 8, COL_CYAN_ENERGY, MAT_EMISSIVE);

        // High-tech swept delta wingman wings with bright cyan energy tips
        gb.addSymmetricAirfoil(
          [0.24, 0.0, -0.65],
          [0.24, 0.0,  0.95],
          0.06,
          [1.65, 0.08, 0.35],
          [1.65, 0.08, 1.15],
          0.025,
          COL_GRAPHITE_DARK,
          COL_UAV_HULL,
          COL_CYAN_ENERGY,
          MAT_METAL,
          MAT_GRAPHITE
        );
      }
      const meshSwarmDrone = gb.endMesh(swarmDroneMarker);

      // ========================================================================
      // MESH 7: SCROLLING LOW-POLY CANYON & MOUNTAIN TERRAIN SLAB
      // ========================================================================
      const terrainMarker = gb.beginMesh();
      {
        // A wide 3D terrain tile: 36 columns across X (-160 to +160), 12 rows along Z (-30 to +30)
        // Designed so Z=-30 and Z=+30 share identical Z-periodic height profiles for seamless tiling!
        const cols = 32;
        const rows = 10;
        const width = 320;
        const depth = 60;

        function terrainHeight(nx, nz) {
          // nx in [-1, 1], nz in [0, 1] periodic
          const angleZ = nz * Math.PI * 2.0;
          const canyonWall = Math.pow(Math.min(Math.abs(nx) * 1.35, 1.4), 1.85) * 28.0;
          const ridge1 = Math.sin(nx * 9.0 + Math.sin(angleZ) * 1.5) * Math.cos(angleZ * 2.0 + nx * 4.0) * 4.5;
          const ridge2 = Math.cos(nx * 17.0 - Math.cos(angleZ) * 2.0) * 2.2;
          const valleyFloor = Math.sin(nx * 6.0) * Math.cos(angleZ) * 1.1;
          const mask = Math.smoothstep ? 1 : Math.min(Math.max((Math.abs(nx) - 0.16) / 0.35, 0.0), 1.0);
          return (canyonWall + ridge1 + ridge2) * mask + valleyFloor * (1.0 - mask);
        }

        const grid = [];
        for (let r = 0; r <= rows; r++) {
          const rowPts = [];
          const nz = r / rows;
          const z = (nz - 0.5) * depth;
          for (let c = 0; c <= cols; c++) {
            const nx = (c / cols) * 2.0 - 1.0;
            const x = nx * (width * 0.5);
            const y = terrainHeight(nx, nz);
            rowPts.push([x, y, z]);
          }
          grid.push(rowPts);
        }

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const p00 = grid[r][c];
            const p10 = grid[r][c + 1];
            const p01 = grid[r + 1][c];
            const p11 = grid[r + 1][c + 1];

            const avgY = 0.25 * (p00[1] + p10[1] + p01[1] + p11[1]);
            let col = [0.14, 0.20, 0.31]; // Deep canyon slate floor
            if (avgY > 22.0) {
              col = [0.72, 0.80, 0.92]; // High alpine snow/mist peaks
            } else if (avgY > 10.0) {
              col = [0.24, 0.33, 0.48]; // Mid mountain ridge rock
            } else if (avgY > 3.5) {
              col = [0.18, 0.26, 0.39]; // Lower foothills
            }

            gb.addTri(p00, p01, p11, col, MAT_TERRAIN);
            gb.addTri(p00, p11, p10, col, MAT_TERRAIN);
          }
        }
      }
      const meshTerrain = gb.endMesh(terrainMarker);

      // ========================================================================
      // MESH 7: OCTAHEDRON SHARD FOR EXPLOSIONS & SPEED LINES
      // ========================================================================
      const shardMarker = gb.beginMesh();
      {
        const t = [0,  0.5,  0], b = [0, -0.5,  0];
        const f = [0,  0, -0.5], k = [0,  0,  0.5];
        const r = [0.5, 0,  0], l = [-0.5, 0,  0];
        const w = [1.0, 1.0, 1.0];
        gb.addTri(t, f, r, w, MAT_EMISSIVE);
        gb.addTri(t, r, k, w, MAT_EMISSIVE);
        gb.addTri(t, k, l, w, MAT_EMISSIVE);
        gb.addTri(t, l, f, w, MAT_EMISSIVE);
        gb.addTri(b, r, f, w, MAT_EMISSIVE);
        gb.addTri(b, k, r, w, MAT_EMISSIVE);
        gb.addTri(b, l, k, w, MAT_EMISSIVE);
        gb.addTri(b, f, l, w, MAT_EMISSIVE);
      }
      const meshShard = gb.endMesh(shardMarker);

      // ========================================================================
      // MESH 8: 3D HOMING MISSILE (Sleek Airframe, Seeker Nose, Cruciform Fins)
      // ========================================================================
      const missileMarker = gb.beginMesh();
      {
        const COL_MISSILE_BODY = [0.96, 0.34, 0.06];
        const COL_MISSILE_HOT  = [1.00, 0.82, 0.34];
        const COL_MISSILE_TIP  = [1.00, 0.97, 0.90];

        addCylinderZ(0, 0, -1.62, -1.05, 0.02, 0.075, 8, COL_MISSILE_TIP, MAT_EMISSIVE);
        addCylinderZ(0, 0, -1.05, -0.80, 0.075, 0.135, 8, COL_MISSILE_HOT, MAT_EMISSIVE);
        addCylinderZ(0, 0, -0.80, -0.52, 0.135, 0.135, 8, COL_MISSILE_BODY, MAT_ACCENT);
        addCylinderZ(0, 0, -0.52, -0.34, 0.138, 0.138, 8, COL_MISSILE_HOT, MAT_EMISSIVE);
        addCylinderZ(0, 0, -0.34,  0.26, 0.135, 0.135, 8, COL_MISSILE_BODY, MAT_ACCENT);
        addCylinderZ(0, 0,  0.26,  0.44, 0.138, 0.138, 8, COL_MISSILE_HOT, MAT_EMISSIVE);
        addCylinderZ(0, 0,  0.44,  1.20, 0.135, 0.135, 8, COL_MISSILE_BODY, MAT_ACCENT);
        addCylinderZ(0, 0,  1.20,  1.44, 0.135, 0.095, 8, COL_TITANIUM_DARK, MAT_METAL);
        addCylinderZ(0, 0,  1.40,  1.58, 0.105, 0.055, 8, COL_MISSILE_HOT, MAT_EMISSIVE);

        gb.addSymmetricAirfoil(
          [0.13, 0.0, 0.55],
          [0.13, 0.0, 1.32],
          0.028,
          [0.62, 0.0, 0.88],
          [0.62, 0.0, 1.35],
          0.014,
          COL_MISSILE_TIP,
          COL_MISSILE_HOT,
          COL_MISSILE_BODY,
          MAT_METAL,
          MAT_ACCENT
        );

        const vFinTopF = [0.0, 0.62, 0.88], vFinTopB = [0.0, 0.62, 1.35];
        const vFinBotF = [0.0, -0.62, 0.88], vFinBotB = [0.0, -0.62, 1.35];
        const vRootF = [0.0, 0.0, 0.55], vRootB = [0.0, 0.0, 1.32];
        gb.addQuad(vRootF, vFinTopF, vFinTopB, vRootB, COL_MISSILE_TIP, MAT_METAL);
        gb.addQuad(vFinTopF, vRootF, vRootB, vFinTopB, COL_MISSILE_TIP, MAT_METAL);
        gb.addQuad(vRootF, vFinBotF, vFinBotB, vRootB, COL_MISSILE_TIP, MAT_METAL);
        gb.addQuad(vFinBotF, vRootF, vRootB, vFinBotB, COL_MISSILE_TIP, MAT_METAL);
      }
      const meshMissile = gb.endMesh(missileMarker);

      const mothershipMarker = gb.beginMesh();
      {
        const COL_CARRIER_HULL  = [0.14, 0.16, 0.21];
        const COL_CARRIER_DECK  = [0.22, 0.25, 0.32];
        const COL_CRIMSON_TRIM  = [0.68, 0.12, 0.16];
        const COL_HANGAR_GLOW   = [1.00, 0.24, 0.14];
        const COL_REACTOR_CORE  = [0.95, 0.20, 0.78];
        const COL_SHIELD_CYAN   = [0.35, 0.92, 1.00];

        const m0 = makeFuselageRing(-22.4, 3.52,  0.00, 1.92, -1.60, 0.70);
        const m1 = makeFuselageRing(-12.0, 7.68,  0.32, 3.68, -3.04, 0.75);
        const m2 = makeFuselageRing(  0.0, 9.92,  0.48, 4.32, -3.52, 0.78);
        const m3 = makeFuselageRing( 12.0, 7.36,  0.16, 3.20, -2.88, 0.74);
        const m4 = makeFuselageRing( 20.0, 2.56, -0.16, 1.28, -1.28, 0.65);

        gb.addLoftSection(m0, m1, COL_CARRIER_DECK, COL_SILVER_METAL, COL_CARRIER_HULL, MAT_METAL);
        gb.addLoftSection(m1, m2, COL_CARRIER_HULL, COL_CRIMSON_TRIM, COL_CARRIER_HULL, MAT_GRAPHITE);
        gb.addLoftSection(m2, m3, COL_CARRIER_DECK, COL_CARRIER_HULL, COL_CARRIER_HULL, MAT_GRAPHITE);
        gb.addLoftSection(m3, m4, COL_CRIMSON_TRIM, COL_SILVER_METAL, COL_CARRIER_HULL, MAT_METAL);

        const b0 = makeFuselageRing(-8.8, 2.24, 3.84, 5.76, 3.36, 0.70);
        const b1 = makeFuselageRing(-1.6, 2.88, 4.16, 7.04, 3.52, 0.72);
        const b2 = makeFuselageRing( 5.6, 1.76, 4.00, 6.08, 3.36, 0.68);
        gb.addLoftSection(b0, b1, COL_CARRIER_DECK, COL_SILVER_METAL, COL_CARRIER_HULL, MAT_METAL);
        gb.addLoftSection(b1, b2, COL_CRIMSON_TRIM, COL_HANGAR_GLOW, COL_CARRIER_HULL, MAT_EMISSIVE);

        gb.addSymmetricAirfoil(
          [ 6.72,  0.32, -10.40],
          [ 6.72,  0.32,  10.40],
          1.20,
          [34.40, -0.96,  -5.60],
          [34.40, -0.96,   6.08],
          0.448,
          COL_CARRIER_HULL,
          COL_SILVER_METAL,
          COL_CRIMSON_TRIM,
          MAT_METAL,
          MAT_GRAPHITE
        );

        gb.addSymmetricAirfoil(
          [ 5.12, -1.92, -8.00],
          [ 5.12, -1.92,  6.40],
          0.56,
          [15.20, -6.72, -3.20],
          [15.20, -6.72,  4.00],
          0.224,
          COL_CARRIER_DECK,
          COL_SILVER_METAL,
          COL_CRIMSON_TRIM,
          MAT_METAL,
          MAT_GRAPHITE
        );

        for (const sign of [-1, 1]) {
          const hx = 13.12 * sign;
          const hy = -1.84;
          addCylinderZ(hx, hy, -8.80, 9.92, 2.64, 2.96, 8, COL_CARRIER_DECK, MAT_METAL);
          addCylinderZ(hx, hy,  7.68, 10.32, 2.16, 1.84, 8, COL_HANGAR_GLOW, MAT_EMISSIVE);
          addCylinderZ(7.20 * sign, 2.16, -12.80, 5.60, 1.04, 0.88, 8, COL_REACTOR_CORE, MAT_EMISSIVE);
        }

        addCylinderZ(0.0, -2.64, 4.00, 14.08, 1.52, 1.04, 10, COL_REACTOR_CORE, MAT_EMISSIVE);

        const plateA0 = makeFuselageRing(-14.0, 7.90, 0.50, 3.70, -3.15, 0.62);
        const plateA1 = makeFuselageRing(  9.0, 9.00, 0.35, 3.85, -3.40, 0.62);
        gb.addLoftSection(plateA0, plateA1, COL_CARRIER_HULL, COL_CRIMSON_TRIM, COL_CARRIER_HULL, MAT_GRAPHITE);

        const plateB0 = makeFuselageRing(-17.0, 7.80, 0.45, 3.30, -2.90, 0.58);
        const plateB1 = makeFuselageRing(  4.0, 11.00, 0.70, 4.40, -3.75, 0.58);
        gb.addLoftSection(plateB0, plateB1, COL_CRIMSON_TRIM, COL_CARRIER_HULL, COL_CARRIER_HULL, MAT_GRAPHITE);

        const emitterNodes = [
          [-9.0, 8.50, 0.36],
          [ 0.0, 10.10, 0.48],
          [ 9.0, 8.30, 0.24]
        ];
        for (const sign of [-1, 1]) {
          for (const node of emitterNodes) {
            addCylinderZ(node[1] * sign, node[2], node[0] - 0.45, node[0] + 0.45, 0.52, 0.36, 6, COL_SHIELD_CYAN, MAT_EMISSIVE);
          }
        }

        const c0 = makeFuselageRing(-2.0, 1.05, 6.90, 7.90, 6.50, 0.66);
        const c1 = makeFuselageRing( 3.5, 0.75, 6.80, 7.50, 6.40, 0.62);
        gb.addLoftSection(c0, c1, COL_CARRIER_DECK, COL_SILVER_METAL, COL_CARRIER_HULL, MAT_METAL);

        const canopyA = makeFuselageRing(2.6, 0.85, 7.20, 7.70, 6.70, 0.70);
        const canopyB = makeFuselageRing(4.4, 0.60, 7.10, 7.40, 6.70, 0.66);
        gb.addLoftSection(canopyA, canopyB, COL_CANOPY_GLASS, COL_CANOPY_GLASS, COL_CARRIER_HULL, MAT_CANOPY);

        for (const sign of [-1, 1]) {
          addCylinderZ(5.0 * sign, -3.60, -6.00, -5.75, 0.90, 0.90, 8, COL_REACTOR_CORE, MAT_EMISSIVE);
          addCylinderZ(5.0 * sign, -3.40,  4.50,  4.75, 0.80, 0.80, 8, COL_REACTOR_CORE, MAT_EMISSIVE);
        }

        for (const sign of [-1, 1]) {
          addCylinderZ(12.5 * sign, 1.60, 0.00, 12.00, 0.34, 0.24, 6, COL_SILVER_METAL, MAT_METAL);
          addCylinderZ(14.0 * sign, 1.60, 11.60, 12.70, 0.20, 0.12, 6, COL_SHIELD_CYAN, MAT_EMISSIVE);
        }
      }
      const meshMothership = gb.endMesh(mothershipMarker);

      const shieldDroneMarker = gb.beginMesh();
      {
        const COL_SHIELD_CYAN = [0.35, 0.92, 1.00];
        const COL_CRIMSON_ACCENT = [0.68, 0.12, 0.16];

        const d0 = makeFuselageRing(-2.00, 0.06, 0.00, 0.04, -0.04, 0.50);
        const d1 = makeFuselageRing(-1.00, 0.32, 0.02, 0.22, -0.18, 0.60);
        const d2 = makeFuselageRing( 0.40, 0.55, 0.04, 0.34, -0.30, 0.62);
        const d3 = makeFuselageRing( 1.60, 0.30, 0.01, 0.18, -0.16, 0.60);

        gb.addLoftSection(d0, d1, COL_SILVER_METAL, COL_SILVER_METAL, COL_GRAPHITE_DARK, MAT_METAL);
        gb.addLoftSection(d1, d2, COL_GRAPHITE_DARK, COL_GRAPHITE_MID, COL_GRAPHITE_DARK, MAT_GRAPHITE);
        gb.addLoftSection(d2, d3, COL_GRAPHITE_DARK, COL_CRIMSON_ACCENT, COL_GRAPHITE_DARK, MAT_METAL);

        addCylinderZ(0.0, 0.0, -2.15, -1.30, 0.50, 0.34, 8, COL_SHIELD_CYAN, MAT_EMISSIVE);

        gb.addSymmetricAirfoil(
          [0.50, 0.00, -0.70],
          [0.50, 0.00,  0.85],
          0.06,
          [1.95, 0.16, 0.10],
          [1.95, 0.16, 0.95],
          0.03,
          COL_GRAPHITE_DARK,
          COL_SILVER_METAL,
          COL_CRIMSON_ACCENT,
          MAT_METAL,
          MAT_GRAPHITE
        );

        addCylinderZ(0.0, 0.0, 1.35, 1.62, 0.16, 0.10, 8, COL_SHIELD_CYAN, MAT_EMISSIVE);
      }
      const meshShieldDrone = gb.endMesh(shieldDroneMarker);

      const shieldPanelMarker = gb.beginMesh();
      {
        const COL_PANEL_BASE   = [0.22, 0.52, 1.00];
        const COL_PANEL_BRIGHT = [0.34, 0.68, 1.00];
        const COL_PANEL_RIM    = [0.66, 0.88, 1.00];
        const COL_PANEL_SEAM   = [0.80, 0.94, 1.00];

        const panelOuterExtent = 0.5;
        const panelInset = 0.03;
        const panelInnerExtent = panelOuterExtent - panelInset;
        const panelColumnCount = 12;
        const panelRowCount = 5;

        function panelBulge(panelX) {
          const normalizedX = 2.0 * panelX;
          return 0.10 * (1.0 - normalizedX * normalizedX);
        }

        function panelPoint(panelX, panelY) {
          return [panelX, panelY, panelBulge(panelX)];
        }

        const panelColumnX = [];
        for (let columnIndex = 0; columnIndex <= panelColumnCount; columnIndex++) {
          panelColumnX.push(-panelInnerExtent + (columnIndex / panelColumnCount) * (panelInnerExtent * 2.0));
        }
        const panelRowY = [];
        for (let rowIndex = 0; rowIndex <= panelRowCount; rowIndex++) {
          panelRowY.push(-panelInnerExtent + (rowIndex / panelRowCount) * (panelInnerExtent * 2.0));
        }

        for (let rowIndex = 0; rowIndex < panelRowCount; rowIndex++) {
          for (let columnIndex = 0; columnIndex < panelColumnCount; columnIndex++) {
            const x0 = panelColumnX[columnIndex];
            const x1 = panelColumnX[columnIndex + 1];
            const y0 = panelRowY[rowIndex];
            const y1 = panelRowY[rowIndex + 1];
            const cellColor = ((rowIndex + columnIndex) % 2 === 0) ? COL_PANEL_BASE : COL_PANEL_BRIGHT;
            gb.addQuad(panelPoint(x0, y0), panelPoint(x1, y0), panelPoint(x1, y1), panelPoint(x0, y1), cellColor, MAT_EMISSIVE);
          }
        }

        for (let columnIndex = 0; columnIndex < panelColumnCount; columnIndex++) {
          const x0 = panelColumnX[columnIndex];
          const x1 = panelColumnX[columnIndex + 1];
          gb.addQuad(
            panelPoint(x0, panelInnerExtent),
            panelPoint(x1, panelInnerExtent),
            panelPoint(x1, panelOuterExtent),
            panelPoint(x0, panelOuterExtent),
            COL_PANEL_RIM,
            MAT_EMISSIVE
          );
          gb.addQuad(
            panelPoint(x0, -panelOuterExtent),
            panelPoint(x1, -panelOuterExtent),
            panelPoint(x1, -panelInnerExtent),
            panelPoint(x0, -panelInnerExtent),
            COL_PANEL_RIM,
            MAT_EMISSIVE
          );
        }

        for (let rowIndex = 0; rowIndex < panelRowCount; rowIndex++) {
          const y0 = panelRowY[rowIndex];
          const y1 = panelRowY[rowIndex + 1];
          gb.addQuad(
            panelPoint(-panelOuterExtent, y0),
            panelPoint(-panelInnerExtent, y0),
            panelPoint(-panelInnerExtent, y1),
            panelPoint(-panelOuterExtent, y1),
            COL_PANEL_RIM,
            MAT_EMISSIVE
          );
          gb.addQuad(
            panelPoint(panelInnerExtent, y0),
            panelPoint(panelOuterExtent, y0),
            panelPoint(panelOuterExtent, y1),
            panelPoint(panelInnerExtent, y1),
            COL_PANEL_RIM,
            MAT_EMISSIVE
          );
        }

        gb.addQuad(
          panelPoint(-panelOuterExtent, panelInnerExtent),
          panelPoint(-panelInnerExtent, panelInnerExtent),
          panelPoint(-panelInnerExtent, panelOuterExtent),
          panelPoint(-panelOuterExtent, panelOuterExtent),
          COL_PANEL_RIM,
          MAT_EMISSIVE
        );
        gb.addQuad(
          panelPoint(panelInnerExtent, panelInnerExtent),
          panelPoint(panelOuterExtent, panelInnerExtent),
          panelPoint(panelOuterExtent, panelOuterExtent),
          panelPoint(panelInnerExtent, panelOuterExtent),
          COL_PANEL_RIM,
          MAT_EMISSIVE
        );
        gb.addQuad(
          panelPoint(-panelOuterExtent, -panelOuterExtent),
          panelPoint(-panelInnerExtent, -panelOuterExtent),
          panelPoint(-panelInnerExtent, -panelInnerExtent),
          panelPoint(-panelOuterExtent, -panelInnerExtent),
          COL_PANEL_RIM,
          MAT_EMISSIVE
        );
        gb.addQuad(
          panelPoint(panelInnerExtent, -panelOuterExtent),
          panelPoint(panelOuterExtent, -panelOuterExtent),
          panelPoint(panelOuterExtent, -panelInnerExtent),
          panelPoint(panelInnerExtent, -panelInnerExtent),
          COL_PANEL_RIM,
          MAT_EMISSIVE
        );

        const panelSeamHalfWidth = 0.007;
        const panelSeamCentresX = [-0.235, 0.235];
        for (const seamCentreX of panelSeamCentresX) {
          gb.addQuad(
            panelPoint(seamCentreX - panelSeamHalfWidth, -panelInnerExtent),
            panelPoint(seamCentreX + panelSeamHalfWidth, -panelInnerExtent),
            panelPoint(seamCentreX + panelSeamHalfWidth, panelInnerExtent),
            panelPoint(seamCentreX - panelSeamHalfWidth, panelInnerExtent),
            COL_PANEL_SEAM,
            MAT_EMISSIVE
          );
        }

        const panelSeamHalfHeight = 0.006;
        const panelSeamCentresY = [-0.25, 0.25];
        for (const seamCentreY of panelSeamCentresY) {
          for (let columnIndex = 0; columnIndex < panelColumnCount; columnIndex++) {
            const x0 = panelColumnX[columnIndex];
            const x1 = panelColumnX[columnIndex + 1];
            gb.addQuad(
              panelPoint(x0, seamCentreY - panelSeamHalfHeight),
              panelPoint(x1, seamCentreY - panelSeamHalfHeight),
              panelPoint(x1, seamCentreY + panelSeamHalfHeight),
              panelPoint(x0, seamCentreY + panelSeamHalfHeight),
              COL_PANEL_SEAM,
              MAT_EMISSIVE
            );
          }
        }
      }
      const meshShieldPanel = gb.endMesh(shieldPanelMarker);

      const shieldRingMarker = gb.beginMesh();
      {
        const COL_RING_BODY = [0.36, 0.86, 1.00];
        const COL_RING_LIP  = [0.70, 0.94, 1.00];

        const ringInnerRadius = 0.36;
        const ringLipRadius = 0.40;
        const ringOuterRadius = 0.50;
        const ringSegmentCount = 32;

        for (let segmentIndex = 0; segmentIndex < ringSegmentCount; segmentIndex++) {
          const angle0 = (segmentIndex / ringSegmentCount) * Math.PI * 2.0;
          const angle1 = ((segmentIndex + 1) / ringSegmentCount) * Math.PI * 2.0;
          const cos0 = Math.cos(angle0), sin0 = Math.sin(angle0);
          const cos1 = Math.cos(angle1), sin1 = Math.sin(angle1);

          const inner0 = [ringInnerRadius * cos0, ringInnerRadius * sin0, 0.0];
          const lip0 = [ringLipRadius * cos0, ringLipRadius * sin0, 0.0];
          const outer0 = [ringOuterRadius * cos0, ringOuterRadius * sin0, 0.0];
          const inner1 = [ringInnerRadius * cos1, ringInnerRadius * sin1, 0.0];
          const lip1 = [ringLipRadius * cos1, ringLipRadius * sin1, 0.0];
          const outer1 = [ringOuterRadius * cos1, ringOuterRadius * sin1, 0.0];

          gb.addQuad(inner0, lip0, lip1, inner1, COL_RING_LIP, MAT_EMISSIVE);
          gb.addQuad(lip0, outer0, outer1, lip1, COL_RING_BODY, MAT_EMISSIVE);
        }
      }
      const meshShieldRing = gb.endMesh(shieldRingMarker);

      const blastSphereMarker = gb.beginMesh();
      {
        const segments = 12;
        const rings = 7;
        const grid = [];
        for (let ring = 0; ring <= rings; ring++) {
          const phi = (ring / rings) * Math.PI;
          const ringPoints = [];
          for (let segment = 0; segment <= segments; segment++) {
            const theta = (segment / segments) * Math.PI * 2;
            ringPoints.push([
              Math.sin(phi) * Math.cos(theta),
              Math.cos(phi),
              Math.sin(phi) * Math.sin(theta)
            ]);
          }
          grid.push(ringPoints);
        }
        for (let ring = 0; ring < rings; ring++) {
          for (let segment = 0; segment < segments; segment++) {
            const a = grid[ring][segment];
            const b = grid[ring][segment + 1];
            const c = grid[ring + 1][segment + 1];
            const d = grid[ring + 1][segment];
            if (ring === 0) {
              gb.addTri(a, b, c, [1, 1, 1], MAT_EMISSIVE);
            } else if (ring === rings - 1) {
              gb.addTri(a, b, d, [1, 1, 1], MAT_EMISSIVE);
            } else {
              gb.addQuad(a, b, c, d, [1, 1, 1], MAT_EMISSIVE);
            }
          }
        }
      }
      const meshBlastSphere = gb.endMesh(blastSphereMarker);

      const blastRingMarker = gb.beginMesh();
      {
        const segments = 32;
        const inner = 0.84;
        for (let segment = 0; segment < segments; segment++) {
          const angleA = (segment / segments) * Math.PI * 2;
          const angleB = ((segment + 1) / segments) * Math.PI * 2;
          const cosA = Math.cos(angleA), sinA = Math.sin(angleA);
          const cosB = Math.cos(angleB), sinB = Math.sin(angleB);
          gb.addQuad(
            [cosA * inner, sinA * inner, 0],
            [cosB * inner, sinB * inner, 0],
            [cosB, sinB, 0],
            [cosA, sinA, 0],
            [1, 1, 1],
            MAT_EMISSIVE
          );
        }
      }
      const meshBlastRing = gb.endMesh(blastRingMarker);

      const voltFighterMarker = gb.beginMesh();
      {
        const COL_VOLT_HULL   = [0.17, 0.20, 0.31];
        const COL_VOLT_PLATE  = [0.32, 0.39, 0.58];
        const COL_VOLT_ACCENT = [0.36, 0.64, 1.00];
        const COL_VOLT_ARC    = [0.72, 0.95, 1.00];

        const v0 = makeFuselageRing(-6.35, 0.02, -0.10, -0.08, -0.12, 0.50);
        const v1 = makeFuselageRing(-5.10, 0.30, -0.06,  0.10, -0.20, 0.50);
        const v2 = makeFuselageRing(-3.60, 0.66, -0.02,  0.28, -0.34, 0.52);
        const v3 = makeFuselageRing(-1.90, 1.14,  0.02,  0.44, -0.44, 0.56);
        const v4 = makeFuselageRing(-0.10, 1.44,  0.04,  0.46, -0.46, 0.62);
        const v5 = makeFuselageRing( 1.90, 1.34,  0.04,  0.40, -0.42, 0.68);
        const v6 = makeFuselageRing( 3.60, 1.10,  0.03,  0.30, -0.32, 0.72);

        gb.addLoftSection(v0, v1, COL_VOLT_ARC, COL_VOLT_ARC, COL_VOLT_ARC, MAT_EMISSIVE);
        gb.addLoftSection(v1, v2, COL_VOLT_HULL, COL_VOLT_PLATE, COL_VOLT_HULL, MAT_GRAPHITE);
        gb.addLoftSection(v2, v3, COL_VOLT_HULL, COL_VOLT_ACCENT, COL_VOLT_HULL, MAT_GRAPHITE);
        gb.addLoftSection(v3, v4, COL_VOLT_PLATE, COL_VOLT_HULL, COL_VOLT_HULL, MAT_GRAPHITE);
        gb.addLoftSection(v4, v5, COL_VOLT_HULL, COL_VOLT_HULL, COL_VOLT_HULL, MAT_GRAPHITE);
        gb.addLoftSection(v5, v6, COL_VOLT_PLATE, COL_VOLT_ACCENT, COL_VOLT_HULL, MAT_METAL);

        const k0 = makeFuselageRing(-3.85, 0.20, 0.22, 0.26, 0.20, 0.70);
        const k1 = makeFuselageRing(-2.95, 0.46, 0.32, 0.70, 0.24, 0.72);
        const k2 = makeFuselageRing(-1.85, 0.50, 0.36, 0.78, 0.28, 0.72);
        const k3 = makeFuselageRing(-0.85, 0.36, 0.38, 0.58, 0.32, 0.68);
        gb.addLoftSection(k0, k1, COL_CANOPY_GLASS, COL_CANOPY_GLASS, COL_VOLT_HULL, MAT_CANOPY);
        gb.addLoftSection(k1, k2, COL_CANOPY_GLASS, COL_CANOPY_GLASS, COL_VOLT_HULL, MAT_CANOPY);
        gb.addLoftSection(k2, k3, COL_CANOPY_GLASS, COL_CANOPY_GLASS, COL_VOLT_HULL, MAT_CANOPY);

        gb.addSymmetricAirfoil(
          [1.15, 0.04, -1.30],
          [1.15, 0.02,  2.30],
          0.13,
          [5.30, 0.30,  0.20],
          [5.30, 0.30,  1.90],
          0.05,
          COL_VOLT_HULL,
          COL_VOLT_PLATE,
          COL_VOLT_ACCENT,
          MAT_METAL,
          MAT_GRAPHITE
        );

        gb.addSymmetricAirfoil(
          [0.70, 0.20, 2.60],
          [0.70, 0.16, 4.10],
          0.06,
          [1.50, 1.55, 3.30],
          [1.46, 1.52, 4.40],
          0.025,
          COL_VOLT_PLATE,
          COL_VOLT_HULL,
          COL_VOLT_ARC,
          MAT_METAL,
          MAT_GRAPHITE
        );

        for (const sign of [-1, 1]) {
          addCylinderZ(5.34 * sign, 0.30, 0.10, 1.10, 0.10, 0.05, 6, COL_VOLT_ARC, MAT_EMISSIVE);
          addCylinderZ(0.56 * sign, -0.02, 3.55, 4.45, 0.34, 0.26, 10, COL_VOLT_PLATE, MAT_METAL);
          addCylinderZ(0.56 * sign, -0.02, 4.40, 4.66, 0.22, 0.15, 10, COL_VOLT_ARC, MAT_EMISSIVE);
          addCylinderZ(1.62 * sign, -0.20, -2.30, -1.35, 0.05, 0.13, 6, COL_VOLT_ACCENT, MAT_ACCENT);
        }
      }
      const meshVoltFighter = gb.endMesh(voltFighterMarker);

      const boltMarker = gb.beginMesh();
      {
        const COL_BOLT_CORE = [0.88, 0.98, 1.00];
        const COL_BOLT_EDGE = [0.30, 0.58, 1.00];
        const jitterX = [0.07, -0.10, 0.12, -0.08, 0.05, 0.00];
        const jitterY = [-0.05, 0.08, 0.04, -0.09, 0.06, 0.00];
        let previousZ = -2.0;
        for (let segment = 0; segment < 6; segment++) {
          const nextZ = -2.0 + ((segment + 1) / 6) * 4.0;
          const radius = 0.055 + (1 - segment / 6) * 0.045;
          addCylinderZ(
            jitterX[segment], jitterY[segment],
            previousZ, nextZ,
            radius * 0.75, radius, 5,
            segment % 2 === 0 ? COL_BOLT_CORE : COL_BOLT_EDGE,
            MAT_EMISSIVE
          );
          previousZ = nextZ;
        }
      }
      const meshLightningBolt = gb.endMesh(boltMarker);

      return {
        vertexData: new Float32Array(gb.vertices),
        indexData: new Uint32Array(gb.indices),
        meshes: {
          fighter: meshFighter,
          plume: meshPlume,
          drone: meshDrone,
          heavyDrone: meshHeavyDrone,
          swarmDrone: meshSwarmDrone,
          projectile: meshProjectile,
          terrain: meshTerrain,
          shard: meshShard,
          missile: meshMissile,
          mothership: meshMothership,
          shieldDrone: meshShieldDrone,
          shieldPanel: meshShieldPanel,
          shieldRing: meshShieldRing,
          blastSphere: meshBlastSphere,
          blastRing: meshBlastRing,
          voltFighter: meshVoltFighter,
          lightningBolt: meshLightningBolt
        }
      };
    }

