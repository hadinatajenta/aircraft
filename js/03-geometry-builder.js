"use strict";
    // ============================================================================
    // 3. PROCEDURAL 3D GEOMETRY BUILDER (FIGHTER JET, DRONES, TERRAIN, VFX)
    // ============================================================================
    class GeometryBuilder {
      constructor() {
        this.vertices = []; // 12 floats per vertex: pos(3), norm(3), col(3), matProps(3)
        this.indices = [];
        this.vertexCount = 0;
      }

      beginMesh() {
        return {
          firstIndex: this.indices.length,
          baseVertex: 0
        };
      }

      endMesh(marker) {
        return {
          firstIndex: marker.firstIndex,
          indexCount: this.indices.length - marker.firstIndex,
          baseVertex: 0
        };
      }

      addVertex(px, py, pz, nx, ny, nz, r, g, b, matID, roughness, metallic) {
        this.vertices.push(px, py, pz, nx, ny, nz, r, g, b, matID, roughness, metallic);
        return this.vertexCount++;
      }

      // Add flat-shaded triangle with automatically computed outward normal
      addTri(p0, p1, p2, col, matProps) {
        const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
        const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;

        const i0 = this.addVertex(p0[0], p0[1], p0[2], nx, ny, nz, col[0], col[1], col[2], matProps[0], matProps[1], matProps[2]);
        const i1 = this.addVertex(p1[0], p1[1], p1[2], nx, ny, nz, col[0], col[1], col[2], matProps[0], matProps[1], matProps[2]);
        const i2 = this.addVertex(p2[0], p2[1], p2[2], nx, ny, nz, col[0], col[1], col[2], matProps[0], matProps[1], matProps[2]);
        this.indices.push(i0, i1, i2);
      }

      // Add quad (p0, p1, p2, p3 in counter-clockwise order)
      addQuad(p0, p1, p2, p3, col, matProps) {
        this.addTri(p0, p1, p2, col, matProps);
        this.addTri(p0, p2, p3, col, matProps);
      }

      // Loft two 3D cross-section rings of equal point count
      addLoftSection(ringA, ringB, colTop, colSide, colBot, matProps) {
        const n = ringA.length;
        for (let i = 0; i < n; i++) {
          const next = (i + 1) % n;
          const a0 = ringA[i], a1 = ringA[next];
          const b0 = ringB[i], b1 = ringB[next];

          // Choose top/side/bottom color based on average Y of quad
          const avgY = 0.25 * (a0[1] + a1[1] + b0[1] + b1[1]);
          let c = colSide;
          if (avgY > 0.08) c = colTop;
          else if (avgY < -0.08) c = colBot;

          this.addQuad(a0, b0, b1, a1, c, matProps);
        }
      }

      // Helper to build a 3D wing/fin airfoil surface from root chord to tip chord
      addSymmetricAirfoil(rootFront, rootBack, rootThick, tipFront, tipBack, tipThick, colMain, colEdge, colAccent, matMetal, matPaint) {
        for (const sign of [-1, 1]) {
          const rf = [rootFront[0] * sign, rootFront[1], rootFront[2]];
          const rb = [rootBack[0] * sign,  rootBack[1],  rootBack[2]];
          const tf = [tipFront[0] * sign,  tipFront[1],  tipFront[2]];
          const tb = [tipBack[0] * sign,   tipBack[1],   tipBack[2]];

          // Mid-chord ridge points (giving a realistic diamond/hexagonal supersonic airfoil cross-section)
          const rMidX = (rf[0] * 0.45 + rb[0] * 0.55);
          const rMidY = (rf[1] * 0.45 + rb[1] * 0.55);
          const rMidZ = (rf[2] * 0.45 + rb[2] * 0.55);

          const tMidX = (tf[0] * 0.45 + tb[0] * 0.55);
          const tMidY = (tf[1] * 0.45 + tb[1] * 0.55);
          const tMidZ = (tf[2] * 0.45 + tb[2] * 0.55);

          const rTop = [rMidX, rMidY + rootThick, rMidZ];
          const rBot = [rMidX, rMidY - rootThick * 0.7, rMidZ];
          const tTop = [tMidX, tMidY + tipThick, tMidZ];
          const tBot = [tMidX, tMidY - tipThick * 0.7, tMidZ];

          // Split spanwise at 82% for high-contrast wingtip accent stripe
          const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
          const s = 0.80;
          const mf = lerp3(rf, tf, s);
          const mb = lerp3(rb, tb, s);
          const mTop = lerp3(rTop, tTop, s);
          const mBot = lerp3(rBot, tBot, s);

          if (sign === 1) {
            // Right wing (+X): ensure CCW winding
            // Inner main wing (leading edge metallic silver, aft main panel dark graphite)
            this.addQuad(rf, mf, mTop, rTop, colEdge, matMetal);
            this.addQuad(rTop, mTop, mb, rb, colMain, matPaint);
            this.addQuad(mf, rf, rBot, mBot, colEdge, matMetal);
            this.addQuad(mBot, rBot, rb, mb, colMain, matPaint);

            // Outer tip panel (orange tactical accent)
            this.addQuad(mf, tf, tTop, mTop, colAccent, matPaint);
            this.addQuad(mTop, tTop, tb, mb, colAccent, matPaint);
            this.addQuad(tf, mf, mBot, tBot, colAccent, matPaint);
            this.addQuad(tBot, mBot, mb, tb, colAccent, matPaint);

            // Tip cap
            this.addTri(tf, tb, tTop, colEdge, matMetal);
            this.addTri(tf, tBot, tb, colEdge, matMetal);
          } else {
            // Left wing (-X): reverse winding for mirrored X
            this.addQuad(mf, rf, rTop, mTop, colEdge, matMetal);
            this.addQuad(mTop, rTop, rb, mb, colMain, matPaint);
            this.addQuad(rf, mf, mBot, rBot, colEdge, matMetal);
            this.addQuad(rBot, mBot, mb, rb, colMain, matPaint);

            this.addQuad(tf, mf, mTop, tTop, colAccent, matPaint);
            this.addQuad(tTop, mTop, mb, tb, colAccent, matPaint);
            this.addQuad(mf, tf, tBot, mBot, colAccent, matPaint);
            this.addQuad(mBot, tBot, tb, mb, colAccent, matPaint);

            this.addTri(tb, tf, tTop, colEdge, matMetal);
            this.addTri(tBot, tf, tb, colEdge, matMetal);
          }
        }
      }
    }

