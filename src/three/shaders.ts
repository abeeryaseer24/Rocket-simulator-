/** Ashima Arts 3D simplex noise (MIT) — compact GLSL port. */
export const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){
  float a=0.5,s=0.0;
  for(int i=0;i<7;i++){s+=a*snoise(p);p*=2.03;a*=0.5;}
  return s;
}
`;

export const EARTH_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vLocal;
varying vec3 vNormalW;
varying vec3 vPosW;
void main(){
  vLocal = normalize(position);
  vec4 w = modelMatrix * vec4(position,1.0);
  vPosW = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normalize(position));
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}
`;

export const EARTH_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uSun;
uniform vec3 uSite;
varying vec3 vLocal;
varying vec3 vNormalW;
varying vec3 vPosW;
${NOISE}
void main(){
  #include <logdepthbuf_fragment>
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  float n = fbm(vLocal*2.1 + vec3(3.1,1.7,0.4));
  float siteBoost = smoothstep(0.05,0.0,distance(vLocal,uSite))*0.5;
  float h = n + siteBoost;
  float land = smoothstep(0.08,0.11,h);
  float lat = abs(vLocal.z);
  float detail = snoise(vLocal*900.0)*0.5 + snoise(vLocal*5200.0)*0.25;
  vec3 ocean = mix(vec3(0.03,0.13,0.27), vec3(0.08,0.28,0.42), smoothstep(-0.1,0.09,h));
  float dry = smoothstep(-0.2,0.5, snoise(vLocal*6.0));
  vec3 terrain = mix(vec3(0.25,0.33,0.18), vec3(0.52,0.46,0.3), dry);
  terrain = mix(terrain, vec3(0.42,0.4,0.37), smoothstep(0.35,0.6,h));
  terrain *= 0.92 + 0.12*detail;
  vec3 col = mix(ocean, terrain, land);
  col = mix(col, vec3(0.92,0.94,0.96), smoothstep(0.78,0.86,lat + 0.05*n));
  float c = fbm(vLocal*4.0 + vec3(10.0));
  float cloud = smoothstep(0.12,0.45,c) * (1.0 - siteBoost*1.6);
  col = mix(col, vec3(0.95), clamp(cloud,0.0,1.0)*0.85);
  float d = dot(N,uSun);
  float day = smoothstep(-0.08,0.18,d);
  vec3 lit = col*(0.035 + 1.05*max(d,0.0));
  vec3 R = reflect(-uSun,N);
  lit += (1.0-land)*(1.0-cloud)*pow(max(dot(R,V),0.0),60.0)*0.45*day;
  // City lights on the night side
  float town = smoothstep(0.58, 0.82, snoise(vLocal*240.0)*0.5+0.5) * smoothstep(0.35, 0.9, snoise(vLocal*35.0)*0.5+0.5);
  float far = smoothstep(40.0, 400.0, length(cameraPosition - vPosW));
  lit += vec3(1.0,0.7,0.36) * town * land * (1.0 - day) * (1.0 - cloud*0.8) * 1.4 * far;
  float fres = pow(1.0-max(dot(N,V),0.0),3.0);
  lit = mix(lit, vec3(0.45,0.66,0.92)*day, fres*0.55);
  gl_FragColor = vec4(lit,1.0);
}
`;

export const ATMO_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vNormalW;
varying vec3 vPosW;
void main(){
  vec4 w = modelMatrix*vec4(position,1.0);
  vPosW = w.xyz;
  vNormalW = normalize(mat3(modelMatrix)*normal);
  gl_Position = projectionMatrix*viewMatrix*w;
  #include <logdepthbuf_vertex>
}
`;

export const ATMO_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uSun;
varying vec3 vNormalW;
varying vec3 vPosW;
void main(){
  #include <logdepthbuf_fragment>
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  float rim = pow(clamp(1.0 + dot(V,N)*1.0, 0.0, 1.0), 3.0);
  float day = smoothstep(-0.25,0.35,dot(-N,uSun)*-1.0);
  gl_FragColor = vec4(vec3(0.35,0.6,1.0)*rim*day, rim*day*0.9);
}
`;

export const PLUME_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);
  #include <logdepthbuf_vertex>
}
`;

export const PLUME_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uCore;
uniform vec3 uEdge;
uniform float uTime;
uniform float uAlpha;
uniform float uDiamonds;
varying vec2 vUv;
void main(){
  #include <logdepthbuf_fragment>
  // vUv.y: 0 at the nozzle, 1 at the tail
  float along = vUv.y;
  float flicker = 0.85 + 0.15*sin(uTime*47.0 + along*30.0)*sin(uTime*31.0);
  float body = pow(1.0-along, 1.6);
  // Mach diamonds: standing shock pattern of an over/under-expanded jet at low altitude
  float diamonds = uDiamonds * smoothstep(0.75,1.0,sin(along*20.0))*pow(1.0-along,2.0)*0.35;
  float radial = 1.0;
  vec3 col = mix(uEdge, uCore, clamp(pow(1.0-along,3.0)*1.4 + diamonds,0.0,1.0));
  float a = clamp((body*0.95 + diamonds)*flicker*uAlpha*radial, 0.0, 1.0);
  gl_FragColor = vec4(col*1.15, a);
}
`;
