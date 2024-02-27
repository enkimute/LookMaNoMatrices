/******************************************************************************
 *
 * Look, Ma, No Matrices!
 * Putting PGA to the test.
 *
 * by Steven De Keninck 
 *
 * A matrix-free forward rendering 3D glTF renderer.
 *
 * Figure out which glTF files are referenced in the page, load the data, and
 * setup the rendering loop.
 *
 * The 3D files are referenced in the main html, for example as :
 *
 * <SPAN CLASS="glTF" data-scene="data/elephant.glb" data-blend=0 data-anima=1 data-animb=2>
 *
 * with:
 *
 * CLASS="glTF"      mandatory, indicates a glTF file needs to be rendered here.
 * data-scene="uri"  uri of the glb/glTF file to load.
 * data-anima=x      number of first animation in the blend. 0 if omitted.
 * data-animb=x      number of second animation in the blend. same as a if omitted.
 * data-blend=x      blending factor between the animations. auto if omitted.
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

// Grab all html elements we need to render glTF files behind.
const els    = [...document.querySelectorAll(".glTF")];
const files  = els.map(x=>x.dataset.scene).filter((x,i,a)=>a.indexOf(x)==i).sort((a,b)=>a<b?-1:1);
els.forEach( el => el.sceneID = files.indexOf( el.dataset.scene ));

// Load a glTF file and upload to webGL.
const glTF  = await Promise.all(files.map( file => render.load(file) ));

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
  els.forEach( model => {  

    // Figure out if it is on the screen.
    var rect   = model.getBoundingClientRect();
    var aspect = canvas.width/canvas.height;
    var height = canvas.clientHeight;
    var center = [(rect.left + 0.5*(rect.right - rect.left))/window.innerWidth, (rect.bottom + 0.5*(rect.top - rect.bottom))/height];
    center = add(mul(sub(center,0.5),0.48),0.5);
    if (rect.bottom<0 || rect.top>window.innerHeight) return;

    // If we are visible, set our scale and calculate our final transform.
    render.worldscale = (rect.bottom - rect.top) / height * 0.5;
    var world2 = gp(world, exp_t( -(center[0]-0.5) / render.worldscale * aspect - 0.05 , e01 ), exp_t( (center[1]-0.5) / render.worldscale, e02 ), exp_r( 0.2, e31));

    // Grab correct scene.
    const TF = glTF[model.sceneID ?? 0];

    // Make sure our motors get recalculated.
    TF.json.scenes[0].nodes[0].changed = true;
    
    // Now setup the proper animation. Either what the html tag has, or what's selected in the dropdown.
    var a1 = model.dataset.anima ?? document.querySelector('#anim1')?.selectedIndex ?? 0;
    var a2 = model.dataset.animb ?? document.querySelector('#anim2')?.selectedIndex ?? a1;
    
    // Figure out if we need manual blending or just slowly back and forth.
    var bl = model.dataset.blend ?? Math.sin(performance.now()/800 - Math.PI/2)*0.5+0.5;
    
    // Now grab both animations
    const an1 = TF?.json?.animations[a1];
    const an2 = TF?.json?.animations[a2];
    
    // Figure out animation time.
    const t = performance.now()/1000;
    const t1 = t % an1.duration;
    const t2 = t % an2.duration;
    
    // Animate!
    TF.setTime( t1, a1, t2, a2, bl);

    // And render this character.
    render.render(world2, model.sceneID ?? 0);

  });  
  requestAnimationFrame(frame);
}
frame();

