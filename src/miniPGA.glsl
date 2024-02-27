/******************************************************************************
 *
 * Look, Ma, No Matrices!
 * miniPGA.glsl
 *
 * by Steven De Keninck 
 *
 * Basic PGA support for glsl. Layouts used :
 *
 * motor     : mat2x4 : [ [s, e23, e31, e12], [e01, e02, e03, e0123] ]
 * point     : vec3   : [ e032, e013, e021 ] with implied 1 e123
 * direction : vec3   : [ e032, e013, e021 ] with implied 0 e123
 * line      : mat2x3 : [ [e23, e31, e12], [e01, e02, e03] ]
 *
 * We opt to use matrix types because they allow addition and scalar multiplication.
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
 * m = general motor (normalized)           [ [s, e23, e31, e12], [e01, e02, e03, e0123] ]
 * t = simple translation                   [ [1, 0, 0, 0], [e01, e02, e03, 0] ]
 * r = simple rotation                      [ [s, e23, e31, e12], [0, 0, 0, 0] ]
 * d = ideal point (direction)              [ e032, e013, e021 ]
 * p = normalized Euclidean point (point)   [ e032, e013, e021 ]
 * o = origin. (1e123)                      -
 * b = bivector (line)                      [ [e23, e31, e12], [e01, e02, e03] ]
 * 
 * e.g. gp_mr = geometric product between general motor and rotator.
 *      sw_md = sandwich product between general motor and direction (ideal point).
 *
 * We generally assume normalized motors for performance reasons.
 * A normalisation function is available.  
 *
 *****************************************************************************/

#define motor     mat2x4
#define line      mat2x3
#define point     vec3
#define direction vec3

const float PI = 3.141592653;

/******************************************************************************
 * Apply a normalized motor 'a' to a Euclidean point 'b'. 
 * @param {motor} a The motor 'a' in 'ab~a'. Must be normalized.
 * @param {point} b Euclidean point 'b' in 'ab~a'.
 * @returns {point} The transformed point.
 * 21 muls, 18 adds
 *****************************************************************************/

point sw_mp( motor a, point b ) {
  direction t = cross(b, a[0].yzw)  - a[1].xyz;
  return  (a[0].x * t + cross(t, a[0].yzw) - a[0].yzw * a[1].w) * 2. + b;
} 

/******************************************************************************
 * Apply a normalized motor 'a' to a Euclidean point 'b', but return 
 * (ab~a)/2 - b. (Saving 3 multiplies and 3 adds). 
 * Use this for linear bone skinning, it is not only cheaper but can handle 
 * non normalized weights, including all zero. (i.e. blend the 4 swx results, 
 * then multiply the result with two and add the original vertex back in.)
 * @param {motor} a The motor 'a' in '(ab~a)/2-b'. Must be normalized.
 * @param {point} b Euclidean point 'b' in '(ab~a)/2-b'.
 * @returns {point} (ab~a)/2-b.
 * 18 muls, 15 adds
 *****************************************************************************/

point swx_mp( motor a, point b ) {
  direction t = cross(b, a[0].yzw)  - a[1].xyz;
  return  a[0].x * t + cross(t, a[0].yzw) - a[0].yzw * a[1].w;
} 

/******************************************************************************
 * Apply a normalized motor 'a' to an Infinite point 'b'. 
 * @param {motor} a The motor 'a' in 'ab~a'. Must be normalized.
 * @param {direction} b Infinite point 'b' in 'ab~a'. (direction).
 * @returns {direction} The transformed Infinite point. (direction).
 * 18 muls, 12 adds
 *****************************************************************************/

direction sw_md( motor a, direction b ) {
  direction t = cross(b, a[0].yzw);
  return  (a[0].x * t + cross(t, a[0].yzw)) * 2. + b;
} 

