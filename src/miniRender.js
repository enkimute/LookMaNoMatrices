/******************************************************************************
 *
 * Look, Ma, No Matrices!
 * miniRender.js
 *
 * by Steven De Keninck 
 *
 *****************************************************************************/
 
/******************************************************************************
 * Imports
 *****************************************************************************/
 
import * as util   from './util.js';
import * as miniGL from './miniGL.js';
import * as PGA    from './miniPGA.js';
import {miniGLTF}  from './miniGLTF.js';
import {UBO, vertexShader, fragmentShader} from './shaders.js';

/******************************************************************************
 * Shorthand
 *****************************************************************************/

const {PI, E, sin, min, max, hypot, sqrt, abs} = Math;
const {mul, add, sub, dot, cross, e23, e31, e12, e01, e02, e03, exp_b, exp_t, gp, normalize, fromMatrix3, exp_r, reverse_m, sw_mo, sw_md, identity, gp_mm, sqrt_m, gp_vv} = PGA;
const isMobile = (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent))

/******************************************************************************
 * Create Render class
 *****************************************************************************/
 
export class miniRender {
 
 /*****************************************************************************
  *
  ****************************************************************************/
  constructor ( options ) {
    this.options = options;
    
    if (options.canvas) {
      this.canvas  = options.canvas;
    } else {
      this.canvas  = document.body.appendChild(document.createElement('canvas'));
      Object.assign( this.canvas.style, { position : 'absolute', top : 0, left : 0, width:'100%', height:'100%', zIndex:1000, pointerEvents:'none' });
    }  
    
    this.gl = this.canvas.getContext('webgl2', Object.assign({
      antialias             : !isMobile, 
      alpha                 : true, 
      depth                 : true, 
      stencil               : false, 
      premultipliedAlpha    : false, 
      preserveDrawingBuffer : false, 
      powerPreference       : 'high-performance'
    },options));
    
    this.gl.enable(this.gl.DEPTH_TEST);
    this.gl.enable(this.gl.CULL_FACE);  
    
    const ibl = 'data/factory';
    util.loadCubemap(this.gl, ibl+'_lambertian.cubemap.png').then( id => this.lambertianTextureID = id);
    util.loadCubemap(this.gl, ibl+'_ggx.cubemap.png', 9).then( id => this.ggxTextureID = id);
    util.loadHDRTexture(this.gl,'data/lutGGX.RGBE.png', util.RGBAToLUT).then( id => this.ggxLutTextureID = id);
    
    this.worldscale = 0.25;
    this.exposure   = 1.0;
    this.camera     = exp_b(mul(e03,-1))
    
    this.glTF = [];
    
    return this;
  }
  
 /*****************************************************************************
  * Load a glTF file, convert to PGA, upload to webGL
  * @param {string} uri URI of glTF/glb file to load.
  * @returns {object} reference to this scene.
  ****************************************************************************/
  async load ( uri ) {
    this.glTF.push(await new miniGLTF().load( uri, { progress:x=>{ document.getElementById('file').value = 100*x.value;}})
    .then(glTF=>{
       miniGL.resetProgramCache();
       document.getElementById('file').style.display = 'none';
       const gl = this.gl;
       
       // Create vertex array objects for all primitives.
       console.time('uploading geometry.');
       for (var i in glTF.json.meshes) {
         const mesh = glTF.json.meshes[i];
         for (var j in mesh.primitives) {
           const prim = mesh.primitives[j];
           // unweld and switch to flat arrays.
           var {vertices, normals, uvs, indices, tangents, weights, joints} = glTF.unweld( prim, {scale : prim.worldScale ?? prim.boneScale ?? prim.scale, needsTangent : prim.needsTangent} );
           // Do we need tangents?
           if (prim.needsTangent && tangents == undefined) try {
             var tangents = generateTangents(vertices, normals, uvs);
             console.log('mikkt');
           } catch (e) {
             var tangents = undefined;
           }
           // For each vertex, we construct the tbn matrix with positive determinant,
           // and convert these to PGA rotors. The final determinant is as usual stored
           // separately.
           var tangentRotors = [...Array(vertices.length/3)].map( (_,i)=> {
             // we will assume the dot between tangent and normal is always zero!
             let normal  = normalize([...normals.slice(i*3,i*3+3)]);
             let tangent = tangents ? normalize([...tangents.slice(i*4,i*4+3)]) : normalize([normal[1]+normal[2],normal[0]+normal[2],normal[0]+normal[1]]);
             // Orthogonalize
             tangent = normalize( sub(tangent, mul(normal, dot(normal,tangent) ) ) );
             // Calculate the bitangent.
             let bitangent = normalize(cross(normal, tangent));
             // Now setup the matrix explicitely.
             let mat = [...tangent, ...bitangent, ...normal];
             // Convert to motor and store.
             let motor = fromMatrix3( mat );
             // Use the double cover to encode the handedness.
             // in GA language, this means we are using half of the double cover to distinguish even and odd versors.
             if (tangents) if (Math.sign(motor[0])!=tangents[i*4+3]) motor = motor.map(x=>-x); 
             return [...motor.slice(0,4)];
           }).flat();
           tangentRotors = new Float32Array(tangentRotors);
           // Create and store the vao. (we should really re-weld first ..)
           prim.hasBones = !!weights;
           prim.vao = miniGL.createVAO(gl, vertices, indices, 3, uvs, weights, joints, tangentRotors);
           // Compile the shader.
           prim.material.program = prim.program = miniGL.createProgram(gl, vertexShader(prim.material, prim), fragmentShader(prim.material, prim));
         }
       }
       console.timeEnd('uploading geometry.');
       
       // Load all textures.
       console.time('loading textures.');
       for (var i in glTF.json.textures) {
         const t = glTF.json.textures[i];
         t.tex = miniGL.loadTexture(gl, t.source, t.linear);
       }
       console.timeEnd('loading textures.');
       
       return glTF;
    }));
    return this.glTF[this.glTF.length-1];
  }
  
