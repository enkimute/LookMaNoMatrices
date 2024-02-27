/******************************************************************************
 *
 * Look, Ma, No Matrices!
 * miniGGX.glsl
 *
 * by Steven De Keninck 
 *
 * Elementary GGX lighting support.  
 * Adapted from the official Khronos glTF viewer.
 *
 */ 

/**
 * Computes Schlick's approximation for the Fresnel reflectance.
 * 
 * @param vec3 f0 The reflectance at normal incidence.
 * @param vec3 f90 The reflectance when the view direction is perpendicular to the surface normal.
 * @param float VdotH The dot product of the view and half
 * @returns vec3 The Fresnel reflectance.
 */

vec3 F_Schlick(vec3 f0, vec3 f90, float VdotH) {
    return f0 + (f90 - f0) * pow(clamp(1.0 - VdotH, 0.0, 1.0), 5.0);
}

/**
 * Smith's joint GGX approximation for geometric shadowing/masking.
 * 
 * @param float NdotL The dot product of the surface normal and the light direction.
 * @param float NdotV The dot product of the surface normal and the view direction.
 * @param float alphaRoughness The roughness of the surface squared.
 * @returns float The geometric shadowing/masking factor.
 */

float V_GGX(float NdotL, float NdotV, float alphaRoughness) {
    float alphaRoughnessSq = alphaRoughness * alphaRoughness;

    float GGXV = NdotL * sqrt(NdotV * NdotV * (1.0 - alphaRoughnessSq) + alphaRoughnessSq);
    float GGXL = NdotV * sqrt(NdotL * NdotL * (1.0 - alphaRoughnessSq) + alphaRoughnessSq);

    float GGX = GGXV + GGXL;
    if (GGX > 0.0) return 0.5 / GGX;

    return 0.0;
}

/**
 * GGX/Trowbridge-Reitz normal distribution function for microfacet models.
 * 
 * @param float NdotH The dot product of the surface normal and the half-vector.
 * @param float alphaRoughness The roughness of the surface squared.
 * @returns float The probability distribution of microfacets oriented in the half-vector direction.
 */

float D_GGX(float NdotH, float alphaRoughness) {
    float alphaRoughnessSq = alphaRoughness * alphaRoughness;
    float f = (NdotH * NdotH) * (alphaRoughnessSq - 1.0) + 1.0;
    return alphaRoughnessSq / (PI * f * f);
}

/**
 * Computes the Lambertian part of the BRDF.
 * 
 * @param vec3 F The Fresnel reflectance.
 * @param vec3 diffuseColor The base color of the material.
 * @returns vec3 The diffuse reflection component.
 */

vec3 BRDF_lambertian(vec3 F, vec3 diffuseColor) {
    return (1.0 - F) * (diffuseColor / PI);
}

/**
 * Computes the specular GGX part of the BRDF.
 * 
 * @param vec3 F The Fresnel reflectance.
 * @param float alphaRoughness The roughness of the surface.
 * @param float NdotL The dot product of the surface normal and the light direction.
 * @param float NdotV The dot product of the surface normal and the view direction.
 * @param float NdotH The dot product of the surface normal and the half-vector.
 * @returns vec3 The specular reflection component.
 */

vec3 BRDF_specularGGX(vec3 F, float alphaRoughness, float NdotL, float NdotV, float NdotH) {
    float Vis = V_GGX(NdotL, NdotV, alphaRoughness);
    float D = D_GGX(NdotH, alphaRoughness);

    return F * Vis * D;
}

/**
 * Combines diffuse and specular BRDF components for material rendering.
 * 
 * @param vec3 N The surface normal.
 * @param vec3 V The view direction.
 * @param vec3 L The light direction.
 * @param vec3 matCol The base color of the material.
 * @param vec3 matMetRgh A vector containing the metallic and roughness values of the material.
 * @returns vec3 The combined color contribution from both diffuse and specular reflections.
 */

vec3 brdf(in vec3 N, in vec3 V, in vec3 L, in vec3 matCol, in vec3 matMetRgh) {

    vec3 f_diffuse = vec3(0.), f_specular = vec3(0.);
    vec3 H = normalize(L + V);

    float NdotL = clamp(dot(N, L), 0., 1.);
    float NdotV = clamp(dot(N, V), 0., 1.);
    float NdotH = clamp(dot(N, H), 0., 1.);
    float VdotH = clamp(dot(V, H), 0., 1.);

    vec3 f0 = mix(vec3(0.04), matCol, matMetRgh.r); // Blend between non-metallic and metallic reflectance.
    vec3 c_diff = mix(matCol, vec3(0.), matMetRgh.r); // Adjust base color for metallic materials.

    vec3 F = F_Schlick(f0, vec3(1.0), VdotH);

    if (NdotL > 0. || NdotV > 0.) {
        f_diffuse  += NdotL * BRDF_lambertian(F, c_diff);
        f_specular += NdotL * BRDF_specularGGX(F, matMetRgh.g, NdotL, NdotV, NdotH);
    }

    return f_diffuse + f_specular; // Combine diffuse and specular contributions.
}
