/******************************************************************************
 *
 * Look, Ma, No Matrices!
 * miniGL.js
 *
 * by Steven De Keninck 
 *
 * Minimal webGL2 wrapping.
 *
 *****************************************************************************/

/******************************************************************************
 * imports. 
 *****************************************************************************/

import {texParams} from './util.js';
 
/******************************************************************************
 * Compile a vertex or fragment shader.
 * @param {WebGL2RenderingContext} gl     webgl2 context.
 * @param {Number}                 type   gl.VERTEX_SHADER,gl.FRAGMENT_SHADER
 * @param {String}                 source Shader source.
 * @returns {WebGLShader}
 *****************************************************************************/

const compileShader = (gl, type, source) => {
  // create and compile shader.
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  // output errors with line numbers.
  console.error('GL Shader error: ' + gl.getShaderInfoLog(shader) + '\n', source.split('\n'));
  gl.deleteShader(shader);
}    

/******************************************************************************
 * Program Cache. Compiling takes long .. 
 *****************************************************************************/

var programCache = {};
export const resetProgramCache = ()=>programCache={};

/******************************************************************************
 * Create a program, compile and link shaders, extract uniforms and attribs.
 * @param {WebGL2RenderingContext} gl     webgl2 context.
 * @param {String}          vertexShaderSource   The vertex shader source.
 * @param {String}          fragmentShaderSource The fragment shader source.
 *****************************************************************************/

export const createProgram = (gl, vertexShaderSource, fragmentShaderSource, defines='') => {
  // Check for cached version.
  if (programCache[vertexShaderSource + fragmentShaderSource]) return programCache[vertexShaderSource + fragmentShaderSource];
  // Create program and store in cache
  const program = gl.createProgram();
  programCache[vertexShaderSource + fragmentShaderSource] = program;
  // Compile and attach both shaders.
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER,   '#version 300 es\n'+defines+vertexShaderSource));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, '#version 300 es\n'+defines+fragmentShaderSource));
  // Link the program and print errors if needed.
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('GL Program error: ' + gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return;
  }
  // Figure out which uniform variables the program references.
  program.uniforms = [...Array(gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS))]
         .map((_,i)=>gl.getActiveUniform(program, i))
         .map(x=>Object.assign(gl.getUniformLocation(program, x.name)||{noLocation:true},{name:x.name,type:x.type,size:x.size}));
  // Similarly, determine the vertex attributes used.                          
  program.attribs  = Object.fromEntries([...Array(gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES))]
                           .map((_,i)=>gl.getActiveAttrib(program, i))
                           .map(x=>[x.name,Object.assign(gl.getAttribLocation(program, x.name),{type:x.type,size:x.size})]));                                 
  // And the same for uniform blocks, fetching for each their name, index, size and uniforms.
  program.uniformBlocks = Object.fromEntries([...Array(gl.getProgramParameter(program, gl.ACTIVE_UNIFORM_BLOCKS))]
         .map((_,i)=>[gl.getActiveUniformBlockName(program, i), { 
           index: gl.getUniformBlockIndex(program, gl.getActiveUniformBlockName(program, i)), 
           size: gl.getActiveUniformBlockParameter(program, i, gl.UNIFORM_BLOCK_DATA_SIZE),
           uniforms:  [...gl.getActiveUniformBlockParameter(program, i, gl.UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES)]
                            .map(i=>gl.getActiveUniform(program, i))
         }]));
  // The uniforms list above also contains the block uniforms, split them out so each is
  // in their own block instead.
  var j=0; for (var i in program.uniformBlocks) {
    // Grab the block and find the uniform names.
    const block = program.uniformBlocks[i];
    const names = Object.entries(block.uniforms).map(([k,v])=>v.name);
    // Map those names to indices and then to expected offsets in the ubo.
    const idx = gl.getUniformIndices(program, names);
    const ofs = gl.getActiveUniforms(program, idx, gl.UNIFORM_OFFSET);
    // Store the uniforms per block, with their names, types, indices and offsets included.
    block.uniforms = names.map( (name,i) => Object.assign(program.uniforms.find(x=>x.name == name),{ idx : idx[i], ofs : ofs[i] }));
  }
  // now remove the block ones from the default uniforms list.
  program.uniforms = program.uniforms.filter(x=>x.noLocation!==true);
  return program;
}

