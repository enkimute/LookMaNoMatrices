/******************************************************************************
 *
 * Look, Ma, No Matrices!
 * Putting PGA to the test.
 *
 * by Steven De Keninck 
 *
 *****************************************************************************/
 
/******************************************************************************
 * Shader functions that are shared.
 *****************************************************************************/

const shaderLib = {
  miniPGA : await fetch('src/miniPGA.glsl').then(x=>x.text()),
  miniIBL : await fetch('src/miniIBL.glsl').then(x=>x.text()),
  miniGGX : await fetch('src/miniGGX.glsl').then(x=>x.text()),
}

/******************************************************************************
 * UBO definitions that are shared.
 *****************************************************************************/

export const UBO = {
  /** Scene ******************************************************************/
  scene : `
    uniform scene {
      motor camera;             // World to view motor.
      vec3  cameraPos;          // Current camera position = sw_mo( camera ).
      vec3  lightPos;           // Current light position.
      float aspect;             // Aspect ratio
      float scale;              // Global scale
      float exposure;           // Exposure
    };`,
  /** Instance ***************************************************************/
  instance : `
    uniform instance {
      motor world;              // Object to world motor.
    };`,
  /** Material ***************************************************************/
  material : `
    uniform material {
      // glTF defaults.
      vec3   emissiveFactor;    // Base emissive color.
      // glTF pbrMetallicRoughness
      vec4   baseColorFactor;   // Base color and transparency.
      float  metallicFactor;    // Base metalness.
      float  roughnessFactor;   // Base roughness.
    };
  `,
}
    
/******************************************************************************
 * Main Vertex Shader.
 *****************************************************************************/
export const vertexShader = (material, mesh) => `      
  // Precision qualifiers.
  precision highp float;
  precision highp sampler2DArray;

  // Include PGA motor support.
  ${ shaderLib.miniPGA }

  // Include Scene and Instance uniforms.
  ${ UBO.scene }
  ${ UBO.instance }

  // Shader outputs.
  out vec2 st;
  out vec3 worldPosition;
  out vec3 worldNormal;
  out vec4 worldTangent;
      
  // Vertex Attributes.
  // tangent Rotors replace normals and tangents.
  layout(location = 0) in vec3 attrib_position; 
  layout(location = 1) in vec4 attrib_tangentRotor;
  layout(location = 2) in vec2 attrib_uv;
      
  // Skinned meshes also provide 4 weights and joint indices.
  ${mesh?.skin?.joints?.length?`

    // Two attributes with 4 most important joints and weights
    layout(location = 3) in vec4 attrib_weights;
    layout(location = 4) in vec4 attrib_joints;

    // And an UBO that contains all skin motors.
    uniform skin { motor motors[${mesh.skin.joints.length}]; };
        
  `:``}
      
  void main() {

    // Pass through uv coordinates unmodified.
    st = attrib_uv;
        
    // Our model -> world motor. Replaces its classic matrix equiv.
    motor toWorld = world;
  
    // If the mesh is skinned, apply the skinning weighting to the
    // skinning motors and compose into the world motor.
    ${mesh.hasBones?`
      // Grab the 4 bone motors.
      motor b1 = motors[int(attrib_joints.x)];
      motor b2 = motors[int(attrib_joints.y)];
      motor b3 = motors[int(attrib_joints.z)];
      motor b4 = motors[int(attrib_joints.w)];

      // Blend them together, always use short path.
      motor r = attrib_weights.x * b1;
      if (dot(r[0],b2[0])<=0.0) b2 = -b2;
      r += attrib_weights.y * b2;
      if (dot(r[0],b3[0])<=0.0) b3 = -b3;
      r += attrib_weights.z * b3;
      if (dot(r[0],b4[0])<=0.0) b4 = -b4;
      r += attrib_weights.w * b4;
          
      // Now renormalize and combine with object to world
      toWorld = gp(toWorld, normalize_m(r));
    `:``}
        
    // Now transform our vertex using the motor from object to worldspace.
    worldPosition = sw_mp(toWorld, attrib_position) * scale;
        
    // Concatenate the world motor and the tangent frame.
    motor tangentRotor = gp_rr( toWorld, motor(attrib_tangentRotor,vec4(0.)) );

    // Next, extract world normal and tangent from the tangentFrame rotor.
    extractNormalTangent(tangentRotor, worldNormal, worldTangent.xyz);
    worldTangent.w = sign(1.0 / attrib_tangentRotor.x); // trick to disambiguate negative zero!
 
    // Now transform from worldspace to eyespace using the view motor.
    vec3 viewPosition = sw_mp(camera, worldPosition); 
        
    // And finally do the perspective projection. (see miniPGA.glsl)
    const float n = .04, f = 400.00;                 // near and far plane.
    const float minfov = 26.0 * PI / 180.0;          // The minimal fov in radians.
    gl_Position = project(n, f, minfov, aspect, viewPosition);
    
  }`;
   
/******************************************************************************
 * The main fragment shader. 
 *****************************************************************************/

