/******************************************************************************
 *
 * Look, Ma, No Matrices!
 * miniPGA.js
 *
 * by Steven De Keninck 
 *
 * Basic PGA support for javascript. Layouts used mirror miniPGA.glsl :
 *
 * motor     : mat2x4 : [ s, e23, e31, e12, e01, e02, e03, e0123 ]
 * point     : vec3   : [ e032, e013, e021 ] with implied 1 e123
 * direction : vec3   : [ e032, e013, e021 ] with implied 0 e123
 * line      : mat2x3 : [ e23, e31, e12, e01, e02, e03 ]
 *
 * A postfix approach is used to disambiguate overlapping types. We provide the
 * following functions :
 *
 * prefix      function          postfix
 * gp        = geometric product [_rt, _tr, _mt, _tm, _mr, _rm, _rr, _tt, _mm, _vv]
 * sw        = sandwich product  [_mp, _md, _mo]
 * reverse   = reverse           [_m]
 * exp       = exponential       [_b]
 * log       = logarithm         [_m]
 * normalize = normalize         [_m]
 * sqrt      = square root       [_m]
 *
 * Postfix naming convention :
 *
 * m = general motor (normalized)           [ s, e23, e31, e12, e01, e02, e03, e0123 ]
 * t = simple translation                   [ 1, 0, 0, 0, e01, e02, e03, 0 ]
 * r = simple rotation                      [ s, e23, e31, e12, 0, 0, 0, 0 ]
 * d = ideal point (direction)              [ e032, e013, e021 ]
 * p = normalized Euclidean point (point)   [ e032, e013, e021 ]
 * o = origin. (1e123)                      -
 * b = bivector (line)                      [ e23, e31, e12, e01, e02, e03 ]
 * 
 * We generally assume normalized motors for performance reasons.
 * A normalisation function is available.  
 *
 *****************************************************************************/

/******************************************************************************
 * Some helpers from Math.
 *****************************************************************************/

const {sqrt, cos, sin, PI, E, acos, abs, max, min, hypot} = Math;

/******************************************************************************
 * Basetype used for PGA storage.
 *****************************************************************************/

const baseType = Float32Array;

/******************************************************************************
 * Vector Dot product between two n-d vectors.
 * @param {Array} A First vector
 * @param {Array} B Second vector
 * @returns {Number} The vector dot product between A and B.
 *****************************************************************************/

export const dot         = (A,B) => A.reduce((s,A,i)=>s+A*B[i],0);

/******************************************************************************
 * Vector Cross product between two 3-d vectors.
 * @param {Array} A First vector
 * @param {Array} B Second vector
 * @returns {Array} The vector cross product between A and B.
 *****************************************************************************/

export const cross       = (A,B) => A.map((_,i)=> A[(i+1)%3]*B[(i+2)%3] - A[(i+2)%3]*B[(i+1)%3] );

/******************************************************************************
 * Vector Cross product between two 3-d vectors.
 * @param {Array} A First vector
 * @param {Array} B Second vector
 * @returns {Array} The vector cross product between A and B.
 *****************************************************************************/

export const mix         = (A,B,t) => A.map((Ai,i)=>(1-t)*Ai + t*B[i]);

/******************************************************************************
 * Vector Cross product between two 3-d vectors.
 * @param {Array} A vector
 * @returns {Number} The average value.
 *****************************************************************************/

export const avg         = x => x.reduce((s,a)=>s+a)/x.length;

/******************************************************************************
 * Vector Length
 * @param {Array} A vector
 * @returns {Number} The vector's length.
 *****************************************************************************/

export const length      = A => Math.hypot(...A);

/******************************************************************************
 * Vector Normalization
 * @param {Array} A Input Vector
 * @returns {Array} The normalized vector
 *****************************************************************************/

export const normalize_v = v => mul(v, 1/length(v)); 

/******************************************************************************
 * Vector Addition
 * @param {Array} A Input Vector A
 * @param {Array|Number} B Input vector or number B.
 * @returns {Array} A + B
 *****************************************************************************/

export const add         = (A,B) => A.map((Ai,i)=>Ai+(B[i]??B));

/******************************************************************************
 * Vector Subtraction
 * @param {Array} A Input Vector A
 * @param {Array|Number} B Input vector or number B.
 * @returns {Array} A - B
 *****************************************************************************/

export const sub         = (A,B) => A.map((Ai,i)=>Ai-(B[i]??B));