 /*****************************************************************************
  * Check viewport size/place, and clear it. 
  ****************************************************************************/
  initFrame () {
    const canvas = this.canvas, gl = this.gl;
    
    // We allow our canvas to move during smooth scroll, so at every
    // new frame, we position it center view again.
    canvas.style.top  = window.scrollY + 'px';
    //canvas.style.left = window.scrollX + 'px'; 
 
    // Setup size.
    var dpr = window.devicePixelRatio||1;
    if (canvas.clientWidth * dpr != canvas.width || canvas.clientHeight * dpr != canvas.height) {
      canvas.width  = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    }

    // Now start the render.
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }
 
 /*****************************************************************************
  * Render the scene.
  ****************************************************************************/
  render (world, scene=0) {
    if (!this.glTF) return;
    const gl     = this.gl;
    const canvas = this.canvas;
    const glTF   = this.glTF[scene];
    
    // Render a single node.
    const renderNode = (gl, node, transform, params, trans=0, parentChanged = false) => {
      // Accumulate own transform.
      if (trans === 0) {
        if (parentChanged === true) node.changed = true;
        if (node.changed !== false) { 
          transform = gp_mm(transform, node.transform??identity );
          parentChanged = true;
          node.changed = false;
          params.world = node.world = transform;
          if (node.meshes) node.ubo = miniGL.updateUBO(gl, node.ubo, { world:node.world }, glTF.json.meshes[0].primitives[0].program.uniformBlocks.instance);
        } 
      }  
      // If we have primitives, render them.
      if (node.meshes) for (var m=0, l=node.meshes.length; m<l; m++) for (var i=0,l2=node.meshes[m].length; i<l2; ++i) {
        const prim = node.meshes[m][i];
        const mat  = prim.material;
        const matIsTrans = mat?.alphaMode=='BLEND' || mat?.extensions?.KHR_materials_transmission !== undefined;
        if (trans ^ matIsTrans) continue;
        // bind textures. 
        if (mat?.normalTexture)     { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, mat?.normalTexture.tex); }
        if (mat?.emissiveTexture)   { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, mat?.emissiveTexture.tex); }
        if (mat?.occlusionTexture ) { gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, mat?.occlusionTexture.tex); }