/******************************************************************************
 * Apply a normalized motor 'a' to the x-direction
 * the resulting vector is normalized to length 0.5! 
 * @param {motor} a The motor 'a' in 'a * e1 * ~a'. Must be normalized.
 * @returns {direction} The transformed x direction. (direction).
 * 6 muls, 4 adds
 *****************************************************************************/

direction sw_mx( motor a ) {
  return direction(
    0.5 - a[0].w*a[0].w - a[0].z*a[0].z, 
    a[0].z*a[0].y - a[0].x*a[0].w, 
    a[0].w*a[0].y + a[0].x*a[0].z
  );
} 

/******************************************************************************
 * Apply a normalized motor 'a' to the y-direction.
 * the resulting vector is normalized to length 0.5! 
 * @param {motor} a The motor 'a' in 'a * e2 * ~a'. Must be normalized.
 * @returns {direction} The transformed y direction. (direction).
 * 6 muls, 4 adds
 *****************************************************************************/

direction sw_my( motor a ) {
  return direction(
    a[0].x*a[0].w + a[0].y*a[0].z, 
    0.5 - a[0].y*a[0].y - a[0].w*a[0].w, 
    a[0].w*a[0].z - a[0].x*a[0].y
  );
} 

/******************************************************************************
 * Apply a normalized motor 'a' to the z-direction.
 * the resulting vector is normalized to length 0.5! 
 * @param {motor} a The motor 'a' in 'a * e3 * ~a'. Must be normalized.
 * @returns {direction} The transformed z direction. (direction).
 * 6 muls, 4 adds
 *****************************************************************************/

direction sw_mz( motor a ) {
  return direction(
    a[0].y*a[0].w - a[0].z*a[0].x, 
    a[0].z*a[0].w + a[0].y*a[0].x, 
    0.5 - a[0].z*a[0].z - a[0].y*a[0].y
  );
} 

/******************************************************************************
 * Extract both the normal and tangent directions from a motor.
 * The resulting vectors are normalised to length 0.5 (saves 6 muls).
 * @param {motor} a The motor.
 * @returns {vec3[2]} the normal and tangent vectors.
 * 9 muls, 8 adds.
 *****************************************************************************/

void extractNormalTangent( motor a, out direction normal, out direction tangent ) {
  float yw = a[0].y * a[0].w;
  float xz = a[0].x * a[0].z;
  float zz = a[0].z * a[0].z;

  normal  = direction( yw - xz, a[0].z*a[0].w + a[0].y*a[0].x, 0.5 - zz - a[0].y*a[0].y );
  tangent = direction( 0.5 - zz - a[0].w*a[0].w, a[0].z*a[0].y - a[0].x*a[0].w, yw + xz );
}
 
/******************************************************************************
 * Apply a normalized motor 'a' to the origin.
 * @param {motor} a The motor 'a' in 'a * e123 * ~a'. Must be normalized.
 * @returns {point} The transformed origin.
 * 15 muls, 9 adds
 *****************************************************************************/

point sw_mo( motor a ) { 
  return 2.*( cross(a[0].yzw, a[1].xyz) - a[0].x*a[1].xyz - a[1].w*a[0].yzw ); 
}

/******************************************************************************
 * Reverse a normalized motor 'R'
 * @param {motor} R The motor to be reversed.
 * @returns {motor} The reversed motor.
 * 6 negations
 *****************************************************************************/

motor reverse_m( motor R ) { 
  return motor( R[0].x, -R[0].yzw, -R[1].xyz, R[1].w ); 
}

/******************************************************************************
 * Create a simple rotation that preserves the origin.
 * Expects an angle and normalized line (bivector).
 * @param {number} angle The angle.
 * @param {line}   B     The Euclidean line (Bivector) to rotate around.
 * @returns {motor} The exponentiation of angle*B.
 * 3 muls, cos, sin
 *****************************************************************************/

motor exp_r( float angle, line B ) { 
  return motor( cos(angle), sin(angle)*B[0], vec4(0.) ); 
}