/******************************************************************************
 * Vector Hadamard Product
 * @param {Array} A Input Vector A
 * @param {Array|Number} B Input vector or number B.
 * @returns {Array} Component wise multiplication
 *****************************************************************************/

export const mul         = (A,B) => A.map((Ai,i)=>Ai*(B[i]??B));

/******************************************************************************
 * Apply a normalized motor 'a' to a Euclidean point 'b'. 
 * @param {motor} a The motor 'a' in 'ab~a'. Must be normalized.
 * @param {point} b Euclidean point 'b' in 'ab~a'.
 * @returns {point} The transformed point.
 * 21 muls, 18 adds
 *****************************************************************************/

export const sw_mp = (a, b) => {
  const a0=a[0],a1=a[1],a2=a[2],a3=a[3],a4=a[4],a5=a[5],a6=a[6],a7=a[7],
        b0=b[0],b1=b[1],b2=b[2],
        s0=a1*b2-a3*b0-a5, s1=a3*b1-a2*b2-a4, s2=a2*b0-a1*b1-a6;

  return [b0+2*(a3*s0+a0*s1-a1*a7-a2*s2),
          b1+2*(a1*s2+a0*s0-a2*a7-a3*s1),
          b2+2*(a2*s1+a0*s2-a3*a7-a1*s0)];
} 

/******************************************************************************
 * Apply a normalized motor 'a' to an Infinite point 'b'. 
 * @param {motor} a The motor 'a' in 'ab~a'. Must be normalized.
 * @param {direction} b Infinite point 'b' in 'ab~a'. (direction).
 * @returns {direction} The transformed Infinite point. (direction).
 * 18 muls, 12 adds
 *****************************************************************************/

export const sw_md = (a, b) => {
  const a0=a[0],a1=a[1],a2=a[2],a3=a[3],a4=a[4],a5=a[5],a6=a[6],a7=a[7],b0=b[0],b1=b[1],b2=b[2],
    s0=a1*b2-a3*b0,s1=a3*b1-a2*b2,s2=a2*b0-a1*b1;
  return [b0+2*(a3*s0+a0*s1-a2*s2),
          b1+2*(a1*s2+a0*s0-a3*s1),
          b2+2*(a2*s1+a0*s2-a1*s0)];
} 

/******************************************************************************
 * Apply a normalized motor 'a' to the origin.
 * @param {motor} a The motor 'a' in 'a * e123 * ~a'. Must be normalized.
 * @returns {point} The transformed origin.
 * 15 muls, 9 adds
 *****************************************************************************/

export const sw_mo = a => {
  const a0=a[0],a1=a[1],a2=a[2],a3=a[3],a4=a[4],a5=a[5],a6=a[6],a7=a[7];
  return [2*(a2*a6-a0*a4-a1*a7-a3*a5),
          2*(a3*a4-a0*a5-a1*a6-a2*a7),
          2*(a1*a5-a0*a6-a2*a4-a3*a7)];
}

/******************************************************************************
 * Reverse a normalized motor 'R'
 * @param {motor} R The motor to be reversed.
 * @returns {motor} The reversed motor.
 * 6 negations
 *****************************************************************************/

export const reverse_m = (R, res = new baseType(8)) => {
  res[0] = R[0]; res[1] = -R[1]; res[2] = -R[2]; res[3] = -R[3];
  res[4] = -R[4]; res[5] = -R[5]; res[6] = -R[6]; res[7] = R[7];
  return res;
}; 

/******************************************************************************
 * Create a simple rotation that preserves the origin.
 * Expects an angle and normalized line (bivector).
 * @param {number} angle The angle.
 * @param {line}   B     The Euclidean line (Bivector) to rotate around.
 * @returns {motor} The exponentiation of angle*B.
 * 3 muls, cos, sin
 *****************************************************************************/

export const exp_r = (angle, B, R = new baseType(8)) => {
  var s = sin(angle);
  R[0] = cos(angle); R[1] = B[0]*s; R[2] = B[1]*s; R[3] = B[2]*s;
  R[4] = R[5] = R[6] = R[7] = 0;
  return R;
} 

/******************************************************************************
 * Create a simple translation.
 * Expects a distance and normalized bivector.
 * @param {number} dist  The distance.
 * @param {line}   B     The ideal line (Bivector) to 'rotate' around.
 * @returns {motor} The exponentiation of dist*B.
 * 3 muls
 *****************************************************************************/

export const exp_t = (dist, B, R = new baseType(8)) => {
  R[0] = 1; R[1] = R[2] = R[3] = R[7] = 0;
  R[4] = dist*B[3]; R[5] = dist*B[4]; R[6] = dist*B[5];
  return R;
}