/******************************************************************************
 * Create or Update a uniform block. 
 *****************************************************************************/

export const updateUBO = (gl, buffer, data, block) => {
  if (buffer === undefined) buffer = gl.createBuffer();
  gl.bindBuffer(gl.UNIFORM_BUFFER, buffer);
  if (data instanceof Float32Array || data instanceof Array) {
    gl.bufferData(gl.UNIFORM_BUFFER, data, gl.DYNAMIC_DRAW);
  } else {
    buffer.arr = buffer.arr ?? new Float32Array( block.size / 4 );
    for (var prop=0, l = block.uniforms.length; prop<l; ++prop) {
      const d = data[block.uniforms[prop].name];
      if (d.map) /*(d instanceof Array || d instanceof Float32Array)*/ buffer.arr.set( d, block.uniforms[prop].ofs/4 );
      else buffer.arr[block.uniforms[prop].ofs/4] = d;
    }  
    gl.bufferData(gl.UNIFORM_BUFFER, buffer.arr, gl.DYNAMIC_DRAW);
    if (buffer.arr.length * 4 != block.size) debugger;
  } 
  gl.bindBuffer(gl.UNIFORM_BUFFER, null);
  return buffer;
}

/******************************************************************************
 * Create a vertex array object.
 *****************************************************************************/
 
export const createVAO = (gl, vertices, indices, nrOfCoords = 2, uvs, weights, joints, tangentRotors) => {
  // Create and bind the vao.
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  // Bind all vertex attributes.
  // We use a fixed layout, position, tangentFrame, uv, [weights, indices]
  [vertices, tangentRotors, uvs, weights].forEach((x,i)=>{ if (x) {
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(x), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i,[nrOfCoords,4,2,4][i], gl.FLOAT, false, 0, 0);
  }});
  // Joints are uint16 attributes
  if (joints) {
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); 
    gl.bufferData(gl.ARRAY_BUFFER, new Uint16Array(joints), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.UNSIGNED_SHORT, false, 0, 0);
  }
  // Bind the polygon attributes.
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW);
  // Store lengths for drawing..
  vao.length = indices.length;
  vao.nrPoints = vertices.length / nrOfCoords;
  // Unbind and return.
  gl.bindVertexArray(null);
  return vao;
}    

/******************************************************************************
 * Render a vertex array object.
 *****************************************************************************/

export const render = (gl, program, vao, indexCount, uniforms={}, points=false, lines=false) => {
  gl.useProgram(program);
  for (let u=0, l=program.uniforms.length; u<l; ++u) {
    const pu = program.uniforms[u];
    const v = pu.name; 
      switch (pu.type) {
        case gl.SAMPLER_2D   : 
        case gl.SAMPLER_CUBE : if (program.used !== true) gl.uniform1i( pu, uniforms[v]); break;
        case gl.FLOAT_MAT4   : gl.uniformMatrix4fv( pu, false, uniforms[v] ); break;
        case gl.FLOAT_MAT3   : gl.uniformMatrix3fv( pu, false, uniforms[v] ); break;
        case gl.FLOAT_MAT3x4 : gl.uniformMatrix3x4fv( pu, false, uniforms[v] ); break;
        case gl.FLOAT_MAT2x4 : gl.uniformMatrix2x4fv( pu, false, uniforms[v] ); break;
        case gl.FLOAT_VEC4   : gl.uniform4fv( pu, uniforms[v] ); break;
        case gl.FLOAT_VEC3   : gl.uniform3fv( pu, uniforms[v] ); break;
        case gl.FLOAT_VEC2   : gl.uniform2fv( pu, uniforms[v] ); break;
        case gl.FLOAT        : gl.uniform1f( pu, uniforms[v]); break;
        default              : gl.uniform1i( pu, uniforms[v]); break;
      }
    }
  for (let i in program.uniformBlocks) {
    const block = program.uniformBlocks[i];
    gl.bindBufferBase( gl.UNIFORM_BUFFER, block.index, block.buffer );
    gl.uniformBlockBinding(program, block.index, block.index);
  }
  program.used = true; 
  gl.bindVertexArray(vao);
  if (points) gl.drawArrays(gl.POINTS, 0, vao.nrPoints);
         else gl.drawElements(lines?gl.LINES:gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0);
}

