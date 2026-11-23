import React, { useEffect, useRef, useState } from "react";

// Küçük, bağımsız WebGL sahnesi; sohbet ekranında GPU kullanmaz.
export default function NexaModel() {
  const canvasRef = useRef(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl", { alpha: true, antialias: true, powerPreference: "low-power" });
    if (!gl) return;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); return null; }
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, `attribute vec3 p; attribute float shade; uniform float angle; varying float light; void main(){ float c=cos(angle),s=sin(angle); vec3 v=vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z); gl_Position=vec4(v.x*.55,v.y*.55,v.z*.15,1.); light=shade; }`);
    const fs = compile(gl.FRAGMENT_SHADER, `precision mediump float; varying float light; void main(){gl_FragColor=vec4(vec3(.46,.61,.74)*light+vec3(.10,.13,.16),1.);}`);
    if (!vs || !fs) return;
    const program = gl.createProgram(); gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); gl.deleteShader(vs); gl.deleteShader(fs); return; }
    // Three extruded bars form an actual 3D N, including side faces.
    const data = [];
    const box = (cx, cy, angle) => {
      const c = Math.cos(angle), s = Math.sin(angle);
      const pts = [[-0.16,-0.85], [0.16,-0.85], [0.16,0.85], [-0.16,0.85]].map(([x,y]) => [cx+x*c-y*s,cy+x*s+y*c]);
      const point = (i,z) => [pts[i][0],pts[i][1],z];
      const face = (vertices, shade) => { for (const i of [0,1,2,0,2,3]) data.push(...vertices[i], shade); };
      face([point(0,.14),point(1,.14),point(2,.14),point(3,.14)],1);
      face([point(1,-.14),point(0,-.14),point(3,-.14),point(2,-.14)],.45);
      for (let i=0;i<4;i++) { const j=(i+1)%4; face([point(i,.14),point(i,-.14),point(j,-.14),point(j,.14)],i%2 ? .68 : .83); }
    };
    box(-.63,0,0); box(.63,0,0); box(0,0,.64);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    gl.useProgram(program);
    const p = gl.getAttribLocation(program,"p"), shade = gl.getAttribLocation(program,"shade");
    gl.enableVertexAttribArray(p); gl.vertexAttribPointer(p,3,gl.FLOAT,false,16,0);
    gl.enableVertexAttribArray(shade); gl.vertexAttribPointer(shade,1,gl.FLOAT,false,16,12);
    const angle = gl.getUniformLocation(program,"angle");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0, stopped = false;
    const render = (time = 0) => {
      if (stopped) return;
      gl.viewport(0,0,canvas.width,canvas.height); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.uniform1f(angle,reduced.matches ? .35 : .35 + Math.sin(time*.00045)*.27);
      gl.drawArrays(gl.TRIANGLES,0,data.length/4);
      if (!reduced.matches) frame = requestAnimationFrame(render);
    };
    const motionChange = () => { cancelAnimationFrame(frame); render(); };
    reduced.addEventListener?.("change", motionChange); setReady(true); render();
    return () => { stopped=true; cancelAnimationFrame(frame); reduced.removeEventListener?.("change", motionChange); gl.deleteBuffer(buffer); gl.deleteProgram(program); gl.deleteShader(vs); gl.deleteShader(fs); };
  }, []);
  return <div className="nx-emblem" aria-hidden="true"><span style={{ display: ready ? "none" : undefined }}>N</span><canvas ref={canvasRef} width="136" height="136" style={{ width: "100%", height: "100%", display: ready ? "block" : "none" }} /></div>;
}