/******************************************************************************
 * General exponential.
 * @param {line}   B     The line (bivector) to exponentiate.
 * @returns {motor} The exponentiation of B.
 * 17 muls 8 add 2 div 1 sqrt 1 cos 1 sin
 *****************************************************************************/

export const exp_b = ( B, R = new baseType(8) ) => {
  const l = B[0]**2 + B[1]**2 + B[2]**2; 
  if (l==0) return [1,0,0,0,B[3],B[4],B[5],0]; 
  const a = sqrt(l), m = B[0]*B[3]+B[1]*B[4]+B[2]*B[5], c = cos(a), s = sin(a)/a, t = m/l*(c-s);
  R[0] = c; R[1] = B[0]*s; R[2] = B[1]*s; R[3] = B[2]*s;
  R[4] = B[3]*s + B[0]*t; R[5] = B[4]*s + B[1]*t; R[6] = B[5]*s + B[2]*t; R[7] = m*s;
  return R;
}

/******************************************************************************
 * General logarithm.
 * @param {motor}   M   The normalized motor of which to take the logarithm.
 * @returns {line}  The logarithm of M.
 * 14 muls 5 add 1 div 1 acos 1 sqrt
 *****************************************************************************/

export const log_m = M => { 
  if (Math.abs(M[0] - 1.)<0.000001) return [0,0,0,M[4],M[5],M[6]];
  const a = 1./(1. - M[0]**2), b = acos(M[0]) * Math.sqrt(a), c = a*M[7]*(1. - M[0]*b);
  return [M[1]*b, M[2]*b, M[3]*b, M[4]*b + M[1]*c, M[5]*b + M[2]*c, M[6]*b + M[3]*c]; 
}

/******************************************************************************
 * Compose two general motors ab = a * b
 * @param   {motor} A   A general motor A.
 * @param   {motor} B   A general motor B.
 * @returns {motor} The composition of motors ab
 * 48 muls 40 adds
 *****************************************************************************/

export const gp_mm = (a,b,res=new baseType(8)) => {
  const a0=a[0],a1=a[1],a2=a[2],a3=a[3],a4=a[4],a5=a[5],a6=a[6],a7=a[7],
        b0=b[0],b1=b[1],b2=b[2],b3=b[3],b4=b[4],b5=b[5],b6=b[6],b7=b[7];
  res[0] = a0*b0-a1*b1-a2*b2-a3*b3;
  res[1] = a0*b1+a1*b0+a3*b2-a2*b3;
  res[2] = a0*b2+a1*b3+a2*b0-a3*b1;
  res[3] = a0*b3+a2*b1+a3*b0-a1*b2;
  res[4] = a0*b4+a3*b5+a4*b0+a6*b2-a1*b7-a2*b6-a5*b3-a7*b1;
  res[5] = a0*b5+a1*b6+a4*b3+a5*b0-a2*b7-a3*b4-a6*b1-a7*b2;
  res[6] = a0*b6+a2*b4+a5*b1+a6*b0-a1*b5-a3*b7-a4*b2-a7*b3;
  res[7] = a0*b7+a1*b4+a2*b5+a3*b6+a4*b1+a5*b2+a6*b3+a7*b0;
  return res;
}

/******************************************************************************
 * Normalize a motor.
 * @param   {motor} a   A general non-normalized motor a.
 * @returns {motor} The normalized input.
 *****************************************************************************/

export const normalize_m = a => { 
  const a0=a[0], a1=a[1], a2=a[2], a3=a[3], a4=a[4], a5=a[5], a6=a[6], a7=a[7];
  const s = 1. / (a0**2 + a1**2 + a2**2 + a3**2)**.5; 
  const d = (a7*a0 - ( a4*a1 + a5*a2 + a6*a3 ))*s*s;
  return new baseType([ a0*s, a1*s, a2*s, a3*s, 
           a4*s + a1*s*d, a5*s + a2*s*d, a6*s + a3*s*d, a7*s - a0*s*d ]);
}

/******************************************************************************
 * GP between two R3 vectors.
 * @param   {vec3} a   A vector.
 * @param   {vec3} b   A vector.
 * @returns {motor} The geometric product ab
 *****************************************************************************/

export const gp_vv = (a,b)=> [dot(a,b),...cross(a,b),0,0,0,0];
 
/******************************************************************************
 * Square root of a motor.
 * @param   {motor} R   The rotor to take the square root of.
 * @returns {motor} The square root of R.
 *****************************************************************************/