/******************************************************************************
 * Create a simple translation.
 * Expects a distance and normalized bivector.
 * @param {number} dist  The distance.
 * @param {line}   B     The ideal line (Bivector) to 'rotate' around.
 * @returns {motor} The exponentiation of dist*B.
 * 3 muls
 *****************************************************************************/

motor exp_t( float dist, line B ) { 
  return motor( 1., 0., 0., 0., dist*B[1], 0. ); 
}

/******************************************************************************
 * General exponential.
 * @param {line}   B     The line (bivector) to exponentiate.
 * @returns {motor} The exponentiation of B.
 * 17 muls 8 add 2 div 1 sqrt 1 cos 1 sin
 *****************************************************************************/

motor exp_b( line B ) {
  float l = dot(B[0],B[0]);
  if (l==0.) return motor( vec4(1., 0., 0., 0.), vec4(B[1], 0.) );
  float a = sqrt(l), m = dot(B[0].xyz, B[1]), c = cos(a), s = sin(a)/a, t = m/l*(c-s);
  return motor( c, s*B[0], s*B[1] + t*B[0].zyx, m*s );
}

/******************************************************************************
 * General logarithm.
 * @param {motor}   M   The normalized motor of which to take the logarithm.
 * @returns {line}  The logarithm of M.
 * 14 muls 5 add 1 div 1 acos 1 sqrt
 *****************************************************************************/

line log_m( motor M ) { 
  if (M[0].x == 1.) return line( vec3(0.), vec3(M[1].xyz) );
  float a = 1./(1. - M[0].x*M[0].x), b = acos(M[0].x) * sqrt(a), c = a*M[1].w*(1. - M[0].x*b);
  return line( b*M[0].yzw, b*M[1].xyz + c*M[0].wzy);
}

/******************************************************************************
 * Efficient composition of motors iff a is a rotation and b a translation.
 * @param   {motor} A   A rotation motor A.
 * @param   {motor} B   A translation motor B.
 * @returns {motor} The composition of motors ab
 * 12 muls 8 adds
 *****************************************************************************/

motor gp_rt( motor a, motor b ) { 
  return motor( a[0], a[0].x*b[1].xyz + cross(b[1].xyz, a[0].yzw), dot(b[1].xyz, a[0].yzw) ); 
}

/******************************************************************************
 * Efficient composition of motors iff a is a translation and b a rotation.
 * @param   {motor} A   A translation motor A.
 * @param   {motor} B   A rotation motor B.
 * @returns {motor} The composition of motors ab
 * 12 muls 8 adds
 *****************************************************************************/

motor gp_tr( motor a, motor b ) { 
  return motor( b[0], b[0].x*a[1].xyz - cross(a[1].xyz, b[0].yzw), dot(a[1].xyz, b[0].yzw) ); 
}

/******************************************************************************
 * Efficient composition of motors iff a is a rotation and b a general motor.
 * @param   {motor} A   A rotation motor A.
 * @param   {motor} B   A general motor B.
 * @returns {motor} The composition of motors ab
 * 32 muls 24 adds
 *****************************************************************************/

motor gp_rm( motor a, motor b ) {
  return motor( a[0].x*b[0] + vec4( -dot(a[0].yzw, b[0].yzw), b[0].x*a[0].yzw + cross(b[0].yzw, a[0].yzw) ),
                a[0].x*b[1] + vec4( cross(b[1].xyz, a[0].yzw) - a[0].yzw*b[1].w, dot(a[0].yzw, b[1].xyz) ));
}

/******************************************************************************
 * Efficient composition of motors iff a is a general motor and b a rotation.
 * @param   {motor} A   A general motor A.
 * @param   {motor} B   A rotation motor B.
 * @returns {motor} The composition of motors ab
 * 32 muls 24 adds
 *****************************************************************************/

