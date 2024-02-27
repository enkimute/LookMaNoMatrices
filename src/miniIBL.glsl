/******************************************************************************
 *
 * Look, Ma, No Matrices!
 * miniIBL.glsl
 *
 * by Steven De Keninck 
 *
 * Elementary IBL GGX lighting support.  
 * Adapted from the official Khronos glTF viewer.
 *
 */ 

/* We use three textures for IBL lighting :
 *
 * ibl_irradiance : cubemap for environment and reflections. (GGX mips)
 * ibl_radiance   : cubemap for indirect lighting.
 * ibl_lut        : GGX lookup table.
 */

uniform samplerCube ibl_irradiance;
uniform samplerCube ibl_radiance;
uniform sampler2D   ibl_lut;

/* Convert a direction to equirectangular uv coordinates.
 *
 * @param {vec3} direction The direction to convert.
 * @returns {vec2} The equirectangular uv coordinates.
 **/
 
vec2 equirect(vec3 dir) { 
  return vec2(1.0 - (PI + atan(dir.z,dir.x)) / (2.0 * PI), acos(dir.y) / PI); 
}
  
/**
 * Reproject a (position,direction) w.r.t. a finite environment cube. Used for localised
 * reflections and lighting. It requires vpos to be inside the box! 
 *
 * @param {vec3} indir    The direction to reproject.
 * @param {vec3} vpos     The position indir is from.
 * @param {vec3} bmin     The minimum values of an axis aligned bounding box.
 * @param {vec3} bmax     The maximum values of an axis aligned bounding box.
 * @param {vec3} bpos     The center of the axis aligned bounding box.
 * @returns {vec3} The reprojected direction.  
 **/     

vec3 reproject_cube( vec3 indir, vec3 vpos, vec3 bmin, vec3 bmax, vec3 bpos ) {

  // Determine where, seen from vpos, our indir hits the box.
  
  vec3 FirstPlaneIntersect = (bmax-vpos) / indir;
  vec3 SecondPlaneIntersect = (bmin-vpos) / indir;
  
  // Figure out the furthest plane, and the distance to it.
  
  vec3 FurthestPlane = max(FirstPlaneIntersect, SecondPlaneIntersect);
  float Distance = min(min(FurthestPlane.x, FurthestPlane.y), FurthestPlane.z); 
  
  // Return the direction 'bpos' needs to hit the same point.  
  
  vec3 IntersectPositionWS = vpos.xyz + indir * Distance;
  return normalize(IntersectPositionWS - bpos);
} 

/**
 * Computes the specular radiance contribution from the environment lighting using GGX.
 * 
 * @param vec3 n          The surface normal direction vector.
 * @param vec3 v          The view direction vector from the camera to the surface point.
 * @param float roughness The roughness of the surface, affecting the sharpness of the reflection.
 * @param vec3 F0         The Fresnel reflectance at normal incidence.
 * @param vec3 pos        The position of the surface point in world space.
 * @returns vec3          The specular radiance contribution from the environment.
 */

vec3 getIBLRadianceGGX(vec3 n, vec3 v, float roughness, vec3 F0, vec3 pos)
{

    // Clamp dot product of normal and view vector to avoid negative values

    float NdotV = clamp(dot(n, v), 0.0, 1.0);

    // Calculate level of detail for mipmapping based on roughness

    float lod = roughness * 7.0; // Assuming 8 mipmap levels

    // Reflect view vector around normal, and reproject w.r.t. environment box

    vec3 reflection = normalize(reflect(-v, n));
    reflection = reproject_cube(reflection, pos, vec3(-12.0, -1.0, -12.0), vec3(12.0, 80.0, 12.0), vec3(0.0, 0.0, -2.3));

    // Determine the BRDF sampling point, sample reflectance and geom. att.

    vec2 brdfSamplePoint = clamp(vec2(NdotV, roughness), vec2(0.0), vec2(1.0));
    vec2 f_ab = texture(ibl_lut, brdfSamplePoint).rg;

    // Sample the specular radiance from the environment map

    vec3 specularLight = textureLod(ibl_irradiance, reflection, lod).rgb;

    // Calculate Fresnel reflectance and specualr scaling.

    vec3 Fr = max(vec3(1.0 - roughness), F0) - F0;
    vec3 k_S = F0 + Fr * pow(1.0 - NdotV, 5.0);

    // Return final spec contribution from env.

    return specularLight * (k_S * f_ab.x + f_ab.y);
}

/**
 * Computes the diffuse radiance contribution from the environment lighting based on Lambertian reflection.
 * This function provides the indirect lighting effect on surfaces, taking into account their roughness and base color.
 * 
 * @param vec3 n            The surface normal direction vector.
 * @param vec3 v            The view direction vector from the camera to the surface point.
 * @param float roughness   The roughness of the surface, affecting the diffusion of the reflection.
 * @param vec3 diffuseColor The base color of the surface.
 * @param vec3 F0           The Fresnel reflectance at normal incidence.
 * @returns vec3            The diffuse radiance contribution from the environment.
 */

vec3 getIBLRadianceLambertian(vec3 n, vec3 v, float roughness, vec3 diffuseColor, vec3 F0)
{
    // Clamp dot product of normal and view vector to ensure non-negative values

    float NdotV = clamp(dot(n, v), 0.0, 1.0);

    // Determine the BRDF sampling point, sample reflectance and geom. att.

    vec2 brdfSamplePoint = clamp(vec2(NdotV, roughness), vec2(0.0), vec2(1.0));
    vec2 f_ab = texture(ibl_lut, brdfSamplePoint).rg;

    // Sample the diffuse irradiance from the environment map

    vec3 irradiance = texture(ibl_radiance, n).rgb;

    // Calculate Fresnel reflectance at normal incidence

    vec3 Fr = max(vec3(1.0 - roughness), F0) - F0;
    vec3 k_S = F0 + Fr * pow(1.0 - NdotV, 5.0);

    // Combine Fresnel reflectance and geometric attenuation

    vec3 FssEss = k_S * f_ab.x + f_ab.y;

    // Calculate energy conservation for multiple scattering

    float Ems = 1.0 - (f_ab.x + f_ab.y);

    // Compute average Fresnel reflectance

    vec3 F_avg = F0 + (1.0 - F0) / 21.0;

    // Calculate multiple scattering component

    vec3 FmsEms = Ems * FssEss * F_avg / (1.0 - F_avg * Ems);

    // Compute diffuse contribution, accounting for energy conservation

    vec3 k_D = diffuseColor * (1.0 - FssEss + FmsEms);

    // Return final diffuse contribution from the environment

    return (FmsEms + k_D) * irradiance;
}