        if (mat?.pbrMetallicRoughness) {
          if (mat.pbrMetallicRoughness.baseColorTexture) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, mat?.pbrMetallicRoughness.baseColorTexture.tex); }
          if (mat.pbrMetallicRoughness.metallicRoughnessTexture) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, mat?.pbrMetallicRoughness.metallicRoughnessTexture.tex); }
        }
        if (mat?.extensions) {
          if (mat.extensions.KHR_materials_pbrSpecularGlossiness?.diffuseTexture) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, mat.extensions.KHR_materials_pbrSpecularGlossiness.diffuseTexture.tex); }
        }  

        // if (node.skin) gl.bindBufferBase(gl.UNIFORM_BUFFER, prim.program.uniformBlocks.skin.index, node.skin.ubo);
        if (node.skin) prim.program.uniformBlocks.skin.buffer = node.skin.ubo;
        prim.program.uniformBlocks.scene.buffer = glTF.json.scenes[0].ubo;
        prim.program.uniformBlocks.instance.buffer = node.ubo;
        prim.program.uniformBlocks.material.buffer = mat.ubo;
        
        // gl state
        if (mat?.alphaMode=='BLEND' || mat?.extensions?.KHR_materials_transmission) {
          gl.enable(gl.BLEND);
          gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ZERO);
        } else {
          gl.disable(gl.BLEND);
        }
        if (mat?.doubleSided) {
          //  gl.disable(gl.CULL_FACE); else gl.enable(gl.CULL_FACE);
          if (mat?.alphaMode=='BLEND' || mat?.extensions?.KHR_materials_transmission) {
            if (mat?.pbrMetallicRoughness?.baseColorFactor && mat?.pbrMetallicRoughness?.baseColorFactor[3] < 0.1) gl.depthMask(false);
            gl.frontFace(gl.CW);
            miniGL.render(gl, prim.program, prim.vao, prim.vao.length, params);
            gl.frontFace(gl.CCW);
            miniGL.render(gl, prim.program, prim.vao, prim.vao.length, params);
            if (mat?.pbrMetallicRoughness?.baseColorFactor && mat?.pbrMetallicRoughness?.baseColorFactor[3] < 0.1) gl.depthMask(true);
          } else {
            gl.disable(gl.CULL_FACE);
            miniGL.render(gl, prim.program, prim.vao, prim.vao.length, params);
            gl.enable(gl.CULL_FACE);
          }  
        } else {
          // push geometry.
          miniGL.render(gl, prim.program, prim.vao, prim.vao.length, params);
        }
      }
      // Render all children.
      if (node.children) for (var i=0, l=node.children.length; i<l; ++i) renderNode(gl, node.children[i], node.world||identity, params, trans, parentChanged);
    }
    

    // Populate the scene level ubo.
    glTF.json.scenes[0].ubo = miniGL.updateUBO( gl, glTF.json.scenes[0].ubo, {
      camera    : this.camera,
      aspect    : canvas.width/canvas.height,
      scale     : this.worldscale,
      lightPos  : [6,6,-10],
      cameraPos : sw_mo(reverse_m(this.camera)),
      exposure  : 2**this.exposure,
    }, glTF.json.meshes[0].primitives[0].program.uniformBlocks.scene );
    
    // Resolve UBO's for skeletons.
    function xform( cur, motor = identity, changed = false ) {
      cur.worldTransform = gp_mm( motor, cur.transform??identity );
      cur.changed = cur.changed | changed;
      cur.children?.forEach( child => xform( child, cur.worldTransform, cur.changed ) );
    }

    var m = new Float32Array(8);
    glTF.json.skins.forEach( skin => {
       xform( skin.skeleton ?? skin.joints[0] ?? glTF.json.nodes.find(x=>x.skin == skin) );
       if (skin.array === undefined) skin.array = new Float32Array( skin.joints.length * 8 );
       for (var i = 0, k = 0, l = skin.joints.length; i<l; ++i) {
        m = gp_mm( skin.joints[i].worldTransform ?? skin.joints[i].transform , skin.inverseBindMotors[i] , m);
        skin.array.set(m,k); k+=8;
       }
       skin.ubo = miniGL.updateUBO(gl, skin.ubo, skin.array );
    });
    
    // Resolve UBO's for materials.
    glTF.json.materials.forEach( material => {
      if (!material.program.uniformBlocks.material) return;
      material.ubo = miniGL.updateUBO(gl, material.ubo, {
        baseColorFactor : material.pbrMetallicRoughness?.baseColorFactor??[1,1,1,1],
        emissiveFactor  : material.emissiveFactor??[0,0,0],
        metallicFactor  : material.pbrMetallicRoughness?.metallicFactor??0,
        roughnessFactor : material.pbrMetallicRoughness?.roughnessFactor??1,
      }, material.program.uniformBlocks.material);
    });
    
    
    // Bind IBL images.
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.ggxTextureID);
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, this.ggxLutTextureID);
    gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.lambertianTextureID);
      
    // Now render all nodes.  
    for (let trans=0; trans<2; ++trans) for (var i in glTF.json.scenes[glTF.json.scene].nodes) renderNode(gl, glTF.json.scenes[glTF.json.scene].nodes[i], world, { 
      colorTexture    : 0, 
      specularTexture : 1, 
      emissiveTexture : 2, 
      oclusionTexture : 3, 
      normalTexture   : 4, 
      ibl_irradiance  : 5, 
      ibl_lut         : 6, 
      ibl_radiance    : 7
    }, trans);
    
  }
  
}

