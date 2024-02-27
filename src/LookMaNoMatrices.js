/******************************************************************************
 *
 * Look, Ma, No Matrices!
 * Putting PGA to the test.
 *
 * by Steven De Keninck 
 *
 * A matrix-free forward rendering 3D glTF renderer.
 *
 *****************************************************************************/

/******************************************************************************
 * Imports
 *****************************************************************************/
 
import {miniRender} from './miniRender.js';
import * as PGA     from './miniPGA.js';
    
/******************************************************************************
 * Shorthand
 *****************************************************************************/

const {PI, E, sin, min, max, hypot, sqrt, abs} = Math;
const {gp, exp_t, exp_r, exp_b, add, sub, mul, e31, e12, e23, e01, e02, e03} = PGA;
    
/******************************************************************************
 * Initialize and Load.
 *****************************************************************************/
    
// Setup canvas.
const canvas = document.getElementById('render'); 
const render = new miniRender({canvas});

// Load a glTF file and upload to webGL.
const glTF = await render.load('data/elephant.glb');

/******************************************************************************
 * Our Frame Handler.
 *****************************************************************************/
const frame = ()=>{

  // Update canvas size/pos and clear.
  render.initFrame();
  
  // Our default orientation.
  // This will put our object center screen.
  var world = (exp_b(add(mul(e31,PI/2),mul(e02,0.4))));
       
  // Now scan the page for html elements with the id 'elephant'
  // and render in those places. This allows us to integrate neatly
  // into the page, and break outside of our 'box', without needing
  // multiple canvases or contexts.     
  for (var i=1; i<10; ++i) {
  
    // See if we find a html element for this elephant.
    var elephant   = document.querySelector('#elephant'+i);
    if (!elephant) break;

    // Figure out if it is on the screen.
    var rect   = elephant.getBoundingClientRect();
    var aspect = canvas.width/canvas.height;
    var height = canvas.clientHeight;
    var center = [(rect.left + 0.5*(rect.right - rect.left))/window.innerWidth, (rect.bottom + 0.5*(rect.top - rect.bottom))/height];
    center = add(mul(sub(center,0.5),0.48),0.5);
    if (rect.bottom<0 || rect.top>window.innerHeight) continue;

    // If we are visible, set our scale and calculate our final transform.
    render.worldscale = (rect.bottom - rect.top) / height * 0.5;
    var world2 = gp(world, exp_t( -(center[0]-0.5) / render.worldscale * aspect - 0.05 , e01 ), exp_t( (center[1]-0.5 + (i==1?0.005:0)) / render.worldscale, e02 ), exp_r( i==1?-0.5:0.2, e31));

    // Make sure our motors get recalculated.
    glTF.json.scenes[0].nodes[0].changed = true;
    
    // Now setup the proper animation. Either what the html tag has, or what's selected in the dropdown.
    var a1 = elephant.dataset.anima ?? document.querySelector('#anim1').selectedIndex;
    var a2 = elephant.dataset.animb ?? document.querySelector('#anim2').selectedIndex;
    
    // Figure out if we need manual blending or just slowly back and forth.
    var bl = i == 4 ? document.querySelector('#blend').value*1 : Math.sin(performance.now()/800 - Math.PI/2)*0.5+0.5;
    
    // Now grab both animations
    const an1 = glTF?.json?.animations[a1];
    const an2 = glTF?.json?.animations[a2];
    
    // Figure out animation time.
    const t = performance.now()/1000;
    const t1 = t % an1.duration;
    const t2 = t % an2.duration;
    
    // Animate!
    glTF.setTime( t1, a1, t2, a2, bl);

    // And render this character.
    render.render(world2);

  }  
  requestAnimationFrame(frame);
}
frame();
