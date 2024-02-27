/******************************************************************************
 *
 * Look, Ma, No Matrices!
 * Putting PGA to the test.
 *
 * by Steven De Keninck 
 *
 * Some assorted utilities.
 *
 *****************************************************************************/

 const {floor, ceil, log2, log, max, pow, round} = Math;

/**
 *  Browser : save url as file.
 *  @function saveAs
 *  @param {String}    href      the url to save.
 *  @param {String}    download  the local filename to use.
 */
 export const saveAs = ( href, download ) => Object.assign( document.createElement('a'), {href, download} ).click(); 
 
/**
 * Helper to set all the texture parameters.
 **/
 export function texParams (gl, target, ...vals) {
   vals.forEach((val,i)=>{
     if (val!==undefined) gl.texParameteri(
       target,
       [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER,gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_MIN_LOD,gl.TEXTURE_MAX_LOD][i], 
       val);
   });
 }  
 
/**
 *  Store an arraybufer into a 32bit PNG.
 *  This is unfortunately hard. The obvious putImageData fails because of
 *  bad premultiplication control. We detour via webGL1.
 *  @function dataToImage
 *  @param  {Arraybuffer} data               The arraybuffer of raw data you want to store in the png
 *  @param  {Number}      [w]                Optional width to use.
 *  @param  {Number}      [h]                Optional height to use. 
 *  @param  {String}      [tp='image/png']   Image mimetype. (only png is safe :( )
 **/
 export async function dataToImage( data, w, h, tp = 'image/png' ) {
   // Grab a pointer to the bytes.
   const bytes = new Uint8Array( data.buffer );

   // First decide on the resolution.
   const closestPow2 = 2 << (floor(log2((bytes.length/4)**.5))-1);
   const width  = w||floor(closestPow2);
   const height = h||ceil(bytes.length/(width*4));

   // We need to do this via webGL to get unmodified data in the canvas..
   // hmmm can we do this with an imagebitmaprender context instead??
   function createShader(gl,src,tp)   { var s = gl.createShader(tp); gl.shaderSource(s, src); gl.compileShader(s); return s; };
   function createProgram(gl, vs, fs) { 
     var p = gl.createProgram(); 
     gl.attachShader(p, vs=createShader(gl, vs, gl.VERTEX_SHADER));
     gl.attachShader(p, fs=createShader(gl, fs, gl.FRAGMENT_SHADER));
     gl.linkProgram(p); gl.deleteShader(vs); gl.deleteShader(fs);
     return p;
   };
   var vs2 = 'precision highp float;\nattribute vec3 position;\nvarying vec2 tex;\nvoid main() { tex = position.xy/2.0+0.5; gl_Position = vec4(position, 1.0); }';
   var fs2 = 'precision highp float;\nprecision highp sampler2D;\nuniform sampler2D tx;\nvarying vec2 tex;\nvoid main() { gl_FragColor = texture2D(tx,tex); }';
   var canvas = Object.assign(document.createElement('canvas'),{width,height});
   var gl = canvas.getContext('webgl',{antialias:false,alpha:true,premultipliedAlpha:false,preserveDrawingBuffer:true});

   // Now create the texture we will use.
   var texture = gl.createTexture();
   gl.activeTexture(gl.TEXTURE0);  gl.bindTexture(gl.TEXTURE_2D, texture);  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
   texParams(gl, gl.TEXTURE_2D, gl.NEAREST, gl.NEAREST, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE);
   var bytes2 = new Uint8Array( width * height * 4 ); bytes2.set(bytes,0);
   gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes2);

   // Create the program to render this texture unmodified to the canvas.
   var program = createProgram(gl, vs2, fs2), uniformTexLocation = gl.getUniformLocation(program, 'tx');
   var positions = new Float32Array([-1, -1, 1, -1, 1,  1, 1,  1, -1,  1, -1, -1]), vertexPosBuffer=gl.createBuffer();
   gl.enableVertexAttribArray(0); gl.bindBuffer(gl.ARRAY_BUFFER, vertexPosBuffer); gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW); 
   gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

   // Setup the program and texture slot, render and cleanup
   gl.useProgram(program); gl.uniform1i(uniformTexLocation, 0);
   gl.drawArrays(gl.TRIANGLES, 0, 6);
   gl.deleteTexture(texture); gl.deleteProgram(program); gl.deleteBuffer(vertexPosBuffer);

   // Now convert it to a png.
   return await canvas.toBlob( blob => {
     var url = URL.createObjectURL(blob);
     console.log('compressed',bytes.length,'to',blob.size,'['+(100*blob.size/bytes.length).toFixed(3)+'%] - ',width,'*',height);
   }, tp, 1);
 }
 
 /** 
  * Similarly, getting raw bytes from an image is not obvious either.
  * We use createImageBitmap and OffscreenCanvas for webWorker access.
  * @param   {String}      url    Image url to load
  * @returns {ArrayBuffer} data   raw data
  **/
 export async function imageToData( url ) {
   // Fetch the data as imagebitmap - mind premultiply option!
   const blob = await fetch(url,{priority:'high', cache:'force-cache'}).then(res=>res.blob());
   const i = await createImageBitmap( blob, {premultiplyAlpha:"none", colorSpaceConversion:"none"} );

   // Create gl context and upload data as texture.
   const c = new OffscreenCanvas(i.width,i.height), gl = c.getContext('webgl');
   const texture = gl.createTexture();
   gl.bindTexture(gl.TEXTURE_2D, texture);
   gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, i);

   // Create framebuffer and attach texture
   const fb = gl.createFramebuffer();
   gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
   gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

   // Now read back the data.
   const res = new Uint8Array(i.width*i.height*4);
   gl.readPixels(0,0,i.width,i.height,gl.RGBA,gl.UNSIGNED_BYTE,res);
   gl.deleteTexture(texture); gl.deleteFramebuffer(fb);
   res.width = i.width; res.height = i.height;
   gl.bindFramebuffer(gl.FRAMEBUFFER, null);
   return res;
 }

 /** 
  * Convert HDR Floating point data to RGBE format.
  * @param {Array} Color Red, Green, Blue floating point vector.
  * @returns {Array} Color [R,G,B,E] Uint vector
  **/
 export function floatToRGBE([r, g, b]) {
   // Highest coefficient determines shared exponent.
   let v = max(r, g, b);
   if (v < 1e-32) return [0, 0, 0, 0];

   // Calculate exponent and scaling factor.
   let exp   = floor(log2(v) + 1.0);
   let scale = pow(2.0, -exp);

   // Return scaled versions as unsigned bytes.
   return [
     round(r * scale * 255.0),
     round(g * scale * 255.0),
     round(b * scale * 255.0),
     exp + 128
   ];
 }
 
 /** 
  * Convert RGBE data back to floating point HDR RGB.
  * @param {array}   RGBE      Array with RGBE unsigned byte data.
  * @param {number}  [offset]  Optional offset into the input array
  * @returns {array} Color     Array with HDR RGB color.
  **/
 const RGBE_exp_cache = [...Array(256)].map((x,i)=>pow(2.0, i - 136)); 
 export function RGBEToFloat(RGBE, offset = 0, dest = [], destOffset = 0) {
   let f = RGBE_exp_cache[RGBE[offset + 3]]; // 2 ** (RGBE[offset + 3] - 136);
   dest[destOffset  ] = RGBE[offset] * f;
   dest[destOffset+1] = RGBE[offset+1] * f;
   dest[destOffset+2] = RGBE[offset+2] * f;
   return dest;
 }
 
 /** 
  * Packs two floating points into RGBA unsigned bytes. Specically scales for LUT range!
  * @param {array} xy Array with two floating point values to be packed.
  * @returns {array} RGBA Array with 4 unsigned bytes packing the floating point values.
  **/
 export function LUTToRGBA([x,y]) {
   x = floor(x * 65500);
   y = floor(y * 65500);
   return [(x >> 8)&255, (x)&255, (y >> 8)&255, y&255];
 }
 
 /**
  * Unpacks RGBA encoded LUT information back to two floats. Specific for LUT range!
  * @param {array}   RGBA   RGBA input
  * @param {number}  offset Optional offset to use in the input.
  * @returns {array} XY     Two unpacked rescaled floating point values.
  */
 export function RGBAToLUT(RGBA, offset = 0, dest = [], destOffset = 0) {
   dest[destOffset]   = ((RGBA[offset] << 8) + RGBA[offset+1])/65500;
   dest[destOffset+1] = ((RGBA[offset+2] << 8) + RGBA[offset+3])/65500;
   return dest; 
 }

 /** 
  * Calculates a simple mipmap chain. Handles any type of input data.
  * @param {array|typedarray} buffer input buffer.
  * @param {number} width width of input image.
  * @param {number} height height of input image.
  * @param {number} [pp=3] number of components per pixel.  
  * @returns {array} mips Array of mips, same type as buffer, starting with buffer and halving in size each step.
  **/
 export function generateMipChain (buffer, width, height, pp=3) {
   // Our result starts with the input, our first size is halfway.   
   const res = [buffer];
   width = width >> 1; height = height >> 1;

   // Untill one of the sizes is zero, repeat.
   while (width && height) {

     // Create a new buffer of the same type and correct size.
     var buf = new (buffer.constructor)( width * height * pp );

     // Now do a simple box filter 50% scale.
     for (var i=0; i<height; ++i) for (var j=0; j<width; ++j) for (var k=0; k<pp; ++k) {
       buf[ i*width*pp + j*pp + k ] = (
         buffer[ (i*2  )*width*pp*2 + (j*2  )*pp + k ]
        +buffer[ (i*2+1)*width*pp*2 + (j*2  )*pp + k ]
        +buffer[ (i*2  )*width*pp*2 + (j*2+1)*pp + k ]
        +buffer[ (i*2+1)*width*pp*2 + (j*2+1)*pp + k ]
       )/4;
     }

     // Store this result, halven sizes and carry on.
     res.push(buf); buffer = buf;
     width = width >> 1; height = height >> 1;
   }
   return res;	
 }
  
 /** 
  * Fetch with progress for ArrayBuffer, Blob and JSON.
  * @param {Function}  progressCallback Gets called with progress update object { current, estimate, value }
  **/
 Response.prototype.progress = async function ( progressCallback ) {
   // Figure out total size :
   // 1. from custom x-content-length header containing uncompressed length of compressed streams, must be custom set on server.
   // 2. from content-length header containing uncompressed length of raw streams.
   // 3. from local storage if we loaded the file before.
   const totSize = ( this.headers.get("x-content-length") || this.headers.get("content-length") || localStorage["content_length_"+this.url] ) | 0;

   // Read the request as stream and accumulate the chunks.
   let responseSize = 0, chunks = [], reader = this.body.getReader(), time_start = performance.now();
   progressCallback&&progressCallback({ chunk : 0, current : responseSize, estimate : totSize, value : responseSize / totSize });
   while (true) {
     const {done, value} = await reader.read();
     if (done) { reader.releaseLock(); break; }; 
     responseSize += value.length;
     const time_passed = performance.now() - time_start;
     progressCallback&&progressCallback({ 
       chunk    : value.length, 
       current  : responseSize, 
       estimate : totSize,
       value    : responseSize / totSize,
       speed    : responseSize / time_passed
     });
     chunks.push(value);
   }
   localStorage["content_length_"+this.url] = responseSize;

   // Concatenate chunks
   let buffer = new Uint8Array(responseSize);
   for (var i=0, j=0; i<chunks.length; ++i) { buffer.set(chunks[i],j); j+=chunks[i].length; }

   // Finally, return the needed accessors.
   return {
     text        : ()=>new TextDecoder().decode(buffer),
     arrayBuffer : ()=>buffer.buffer,
     json        : ()=>JSON.parse(new TextDecoder().decode(buffer)),
     blob        : ()=>new Blob([buffer],{ type : this.headers.get('content-type') }),
   };
 }

 /**
  * Save a packed RGBE HDR panoramic cubemap, optionally with mipmaps.
  **/
 export function saveCubemap (gl, texid, texturesize = 256, baseName = 'cubemap', nrMips = 0)  {

   // Function to process each face of the cubemap
   function processCubemapFace(faceIndex, ctx, offset=0, mipLevel=0) {
       const cursize = texturesize / (2**mipLevel);

       // Bind the framebuffer
       let framebuffer = gl.createFramebuffer();
       gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
       gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + faceIndex, texid, mipLevel);

       // Read pixels from the framebuffer
       let rawData = new Float32Array(cursize * cursize * 4);
       gl.readPixels(0, 0, cursize, cursize, gl.RGBA, gl.FLOAT, rawData);

       // Convert each pixel and write it to the canvas.
       console.log('   ',faceIndex, cursize, ' @@@', offset + cursize**2*4*faceIndex);
       for (let i = 0; i < rawData.length; i += 4) {
           let rgbe = floatToRGBE([rawData[i], rawData[i + 1], rawData[i + 2]]);
           ctx.set(rgbe, i + offset + cursize**2*4*faceIndex);
       }

       // Cleanup     
       gl.deleteFramebuffer(framebuffer);
       gl.bindFramebuffer(gl.FRAMEBUFFER, null);
   }

   // Store the entire thing. The size is the base size + 25% of that and so on.
   const totsize = texturesize**2 * 6 * 4 * 4/3 * (1-1/4**(nrMips+1)) ; // Geometric series ..  1 + 1/4 + ... + 1/4^n = 4/3 * (1 - 1/4^n)
   let final = new Uint8Array( totsize ); 

   // Process each face of the cubemap
   for (let j = 0; j < nrMips+1; ++j) for (let i = 0; i < 6; i++) processCubemapFace(i, final, texturesize**2 * 6 * 4 * 4/3 * (1-1/4**j), j);
   dataToImage( final, texturesize*2, Math.ceil((totsize/4) / (texturesize*2)) ).then(url=>saveAs( url, `${baseName}.cubemap.png` ));
 }  
   
 /**
  * imageCache object.
  **/
 export const imageCache = {};  
 
 /** 
  * Loads a packed RGBE HDR panoramic cubemap, optionally with mipmaps.
  * @param {WebGL2RenderingContext} gl webGL2 rendering context.
  * @param {WebGLTexture} [texture] Optional texture object. A new texture is created if undefined.
  * @param {String} fileName Filename to load.
  * @param {boolean} [domips=true] Also load mipmaps.
  * @param {number} [nrMips=1] Nr of mipmaps to load.
  * @returns {WebGLTexture} A webGL texture.
  **/ 
 export async function loadCubemap (gl, fileName, nrMips = 1) {
   // First check the cache. 
   if (imageCache[fileName]) return imageCache[fileName];
 
   // Create texture.
   const texture = gl.createTexture();
   const imageData = await imageToData( fileName );

   // These cubemaps are saved with twice their actual width. 
   const [width,height] = [imageData.width / 2, imageData.height * 2];
     
   // Convert each pixel from RGBE to RGBA32f and write to a Float32Array
   let floatData = new Float32Array(imageData.length);
   for (let i = 0; i < imageData.length; i += 4) RGBEToFloat(imageData, i, floatData, i);//floatData.set( RGBEToFloat(imageData, i), i);

   // Upload the float data to the cubemap face
   gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
   gl.texStorage2D(gl.TEXTURE_CUBE_MAP, nrMips, gl.RGBA16F, width, width);
   for (var faceIndex = 0; faceIndex < 6; ++faceIndex) 
     for (var j=0; j<nrMips; ++j) {
       const curSize   = width / (2**j);
       const mipOffset = width**2 * 6 * 4 * (4/3 * (1-1/4**j));
       const imgOffset = mipOffset + faceIndex * curSize**2 * 4;
       const imgSize   = curSize**2 * 4;
       gl.texSubImage2D( gl.TEXTURE_CUBE_MAP_POSITIVE_X + faceIndex, j, 0, 0, curSize, curSize, gl.RGBA, gl.FLOAT, floatData.slice( imgOffset, imgOffset + imgSize ));
     }
     
   // Set texture parameters, max miplevel and resolve.
   texParams(gl, gl.TEXTURE_CUBE_MAP, nrMips>1?gl.LINEAR_MIPMAP_LINEAR:gl.LINEAR, gl.LINEAR, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE);
   gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAX_LEVEL, Math.max(0,nrMips-1));                
   imageCache[fileName] = texture;
   return texture;
 }
 
 /**
  * Loads a HDR texture from PNG. Standard decoder is RGBE to Float RGB. 
  * Our GGX LUT tables are also stored as PNG and decoded with RGBAToLUT.
  * @param {WebGL2RenderingContext} gl                     WebGL context to use.
  * @param {string}                 fileName               URI to load.
  * @param {function}               [decoder=RGBEToFloat]  Decoder function(array, offset).
  **/ 
 export async function loadHDRTexture (gl, fileName, decoder = RGBEToFloat) {
   // Create the texture, fetch the data.
   const texture        = gl.createTexture();
   const imageData      = await imageToData( fileName );
   const {width,height} = imageData;
   // Convert each pixel from RGBE to RGBA32f and write to a Float32Array
   let floatData = new Float32Array(imageData.length);
   for (let i = 0; i < imageData.length; i += 4) decoder(imageData, i, floatData, i);
   // Upload the float data to the cubemap face
   gl.bindTexture(gl.TEXTURE_2D, texture);
   gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.FLOAT, floatData);
   texParams(gl, gl.TEXTURE_2D, gl.LINEAR, gl.LINEAR, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE);
   return texture;
 }
  
   