export const sqrt_m = R => normalize_m( [R[0]+1,R[1],R[2],R[3],R[4],R[5],R[6],R[7]] ); 

/******************************************************************************
 * Basis planes e1,e2,e3
 *****************************************************************************/

export const e1 = new baseType([1., 0., 0.]);
export const e2 = new baseType([0., 1., 0.]);
export const e3 = new baseType([0., 0., 1.]);

/******************************************************************************
 * Basis directions 
 *****************************************************************************/

export const e032 = new baseType([1., 0., 0.]);
export const e013 = new baseType([0., 1., 0.]);
export const e021 = new baseType([0., 0., 1.]);
export const e123 = new baseType([0., 0., 0.]); // remember implied 4th '1' coefficient for points !

/******************************************************************************
 * Basis lines
 *****************************************************************************/

export const e23 = new baseType([ 1., 0., 0., 0., 0., 0.]);
export const e31 = new baseType([ 0., 1., 0., 0., 0., 0.]);
export const e12 = new baseType([ 0., 0., 1., 0., 0., 0.]);
export const e01 = new baseType([ 0., 0., 0., 1., 0., 0.]);
export const e02 = new baseType([ 0., 0., 0., 0., 1., 0.]);
export const e03 = new baseType([ 0., 0., 0., 0., 0., 1.]);

/******************************************************************************
 * Identity motor
 *****************************************************************************/

export const identity = new baseType([1,0,0,0, 0,0,0,0]);

/******************************************************************************
 * Multi-argument gp, and type aware normalize.
 *****************************************************************************/

export const gp = (a,...args)=>a.length==3?gp_vv(a,args[0]):args.reduce((p,x)=>gp_mm(p,x),a);
export const normalize = x => x.length != 3 ? normalize_m(x) : normalize_v(x);

/******************************************************************************
 * Convert an orthogonal 3x3 matrix to a motor. Try to compensate for funky
 * scaling. Used only for importing animations, tangent spaces etc. 
 * @param {Matrix} M The 3x3 input matrix
 * @returns {Motor} The rotor representing this matrix.
 *****************************************************************************/

export const fromMatrix3 = M => {
  // Shorthand.
  var [m00,m01,m02,m10,m11,m12,m20,m21,m22] = M;
  
  // Quick scale check - we really should do SVD here.
  const scale = [hypot(m00,m01,m02),hypot(m10,m11,m12),hypot(m20,m21,m22)];
  if (abs(scale[0]-1)>0.0001 || abs(scale[1]-1)>0.0001 || abs(scale[2]-1)>0.0001) {
    const i = scale.map(s=>1/s);
    m00 *= i[0]; m01 *= i[0]; m02 *= i[0];
    m10 *= i[1]; m11 *= i[1]; m12 *= i[1];
    m20 *= i[2]; m21 *= i[2]; m22 *= i[2];
    if (abs(scale[0]/scale[1]-1)>0.0001 || abs(scale[1]/scale[2]-1)>0.0001) console.warn("non uniformly scaled matrix !", scale);
  }  
  
  // Return a pure rotation (in motor format)
  return normalize(   m00 + m11 + m22 > 0 ? [m00 + m11 + m22 + 1.0, m21 - m12, m02 - m20, m10 - m01, 0,0,0,0]:
                   m00 > m11 && m00 > m22 ? [m21 - m12, 1.0 + m00 - m11 - m22, m01 + m10, m02 + m20, 0,0,0,0]:
                                m11 > m22 ? [m02 - m20, m01 + m10, 1.0 + m11 - m00 - m22, m12 + m21, 0,0,0,0]:
                                            [m10 - m01, m02 + m20, m12 + m21, 1.0 + m22 - m00 - m11, 0,0,0,0]);
}

/******************************************************************************
 * Convert an orthogonal 4x4 matrix to a motor. Try to compensate for funky
 * scaling. Used only for importing animations etc.
 * @param {Matrix} M The 4x4 input matrix
 * @returns {Motor} The motor representing this matrix.
 *****************************************************************************/

export const fromMatrix = M => {
  // Shorthand.
  var [m00,m01,m02,m03,m10,m11,m12,m13,m20,m21,m22,m23,m30,m31,m32,m33] = M;
  
  // Return rotor as translation * rotation
  return gp_mm( [1,0,0,0,-0.5*m30,-0.5*m31,-0.5*m32,0], fromMatrix3([m00,m01,m02,m10,m11,m12,m20,m21,m22]) );
}