export const fragmentShader = (material, mesh)=>`
  precision highp float;
  precision highp sampler2DArray;
  precision highp sampler2D;
  precision highp samplerCube;

  // Import PGA, IBL, GGX
  ${ shaderLib.miniPGA }
  ${ shaderLib.miniIBL }
  ${ shaderLib.miniGGX }

  // We'll also use the scene uniforms.
  ${UBO.scene}      
  
  // And the material uniform block.
  ${UBO.material}

  // Incoming varying attributes.
  in vec2 st;
  in vec3 worldPosition;
  in vec3 worldNormal;
  in vec4 worldTangent;
      
  // Textures we might sample.
  uniform sampler2D colorTexture;      
  uniform sampler2D specularTexture;      
  uniform sampler2D emissiveTexture;      
  uniform sampler2D normalTexture;
  uniform sampler2D oclusionTexture;
      
  // We output the final color.
  layout (location=0) out vec4 outColor;

  void main() {
    // Renormalize interpolated normal
    vec3 normal = normalize(worldNormal);
      
    // Sample and mix material properties
    vec2 uv = vec2(1., 1.) ;
    vec4 color, sgao;
    
    color = ${material?.pbrMetallicRoughness?.baseColorFactor?`vec4(${material.pbrMetallicRoughness?.baseColorFactor.map(x=>x.toFixed(3))}) *`:'vec4(1.0) *'}
            ${material?.pbrMetallicRoughness?.baseColorTexture || material?.extensions?.KHR_materials_pbrSpecularGlossiness?.diffuseTexture ?'texture(colorTexture, vec2(st * uv)).rgba':'1.0'};  // sRGB!
                
    // Alpha Test
    ${(material?.alphaMode == 'MASK')?`
      if (color.a < ${material?.alphaCutoff?.toFixed(3)||'0.5'}) discard;
    `:''}
    ${(material?.alphaMode == 'BLEND')?`
        if (color.a < 5./255.) discard;
    `:''}

    // Spec, Gloss, AO.
    sgao = ${material?.pbrMetallicRoughness?.metallicRoughnessTexture?'texture(specularTexture, vec2(st  * uv)).bgra;':`vec4(1.0,${material?.pbrMetallicRoughness?.roughnessFactor?.toFixed(3)??'1.0'}, 1.0, 1.0).bgra;`}
    vec3 emissive = ${(material?.emissiveTexture !== undefined)?'texture(emissiveTexture, vec2(st  * uv)).rgb;':(material?.emissiveFactor !== undefined)?`vec3(${material.emissiveFactor.map(x=>(x*(material?.extensions?.KHR_materials_emissive_strength?.emissiveStrength??1)).toFixed(3))});`:'vec3(0.0);'}


    ${material?.extensions?.KHR_materials_unlit?'outColor = vec4( pow(exposure*(color.rgb + emissive.rgb), vec3(1./2.2)) , dot(vec3(0.299, 0.587, 0.114),emissive.rgb)); outColor2= vec4(vec3(0.),max(0., dot( vec3(0.30, 0.59, 0.11), outColor.rgb ) - 1.) / 2.0); return;':''}

    ${(material?.pbrMetallicRoughness?.metallicFactor!==undefined)?`sgao.r *= ${material?.pbrMetallicRoughness?.metallicFactor.toFixed(3)};`:``}

    // convert roughness ..
    sgao.g = clamp(sgao.g, 0., 1.);
    sgao.r = clamp(sgao.r, 0., 1.);
        
    sgao.g = sgao.g * sgao.g;
    sgao.g = max(sgao.g, 0.0002);

    ${(material?.occlusionTexture !== undefined && material?.occlusionTexture !== material?.pbrMetallicRoughness)?'sgao.b = texture(oclusionTexture, vec2(st*uv)).r;':'sgao.b = 1.0;'}
        
    // Sample normalmap..
    vec2 nuv = vec2(st * uv * vec2(${(material?.normalTexture?.extensions?.KHR_texture_transform?.scale??[1,1]).map(x=>x.toFixed(3))}));
    vec3 normalTex = normalize(texture(normalTexture, nuv).rgb  * 2.0 - 1.0);
    normalTex.y *= worldTangent.w;
 
    // Build tangent frame.       
    vec3 tg = normalize(worldTangent.xyz);
    tg = normalize( tg - normal * dot(tg, normal) );
    mat3 tgw = mat3( tg, normalize(cross(normal, tg)), normal );
    ${(material?.normalTexture !== undefined) ? 'normal = normalize(tgw * normalTex);':''}

    if (gl_FrontFacing == false) normal *= -1.;
        
    // Do all lights.
    vec3 V = normalize(cameraPos - worldPosition);
 
    // light1 - main light, always used.
    float range = 36.;
    float dist  = length(worldPosition - lightPos); 
    float att   = clamp(1. - (dist*dist)/(range*range), 0., 1.); att *= att;
    vec3 ldir = normalize(lightPos - worldPosition);
    vec3 light1 = 1.2 * att * sgao.b * brdf(normal, V, ldir, color.rgb, sgao.rgb);

    ldir =  normalize(vec3(-lightPos.xy, lightPos.z) - worldPosition);
    dist  = length(worldPosition - vec3(-lightPos.xy, lightPos.z)); 
    att   = clamp(1. - (dist*dist)/(range*range), 0., 1.); att *= att;
    vec3 light2 =1.0 * att * vec3(1.0,1.,1.) * sgao.b * brdf(normal, V, ldir, color.rgb, sgao.rgb);
        
    // test ibl
    if (color.a > 0.05) {
      light1 +=  /*sgao.b **/ getIBLRadianceGGX(normal, V, pow(sgao.g,.5), mix(vec3(0.04), color.rgb, sgao.r), worldPosition);
      light1 +=  sgao.b * getIBLRadianceLambertian( normal, V, pow(sgao.g,.5), mix(color.rgb, vec3(0.), sgao.r), mix(vec3(0.04), color.rgb, sgao.r));
    }

    // Accumulate and gamma correct
    outColor = vec4( exposure * (light1 + light2/*+ light2 + light3 */ + emissive), color.a);
    outColor.rgb = pow(outColor.rgb,vec3(1./2.2));
  }`;
 
