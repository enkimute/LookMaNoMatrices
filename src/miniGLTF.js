/** A minimal GLTF loader with PGA support 
 *
 * * Loads and prepares .gltf and .glb files. Converts matrices, 
 *   quaternions and translations to PGA motors. 
 * * offers unwelding (for mikkt) and scale compensation.
 * * evaluates glTF animations.
 *
 * ©2024 - Enki
 **/

const {abs,min,max,hypot} = Math;

import {identity, fromMatrix, log_m, gp_mm, normalize, mix, dot} from './miniPGA.js';

export class miniGLTF {

  constructor () {
    this.json = null;
  }

  /**
   * Load a glTF or glb file.
   * @param {string}   uri              The url of the file to load.
   * @param {Object}   [opts]           An optional options object.
   * @param {function} [opts.progress]  A download progress callback function.
   **/
  async load (uri, opts) {
  
    // Split path and filename. Other references will be relative to this path.
    const path  = uri.replace(/[^\/]*$/,'');
    const fname = uri.replace(/^.*\//,'');
    
    // note : lots of 'var x in' because many things can and will be arrays and/or objects!
  
    // First lets load and parse the JSON and fetch the buffers. (or split them from a glb)
    if (fname.match(/\.glb$/i)) {
  
      // Fetch binary data. We'll assume one big blob at the end, never seen multiple buffers here.
      var bin = await fetch(uri, {priority:'high',cache:'force-cache'})
                .then(r => r.progress( opts.progress ))
                .then(r => r.arrayBuffer());
                
      // Make sure its a valid glb file. (check magic and size)          
      var b32 = new Uint32Array(bin,0,5), b8 = new Uint8Array(bin);
      if (b32[0] != 0x46546C67 || b32[2] != bin.byteLength) return console.error('not a valid .glb file.');
  
      // Now split json and buffer - we're assuming just two chuncks.
      var J = this.json = JSON.parse(new TextDecoder().decode(b8.slice(20, 20 + b32[3]))); // skip 12 byte header and 8 byte chunk header.
      for (var i in J.buffers) J.buffers[i] = bin.slice( 20 + b32[3] + 8 );                // skip 12 + 8 + json_size + 8 of next header.
  
    } else { 
  
      // if not glb, json and binary are separate uri's.
      var J = this.json = await fetch(uri,{priority:'high'}).then(r => r.json());
      for (var i in J.buffers) J.buffers[i] = await fetch( (J.buffers[i].uri.match(/^data/)?'':path) + J.buffers[i].uri, {priority:'high'})
                                             .then(r => r.progress(opts.progress))
                                             .then(r => r.arrayBuffer());
    }  
    
    // Split bufferviews and link accessors directly.
    for (var i in J.bufferViews) {
      const bv = J.bufferViews[i];
      bv.buffer = J.buffers[bv.buffer].slice(bv.byteOffset??0, (bv.byteOffset??0) + bv.byteLength);
    }
    
    // Now link all the accessors to appropriate typed arrays.
    for (var i in J.accessors) { 
      const arrayType = {5120:Int8Array, 5121:Uint8Array, 5122:Int16Array, 5123:Uint16Array, 5124:Int32Array, 5125:Uint32Array, 5126:Float32Array}[J.accessors[i].componentType];
      const size = {5120:1, 5121:1, 5122:2, 5123:2, 5124:4, 5125:4, 5126:4}[J.accessors[i].componentType];
      const full = size * {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[J.accessors[i].type];
      const ofs  = J.accessors[i].byteOffset??0;
      const count = J.accessors[i].count;
      if (J.accessors[i].bufferView !== undefined) J.accessors[i].bufferView = Object.assign(new arrayType(J.bufferViews[J.accessors[i].bufferView].buffer),{byteStride:J.bufferViews[J.accessors[i].bufferView].byteStride});
    }  
    
    // Prepare the images, either as blob or as url.
    for (var i in J.images) {
      
      // old glTF files included binary images via extension. 
      if (J.images[i].extensions?.KHR_binary_glTF) Object.assign(J.images[i], J.images[i].extensions.KHR_binary_glTF);
      
      // Store either as URI or blob.
      if (J.images[i].bufferView !== undefined) J.images[i].blob = Object.assign(new Blob( [J.bufferViews[J.images[i].bufferView].buffer], {  type: J.images[i].mimeType } ),{name : J.bufferViews[J.images[i].bufferView].name??uri});
                                           else J.images[i].uri  = (J.images[i].uri.match(/^data/)?'':path) + J.images[i].uri;
    }  
    
    // Assume images are in linear space.
    for (var i in J.textures) Object.assign( J.textures[i], {source: J.images[J.textures[i].source], linear:true, sampler: J.samplers&&J.samplers[J.textures[i]?.sampler] });
    
    // now process the materials, link all the textures.
    for (var i in J.materials) {
      const M = J.materials[i];
      const getTex = (M,n) => Object.assign( J.textures[M[n].index], { extensions : M[n].extensions } );

      // Top level textures, as well as those in metallicRoughness etc ..
      ['emissiveTexture','normalTexture','occlusionTexture'].forEach(n=>{if (M[n]) M[n] = getTex(M,n);  });
      if (M.pbrMetallicRoughness) ['baseColorTexture','metallicRoughnessTexture'].forEach(n=>{if (M.pbrMetallicRoughness[n]) M.pbrMetallicRoughness[n] = getTex(M.pbrMetallicRoughness,n); });
      if (M.extensions?.KHR_materials_pbrSpecularGlossiness) ['diffuseTexture'].forEach(n=>{if (M.extensions?.KHR_materials_pbrSpecularGlossiness[n]) M.extensions.KHR_materials_pbrSpecularGlossiness[n] = getTex(M.extensions.KHR_materials_pbrSpecularGlossiness,n); });
      if (M.extensions?.KHR_materials_clearcoat) ['clearcoatTexture','clearcoatNormalTexture','clearcoatRoughnessTexture'].forEach(n=>{if (M.extensions?.KHR_materials_clearcoat[n]) M.extensions.KHR_materials_clearcoat[n] = getTex(M.extensions.KHR_materials_clearcoat,n); });

      // Update those textures that should be provided in SRGB space.
      if (M.emissiveTexture) M.emissiveTexture.linear = false;
      if (M.pbrMetallicRoughness?.baseColorTexture) M.pbrMetallicRoughness.baseColorTexture.linear = false;
      if (M.extensions?.KHR_materials_pbrSpecularGlossiness?.diffuseTexture) M.extensions.KHR_materials_pbrSpecularGlossiness.diffuseTexture.linear = false;
      
      // temp patch for pbrSpecularGlossiness
      if (M.extensions?.KHR_materials_pbrSpecularGlossiness) M.pbrMetallicRoughness = { baseColorFactor : M.extensions.KHR_materials_pbrSpecularGlossiness.diffuseFactor };
    }
    
    // Now iterate and prepare all meshes. link all attributes and materials.
    for (var i in J.meshes) J.meshes[i].primitives.map( p=> {
      p.attributes = Object.fromEntries(Object.entries(p.attributes).map( ([k,v]) => [k, J.accessors[v]] ));
      if (p.indices  !== undefined) p.indices  = J.accessors[p.indices];
      if (p.material !== undefined) p.material = J.materials[p.material];
      if (p.material?.normalTexture || p.material?.extensions?.KHR_materials_clearcoat?.clearcoatNormalTexture) p.needsTangent = true;
    });
    
    // Next link all meshes to their nodes and resolve node children to nodes.
    for (var i in J.nodes) {
      if (J.nodes[i].mesh !== undefined && J.nodes[i].meshes === undefined) J.nodes[i].meshes=[J.nodes[i].mesh];
      J.nodes[i].meshes = J.nodes[i].meshes?.map( name => J.meshes[name].primitives );
      J.nodes[i].children = J.nodes[i].children?.map( name => { J.nodes[name].parent = J.nodes[i]; return J.nodes[name]; } );
      if (J.nodes[i].camera !== undefined) J.nodes[i].camera = J.cameras[J.nodes[i].camera];
      if (J.nodes[i].skin !== undefined) J.nodes[i].skin = J.skins[J.nodes[i].skin];
    }  
    
    // Now for all the scenes, link the nodes.
    for (var i in J.scenes) J.scenes[i].nodes = J.scenes[i].nodes.map( name => J.nodes[name] );
    
    // Process the skeletons. Convert inverseBindMatrices to inverseBindMotors.
    for (var i in J.skins) {
      const skin = J.skins[i];
      
      // Link and convert bind matrices.
      if (skin.inverseBindMatrices) {
        const bm = J.accessors[skin.inverseBindMatrices];
        skin.inverseBindMatrices = bm;
        skin.inverseBindMotors   = [...Array(bm.count)].map((x,i)=> fromMatrix( bm.bufferView.slice(i*16,i*16+16) ));
      }  
      
      // Link nodes to joints.
      if (skin.skeleton) skin.skeleton = J.nodes[skin.skeleton];
      skin.joints = skin.joints.map(joint => J.nodes[joint]);
    }
    
    // Process the animations - link all samplers and targets. Verify min and max on inputs is present!
    if (J.animations instanceof Object) J.animations = Object.values(J.animations);
    if (J.animations?.length === 0) J.animations = undefined;
    for (var i in J.animations) {
      const anim = J.animations[i];
      J.animations[i].channels.forEach(channel=>{
        channel.sampler        = J.animations[i].samplers[channel.sampler];
        channel.target.node    = J.nodes[channel.target.node];
        channel.sampler.input  = J.accessors[channel.sampler.input];
        channel.sampler.output = J.accessors[channel.sampler.output];
        const input = channel.sampler.input, output = channel.sampler.output;
        input.min = [ Infinity]; for (var j=0; j<input.count; ++j) input.min[0]=min(input.min[0],input.bufferView[ (input.byteOffset??0)/4 + j*(input.byteStride??4)/4 ]);
        input.max = [-Infinity]; for (var j=0; j<input.count; ++j) input.max[0]=max(input.max[0],input.bufferView[ (input.byteOffset??0)/4 + j*(input.byteStride??4)/4 ]);
        //if ((output.min !== undefined) && (output.max !== undefined) && (output.min+'' == output.max+'')) input.skip = output.skip = channel.skip = true;
        anim.duration = max(input.max[0], anim.duration??0);
      })
    }
    
    // Next, make sure all animations are 'complete', that is animations that do not animate properties that
    // are animated in other animations should reset those properties.
    const animatedProps = J.animations.map(x=>x.channels).flat().map(x=>[x.target.node, x.target.path]).filter((x,i,a)=>a.findIndex(([n,p])=>x[0]==n&&x[1]==p)==i);
    J.animations.forEach(a=>{
      const missing = animatedProps.filter( ([n,p]) => !a.channels.find( c => c.target.node == n && c.target.path == p ) );
      missing.forEach(([n,p])=>a.channels.push({
        target : { node : n, path : p },
        sampler : { input : { bufferView:[0], count:1 } , output : { bufferView:n[p].slice() , count:1} }      
      }));
    })
        
    // Next, convert all local matrices to motors/bivectors.
    // All nodes will get a property 'transform' which is a motor representing the local transformation.
    for (var i in J.nodes) {
      
      // Fall back identity if no transform included.
      J.nodes[i].transform = identity;
      
      // First matrix, then rot, tran. Scale is not handled! 
      if (J.nodes[i].matrix)        J.nodes[i].transform = fromMatrix(J.nodes[i].matrix);      
      else {
        if (J.nodes[i].rotation)    J.nodes[i].transform = gp_mm([J.nodes[i].rotation[3],...J.nodes[i].rotation.slice(0,3).map(x=>-x), 0,0,0,0], J.nodes[i].transform);
        if (J.nodes[i].translation) J.nodes[i].transform = gp_mm([1,0,0,0,...J.nodes[i].translation.map(x=>-x/2),0], J.nodes[i].transform);
      }  
      J.nodes[i].bivector  = log_m(J.nodes[i].transform);
    }
    
    // Finally, establish what we need to get rid of any scaling.
    // Most scaling is uniform, and occurs simply to set relative sizes.
    // We can easily compensate for this by adjusting animation keys and vertex data.
    // Step 1. Establish world scale for each node.
    const calculateWorldScale = (node, scale = [1,1,1]) => {
      
      // find our own scale and multiply with incoming scale.
      const nm = node.matrix;
      node.ownScale   = node.scale ?? (nm ? [hypot(...nm.slice(0,3)), hypot(...nm.slice(4,7)), hypot(...nm.slice(8,11))]: [1,1,1]);
      node.worldScale = scale.map((x,i)=>node.ownScale[i]*x); 
      
      // now forward to our children.
      node.children?.forEach( child => calculateWorldScale(child, node.worldScale) );
    }
    if (J.scenes instanceof Object) J.scenes = Object.values(J.scenes);
    if (typeof J.scene == 'string') J.scene = 0;
    for (var s in J.scenes) J.scenes[s].nodes.forEach( node => calculateWorldScale(node) );
    
    // Step 2. Find for each mesh, which nodes it is associated with.
    for (var j in J.nodes) { const node = J.nodes[j]; node.meshes?.forEach( mesh => mesh.forEach( prim => {
      prim.nodes = (prim.nodes || []);
      
      // For a skinned mesh, add the used bones, else add the instance bone.
      if (node.skin) {
        
        // Figure out which bones are used by this primitive.
        const usedBones = [], attrib = prim.attributes.JOINTS_0, stride = (attrib.byteStride??8)/2, ofs = (attrib.byteOffset??0)/2;
        for (var i=0; i<attrib.count; i++) for (var j=0; j<4; j++) 
          if (usedBones.indexOf( attrib.bufferView[ofs + i * stride + j] ) == -1) usedBones.push( attrib.bufferView[ofs + i * stride + j] );
        
        // Store the nodes for all these bones on the primitive.  
        prim.nodes.push(...usedBones.map( jointID => node.skin.joints[jointID] ));
        
        // Grab the inverse bindMatrix of a used bone and figure out its scale.
        // Next check the matching node for its scale. The difference we need to patch up for.
        // (reminder, M and N often satisfy MN=1, but e.g. in stegosaurus.glb they do not)
        const matrix     = node.skin.inverseBindMatrices.bufferView.slice(usedBones[0]*16, usedBones[0]*16+16);
        const boneScaleM = [hypot(...matrix.slice(0,3)), hypot(...matrix.slice(4,7)), hypot(...matrix.slice(8,11))];
        const boneScaleN = prim.nodes[0].scale??[1,1,1];
        
        // For this primitive, the total scale is the standard worldscale multiplied with the bonescale. 
        prim.worldScale = node.worldScale.map((x,i)=>x*boneScaleM[i]*boneScaleN[i]); 
        prim.skin = node.skin;
        node.ownScale = node.ownScale.map((x,i)=>x*boneScaleN[i]); 
      
      } else {
        
        // Add this node to the primitive list.
        prim.nodes.push(node);
        prim.worldScale = node.worldScale;
        if (prim.nodes.length > 1) console.log('multiple instances ', prim.nodes);
      }
    }))};
    
    // Step 3. Update the inverseBindMotors, and the transforms to the new scaling.
    if (J.skins instanceof Object) J.skins = Object.values(J.skins);
    J.skins?.forEach( skin => skin.joints.forEach( (joint, j) => {
      const pscale = joint?.parent?.worldScale??[1,1,1];
      skin.inverseBindMotors[j][4] *= pscale[0];
      skin.inverseBindMotors[j][5] *= pscale[1];
      skin.inverseBindMotors[j][6] *= pscale[2];
      skin.inverseBindMotors[j][7] *= pscale[2];
    }));
    
    // Adjust all node transformations to reflect scale changes.
    for (var j in J.nodes) { const node = J.nodes[j];
      const pscale = node?.parent?.worldScale??[1,1,1];
      node.transform[4] *= pscale[0]; 
      node.transform[5] *= pscale[1]; 
      node.transform[6] *= pscale[2]; 
      node.transform[7] *= pscale[2]; 
    };
    
    // Let us also renormalize skinning weights so they always sum to one.
    if (J.meshes instanceof Object) J.meshes = Object.values(J.meshes);
    for (var m in J.meshes) J.meshes[m].primitives.forEach( prim => {
      
      // Only if the primitive is skinned.
      if (!prim.attributes.WEIGHTS_0) return;
      
      // Grab the attribute, stride and offset
      const attrib = prim.attributes.WEIGHTS_0, ofs = (attrib.byteOffset??0)/4, stride = (attrib.byteStride??16)/4;
      
      // Now loop over all sets of weights and renormalize them.
      for (var i=0; i<attrib.count; ++i) {
        const vec = attrib.bufferView.slice(ofs + stride * i,ofs + stride * i + 4);
        const len = hypot(...vec);
        attrib.bufferView.set( vec.map(x=>x/len) , ofs + stride * i);
      }
    });
    
    return this;
  }
  
  /** 
   * Evaluate all nodes at the given time for the given animation.
   * @param {number} [time=0] The time to evaluate at.
   * @param {number} [anim=0] The animation to evaluate.
   **/
  setTime (time=0, anim=0, time2, anim2, blend) {
  
    // Make sure we have a valid animation
    if (!this.json.animations || !this.json.animations.length) return;
    anim = min(anim, (this.json?.animations?.length??1)-1)
    if (blend) anim2 = min(anim2, (this.json?.animations?.length??1)-1)
  
    // Make sure we have a valid time in that animation.
    //time = min(max(time,this.json?.animations[anim].channels[0].sampler.input.min[0]),this.json?.animations[anim].channels[0].sampler.input.max[0])
    
    // Now loop over all channnels
    var allAnims = blend ? [[anim, time],[anim2, time2]]:[[anim, time]];
    allAnims.forEach(([anim, time],bi)=>{
    for (var ci=0, cl=this.json.animations[anim].channels.length; ci<cl; ++ci) { 
      let channel = this.json.animations[anim].channels[ci];
      //if (channel.skip) continue;
    
      // Grab the target and sampler - with their offsets. strides are fixed for animation data!
      const {target, sampler} = channel;
      const ofsi = (sampler.input.byteOffset??0)/4;
      const ofso = (sampler.output.byteOffset??0)/4;

      // find correct frame. (start looking from our last found frame as optimisation).
      const si = sampler.input, sib = si.bufferView;
      if (si.skip) {
        var frame = 0;
      } else {
        for (var frame = time>=sampler.curTime?sampler.curFrame:0; sib[ofsi + frame]<=time && frame<si.count-1; ++frame);
      }  

      // Calculate the subframe time as 't'      
      var t = frame==0?1:(time - sampler.input.bufferView[ofsi + frame - 1])/(sampler.input.bufferView[ofsi + frame] - sampler.input.bufferView[ofsi + (frame-1)]);
      t = min(1,max(0,t));
      //if (ci == 1) console.log(time, frame, t);
      
      // Store our current frame and time
      sampler.curFrame = frame;
      sampler.curTime = time;
      const bv = sampler.output.bufferView;
      target.node.changed = true;
      
      // Now handle the translation
      if (target.path == 'translation') {
        const ofsB = ofso + frame*3, ofsA = ofsB - 3;
        if (bi) {
          if (t===1) target.node.translation = mix(target.node.translation, bv.slice(ofsB, ofsB+3), blend);
          else if (t==0) target.node.translation = mix(target.node.translation, bv.slice(ofsA, ofsA+3), blend);
          else target.node.translation = mix(target.node.translation, [bv[ofsA]*(1-t)+t*bv[ofsB], bv[ofsA+1]*(1-t)+t*bv[ofsB+1], bv[ofsA+2]*(1-t)+t*bv[ofsB+2]], blend);
        } else {
          if (t===1) target.node.translation = bv.slice(ofsB, ofsB+3);
          else if (t==0) target.node.translation = bv.slice(ofsA, ofsA+3);
          else target.node.translation = [bv[ofsA]*(1-t)+t*bv[ofsB], bv[ofsA+1]*(1-t)+t*bv[ofsB+1], bv[ofsA+2]*(1-t)+t*bv[ofsB+2]];
        }  
      }
      
      // For the rotation we do a renormalized lerp for now.
      if (target.path == 'rotation') {
        // Fetch both frames.
        const ofsB = ofso + frame*4, ofsA = ofsB - 4;
        
        // Quick bail.
        if (t==1) { 
          if (bi) {
            rotF = bv.slice(ofsB, ofsB+4);
            if (dot(rotF, target.node.rotation)<0) rotF = rotF.map(x=>-x);
            target.node.rotation = mix(target.node.rotation, rotF, blend);
          } else {
           target.node.rotation = bv.slice(ofsB, ofsB+4); 
          } 
          continue; 
        }
        if (t==0) { 
          if (bi) {
            rotF = bv.slice(ofsA, ofsA+4);
            if (dot(rotF, target.node.rotation)<0) rotF = rotF.map(x=>-x);
            target.node.rotation = mix(target.node.rotation, rotF, blend);
          } else {
           target.node.rotation = bv.slice(ofsA, ofsA+4); 
          } 
          continue; 
        }
        
        // Make sure we're picking the small angle.
        if ( bv[ofsA]*bv[ofsB] + bv[ofsA+1]*bv[ofsB+1] + bv[ofsA+2]*bv[ofsB+2] + bv[ofsA+3]*bv[ofsB+3] < 0) 
          var rotF = [bv[ofsA]*(1-t)-t*bv[ofsB], bv[ofsA+1]*(1-t)-t*bv[ofsB+1], bv[ofsA+2]*(1-t)-t*bv[ofsB+2], bv[ofsA+3]*(1-t)-t*bv[ofsB+3]]; // rotA.map((a,i)=> a * (1 - t) - t * rotB[i] );
        else
          var rotF = [bv[ofsA]*(1-t)+t*bv[ofsB], bv[ofsA+1]*(1-t)+t*bv[ofsB+1], bv[ofsA+2]*(1-t)+t*bv[ofsB+2], bv[ofsA+3]*(1-t)+t*bv[ofsB+3]]; // rotA.map((a,i)=> a * (1 - t) + t * rotB[i] );
        
        // Now interpolate linearly and renormalize.
        var len  = (rotF[0]**2 + rotF[1]**2 + rotF[2]**2 + rotF[3]**2)**-.5; // hypot(...rotF);
        if (bi) {
          rotF = rotF.map(x=>x*len);
          if (dot(rotF, target.node.rotation)<0) rotF = rotF.map(x=>-x);
          target.node.rotation = mix(target.node.rotation, rotF, blend);
        } else {
          target.node.rotation = rotF.map(x=>x*len);
        }  
      }
    }});
    
    // Now that all animation data is updated, we need to recalculate all local transforms.
    const J = this.json;
    for (var i=0, l=J.nodes.length; i<l; ++i) {
      const JNI = J.nodes[i];
      if (!JNI.changed) continue;
      
      JNI.transform=identity;
      
      // First matrix, then rot, tran. Scale is not handled here! 
      if (JNI.matrix)      JNI.transform = fromMatrix(JNI.matrix);      
      if (JNI.rotation)    JNI.transform = normalize([JNI.rotation[3],-JNI.rotation[0],-JNI.rotation[1],-JNI.rotation[2], 0,0,0,0]);
      if (JNI.translation) JNI.transform = gp_mm([1,0,0,0,-JNI.translation[0]/2,-JNI.translation[1]/2,-JNI.translation[2]/2,0], JNI.transform);
      
      // Apply scale patch - assume verts are already scaled, so only modify transform translation part.      
      const tf = JNI.transform, s = JNI?.parent?.worldScale || [1,1,1];
      tf[4] *= s[0]; tf[5] *= s[1]; tf[6] *= s[2]; tf[7] *= s[2];
    }
  }

  /**
   * Unweld: Used to unpack attributes so they are no longer interleaved.
   * Optionally can unweld all vertices (e.g. for mikkt).
   * @param {Object}   prim                      The glTF primitive to process.
   * @param {Object}   [opts]                    An options object.
   * @param {number[]} [opts.scale]              Optional scaling to apply to the vertex positions.
   * @param {boolean}  [opts.needsTangent=false] Boolean indicating if a full unweld is needed.
   **/
  unweld (prim, opts={}) {
    // Grab the attributes.
    var P = prim.attributes.POSITION.bufferView;
    var N = (prim.attributes.NORMAL) ? prim.attributes.NORMAL.bufferView : new Float32Array(P.length);
    var T = (prim.attributes.TEXCOORD_0) ? prim.attributes.TEXCOORD_0.bufferView : new Float32Array(P.length/3*2);
    var TG = prim.attributes?.TANGENT?.bufferView;
    var W = prim.attributes?.WEIGHTS_0?.bufferView;
    var J = prim.attributes?.JOINTS_0?.bufferView;
    var I = prim.indices?.bufferView??new Uint32Array([...Array(P.length/3).keys()]);
    // Grab the offsets and strides.
    const pa = prim.attributes;
    const [PO, NO, TO, GO, WO, JO] = [pa.POSITION.byteOffset??0, pa.NORMAL?.byteOffset??0, pa.TEXCOORD_0?.byteOffset||0, pa.TANGENT?.byteOffset??0, pa.WEIGHTS_0?.byteOffset??0, (pa.JOINTS_0?.byteOffset??0)*2].map(x=>x/4);
    const [PS, NS, TS, GS, WS, JS] = [pa.POSITION.byteStride??12, pa.NORMAL?.byteStride??12, pa.TEXCOORD_0?.byteStride||8, pa.TANGENT?.byteStride??16, pa.WEIGHTS_0?.byteStride??16, (pa.JOINTS_0?.bufferView?.byteStride??8)*2 ].map(x=>x/4);
    const IO = (prim?.indices?.byteOffset??0) / ((I instanceof Uint16Array)?2:4); 
    // Now unpack
    if (opts.scale == undefined) opts.scale = [1,1,1];
    if ((opts.needsTangent && !prim.attributes.TANGENT)) {
      var vertices = new Float32Array((prim?.indices?.count??I.length)*3), normals = new Float32Array(prim.indices.count*3), weights = W && new Float32Array(prim.indices.count*4), joints = J && new Uint16Array(prim.indices.count*4),
          uvs = new Float32Array(prim.indices.count*2), indices = [], tangents = TG?new Float32Array(prim.indices.count*4):undefined;
      for (var j=0; j<(prim?.indices?.count??I.length); ++j) {
        var i = I[j + IO];
        vertices[j*3  ] = P[i*PS + PO  ] * opts.scale[0];
        vertices[j*3+1] = P[i*PS + PO+1] * opts.scale[1];
        vertices[j*3+2] = P[i*PS + PO+2] * opts.scale[2];
        normals.set(N.slice(i*NS + NO, i*NS + NO + 3), j*3);
        uvs.set(T.slice(i*TS + TO, i*TS + TO + 2), j*2);
        if (TG) tangents.set(TG.slice(i*GS + GO, i*GS + GO + 4), j*4);
        if (W) weights.set(W.slice(i*WS + WO, i*WS + WO + 4), j*4);
        if (J) joints.set(J.slice(i*JS + JO, i*JS + JO + 4), j*4);
        indices.push(indices.length);
      }
    } else { // no need to unweld.
      vertices = P.slice( PO, PO + prim.attributes.POSITION.count * 3 );
      if (opts.scale[0]!=1 || opts.scale[1]!=1 || opts.scale[2]!=1) {
        // if (J) console.log('apply scale', PO, vertices.length, opts.scale);
        for (var i=0; i<vertices.length; ++i) vertices[i] *= opts.scale[i%3]??1;
      }
      normals  = N.slice( NO, NO + prim.attributes.POSITION.count * 3 );
      uvs      = T.slice( TO, TO + prim.attributes.POSITION.count * 2 );
      if (TG) tangents = TG.slice( GO, GO + prim.attributes.POSITION.count * 4 );
      if (W) weights = W.slice( WO, WO + prim.attributes.POSITION.count * 4 );
      if (J) {
        if (JS==4) {
          joints  = J.slice( JO, JO + prim.attributes.POSITION.count * 4 );
        } else {
          const l = prim.attributes.POSITION.count;
          joints  = new Uint16Array( l * 4 );
          for (var i=0; i<l; ++i) joints.set( J.slice(JO + i*JS, JO + i*JS + 4) , i*4 );
        }
      }
      indices  = I.slice(IO, IO + (prim?.indices?.count??I.length));
    }  
    return {vertices, normals, uvs, indices, tangents, weights, joints};
  } 

}