/******************************************************************************
 * Texture cache.
 *****************************************************************************/

var textureCache = {};

/******************************************************************************
 * Load a texture.
 *****************************************************************************/

export const loadTexture = (gl, src, linear = true, target = gl.TEXTURE_2D) => {
  const id = src.blob ? src.blob.name+src.bufferView:(src.uri??src);
  if (textureCache[id]) return textureCache[id];
  const texture = gl.createTexture();
  textureCache[id] = texture;
  gl.bindTexture(target, texture);
  gl.texImage2D(target, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  // make texture into blobPromise.
  const blobPromise = src.blob ? new Promise((S,F)=>S(src.blob)):fetch( src.uri || src ).then( res => res.blob() );
  blobPromise.then( blob => createImageBitmap(blob,{premultiplyAlpha:"none", colorSpaceConversion:"none"}).then( ib=>{
    // console.log('ib load', linear?'linear':'sRGB',' [',ib.width,',',ib.height,']');
    gl.bindTexture(target, texture);
    gl.texImage2D(target, 0, linear==false ? gl.SRGB8_ALPHA8 : gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ib);
    texParams(gl, target, gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR)
    gl.generateMipmap(target);
  }));  
  return texture
}

/******************************************************************************
 * Create and bind a framebuffer object.
 *****************************************************************************/

export const bindFrameBuffer = (gl, buf, width = 1920, height = 1080, hasDepth = true, nrMips = 1, mipLevel = 0, nrAttachments = 1) => {
  // If no buffer yet, create one
  if (buf == undefined) buf = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, buf);
  // If we're still the same size, bail early.
  if (buf.width == width && buf.height == height) {
    // We attach the correct mipLevel
    if (buf.colorTexture)  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, buf.colorTexture, mipLevel);
    if (buf.colorTexture2) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, buf.colorTexture2, mipLevel);
    if (buf.depthTexture)  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,  gl.TEXTURE_2D, buf.depthTexture, mipLevel);
    // Return the buffer.
    return buf;
  }
  Object.assign(buf, {width, height});
  // Create/resize the textures
  if (buf.colorTexture !== undefined) gl.deleteTexture(buf.colorTexture);
  buf.colorTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, buf.colorTexture);
  gl.texStorage2D(gl.TEXTURE_2D, nrMips, gl.RGBA8, width, height);
  texParams(gl, gl.TEXTURE_2D, nrMips==1?gl.LINEAR:gl.LINEAR_MIPMAP_NEAREST, gl.LINEAR, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE, 0, nrMips);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, buf.colorTexture, mipLevel);
  if (nrAttachments == 2) {
    if (buf.colorTexture2 !== undefined) gl.deleteTexture(buf.colorTexture2);
    buf.colorTexture2 = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, buf.colorTexture2);
    gl.texStorage2D(gl.TEXTURE_2D, nrMips, gl.RGBA8, width, height);
    texParams(gl, gl.TEXTURE_2D, nrMips==1?gl.LINEAR:gl.LINEAR_MIPMAP_NEAREST, gl.LINEAR, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE, 0, nrMips);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, buf.colorTexture2, mipLevel);
  }  
  // Create/resize the depth textures.      
  if (hasDepth) {
    if (buf.depthTexture !== undefined) gl.deleteTexture(buf.depthTexture);
    buf.depthTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, buf.depthTexture);
    gl.texStorage2D(gl.TEXTURE_2D, nrMips, gl.DEPTH_COMPONENT24, width, height);
    texParams(gl, gl.TEXTURE_2D, gl.NEAREST, gl.NEAREST,gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE, 0, nrMips);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,  gl.TEXTURE_2D, buf.depthTexture, mipLevel);
  }  
  return buf;
}
 