motor gp_mr( motor a, motor b ) {
  return motor( b[0].x*a[0] + vec4( -dot(b[0].yzw, a[0].yzw), a[0].x*b[0].yzw - cross(a[0].yzw, b[0].yzw) ),
                b[0].x*a[1] + vec4( -cross(a[1].xyz, b[0].yzw) - b[0].yzw*a[1].w, dot(b[0].yzw, a[1].xyz) ));
}

/******************************************************************************
 * Efficient composition of motors iff a is a translation and b a general motor
 * @param   {motor} A   A translation motor A.
 * @param   {motor} B   A general motor B.
 * @returns {motor} The composition of motors ab
 * 12 muls 12 adds
 *****************************************************************************/

motor gp_tm( motor a, motor b ) { 
  return motor( b[0], b[1].xyz + b[0].x*a[1].xyz - cross(a[1].xyz, b[0].yzw), dot(a[1].xyz, b[0].yzw) + b[1].w ); 
}

/******************************************************************************
 * Efficient composition of motors iff a is a general motor and b a translation
 * @param   {motor} A   A general motor A.
 * @param   {motor} B   A translation motor B.
 * @returns {motor} The composition of motors ab
 * 12 muls 12 adds
 *****************************************************************************/

motor gp_mt( motor a, motor b ) {
  return motor( a[0], a[1].xyz + a[0].x*b[1].xyz + cross(b[1].xyz, a[0].yzw), dot(b[1].xyz, a[0].yzw) + a[1].w ); 
}

/******************************************************************************
 * Efficient composition of motors iff a and b are both translators.
 * @param   {motor} A   A translation motor A.
 * @param   {motor} B   A translation motor B.
 * @returns {motor} The composition of motors ab
 * 4 adds
 *****************************************************************************/

motor gp_tt( motor a, motor b ) {
  return motor( 1., 0., 0., 0., a[1] + b[1] ); 
}

/******************************************************************************
 * Efficient composition of motors iff a and b are both rotations around origin
 * @param   {motor} A   A rotation motor A.
 * @param   {motor} B   A rotation motor B.
 * @returns {motor} The composition of motors ab
 * 16 muls 12 adds
 *****************************************************************************/

motor gp_rr( motor a, motor b ) {
  return motor( a[0].x*b[0] + vec4( -dot(a[0].yzw, b[0].yzw), b[0].x*a[0].yzw + cross(b[0].yzw,a[0].yzw) ), vec4(0.) ); 
}

/******************************************************************************
 * Compose two general motors ab = a * b
 * @param   {motor} A   A general motor A.
 * @param   {motor} B   A general motor B.
 * @returns {motor} The composition of motors ab
 * 48 muls 40 adds
 *****************************************************************************/

motor gp_mm( motor a, motor b ) {
  return motor(
         a[0].x*b[0].x   - dot(a[0].yzw, b[0].yzw), 
         a[0].x*b[0].yzw + b[0].x*a[0].yzw + cross(b[0].yzw, a[0].yzw),
         a[0].x*b[1].xyz + b[0].x*a[1].xyz + cross(b[0].yzw, a[1].xyz) + cross(b[1].xyz, a[0].yzw) - b[1].w*a[0].yzw - a[1].w*b[0].yzw, 
         a[0].x*b[1].w + b[0].x*a[1].w + dot(a[0].yzw, b[1].xyz) + dot(a[1].xyz, b[0].yzw));
}

/******************************************************************************
 * Normalize a motor.
 * @param   {motor} a   A general non-normalized motor a.
 * @returns {motor} The normalized input.
 *****************************************************************************/

motor normalize_m( motor a ) {
  float s = 1. / length( a[0] );
  float d = (a[1].w * a[0].x - dot( a[1].xyz, a[0].yzw ))*s*s;
  return motor(a[0]*s, a[1]*s + vec4(a[0].yzw*s*d,-a[0].x*s*d));
}

/******************************************************************************
 * GP between two R3 vectors.
 * @param   {vec3} a   A vector.
 * @param   {vec3} b   A vector.
 * @returns {motor} The geometric product ab
 *****************************************************************************/

