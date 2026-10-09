/**
 * 輕量 360 環景檢視器（WebGL，無第三方套件）。
 * 每個螢幕像素算出視線方向 → 經緯度 → 取等距長方投影貼圖。
 * 同一份 shader 也嵌進「客戶用單檔 HTML」，客戶離線即可拖曳瀏覽。
 */

export const PANO_VERT = `attribute vec2 p;varying vec2 v;void main(){v=p;gl_Position=vec4(p,0.,1.);}`;

export const PANO_FRAG = `precision highp float;varying vec2 v;uniform sampler2D t;uniform float yaw,pitch,tf,asp;
const float PI=3.14159265359;
void main(){
  vec3 d=normalize(vec3(v.x*tf*asp,v.y*tf,1.));
  float cp=cos(pitch),sp=sin(pitch);
  d=vec3(d.x,d.y*cp+d.z*sp,-d.y*sp+d.z*cp);
  float cy=cos(yaw),sy=sin(yaw);
  d=vec3(d.x*cy+d.z*sy,d.y,-d.x*sy+d.z*cy);
  float lon=atan(d.x,d.z),lat=asin(clamp(d.y,-1.,1.));
  gl_FragColor=texture2D(t,vec2(lon/(2.*PI)+.5,.5-lat/PI));
}`;

export interface ViewState {
  yaw: number; // 度
  pitch: number;
  fov: number; // 垂直視角（度）
}

export class PanoViewer {
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private tex: WebGLTexture | null = null;
  private raf = 0;
  private drag: { x: number; y: number; yaw: number; pitch: number } | null = null;
  private pinch: { d: number; fov: number } | null = null;
  private down = new Set<number>(); // 雙指縮放時停止旋轉，避免畫面亂跳
  state: ViewState = { yaw: 0, pitch: 0, fov: 75 };
  onChange?: (s: ViewState) => void;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", { antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error("此瀏覽器不支援 WebGL，無法預覽 360。");
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, PANO_VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, PANO_FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    this.prog = prog;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.bind();
  }

  /** WebGL 1 貼圖上限，超過需先縮圖 */
  get maxTextureSize(): number {
    return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number;
  }

  setImage(src: TexImageSource) {
    const gl = this.gl;
    if (this.tex) gl.deleteTexture(this.tex);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
    // 非 2 次方尺寸：不用 mipmap，經度接縫才不會出現細線
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.request();
  }

  set(s: Partial<ViewState>) {
    this.state = {
      yaw: s.yaw ?? this.state.yaw,
      pitch: Math.max(-89, Math.min(89, s.pitch ?? this.state.pitch)),
      fov: Math.max(30, Math.min(110, s.fov ?? this.state.fov)),
    };
    this.onChange?.(this.state);
    this.request();
  }

  request() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  private draw() {
    const gl = this.gl;
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(c.clientWidth * dpr);
    const h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    gl.viewport(0, 0, w, h);
    if (!this.tex) {
      gl.clearColor(0.9, 0.9, 0.88, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    const D = Math.PI / 180;
    gl.uniform1f(gl.getUniformLocation(this.prog, "yaw"), this.state.yaw * D);
    gl.uniform1f(gl.getUniformLocation(this.prog, "pitch"), this.state.pitch * D);
    gl.uniform1f(gl.getUniformLocation(this.prog, "tf"), Math.tan((this.state.fov * D) / 2));
    gl.uniform1f(gl.getUniformLocation(this.prog, "asp"), w / Math.max(1, h));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private onDown = (e: PointerEvent) => {
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* 指標已失效時忽略 */
    }
    this.down.add(e.pointerId);
    this.drag =
      this.down.size === 1 ? { x: e.clientX, y: e.clientY, yaw: this.state.yaw, pitch: this.state.pitch } : null;
  };
  private onMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || this.down.size !== 1) return;
    const k = this.state.fov / Math.max(1, this.canvas.clientHeight);
    this.set({
      yaw: d.yaw - (e.clientX - d.x) * k,
      pitch: d.pitch + (e.clientY - d.y) * k,
    });
  };
  private onUp = (e: PointerEvent) => {
    this.down.delete(e.pointerId);
    this.drag = null;
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.set({ fov: this.state.fov + e.deltaY * 0.05 });
  };
  private onTouch = (e: TouchEvent) => {
    if (e.touches.length !== 2) {
      this.pinch = null;
      return;
    }
    const d = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY,
    );
    if (!this.pinch) this.pinch = { d, fov: this.state.fov };
    else this.set({ fov: (this.pinch.fov * this.pinch.d) / d });
  };
  private onResize = () => this.request();

  private bind() {
    const c = this.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
    c.addEventListener("wheel", this.onWheel, { passive: false });
    c.addEventListener("touchmove", this.onTouch, { passive: true });
    window.addEventListener("resize", this.onResize);
  }

  destroy() {
    const c = this.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointermove", this.onMove);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onUp);
    c.removeEventListener("wheel", this.onWheel);
    c.removeEventListener("touchmove", this.onTouch);
    window.removeEventListener("resize", this.onResize);
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.tex) this.gl.deleteTexture(this.tex);
  }
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * 產生客戶用單檔 HTML（內嵌全景 JPEG + 檢視器），可用 LINE / Email 傳送、離線開啟。
 */
