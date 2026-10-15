"use strict";
    // ============================================================================
    // 2. COMPACT 3D MATRIX & VECTOR MATH UTILITIES (ZERO ALLOCATIONS IN LOOP)
    // ============================================================================
    function createMat4() {
      return new Float32Array(16);
    }

    function mat4Identity(out) {
      out.fill(0);
      out[0] = 1; out[5] = 1; out[10] = 1; out[15] = 1;
      return out;
    }

    // WebGPU perspective matrix (clip space Z in [0, 1])
    function mat4PerspectiveZO(out, fovyRad, aspect, near, far) {
      const f = 1.0 / Math.tan(fovyRad * 0.5);
      const nf = 1.0 / (near - far);
      out.fill(0);
      out[0] = f / aspect;
      out[5] = f;
      out[10] = far * nf;
      out[11] = -1.0;
      out[14] = near * far * nf;
      return out;
    }

    function mat4LookAt(out, eyeX, eyeY, eyeZ, centerX, centerY, centerZ, upX, upY, upZ) {
      let zx = eyeX - centerX, zy = eyeY - centerY, zz = eyeZ - centerZ;
      let len = Math.hypot(zx, zy, zz) || 1;
      zx /= len; zy /= len; zz /= len;

      let xx = upY * zz - upZ * zy;
      let xy = upZ * zx - upX * zz;
      let xz = upX * zy - upY * zx;
      len = Math.hypot(xx, xy, xz) || 1;
      xx /= len; xy /= len; xz /= len;

      const yx = zy * xz - zz * xy;
      const yy = zz * xx - zx * xz;
      const yz = zx * xy - zy * xx;

      out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
      out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
      out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
      out[12] = -(xx * eyeX + xy * eyeY + xz * eyeZ);
      out[13] = -(yx * eyeX + yy * eyeY + yz * eyeZ);
      out[14] = -(zx * eyeX + zy * eyeY + zz * eyeZ);
      out[15] = 1;
      return out;
    }

    function mat4Multiply(out, a, b) {
      const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
      const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
      const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

      for (let i = 0; i < 4; i++) {
        const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
        out[i * 4]     = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        out[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        out[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        out[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
      }
      return out;
    }

    function mat4Invert(out, m) {
      const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
      const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
      const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
      const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

      const b00 = a00 * a11 - a01 * a10;
      const b01 = a00 * a12 - a02 * a10;
      const b02 = a00 * a13 - a03 * a10;
      const b03 = a01 * a12 - a02 * a11;
      const b04 = a01 * a13 - a03 * a11;
      const b05 = a02 * a13 - a03 * a12;
      const b06 = a20 * a31 - a21 * a30;
      const b07 = a20 * a32 - a22 * a30;
      const b08 = a20 * a33 - a23 * a30;
      const b09 = a21 * a32 - a22 * a31;
      const b10 = a21 * a33 - a23 * a31;
      const b11 = a22 * a33 - a23 * a32;

      let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) return mat4Identity(out);
      det = 1.0 / det;

      out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
      out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
      out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
      out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
      out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
      out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
      out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
      out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
      out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
      out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
      out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
      out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
      out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
      out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
      out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
      out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
      return out;
    }

    // Compose TRS matrix with Yaw (Y) -> Pitch (X) -> Roll (Z) intrinsic Euler rotation
    function composeModelMatrix(out, offset, tx, ty, tz, yaw, pitch, roll, sx, sy, sz) {
      const cy = Math.cos(yaw), syaw = Math.sin(yaw);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const cr = Math.cos(roll), sr = Math.sin(roll);

      // R = Ry(yaw) * Rx(pitch) * Rz(roll)
      const r00 = cy * cr + syaw * sp * sr;
      const r01 = cp * sr;
      const r02 = -syaw * cr + cy * sp * sr;

      const r10 = -cy * sr + syaw * sp * cr;
      const r11 = cp * cr;
      const r12 = syaw * sr + cy * sp * cr;

      const r20 = syaw * cp;
      const r21 = -sp;
      const r22 = cy * cp;

      out[offset + 0]  = r00 * sx;
      out[offset + 1]  = r01 * sx;
      out[offset + 2]  = r02 * sx;
      out[offset + 3]  = 0;

      out[offset + 4]  = r10 * sy;
      out[offset + 5]  = r11 * sy;
      out[offset + 6]  = r12 * sy;
      out[offset + 7]  = 0;

      out[offset + 8]  = r20 * sz;
      out[offset + 9]  = r21 * sz;
      out[offset + 10] = r22 * sz;
      out[offset + 11] = 0;

      out[offset + 12] = tx;
      out[offset + 13] = ty;
      out[offset + 14] = tz;
      out[offset + 15] = 1;
    }

    // Transform a local point by aircraft yaw/pitch/roll + position
    function transformAircraftPoint(localX, localY, localZ, jetX, jetY, jetZ, yaw, pitch, roll, outVec) {
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const cr = Math.cos(roll), sr = Math.sin(roll);

      const r00 = cy * cr + sy * sp * sr;
      const r01 = cp * sr;
      const r02 = -sy * cr + cy * sp * sr;
      const r10 = -cy * sr + sy * sp * cr;
      const r11 = cp * cr;
      const r12 = sy * sr + cy * sp * cr;
      const r20 = sy * cp;
      const r21 = -sp;
      const r22 = cy * cp;

      outVec[0] = jetX + localX * r00 + localY * r10 + localZ * r20;
      outVec[1] = jetY + localX * r01 + localY * r11 + localZ * r21;
      outVec[2] = jetZ + localX * r02 + localY * r12 + localZ * r22;
    }