motor gp_vv (vec3 a, vec3 b) { 
  return motor( dot(a,b), cross(a,b), vec4(0.) ); 
}
 
/******************************************************************************
 * Square root of a motor.
 * @param   {motor} R   The rotor to take the square root of.
 * @returns {motor} The square root of R.
 *****************************************************************************/

motor sqrt_m( motor R ) {
  return normalize_m( motor( R[0].x + 1., R[0].yzw, R[1] ) ); 
}

/******************************************************************************
 * Basis planes e1,e2,e3
 *****************************************************************************/

const direction e1 = direction(1., 0., 0.); // x = 0  (the yz plane)
const direction e2 = direction(0., 1., 0.); // y = 0  (the xz plane)
const direction e3 = direction(0., 0., 1.); // z = 0  (the xy plane)

/******************************************************************************
 * Basis lines
 *****************************************************************************/

const line e23 = line( 1., 0., 0., 0., 0., 0. ); // y = z = 0 (the x line)
const line e31 = line( 0., 1., 0., 0., 0., 0. ); // z = x = 0 (the y line)
const line e12 = line( 0., 0., 1., 0., 0., 0. ); // x = y = 0 (the z line)
const line e01 = line( 0., 0., 0., 1., 0., 0. ); // inf,x line
const line e02 = line( 0., 0., 0., 0., 1., 0. ); // inf,y line
const line e03 = line( 0., 0., 0., 0., 0., 1. ); // inf,z line

/******************************************************************************
 * Basis directions 
 *****************************************************************************/

const direction e032 = direction(1., 0., 0.); // inf,y=z=0  (inf x point)
const direction e013 = direction(0., 1., 0.); // inf,x=z=0  (inf y point)
const direction e021 = direction(0., 0., 1.); // inf,x=y=0  (inf z point)

/******************************************************************************
 * Identity motor
 *****************************************************************************/

const motor identity = motor( 1., 0., 0., 0., 0., 0., 0., 0. );

/******************************************************************************
 * Choosing for addition and scalar multiplication, by going for the internal
 * vec and mat types as opposed to custom structs, means we cannot use type
 * based dispatch. We can however still provide some flexibility for multiple
 * chained geometric products. (keep in mind the specific versions are faster!) 
 *****************************************************************************/

motor gp( motor a, motor b ) { return gp_mm(a,b); }
motor gp( motor a, motor b, motor c ) { return gp(gp(a,b),c); }
motor gp( motor a, motor b, motor c, motor d ) { return gp(gp(a,b,c),d); }
motor gp( motor a, motor b, motor c, motor d, motor e ) { return gp(gp(a,b,c,d),e); }
motor gp( motor a, motor b, motor c, motor d, motor e, motor f ) { return gp(gp(a,b,c,d,e),f); }
motor gp( vec3 a, vec3 b ) { return gp_vv(a,b); }

/******************************************************************************
 * Perform a perspective projection.
 * @param {float} n       The near clipping plane distance.
 * @param {float} f       The far clipping plane distance.
 * @param {float} minfov  The minimal field of view. (for the narrow side).
 * @param {float} aspect  The viewport aspect ratio (width/height).
 * @param {vec3}  inpos   The position of the vertex to project.
 *****************************************************************************/

vec4 project( const float n, const float f, const float minfov, float aspect, vec3 inpos ){
  float cthf = cos(minfov/2.0) / sin(minfov/2.0);              // cotangent of half the minimal fov.
  float fa = 2.*f*n/(n-f), fb = (n+f)/(n-f);                   // all of these can be precomputed constants.
//  vec2 fit = cthf * vec2(-min(1.,1./aspect), min(1.,aspect));  // depending on aspect, fit this fov horizontal or vertical. 
  vec2 fit = cthf * vec2(-1.0/aspect, 1.0);                    // fit vertical.
  return vec4( inpos.xy * fit, fa - fb*inpos.z, inpos.z );
}    