export function buildViewerHtml(title: string, jpegBase64: string, note: string): string {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>${esc(title)}</title>
<style>html,body{margin:0;height:100%;background:#1c1b19;font-family:-apple-system,"Noto Sans TC","PingFang TC",sans-serif;color:#f5f4f0}
canvas{display:block;width:100%;height:100%;cursor:grab}canvas:active{cursor:grabbing}
.hud{position:fixed;left:16px;right:16px;bottom:16px;display:flex;justify-content:space-between;align-items:flex-end;gap:12px;pointer-events:none}
.card{background:rgba(28,27,25,.72);backdrop-filter:blur(8px);border-radius:10px;padding:10px 14px;font-size:13px;line-height:1.5;max-width:520px}
.card b{display:block;font-size:15px}.hint{opacity:.7;font-size:12px}</style></head>
<body><canvas id="c"></canvas>
<div class="hud"><div class="card"><b>${esc(title)}</b><span class="hint">拖曳環視 · 滾輪或雙指縮放</span>${note ? `<div class="hint">${esc(note)}</div>` : ""}</div>
<div class="card hint">璞石集團 PURE GROUP</div></div>
<script>(function(){var c=document.getElementById('c'),gl=c.getContext('webgl');if(!gl){document.body.innerHTML='<p style="padding:24px">此裝置不支援 WebGL。</p>';return;}
function sh(t,s){var x=gl.createShader(t);gl.shaderSource(x,s);gl.compileShader(x);return x;}
var p=gl.createProgram();gl.attachShader(p,sh(gl.VERTEX_SHADER,${JSON.stringify(PANO_VERT)}));gl.attachShader(p,sh(gl.FRAGMENT_SHADER,${JSON.stringify(PANO_FRAG)}));gl.linkProgram(p);gl.useProgram(p);
var b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);var l=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(l);gl.vertexAttribPointer(l,2,gl.FLOAT,false,0,0);
var S={yaw:0,pitch:0,fov:75},tex=null,raf=0,D=Math.PI/180;
function draw(){raf=0;var r=Math.min(2,devicePixelRatio||1),w=c.clientWidth*r|0,h=c.clientHeight*r|0;if(c.width!==w||c.height!==h){c.width=w;c.height=h;}gl.viewport(0,0,w,h);if(!tex)return;
gl.uniform1f(gl.getUniformLocation(p,'yaw'),S.yaw*D);gl.uniform1f(gl.getUniformLocation(p,'pitch'),S.pitch*D);gl.uniform1f(gl.getUniformLocation(p,'tf'),Math.tan(S.fov*D/2));gl.uniform1f(gl.getUniformLocation(p,'asp'),w/Math.max(1,h));gl.drawArrays(gl.TRIANGLE_STRIP,0,4);}
function req(){if(!raf)raf=requestAnimationFrame(draw);}
function set(o){if(o.yaw!==undefined)S.yaw=o.yaw;if(o.pitch!==undefined)S.pitch=Math.max(-89,Math.min(89,o.pitch));if(o.fov!==undefined)S.fov=Math.max(30,Math.min(110,o.fov));req();}
var img=new Image();img.onload=function(){var m=gl.getParameter(gl.MAX_TEXTURE_SIZE),src=img;if(img.width>m){var k=document.createElement('canvas');k.width=m;k.height=m/2;k.getContext('2d').drawImage(img,0,0,m,m/2);src=k;}
tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,src);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);req();};
img.src='data:image/jpeg;base64,${jpegBase64}';
var dr=null,pin=null;c.style.touchAction='none';
var dn={},nd=0;
c.addEventListener('pointerdown',function(e){try{c.setPointerCapture(e.pointerId);}catch(_){}if(!dn[e.pointerId]){dn[e.pointerId]=1;nd++;}dr=nd===1?{x:e.clientX,y:e.clientY,yaw:S.yaw,pitch:S.pitch}:null;});
c.addEventListener('pointermove',function(e){var d=dr;if(!d||nd!==1)return;var k=S.fov/Math.max(1,c.clientHeight);set({yaw:d.yaw-(e.clientX-d.x)*k,pitch:d.pitch+(e.clientY-d.y)*k});});
function up(e){if(dn[e.pointerId]){delete dn[e.pointerId];nd--;}dr=null;}c.addEventListener('pointerup',up);c.addEventListener('pointercancel',up);
c.addEventListener('wheel',function(e){e.preventDefault();set({fov:S.fov+e.deltaY*.05});},{passive:false});
c.addEventListener('touchmove',function(e){if(e.touches.length!==2){pin=null;return;}var d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);if(!pin)pin={d:d,fov:S.fov};else set({fov:pin.fov*pin.d/d});},{passive:true});
addEventListener('resize',req);req();})();</script></body></html>`;
}
